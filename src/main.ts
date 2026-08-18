import { Plugin, normalizePath, Notice, Modal, DataAdapter } from 'obsidian';
import { SettingsManager } from './settings/SettingsManager';
import { GoogleDriveSyncSettingTab } from './settings/SettingsTab';
import { OAuthClient } from './auth/OAuthClient';
import { TokenManager } from './auth/TokenManager';
import { DriveClient } from './drive/DriveClient';
import { DriveChanges } from './drive/DriveChanges';
import { SyncStateManager } from './sync/SyncStateManager';
import { ConflictDetector } from './sync/ConflictDetector';
import { SyncEngine } from './sync/SyncEngine';
import { SyncStatusBar } from './ui/SyncStatusBar';
import { GitIntegration } from './git/GitIntegration';

export default class GoogleDriveSyncPlugin extends Plugin {
  settingsManager!: SettingsManager;
  oauthClient!: OAuthClient;
  tokenManager!: TokenManager;
  driveClient!: DriveClient;
  driveChanges!: DriveChanges;
  syncStateManager!: SyncStateManager;
  conflictDetector!: ConflictDetector;
  syncEngine!: SyncEngine;
  gitIntegration!: GitIntegration;
  syncStatusBar!: SyncStatusBar;

  private syncTimer: number | null = null;

  async onload(): Promise<void> {
    // Initialize modules
    const pluginDir = normalizePath(`${this.manifest.dir || ''}`);
    const vaultAdapter = this.app.vault.adapter;
    const vaultPath = this.getVaultBasePath(vaultAdapter);

    // Settings
    this.settingsManager = new SettingsManager(vaultAdapter, pluginDir);
    await this.settingsManager.loadConfig();

    // Auth
    this.oauthClient = new OAuthClient();
    this.tokenManager = new TokenManager(this.settingsManager, this.oauthClient);
    await this.tokenManager.initialize();

    // Drive
    this.driveClient = new DriveClient(this.tokenManager);
    this.driveChanges = new DriveChanges(this.tokenManager);

    // Sync
    this.syncStateManager = new SyncStateManager(this.app.vault, pluginDir);
    this.conflictDetector = new ConflictDetector();

    // Git
    this.gitIntegration = new GitIntegration(vaultPath);

    // UI
    this.syncStatusBar = new SyncStatusBar(this);

    // Sync Engine
    this.syncEngine = new SyncEngine(
      this.app,
      this.app.vault,
      this.driveClient,
      this.driveChanges,
      this.syncStateManager,
      this.conflictDetector,
      this.settingsManager,
      this.tokenManager,
      this.gitIntegration,
      this.syncStatusBar
    );

    // Register settings tab
    this.addSettingTab(new GoogleDriveSyncSettingTab(this.app, this, this.settingsManager));

    // Register commands
    this.addCommand({
      id: 'trigger-sync',
      name: 'Sync now with Google Drive',
      callback: () => this.triggerSync(),
    });

    this.addCommand({
      id: 'trigger-pull',
      name: 'Pull from Google Drive',
      callback: () => this.triggerPull(),
    });

    this.addCommand({
      id: 'show-sync-status',
      name: 'Show sync status',
      callback: () => this.showSyncStatus(),
    });

    this.addCommand({
      id: 'resolve-conflicts',
      name: 'Resolve pending conflicts',
      callback: () => this.showSyncStatus(),
    });

    // Start auto sync if configured
    this.startAutoSync();

    // Update status bar
    this.updateStatusBar();
  }

  onunload(): void {
    this.stopAutoSync();
    this.syncStatusBar.dispose();
  }

  async startOAuthFlow(): Promise<void> {
    // Show prompt for Client ID
    const clientId = await this.promptForClientId();
    if (!clientId) return;

    try {
      const deviceCode = await this.oauthClient.startDeviceCodeFlow(clientId);
      this.showDeviceCodeModal(deviceCode.verification_url, deviceCode.user_code);

      const token = await this.oauthClient.pollForToken(
        clientId,
        deviceCode.device_code,
        deviceCode.interval
      );

      await this.tokenManager.storeTokens(
        clientId,
        token.access_token,
        token.refresh_token || '',
        token.expires_in
      );

      new Notice('Successfully connected to Google Drive!');
      this.updateStatusBar();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      new Notice(`Authentication failed: ${message}`);
    }
  }

