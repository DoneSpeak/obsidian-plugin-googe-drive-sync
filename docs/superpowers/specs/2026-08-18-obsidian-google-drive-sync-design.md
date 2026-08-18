# Obsidian Google Drive Sync 插件 — 设计文档

> 版本: 1.0
> 日期: 2026-08-18
> 状态: 已批准

## 1. 概述

一个 Obsidian 插件，实现 Vault 与 Google Drive 的双向同步，面向团队协作场景。支持目录映射配置、忽略规则、冲突检测与手动解决、Git 自动提交。

## 2. 需求清单

| 需求 | 说明 |
|------|------|
| 双向同步 | 本地 ↔ Google Drive 双向文件同步 |
| 目录映射 | 支持多条映射规则，每条映射本地目录到 Drive 文件夹 |
| 忽略规则 | 按文件类型（`.tmp`）和目录（`.trash`）忽略 |
| 同步模式 | 手动、自动拉取（自动下载+手动上传）、自动推送、全自动双向 |
| 冲突处理 | 三方对比（本地 vs Drive vs 基线），用户手动选择版本 |
| 同步预览 | 执行前展示变更清单，用户确认后执行 |
| Git 集成 | 同步前后自动 git commit（可配置开关） |
| 团队协作 | 支持多人编辑同一 Vault，通过冲突检测避免覆盖他人修改 |
| Google 认证 | OAuth 设备码流程，无需浏览器能力 |

## 3. 架构

### 3.1 组件图

```
┌──────────────────────────────────────────────────────────────┐
│                    Obsidian Plugin (main.ts)                   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
│  │ Settings   │  │  Auth    │  │  Drive    │  │  Sync    │  │
│  │  Module    │  │  Module  │  │  Client   │  │  Engine  │  │
│  │            │  │          │  │           │  │          │  │
│  │ 配置UI     │  │ OAuth    │  │ API调用   │  │冲突检测  │  │
│  │ 映射管理   │  │ Token管理│  │ 上传/下载 │  │同步计划  │  │
│  └────────────┘  └──────────┘  └───────────┘  └─────┬────┘  │
│                                                      │       │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐    │       │
│  │   Git     │  │  Sync      │  │  UI 组件     │    │       │
│  │  集成     │  │  State     │  │              │    │       │
│  │           │  │            │  │ 冲突弹窗     │◄───┘       │
│  │自动commit │  │sync-state  │  │ 同步预览     │            │
│  └────────────┘  └────────────┘  └──────────────┘            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 核心模块职责

| 模块 | 职责 |
|------|------|
| **Settings Module** | 设置界面：OAuth 认证、目录映射配置、忽略规则、同步模式、Git 开关 |
| **Auth Module** | 实现 Google OAuth 设备码流程，管理 Token 的存储和刷新 |
| **Drive Client** | 封装 Google Drive API v3：文件列表、上传、下载、删除、获取元数据 |
| **Sync Engine** | 核心调度器：协调各模块执行同步流程，生成同步计划 |
| **Conflict Detector** | 三方对比引擎：本地 vs Drive vs 上次同步基线 |
| **Sync State** | 维护 `sync-state.json`，记录每个文件的 md5 和修改时间 |
| **Git Integration** | 同步前后自动 git commit（可配置） |
| **UI 组件** | 同步预览弹窗、冲突解决弹窗、状态栏显示 |

## 4. 同步流程

```
触发同步（自动/手动）
  │
  ▼
1. 同步前 git commit（可选）
  │
  ▼
2. 获取 Drive 文件列表（含 md5, modifiedTime）
  │
  ▼
3. 扫描本地文件（含 md5, modifiedTime）
  │
  ▼
4. 三方对比：本地 vs Drive vs 基线 sync-state
  │
  ▼
5. 生成同步计划（上传/下载/冲突/删除）
  │
  ▼
6. UI 展示同步计划给用户确认
  │
  ▼
7. 执行同步（上传/下载/删除）
  │
  ▼
8. 同步后 git commit（可选）
  │
  ▼
