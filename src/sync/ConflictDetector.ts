import { DriveFile, FileInfo, SyncPlan, SyncState, PluginConfig } from '../types';
import { IgnoreUtils } from '../utils/IgnoreUtils';
import { createSyncPlan, addAction } from './SyncPlan';

export class ConflictDetector {
  buildSyncPlan(
    localFiles: Map<string, FileInfo>,
    driveFiles: Map<string, { driveFile: DriveFile; localPath: string }>,
    syncState: SyncState,
    config: PluginConfig
  ): SyncPlan {
    const plan = createSyncPlan();
    const processedPaths = new Set<string>();

    // Process all files in sync state (previously synced files)
    for (const [localPath, fileState] of Object.entries(syncState.files)) {
      processedPaths.add(localPath);

      if (IgnoreUtils.shouldIgnore(localPath, config.ignore)) continue;
      if (!this.isInMappings(localPath, config)) continue;

      const localFile = localFiles.get(localPath);
      const driveEntry = driveFiles.get(localPath);
      const driveFile = driveEntry?.driveFile;

      const localExists = localFile?.exists ?? false;
      const driveExists = !!driveFile;

      const baselineMd5 = fileState.lastSyncMd5;

      if (!localExists && !driveExists) {
        // Both deleted — remove from state
        addAction(plan, 'delete_local', localPath);
        continue;
      }

      if (!localExists && driveExists) {
        // Local deleted, Drive still has it
        addAction(plan, 'delete_local', localPath, localFile, driveFile);
        continue;
      }

      if (localExists && !driveExists) {
        // Drive deleted, local still has it
        addAction(plan, 'delete_drive', localPath, localFile, driveFile);
        continue;
      }

      // Both exist — compare
      const localChanged = localFile!.md5 !== baselineMd5;
      const driveChanged = driveFile!.md5Checksum !== baselineMd5;

      if (!localChanged && !driveChanged) {
        continue; // No changes
      }

      if (localChanged && !driveChanged) {
        addAction(plan, 'upload', localPath, localFile, driveFile);
      } else if (!localChanged && driveChanged) {
        addAction(plan, 'download', localPath, localFile, driveFile);
      } else {
        // Both changed — CONFLICT
        addAction(plan, 'conflict', localPath, localFile, driveFile);
      }
    }

    // Process new local files (not in sync state)
    for (const [localPath, localFile] of localFiles) {
      if (processedPaths.has(localPath)) continue;
      processedPaths.add(localPath);

      if (IgnoreUtils.shouldIgnore(localPath, config.ignore)) continue;
      if (!this.isInMappings(localPath, config)) continue;

      const driveEntry = driveFiles.get(localPath);

      if (driveEntry) {
        // Exists on Drive but not in sync state — conflict or new
        if (localFile.md5 !== driveEntry.driveFile.md5Checksum) {
          addAction(plan, 'conflict', localPath, localFile, driveEntry.driveFile);
        } else {
          // Same content — just add to state, no action needed
          continue;
        }
      } else {
        addAction(plan, 'upload', localPath, localFile);
      }
    }

    // Process new Drive files (not in sync state, not already matched)
    for (const [localPath, driveEntry] of driveFiles) {
      if (processedPaths.has(localPath)) continue;

      if (IgnoreUtils.shouldIgnore(localPath, config.ignore)) continue;
      if (!this.isInMappings(localPath, config)) continue;

      addAction(plan, 'download', localPath, undefined, driveEntry.driveFile);
    }

    return plan;
  }

  private isInMappings(localPath: string, config: PluginConfig): boolean {
    for (const mapping of config.mappings) {
      if (!mapping.enabled) continue;
      const mappingPath = mapping.localPath.replace(/\/$/, '') + '/';
      if (localPath === mapping.localPath || localPath.startsWith(mappingPath)) {
        return true;
      }
    }
    return config.mappings.length === 0; // If no mappings, sync everything
  }
}