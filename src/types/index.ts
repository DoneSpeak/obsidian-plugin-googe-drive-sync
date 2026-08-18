// ── Auth Types ──
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiryTime: number; // epoch ms
}

// ── Drive Types ──
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum: string;
  modifiedTime: string;
  size: number;
  parents: string[];
  trashed: boolean;
}

export interface DriveFileListResponse {
  files: DriveFile[];
  nextPageToken?: string;
  incompleteSearch: boolean;
}

export interface ChangesResult {
  changes: Array<{
    type: 'file' | 'folder';
    file?: DriveFile;
    removed: boolean;
    fileId: string;
  }>;
  newStartPageToken: string;
  nextPageToken?: string;
}

// ── Config Types ──
export type SyncMode = 'manual' | 'auto_pull' | 'auto_push' | 'auto';

export interface DirectoryMapping {
  localPath: string;
  driveFolderId: string;
  driveFolderPath: string;
  enabled: boolean;
}

export interface SyncConfig {
  mode: SyncMode;
  intervalMinutes: number;
  gitEnabled: boolean;
  gitPreSyncMessage: string;
  gitPostSyncMessage: string;
}

export interface IgnoreConfig {
  patterns: string[];
  folders: string[];
  ignoreGitignore: boolean;
}

export interface PluginConfig {
  auth: {
    clientId: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiry: string;
    driveScope: string;
    encryptionKey: string;
  };
  sync: SyncConfig;
  mappings: DirectoryMapping[];
  ignore: IgnoreConfig;
}

export const DEFAULT_CONFIG: PluginConfig = {
  auth: {
    clientId: '',
    accessToken: '',
    refreshToken: '',
    tokenExpiry: '',
    driveScope: 'https://www.googleapis.com/auth/drive',
    encryptionKey: '',
  },
  sync: {
    mode: 'manual',
    intervalMinutes: 30,
    gitEnabled: true,
    gitPreSyncMessage: 'sync: pre-sync before Google Drive sync',
    gitPostSyncMessage: 'sync: post-sync after Google Drive sync',
  },
  mappings: [],
  ignore: {
    patterns: ['.DS_Store', '*.tmp'],
    folders: ['.trash', '.obsidian'],
    ignoreGitignore: true,
  },
};

// ── Sync State Types ──
export interface FileState {
  localPath: string;
  driveFileId: string;
  driveFileName: string;
  localMd5: string;
  driveMd5: string;
  localModifiedTime: string;
  driveModifiedTime: string;
  lastSyncMd5: string;
  lastSyncTime: string;
}

export interface SyncState {
  version: number;
  lastSyncTime: string;
  files: Record<string, FileState>;
  drivePageToken: string;
}

// ── Sync Plan Types ──
export type SyncActionType = 'upload' | 'download' | 'delete_local' | 'delete_drive' | 'conflict';

export interface SyncAction {
  type: SyncActionType;
  localPath: string;
  localFile?: FileInfo;
  driveFile?: DriveFile;
  resolved: boolean;
  resolution?: 'local' | 'drive' | 'both';
}

export interface SyncPlan {
  actions: SyncAction[];
  hasConflicts: boolean;
}

// ── File Info Types ──
export interface FileInfo {
  path: string;
  md5: string;
  modifiedTime: string;
  size: number;
  exists: boolean;
}

// ── Sync Result ──
export interface SyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  errors: string[];
  startTime: string;
  endTime: string;
}