9. 更新 sync-state.json
```

## 5. 详细设计

### 5.1 Settings Module — 配置结构

配置文件路径: `.obsidian/plugins/google-drive-sync/data.json`

```typescript
interface PluginConfig {
  auth: {
    clientId: string
    accessToken: string          // 加密存储
    refreshToken: string         // 加密存储
    tokenExpiry: string          // ISO 8601
    driveScope: string           // 固定为 "https://www.googleapis.com/auth/drive.file"
  }
  sync: {
    mode: 'manual' | 'auto_pull' | 'auto_push' | 'auto'
    intervalMinutes: number      // 自动同步间隔，默认 30
    gitEnabled: boolean          // 是否启用 git 自动 commit
    gitPreSyncMessage: string    // 同步前 commit message
    gitPostSyncMessage: string   // 同步后 commit message
  }
  mappings: Array<{
    localPath: string            // 相对于 vault 根目录
    driveFolderId: string        // Drive 文件夹 ID
    driveFolderPath: string      // Drive 文件夹路径（展示用）
    enabled: boolean
  }>
  ignore: {
    patterns: string[]           // glob 模式，如 .DS_Store, *.tmp
    folders: string[]            // 目录名，如 .trash, .obsidian
  }
}
```

### 5.2 Auth Module — OAuth 设备码流程

```
1. 用户点击 "开始 OAuth 认证"
   → POST https://oauth2.googleapis.com/device/code
   → 返回 { device_code, user_code, verification_url, interval }

2. 插件显示弹窗，提示用户访问 verification_url 并输入 user_code

3. 用户授权后，插件轮询 Token 端点
   → POST https://oauth2.googleapis.com/token
   → 返回 { access_token, refresh_token, expires_in }

4. Token 加密存储，refresh_token 用于自动刷新
```

Token 管理策略:
- Access Token 过期前 5 分钟自动刷新
- 使用 Obsidian 的 `crypto.randomBytes` 派生加密密钥
- Token 存储前用 AES-256-GCM 加密

### 5.3 Drive Client — API 封装

```typescript
class DriveClient {
  // 认证
  authenticate(deviceCode: DeviceCodeResponse): Promise<Token>
  refreshToken(): Promise<void>
  isAuthenticated(): boolean

  // 文件操作
  listFiles(folderId: string): Promise<DriveFile[]>
  getFile(fileId: string): Promise<DriveFile>
  downloadFile(fileId: string, localPath: string): Promise<void>
  uploadFile(localPath: string, parentFolderId: string): Promise<DriveFile>
  updateFile(fileId: string, localPath: string): Promise<DriveFile>
  deleteFile(fileId: string): Promise<void>
  createFolder(name: string, parentFolderId: string): Promise<DriveFile>

  // 增量变更追踪
  getChanges(pageToken: string): Promise<ChangesResult>
  getStartPageToken(): Promise<string>
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  md5Checksum: string
  modifiedTime: string           // ISO 8601
  size: number
  parents: string[]
  trashed: boolean
}
```

关键实现:
- 分页自动处理（pageToken）
- >5MB 文件使用可恢复上传（resumable upload）
- 429 错误使用指数退避重试
- 所有请求带超时和取消信号

### 5.4 Sync State — 同步状态管理

文件路径: `.obsidian/plugins/google-drive-sync/sync-state.json`
（不参与 git 追踪，在 .gitignore 中排除）

```typescript
interface SyncState {
  version: 1
  lastSyncTime: string               // ISO 8601
  files: Record<string, FileState>   // key = 相对路径
  drivePageToken: string             // Drive 增量同步 token
}

