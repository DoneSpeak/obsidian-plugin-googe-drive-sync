import { normalizePath, Vault } from 'obsidian';
import { SyncState, FileState } from '../types';

export class SyncStateManager {
  private state: SyncState | null = null;
  private readonly statePath: string;

  constructor(
    private vault: Vault,
    pluginDir: string
  ) {
    this.statePath = normalizePath(`${pluginDir}/sync-state.json`);
  }

  async loadState(): Promise<SyncState> {
    if (this.state) return this.state;

    try {
      const exists = await this.vault.adapter.exists(this.statePath);
      if (exists) {
        const content = await this.vault.adapter.read(this.statePath);
        this.state = JSON.parse(content) as SyncState;
        return this.state!;
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('Failed to load sync state:', message);
    }

    // Return default state
    this.state = {
      version: 1,
      lastSyncTime: '',
      files: {},
      drivePageToken: '',
    };
    return this.state;
  }

  async saveState(state: SyncState): Promise<void> {
    this.state = state;
    try {
      await this.vault.adapter.write(this.statePath, JSON.stringify(state, null, 2));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('Failed to save sync state:', message);
    }
  }

  getFileState(localPath: string): FileState | undefined {
    return this.state?.files[localPath];
  }

  async updateFileState(localPath: string, fileState: FileState): Promise<void> {
    if (!this.state) await this.loadState();
    if (this.state) {
      this.state.files[localPath] = fileState;
      await this.saveState(this.state);
    }
  }

  async removeFileState(localPath: string): Promise<void> {
    if (!this.state) await this.loadState();
    if (this.state) {
      delete this.state.files[localPath];
      await this.saveState(this.state);
    }
  }

  async clearAllFileStates(): Promise<void> {
    if (!this.state) await this.loadState();
    if (this.state) {
      this.state.files = {};
      await this.saveState(this.state);
    }
  }

  getState(): SyncState | null {
    return this.state;
  }
}