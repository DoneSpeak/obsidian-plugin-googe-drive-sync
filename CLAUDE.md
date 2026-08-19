# CLAUDE.md

Obsidian 社区插件 **OmniSync GDrive**（插件 ID `gdrive-bisync`）：将 Obsidian 仓库与 Google Drive 双向同步（含冲突解析、Pull-only、Git 集成）。

## 常用命令

- 构建：`npm run build`（产出 `main.js`）
- 本地发布打包：`bash build/build-release.sh`（产出 `dist/gdrive-bisync.zip`）
- 自动发布：推送 tag 触发 `.github/workflows/release.yml`，从 `main.js` + `manifest.json` + `styles.css` 生成 GitHub Release

## 发布流程（Release）

每次发布按以下步骤执行：

1. 同步更新版本号：`manifest.json`、`package.json`、`versions.json`
   - `versions.json` 中新增条目 `"<新版本>": "<minAppVersion>"`（当前 minAppVersion 为 `1.5.0`）
2. `git add` 全部改动并 commit（遵循历史习惯，如 `chore: bump version to X.Y.Z`）
3. 打 tag：`git tag X.Y.Z`
4. 推送：`git push && git push --tags` —— 推送 tag 会触发 release workflow 自动打包发布

> 注意：插件 ID 为 `gdrive-bisync`，安装目录与配置路径 `.obsidian/plugins/gdrive-bisync/` 必须与此一致。遵循 Obsidian 社区插件规范：发布 tag 为裸版本号（如 `1.0.4`，不带 `v`）；发布产物为扁平文件 `main.js`/`manifest.json`/`styles.css`（社区安装器直接使用）；`gdrive-bisync.zip` 仅为手动/BRAT 安装的附加产物。

> 发布记录不写入 CLAUDE.md，发布历史以 git tag 和 GitHub Releases 为准。
