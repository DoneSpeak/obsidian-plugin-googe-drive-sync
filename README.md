# OmniSync GDrive

Synchronize your Obsidian vault with Google Drive. Bidirectional sync with conflict resolution, pull-only mode, and git integration.

## Features

- **Bidirectional Sync** — Keep your vault and Google Drive in sync
- **Pull Only** — One-way download from Drive, skip local uploads
- **Conflict Resolution** — Compare local and Drive versions, keep local / Drive / both per file
- **Sync Preview** — Review all changes before executing
- **Multiple Directory Mappings** — Sync different vault folders to different Drive folders
- **Shared Drive Support** — Works with Google Shared Drives
- **Git Integration** — Auto-commit before and after sync for version history
- **Ignore Rules** — Skip files/folders via patterns (`.gitignore` compatible)
- **Test All** — Verify all Drive folder connections with visual indicators

## Installation

### From Obsidian Community Plugins (pending)

1. Open **Settings** → **Community Plugins** → **Browse**
2. Search for "OmniSync GDrive"
3. Tap **Install** then **Enable**

### Manual Installation

1. Download the latest `gdrive-sync.zip` from the [releases page](https://github.com/DoneSpeak/obsidian-plugin-googe-drive-sync/releases)
2. Unzip into your vault's `.obsidian/plugins/gdrive-bisync/` folder (the folder name must match the plugin ID)
3. Enable the plugin in **Settings** → **Community Plugins**

## Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select an existing one
3. Go to **APIs & Services** → **Library** and enable **Google Drive API**
4. Go to **APIs & Services** → **Credentials**
5. Click **Create Credentials** → **OAuth 2.0 Client ID**
   - Application type: **Desktop app**
   - **Only if you plan to use the manual OAuth Playground token method:** add `https://developers.google.com/oauthplayground` to **Authorized redirect URIs**. The standard device-code flow does not require a redirect URI.
6. Copy the **Client ID**

### 2. Configure the Plugin

1. Open **Settings** → **OmniSync GDrive**
2. Click **Sign in with Google**
3. Enter your **Client ID** when prompted and follow the device code flow
4. After signing in, the status bar shows `☁️ GDrive: idle`. Use **Test All** in the **Directory Mappings** section to verify folder access

> **Alternative:** the **Manual Token Setup (OAuth Playground)** section in settings lets you paste tokens obtained from [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground).

### 3. Add Directory Mappings

1. In the **Directory Mappings** section, use the **Add** button to create a mapping
2. Set **Local Path** — the vault folder to sync (e.g., `Documents`)
3. Set **Drive Folder ID** — the Google Drive folder ID (from the URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`)
4. Click **Test All** to verify enabled folder connections (green ✓ / red ✗ status indicators)
5. Enable the mapping

## Usage

### Commands

| Command | Description |
|---------|-------------|
| **Sync now with Google Drive** | Full bidirectional sync (upload + download + delete) |
| **Pull from Google Drive** | One-way download only (no uploads, no Drive deletions) |
| **Show sync status** | Display last sync time and synced file count |
| **Resolve pending conflicts** | Currently shows sync status (same as above); conflict review is handled inside the sync/pull flow |

### Sync Behavior

| Action | Sync | Pull |
|--------|------|------|
| Local file changed → upload to Drive | ✅ | ❌ Skipped |
| Drive file changed → download to local | ✅ | ✅ |
| Local file deleted → delete from Drive | ✅ | ❌ Skipped |
| Drive file deleted → delete locally | ✅ | ✅ |
| Conflict (both changed) | Prompt for resolution | Prompt for resolution |

### Ignore Rules

Files and folders can be ignored during sync:

- **Patterns** — Glob patterns (e.g., `*.tmp`, `.DS_Store`)
- **Folders** — Directory names to skip (e.g., `.trash`, `.obsidian`)
- **Gitignore** — Auto-merge patterns from your vault's `.gitignore`

## Configuration

All settings are stored in `.obsidian/plugins/gdrive-bisync/data.json`:

- **OAuth** — Client ID, encrypted tokens, token expiry
- **Sync Mode** — Manual, auto-pull, auto-push, or full auto
- **Sync Interval** — Auto-sync interval in minutes (default: 30)
- **Directory Mappings** — Local path ↔ Drive folder ID pairs
- **Ignore Rules** — Patterns and folders to exclude
- **Git Integration** — Auto-commit before/after sync

## Security

- OAuth tokens are encrypted with **AES-256-GCM** before storage
- The encryption key is generated at runtime and stored in the plugin config
- **Note:** The encryption key and encrypted tokens reside in the same config file (`data.json`). This is standard for Obsidian plugins but means anyone with filesystem access to your vault can decrypt the tokens. Treat your vault's config with the same care as your credentials.
- Token refresh happens transparently using the stored refresh token. If refresh or decryption fails, the tokens are cleared and you must sign in again.

## Development

### Prerequisites

- Node.js 18+
- npm

### Build

```bash
npm install
npm run build
```

Output: `main.js`

### Release

```bash
bash build/build-release.sh
```

Output: `dist/gdrive-sync.zip`

### Project Structure

```
src/
├── auth/            # OAuth device code flow, token management
│   ├── OAuthClient.ts
│   └── TokenManager.ts
├── drive/           # Google Drive API client
│   ├── DriveClient.ts
│   ├── DriveChanges.ts
│   └── DriveFile.ts
├── git/             # Git integration
│   └── GitIntegration.ts
├── settings/        # Plugin settings UI and config
│   ├── SettingsManager.ts
│   └── SettingsTab.ts
├── sync/            # Sync engine and conflict detection
│   ├── ConflictDetector.ts
│   ├── SyncEngine.ts
│   ├── SyncPlan.ts
│   └── SyncStateManager.ts
├── types/           # TypeScript type definitions
│   └── index.ts
├── ui/              # Modal dialogs and status bar
│   ├── ConflictResolutionModal.ts
│   ├── SyncPreviewModal.ts
│   └── SyncStatusBar.ts
├── utils/           # Utilities
│   ├── CryptoUtils.ts
│   ├── FileUtils.ts
│   └── IgnoreUtils.ts
└── main.ts          # Plugin entry point
```

## License

MIT