interface FileState {
  localPath: string
  driveFileId: string
  driveFileName: string
  localMd5: string
  driveMd5: string
  localModifiedTime: string
  driveModifiedTime: string
  lastSyncMd5: string                // 基线
  lastSyncTime: string
}
```

### 5.5 Conflict Detector — 三方对比引擎

对比本地、Drive 和基线（lastSyncMd5）三个状态：

| 本地 vs 基线 | Drive vs 基线 | 结论 | 动作 |
|:---:|:---:|------|------|
| = | = | 无变更 | 跳过 |
| ≠ | = | 仅本地变更 | 上传到 Drive |
| = | ≠ | 仅 Drive 变更 | 下载到本地 |
| ≠ | ≠ | **冲突** | 用户选择 |
| 新增(本地) | — | 本地新增 | 上传 |
| — | 新增(Drive) | Drive 新增 | 下载 |
| 已删除 | ≠ | 本地删除 | 询问是否删除 Drive 端 |
| ≠ | 已删除 | Drive 删除 | 询问是否删除本地 |
| 已删除 | = | 双方删除 | 同步删除 |

### 5.6 Git Integration — Git 自动提交

```
同步开始
  │
  ├─ gitEnabled=true ──► git add -A
  │                        │
  │                        ▼
  │                   git commit -m "sync: pre-sync ..."
  │                        │
  │                        ▼
  │                   git push (可选，如果配置了 remote)
  │
  ▼
执行同步（上传/下载）
  │
  ├─ gitEnabled=true ──► git add -A
  │                        │
  │                        ▼
  │                   git commit -m "sync: post-sync ..."
  │                        │
  │                        ▼
  │                   git push (可选)
  │
  ▼
同步完成
```

### 5.7 UI 组件

#### 同步预览弹窗
- 分组展示：上传、下载、冲突、删除
- 每条变更带 checkbox，用户可取消个别操作
- 冲突项高亮显示，点击进入冲突解决

#### 冲突解决弹窗
- 左右对比显示本地版本和 Drive 版本
- 显示各自的修改时间和大小
- 操作按钮：保留本地、保留 Drive、保留双方（本地重命名）
- 可选：查看 git diff

#### 状态栏
- 显示当前同步状态：空闲、同步中、冲突待解决、认证失败
- 显示上次同步时间

## 6. 文件结构

```
src/
├── main.ts                         # 插件入口
├── settings/
│   ├── SettingsTab.ts              # 设置界面
│   └── SettingsManager.ts          # 配置读写验证
├── auth/
│   ├── OAuthClient.ts              # 设备码流程
│   └── TokenManager.ts             # Token 加密存储
├── drive/
│   ├── DriveClient.ts              # API 封装
│   ├── DriveFile.ts                # 数据类型
│   └── DriveChanges.ts             # 增量变更
├── sync/
│   ├── SyncEngine.ts               # 同步调度器
│   ├── ConflictDetector.ts         # 三方对比
│   ├── SyncStateManager.ts         # 状态文件管理
│   └── SyncPlan.ts                 # 同步计划模型
├── git/
│   └── GitIntegration.ts           # git 自动 commit
├── ui/
│   ├── SyncPreviewModal.ts         # 同步预览弹窗
│   ├── ConflictResolutionModal.ts  # 冲突解决弹窗
│   └── SyncStatusBar.ts            # 状态栏
├── utils/
│   ├── CryptoUtils.ts              # Token 加密
│   ├── IgnoreUtils.ts              # 忽略规则匹配
│   └── FileUtils.ts                # 哈希、路径处理
└── types/
    └── index.ts                    # 共享类型定义
```

## 7. 错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| 网络错误 | 指数退避重试 3 次，失败后提示用户 |
| 认证过期 | 尝试 refresh token，失败则提示重新认证 |
| Drive API 限流 | 等待 `Retry-After` 后重试 |
| 文件冲突 | 标记为冲突，等待用户解决 |
| 大文件传输中断 | 断点续传（Drive API 支持） |
| Git 操作失败 | 记录错误，不中断同步流程 |

## 8. 限制与假设

- 依赖 Google Drive API v3，需要网络连接
- 文件大小限制：Drive API 单文件上传限制 5 TB（实践中注意大文件同步时间）
- 同步频率不能低于 5 分钟（避免 API 限流）
- 假设 vault 已初始化 git 仓库（如果启用 git 功能）
- 加密 Token 仅在当前设备可用，跨设备需要重新认证