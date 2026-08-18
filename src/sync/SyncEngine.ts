import { Vault, App, Notice, normalizePath } from 'obsidian';
import { DriveClient } from '../drive/DriveClient';
import { DriveChanges } from '../drive/DriveChanges';
import { SyncStateManager } from './SyncStateManager';
import { ConflictDetector } from './ConflictDetector';
import { SettingsManager } from '../settings/SettingsManager';
import { TokenManager } from '../auth/TokenManager';
import { GitIntegration } from '../git/GitIntegration';
import { SyncPreviewModal } from '../ui/SyncPreviewModal';
import { ConflictResolutionModal } from '../ui/ConflictResolutionModal';
import { SyncStatusBar, SyncStatusState } from '../ui/SyncStatusBar';
import { FileUtils } from '../utils/FileUtils';
import { IgnoreUtils } from '../utils/IgnoreUtils';
import {
  DriveFile,
  FileInfo,
  SyncPlan,
  SyncAction,
  SyncResult,
  SyncActionType,
  PluginConfig,
} from '../types';

// ── Concurrency Helper ──
/**
 * Run async operations on an array concurrently, with a fixed concurrency limit.
 * Each item is processed independently; errors from one item don't stop others.
 */
async function concurrentForEach<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  concurrency: number
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export class SyncEngine {
  private vaultPath: string;
  private static readonly SYNC_CONCURRENCY = 5;
  private static readonly SCAN_CONCURRENCY = 10;

  constructor(
    private app: App,
    private vault: Vault,
    private driveClient: DriveClient,
    private driveChanges: DriveChanges,
    private syncStateManager: SyncStateManager,
    private conflictDetector: ConflictDetector,
    private settingsManager: SettingsManager,
    private tokenManager: TokenManager,
    private gitIntegration: GitIntegration,
    private statusBar: SyncStatusBar
  ) {
    this.vaultPath = (this.vault.adapter as any).getBasePath?.() || '';
  }

  async sync(): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      errors: [],
      startTime: new Date().toISOString(),
      endTime: '',
    };

    try {
      this.statusBar.update({ type: 'syncing', current: 0, total: 5 });

      // Check authentication
      const token = await this.tokenManager.getAccessToken();
      if (!token) {
        throw new Error('Not authenticated. Please sign in first.');
      }

      const config = this.settingsManager.getConfig();

      // Merge .gitignore patterns if enabled
      if (config.ignore.ignoreGitignore) {
        await this.mergeGitignorePatterns(config);
      }

      // Step 1: Pre-sync git commit
      this.statusBar.update({ type: 'syncing', current: 1, total: 5 });
      await this.gitIntegration.preSyncCommit(config.sync);

      // Step 2: Load sync state
      this.statusBar.update({ type: 'syncing', current: 2, total: 5 });
      const syncState = await this.syncStateManager.loadState();

      // Step 3: Gather local files
      this.statusBar.update({ type: 'syncing', current: 3, total: 5 });
      const localFiles = await this.gatherLocalFiles(config);
      console.log(`GDrive Sync: found ${localFiles.size} local files`);
      // Log first 3 file MD5s for debugging
      let logged = 0;
      for (const [path, info] of localFiles) {
        if (logged++ >= 3) break;
        console.log(`GDrive Sync: local file "${path}" md5="${info.md5}" size=${info.size}`);
      }

      // Step 4: Gather Drive files
      this.statusBar.update({ type: 'syncing', current: 4, total: 5 });
      let driveError: Error | null = null;
      let driveFiles: Map<string, { driveFile: DriveFile; localPath: string }>;
      try {
        driveFiles = await this.gatherDriveFiles(config);
      } catch (e) {
        driveError = e instanceof Error ? e : new Error(String(e));
        driveFiles = new Map();
      }
      console.log(`GDrive Sync: found ${driveFiles.size} Drive files`);

      // If Drive listing failed, stop sync to avoid misleading upload-all behavior
      if (driveError) {
        throw new Error(`Cannot list Drive files: ${driveError.message}. Sync cancelled.`);
      }

      if (driveFiles.size === 0 && localFiles.size > 0) {
        console.warn('GDrive Sync: 0 Drive files found — check folder ID and permissions');
      }

      // Step 5: Build sync plan
      const syncPlan = this.conflictDetector.buildSyncPlan(
        localFiles,
        driveFiles,
        syncState,
        config
      );

      if (syncPlan.actions.length === 0) {
        new Notice('Everything is up to date');
        console.log('GDrive Sync: sync plan has 0 actions — no changes detected');
        result.success = true;
        result.endTime = new Date().toISOString();
        this.statusBar.update({ type: 'idle', lastSync: new Date().toLocaleTimeString() });
        return result;
      }

      // Show preview modal
      const modal = new SyncPreviewModal(
        this.app,
        syncPlan,
        async (action) => this.resolveConflict(action)
      );
      const confirmed = await modal.show();

      if (!confirmed) {
        new Notice('Sync cancelled by user');
        result.endTime = new Date().toISOString();
        this.statusBar.update({ type: 'idle', lastSync: new Date().toLocaleTimeString() });
        return result;
      }

      // Execute sync actions
      const selectedActions = modal.getSelectedActions();
      await this.executeSyncActions(selectedActions, config, result);

      // Update sync state
      await this.updateSyncState(syncPlan.actions, syncState, config);

      // Post-sync git commit
      await this.gitIntegration.postSyncCommit(config.sync);

      result.success = true;
      result.endTime = new Date().toISOString();

      new Notice(
        `Sync complete: ${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.deleted} deleted`
      );

      this.statusBar.update({ type: 'idle', lastSync: new Date().toLocaleTimeString() });
    } catch (e: any) {
      result.errors.push(e.message);
      result.endTime = new Date().toISOString();
      new Notice(`Sync failed: ${e.message}`);
      this.statusBar.update({ type: 'error', message: e.message });
      console.error('Sync error:', e);
    }

    return result;
  }

  /**
   * Pull from Google Drive: one-way download only.
   * - Downloads new/changed files from Drive
   * - Deletes local files that were removed from Drive
   * - Conflicts auto-resolve to Drive version
   * - Does NOT upload local changes to Drive
   */
  async pull(): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      conflicts: 0,
      errors: [],
      startTime: new Date().toISOString(),
      endTime: '',
    };

    try {
      this.statusBar.update({ type: 'syncing', current: 0, total: 4 });

      // Check authentication
      const token = await this.tokenManager.getAccessToken();
      if (!token) {
        throw new Error('Not authenticated. Please sign in first.');
      }

      const config = this.settingsManager.getConfig();

      // Merge .gitignore patterns if enabled
      if (config.ignore.ignoreGitignore) {
        await this.mergeGitignorePatterns(config);
      }

      // Step 1: Pre-sync git commit
      this.statusBar.update({ type: 'syncing', current: 1, total: 4 });
      await this.gitIntegration.preSyncCommit(config.sync);

      // Step 2: Load sync state
      this.statusBar.update({ type: 'syncing', current: 2, total: 4 });
      const syncState = await this.syncStateManager.loadState();

      // Step 3: Gather local files
      this.statusBar.update({ type: 'syncing', current: 3, total: 4 });
      const localFiles = await this.gatherLocalFiles(config);

      // Step 4: Gather Drive files
      this.statusBar.update({ type: 'syncing', current: 4, total: 4 });
      let driveFiles: Map<string, { driveFile: DriveFile; localPath: string }>;
      try {
        driveFiles = await this.gatherDriveFiles(config);
      } catch (e) {
        throw new Error(`Cannot list Drive files: ${(e instanceof Error ? e.message : String(e))}. Pull cancelled.`);
      }

      // Build sync plan
      const syncPlan = this.conflictDetector.buildSyncPlan(
        localFiles,
        driveFiles,
        syncState,
        config
      );

      // Filter to only pull-relevant actions:
      // - Skip upload (we're pulling, not pushing)
      // - Skip delete_drive (don't delete from Drive during pull)
      const pullActions = syncPlan.actions.filter(action => {
        if (action.type === 'upload') return false;
        if (action.type === 'delete_drive') return false;
        return true;
      });

      if (pullActions.length === 0) {
        new Notice('Everything is up to date');
        result.success = true;
        result.endTime = new Date().toISOString();
        this.statusBar.update({ type: 'idle', lastSync: new Date().toLocaleTimeString() });
        return result;
      }

      // Resolve conflicts one by one if any
      const conflictActions = pullActions.filter(a => a.type === 'conflict');
      if (conflictActions.length > 0) {
        result.conflicts = conflictActions.length;
        for (const conflict of conflictActions) {
          const resolution = await this.resolveConflict(conflict);
          if (resolution) {
            conflict.resolved = true;
            conflict.resolution = resolution;
          }
        }
      }

      // Execute pull actions directly (no preview modal for non-conflict actions)
      await this.executeSyncActions(pullActions, config, result);

      // Update sync state for executed actions
      await this.updateSyncState(pullActions, syncState, config);

      // Post-sync git commit
      await this.gitIntegration.postSyncCommit(config.sync);

      result.success = true;
      result.endTime = new Date().toISOString();

      new Notice(
        `Pull complete: ${result.downloaded} downloaded, ${result.deleted} deleted`
      );

      this.statusBar.update({ type: 'idle', lastSync: new Date().toLocaleTimeString() });
    } catch (e: any) {
      result.errors.push(e.message);
      result.endTime = new Date().toISOString();
      new Notice(`Pull failed: ${e.message}`);
      this.statusBar.update({ type: 'error', message: e.message });
      console.error('Pull error:', e);
    }

    return result;
  }

  async autoPull(): Promise<void> {
    await this.sync();
  }

  private async gatherLocalFiles(config: PluginConfig): Promise<Map<string, FileInfo>> {
    const files = new Map<string, FileInfo>();

    for (const mapping of config.mappings) {
      if (!mapping.enabled) continue;
      try {
        const filePaths = await FileUtils.listFilesRecursive(this.vault, mapping.localPath);

        // Compute MD5 hashes concurrently
        const entries: Array<{ key: string; info: FileInfo }> = [];
        await concurrentForEach(filePaths, async (filePath) => {
          const relativePath = FileUtils.getRelativePath('/', filePath);
          const fileInfo = await FileUtils.getFileInfo(this.vault, filePath);
          entries.push({ key: relativePath, info: fileInfo });
        }, SyncEngine.SCAN_CONCURRENCY);

        for (const { key, info } of entries) {
          files.set(key, info);
        }
      } catch (e) {
        console.warn(`Failed to scan local path ${mapping.localPath}:`, e);
      }
    }

    return files;
  }

  private async gatherDriveFiles(
    config: PluginConfig
  ): Promise<Map<string, { driveFile: DriveFile; localPath: string }>> {
    const driveFiles = new Map<string, { driveFile: DriveFile; localPath: string }>();
    let firstError: Error | null = null;

    for (const mapping of config.mappings) {
      if (!mapping.enabled) continue;
      try {
        await this.listDriveFolderRecursive(
          mapping.driveFolderId,
          mapping.localPath.replace(/\/$/, ''),
          driveFiles
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Failed to list Drive folder ${mapping.driveFolderId}:`, e);
        if (!firstError) firstError = e instanceof Error ? e : new Error(msg);
      }
    }

    // If no Drive files were found at all and there was an error, propagate it
    if (driveFiles.size === 0 && firstError) {
      throw firstError;
    }

    return driveFiles;
  }

  private async listDriveFolderRecursive(
    folderId: string,
    parentLocalPath: string,
    result: Map<string, { driveFile: DriveFile; localPath: string }>
  ): Promise<void> {
    const files = await this.driveClient.listFiles(folderId);
    const subfolderPromises: Promise<void>[] = [];

    for (const driveFile of files) {
      // Skip folders — recurse into them instead
      if (driveFile.mimeType === 'application/vnd.google-apps.folder') {
        subfolderPromises.push(
          this.listDriveFolderRecursive(
            driveFile.id,
            `${parentLocalPath}/${driveFile.name}`,
            result
          )
        );
        continue;
      }

      const localPath = `${parentLocalPath}/${driveFile.name}`;
      result.set(localPath, { driveFile, localPath });
    }

    // Recurse into all subfolders concurrently
    await Promise.all(subfolderPromises);
  }

  private async resolveConflict(action: SyncAction): Promise<'local' | 'drive' | 'both'> {

    // Get drive file content for preview
    const getDriveContent = async (fileId: string): Promise<string> => {
      try {
        const data = await this.driveClient.downloadFile(fileId);
        return new TextDecoder().decode(data);
      } catch {
        return 'Unable to fetch Drive content';
      }
    };

    const modal = new ConflictResolutionModal(this.app, action, getDriveContent);
    return modal.show();
  }

  private async executeSyncActions(
    actions: SyncAction[],
    config: PluginConfig,
    result: SyncResult
  ): Promise<void> {
    let completed = 0;
    const total = actions.length;

    await concurrentForEach(actions, async (action) => {
      try {
        switch (action.type) {
          case 'upload':
            await this.executeUpload(action);
            result.uploaded++;
            break;

          case 'download':
            await this.executeDownload(action);
            result.downloaded++;
            break;

          case 'conflict':
            await this.executeConflictResolution(action, config);
            result.uploaded++;
            break;

          case 'delete_local':
            await this.executeLocalDelete(action);
            result.deleted++;
            break;

          case 'delete_drive':
            await this.executeDriveDelete(action);
            result.deleted++;
            break;
        }
      } catch (e: any) {
        result.errors.push(`Failed to sync ${action.localPath}: ${e.message}`);
        console.error(`Sync action failed for ${action.localPath}:`, e);
      } finally {
        completed++;
        this.statusBar.update({ type: 'syncing', current: completed, total });
      }
    }, SyncEngine.SYNC_CONCURRENCY);
  }

  private async executeUpload(action: SyncAction): Promise<void> {
    const mapping = this.findMapping(action.localPath);
    if (!mapping) return;

    const isBinary = FileUtils.isBinaryFile(action.localPath);
    let data: ArrayBuffer;

    if (isBinary) {
      data = await FileUtils.readBinary(this.vault, action.localPath);
    } else {
      const content = await FileUtils.readFileContent(this.vault, action.localPath);
      data = new TextEncoder().encode(content).buffer as ArrayBuffer;
    }

    const mimeType = isBinary
      ? FileUtils.getMimeType(action.localPath)
      : 'text/markdown';

    if (action.driveFile) {
      await this.driveClient.updateFile(action.driveFile.id, data, mimeType);
    } else {
      await this.driveClient.uploadFile(
        action.localPath.split('/').pop() || action.localPath,
        mapping.driveFolderId,
        data,
        mimeType
      );
    }
  }

  private async executeDownload(action: SyncAction): Promise<void> {
    if (!action.driveFile) return;

    const data = await this.driveClient.downloadFile(action.driveFile.id);
    const isBinary = this.isBinaryMime(action.driveFile.mimeType);

    // Ensure parent directory exists
    const parentDir = action.localPath.substring(0, action.localPath.lastIndexOf('/'));
    if (parentDir) {
      const dirExists = await FileUtils.fileExists(this.vault, parentDir);
      if (!dirExists) {
        await this.vault.adapter.mkdir(normalizePath(parentDir));
      }
    }

    if (isBinary) {
      await FileUtils.writeBinary(this.vault, action.localPath, data);
    } else {
      const content = new TextDecoder().decode(data);
      await FileUtils.writeFileContent(this.vault, action.localPath, content);
    }
  }

  private async executeConflictResolution(action: SyncAction, config: PluginConfig): Promise<void> {
    if (!action.resolved || !action.resolution) return;

    switch (action.resolution) {
      case 'local':
        // Upload local version to Drive
        await this.executeUpload(action);
        break;

      case 'drive':
        // Download Drive version
        await this.executeDownload(action);
        break;

      case 'both':
        // Keep local version, download Drive version with renamed local file
        if (action.driveFile) {
          const data = await this.driveClient.downloadFile(action.driveFile.id);
          const isBinary = this.isBinaryMime(action.driveFile.mimeType);

          // Save Drive version as .drive-conflict copy
          const conflictPath = action.localPath.replace(
            /(\.[^.]+)$/,
            '.drive-conflict$1'
          );

          if (isBinary) {
            await FileUtils.writeBinary(this.vault, conflictPath, data);
          } else {
            const content = new TextDecoder().decode(data);
            await FileUtils.writeFileContent(this.vault, conflictPath, content);
          }
        }
        break;
    }
  }

  private async executeLocalDelete(action: SyncAction): Promise<void> {
    await FileUtils.deleteFile(this.vault, action.localPath);
  }

  private async executeDriveDelete(action: SyncAction): Promise<void> {
    if (action.driveFile) {
      await this.driveClient.deleteFile(action.driveFile.id);
    }
  }

  private async updateSyncState(
    actions: SyncAction[],
    syncState: any,
    config: PluginConfig
  ): Promise<void> {
    for (const action of actions) {
      if (action.type === 'conflict' && !action.resolved) continue;

      const fileState = syncState.files[action.localPath] || {};
      fileState.localPath = action.localPath;

      if (action.driveFile) {
        fileState.driveFileId = action.driveFile.id;
        fileState.driveFileName = action.driveFile.name;
        fileState.driveMd5 = action.driveFile.md5Checksum;
        fileState.driveModifiedTime = action.driveFile.modifiedTime;
      }

      if (action.localFile) {
        fileState.localMd5 = action.localFile.md5;
        fileState.localModifiedTime = action.localFile.modifiedTime;
      }

      // Update baseline md5 to reflect what was synced
      if (action.type === 'upload' || (action.type === 'conflict' && action.resolution === 'local')) {
        fileState.lastSyncMd5 = action.localFile?.md5 || '';
        fileState.driveMd5 = action.localFile?.md5 || ''; // Drive now matches local
      } else if (action.type === 'download' || (action.type === 'conflict' && action.resolution === 'drive')) {
        fileState.lastSyncMd5 = action.driveFile?.md5Checksum || '';
        fileState.localMd5 = action.driveFile?.md5Checksum || ''; // Local now matches Drive
      } else if (action.type === 'delete_local' || action.type === 'delete_drive') {
        delete syncState.files[action.localPath];
        continue;
      }

      fileState.lastSyncTime = new Date().toISOString();
      syncState.files[action.localPath] = fileState;
    }

    syncState.lastSyncTime = new Date().toISOString();
    await this.syncStateManager.saveState(syncState);
  }

  private findMapping(localPath: string): { localPath: string; driveFolderId: string } | null {
    const config = this.settingsManager.getConfig();
    for (const mapping of config.mappings) {
      if (!mapping.enabled) continue;
      const mappingPath = mapping.localPath.replace(/\/$/, '') + '/';
      if (localPath === mapping.localPath || localPath.startsWith(mappingPath)) {
        return mapping;
      }
    }
    return null;
  }

  /**
   * Determine if a MIME type represents binary data that cannot be
   * safely decoded as text.
   */
  private isBinaryMime(mimeType: string): boolean {
    if (!mimeType) return false;
    // Text types are safe to decode as string
    if (mimeType.startsWith('text/')) return false;
    // JSON is text
    if (mimeType === 'application/json') return false;
    // XML / SVG are text
    if (mimeType === 'application/xml' || mimeType === 'image/svg+xml') return false;
    // JavaScript is text
    if (mimeType === 'application/javascript') return false;
    // Everything else (images, PDFs, video, audio, binary blobs) is binary
    return true;
  }

  /**
   * Read .gitignore files from the vault and merge their patterns
   * into the config's ignore rules. This allows the sync engine to
   * automatically skip files that are git-ignored.
   */
  private async mergeGitignorePatterns(config: PluginConfig): Promise<void> {
    try {
      // Read the root .gitignore
      const gitignorePath = normalizePath('.gitignore');
      const exists = await this.vault.adapter.exists(gitignorePath);
      if (!exists) return;

      const content = await this.vault.adapter.read(gitignorePath);
      const parsed = IgnoreUtils.parseGitignoreContent(content);

      // Merge parsed patterns into config (avoid duplicates)
      for (const pattern of parsed.patterns) {
        if (!config.ignore.patterns.includes(pattern)) {
          config.ignore.patterns.push(pattern);
        }
      }
      for (const folder of parsed.folders) {
        if (!config.ignore.folders.includes(folder)) {
          config.ignore.folders.push(folder);
        }
      }

      console.log(`GDrive Sync: merged ${parsed.patterns.length} patterns and ${parsed.folders.length} folders from .gitignore`);
    } catch (e) {
      console.warn('GDrive Sync: failed to read .gitignore:', e);
    }
  }
}