  async saveManualTokens(clientId: string, accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
    await this.tokenManager.storeTokens(clientId, accessToken, refreshToken, expiresIn);
    this.updateStatusBar();
  }

  async triggerSync(): Promise<void> {
    await this.syncEngine.sync();
    this.updateStatusBar();
  }

  async triggerPull(): Promise<void> {
    await this.syncEngine.pull();
    this.updateStatusBar();
  }

  async showSyncStatus(): Promise<void> {
    const config = this.settingsManager.getConfig();
    const isLoggedIn = !!config.auth.accessToken;

    let message = '';
    if (!isLoggedIn) {
      message = 'Not connected to Google Drive';
    } else {
      const state = await this.syncStateManager.loadState();
      const fileCount = Object.keys(state.files).length;
      message = `Synced ${fileCount} files. Last sync: ${
        state.lastSyncTime ? new Date(state.lastSyncTime).toLocaleString() : 'never'
      }`;
    }

    new Notice(message);
  }

  private async promptForClientId(): Promise<string | null> {
    return new Promise(resolve => {
      const modal = new Modal(this.app);
      modal.titleEl.setText('Google OAuth Setup');
      modal.contentEl.createEl('p', {
        text: 'Enter your Google OAuth Client ID. Create one at https://console.cloud.google.com/apis/credentials',
      });

      const input = modal.contentEl.createEl('input', {
        type: 'text',
        placeholder: 'Client ID',
        cls: 'gdrive-sync-full-width gdrive-sync-mb-1',
      });

      const buttonRow = modal.contentEl.createDiv({ cls: 'gdrive-sync-btn-row-end' });

      const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
      cancelBtn.onclick = () => {
        modal.close();
        resolve(null);
      };

      const confirmBtn = buttonRow.createEl('button', { text: 'Continue' });
      confirmBtn.className = 'mod-cta';
      confirmBtn.onclick = () => {
        const value = input.value.trim();
        if (value) {
          modal.close();
          resolve(value);
        }
      };

      modal.open();
    });
  }

  private showDeviceCodeModal(verificationUrl: string, userCode: string): void {
    const modal = new Modal(this.app);
    modal.titleEl.setText('Google Drive Authentication');

    modal.contentEl.createEl('p', {
      text: 'Sign in to Google Drive to authorize this plugin.',
    });

    modal.contentEl.createEl('p', { text: 'Step 1: Visit this URL:' });
    modal.contentEl.createEl('a', {
      text: verificationUrl,
      href: verificationUrl,
      cls: 'gdrive-sync-device-url',
    });

    modal.contentEl.createEl('p', { text: 'Step 2: Enter this code:' });
    modal.contentEl.createEl('div', { text: userCode, cls: 'gdrive-sync-device-code' });

    modal.contentEl.createEl('p', {
      text: 'Waiting for authorization...',
      cls: 'setting-item-description',
    });

    modal.open();
  }

  private startAutoSync(): void {
    const config = this.settingsManager.getConfig();
    if (config.sync.mode === 'manual') return;

    const intervalMs = config.sync.intervalMinutes * 60 * 1000;
    this.syncTimer = window.setInterval(() => {
      void this.autoSyncTick();
    }, intervalMs);
  }

  private stopAutoSync(): void {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private async autoSyncTick(): Promise<void> {
    const config = this.settingsManager.getConfig();
    const mode = config.sync.mode;

    if (mode === 'auto_pull' || mode === 'auto') {
      await this.syncEngine.sync();
    }
  }

  private updateStatusBar(): void {
    const config = this.settingsManager.getConfig();
    if (!config.auth.accessToken) {
      this.syncStatusBar.update({ type: 'unauthenticated' });
    } else {
      void this.syncStateManager.loadState().then(state => {
        const lastSync = state.lastSyncTime
          ? new Date(state.lastSyncTime).toLocaleTimeString()
          : 'never';
        this.syncStatusBar.update({ type: 'idle', lastSync });
      });
    }
  }

  /** Get the vault's base filesystem path from the adapter, if available. */
  private getVaultBasePath(adapter: DataAdapter): string {
    try {
      return (adapter as DataAdapter & { getBasePath?: () => string }).getBasePath?.() || '';
    } catch {
      return '';
    }
  }
}