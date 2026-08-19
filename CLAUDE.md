# CLAUDE.md

Obsidian 社区插件 **OmniSync GDrive**（插件 ID `gdrive-bisync`）：将 Obsidian 仓库与 Google Drive 双向同步（含冲突解析、Pull-only、Git 集成）。

## 常用命令

- 构建：`npm run build`（产出 `main.js`）
- 本地发布打包：`bash build/build-release.sh`（产出 `dist/gdrive-sync.zip`）
- 自动发布：推送 tag 触发 `.github/workflows/release.yml`，从 `main.js` + `manifest.json` + `styles.css` 生成 GitHub Release

## 发布流程（Release）

每次发布按以下步骤执行：

1. 同步更新版本号：`manifest.json`、`package.json`、`versions.json`
   - `versions.json` 中新增条目 `"<新版本>": "<minAppVersion>"`（当前 minAppVersion 为 `1.5.0`）
2. `git add` 全部改动并 commit（遵循历史习惯，如 `chore: bump version to X.Y.Z`）
3. 打 tag：`git tag X.Y.Z`
4. 推送：`git push && git push --tags` —— 推送 tag 会触发 release workflow 自动打包发布

> 注意：插件 ID 为 `gdrive-bisync`，安装目录与配置路径 `.obsidian/plugins/gdrive-bisync/` 必须与此一致；`build-release.sh` 中的 `gdrive-sync` 仅是 zip 压缩包的文件名。

## 发布记录

### v1.0.3（2026-08-19）

修正 README 与实现之间的偏差：

- 插件 ID / 安装目录（`gdrive-bisync`）、Releases 链接（`DoneSpeak/obsidian-plugin-googe-drive-sync`）、社区插件搜索名（OmniSync GDrive）
- OAuth 配置步骤：设备码流程无需重定向 URI；登录入口是「Sign in with Google」（Client ID 在弹窗中输入）；连接验证使用目录映射区的 **Test All**
- 补充命令表中缺失的 **Resolve pending conflicts**；修正「Visual diff」等不实功能描述
- 数据文件路径 `.obsidian/plugins/gdrive-bisync/data.json`、token 刷新/清空行为等安全说明
