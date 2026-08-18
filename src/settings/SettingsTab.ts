import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import GoogleDriveSyncPlugin from '../main';
import { SettingsManager } from './SettingsManager';
import { SyncMode, DirectoryMapping } from '../types';

// ── Edit Mapping Modal ──
class EditMappingModal extends Modal {
  private newLocalPath: string;
  private newDriveFolderId: string;

  constructor(
    app: App,
    private mapping: DirectoryMapping,
    private index: number,
    private config: { mappings: DirectoryMapping[] },
    private saveConfig: (config: Record<string, unknown>) => Promise<void>,
    private onSaved: () => void
  ) {
    super(app);
    this.newLocalPath = mapping.localPath;
    this.newDriveFolderId = mapping.driveFolderId;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.titleEl.setText(`Edit Mapping ${this.index + 1}`);

    new Setting(contentEl)
      .setName('Local Path')
      .setDesc('Path relative to vault root (e.g. docs/)')
      .addText(text => {
        text.setValue(this.newLocalPath)
          .onChange(val => { this.newLocalPath = val; });
        text.inputEl.addClass('gdrive-sync-full-width');
      });

    new Setting(contentEl)
      .setName('Drive Folder ID')
      .setDesc('Google Drive folder ID')
      .addText(text => {
        text.setValue(this.newDriveFolderId)
          .onChange(val => { this.newDriveFolderId = val; });
        text.inputEl.addClass('gdrive-sync-full-width');
      });

    // Buttons
    const btnRow = contentEl.createDiv({ cls: 'gdrive-sync-btn-row-end' });

    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => this.close();

    const saveBtn = btnRow.createEl('button', { text: 'Save' });
    saveBtn.className = 'mod-cta';
    saveBtn.onclick = async () => {
      if (!this.newLocalPath || !this.newDriveFolderId) {
        new Notice('Both fields are required');
        return;
      }
      this.config.mappings[this.index] = {
        localPath: this.newLocalPath,
        driveFolderId: this.newDriveFolderId,
        driveFolderPath: this.newDriveFolderId,
        enabled: this.mapping.enabled,
      };
      await this.saveConfig(this.config as Record<string, unknown>);
      new Notice(`Mapping ${this.index + 1} updated`);
      this.close();
      this.onSaved();
    };
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class GoogleDriveSyncSettingTab extends PluginSettingTab {
  // Persist manual token values across display() re-renders
  private manualClientId = '';
  private manualAccessToken = '';
  private manualRefreshToken = '';
  private manualExpiresIn = '3600';

  constructor(
    app: App,
    private plugin: GoogleDriveSyncPlugin,
    private settingsManager: SettingsManager
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderAuthSection(containerEl);
    this.renderManualTokenSection(containerEl);
    this.renderSyncConfigSection(containerEl);
    this.renderMappingsSection(containerEl);
    this.renderIgnoreSection(containerEl);
  }

  private renderAuthSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Google Account').setHeading();

    const config = this.settingsManager.getConfig();
    const isLoggedIn = !!config.auth.accessToken && !!config.auth.refreshToken;

    new Setting(containerEl)
      .setName('Authentication')
      .setDesc(isLoggedIn ? 'Connected to Google Drive' : 'Not authenticated')
      .addButton(btn => {
        if (isLoggedIn) {
          btn.setButtonText('Disconnect')
            .onClick(async () => {
              await this.settingsManager.clearAuthTokens();
              new Notice('Disconnected from Google Drive');
              this.display();
            });
        } else {
          btn.setButtonText('Sign in with Google')
            .setCta()
            .onClick(() => {
              void this.plugin.startOAuthFlow();
            });
        }
      });
  }

  private renderManualTokenSection(containerEl: HTMLElement): void {
    const config = this.settingsManager.getConfig();
    const isLoggedIn = !!config.auth.accessToken && !!config.auth.refreshToken;

    const details = containerEl.createEl('details');
    details.open = true;
    const summary = details.createEl('summary');
    summary.textContent = 'Manual Token Setup (OAuth Playground)';
    summary.addClass('gdrive-sync-summary');

    details.createEl('p', {
      text: 'Alternatively, paste tokens from Google OAuth 2.0 Playground.',
      cls: 'setting-item-description',
    });

    if (isLoggedIn) {
      details.createEl('p', {
        text: 'Already authenticated. Disconnect first to update tokens manually.',
        cls: 'setting-item-description',
      });
      return;
    }

    // Link to OAuth Playground
    const linkPara = details.createEl('p');
    linkPara.createEl('span', { text: 'Get tokens from: ' });
    linkPara.createEl('a', {
      text: 'Google OAuth 2.0 Playground',
      href: 'https://developers.google.com/oauthplayground',
      cls: 'gdrive-sync-mb-012',
    });

    // Instructions
    const steps = details.createEl('ol', { cls: 'gdrive-sync-font-small gdrive-sync-mb-012' });
    const stepItems = [
      'Click ⚙️ → check "Use your own OAuth credentials" and paste your Client ID',
      'Select "Drive API v3" and scope "https://www.googleapis.com/auth/drive"',
      'Click "Authorize APIs" and sign in',
      'Click "Exchange authorization code for tokens"',
      'Copy the entire HTTP response (or paste tokens manually below)',
    ];
    for (const s of stepItems) {
      const li = steps.createEl('li');
      li.textContent = s;
    }

    // ── Auto-parse from OAuth Playground response ──
    new Setting(details).setName('Parse from OAuth Playground Response').setHeading();

    details.createEl('p', {
      text: 'Paste the full HTTP request/response from the "Exchange authorization code for tokens" step, then click Parse.',
      cls: 'setting-item-description',
    });

    let parseRawInput = '';

    const parseTextarea = details.createEl('textarea', { cls: 'gdrive-sync-parse-textarea' });
    parseTextarea.placeholder = 'Paste the full HTTP request + response here...\n\ne.g.\nPOST /token HTTP/1.1\nHost: oauth2.googleapis.com\n...\n\n{\n  "access_token": "ya29...",\n  "refresh_token": "1//0g...",\n  "expires_in": 3599,\n  "scope": "https://www.googleapis.com/auth/drive",\n  ...\n}';
    parseTextarea.onchange = () => { parseRawInput = parseTextarea.value; };
    parseTextarea.oninput = () => { parseRawInput = parseTextarea.value; };

    const parseBtnRow = details.createEl('div', { cls: 'gdrive-sync-btn-row gdrive-sync-mb-016' });

    const parseBtn = parseBtnRow.createEl('button', { text: 'Parse & Fill' });
    parseBtn.className = 'mod-cta';

    const parseStatus = parseBtnRow.createEl('span', { cls: 'gdrive-sync-font-small' });

    // ── Manual input fields ──
    new Setting(details).setName('Or Enter Manually').setHeading();

    // Client ID input
    new Setting(details)
      .setName('Client ID')
      .setDesc('Needed for automatic token refresh')
      .addText(text => {
        text.setPlaceholder('From OAuth Playground or Google Cloud Console')
          .setValue(this.manualClientId)
          .onChange(val => { this.manualClientId = val; });
      });

    // Access Token input
    new Setting(details)
      .setName('Access Token')
      .setDesc('Paste your access token (ya29...)')
      .addTextArea(textarea => {
        textarea.setPlaceholder('ya29.a0A...')
          .setValue(this.manualAccessToken)
          .onChange(val => { this.manualAccessToken = val; });
        textarea.inputEl.addClass('gdrive-sync-token-textarea');
      });

    // Refresh Token input
    new Setting(details)
      .setName('Refresh Token')
      .setDesc('Paste your refresh token (1//0g...)')
      .addTextArea(textarea => {
        textarea.setPlaceholder('1//0g...')
          .setValue(this.manualRefreshToken)
          .onChange(val => { this.manualRefreshToken = val; });
        textarea.inputEl.addClass('gdrive-sync-refresh-textarea');
      });

    // Expires In input
    new Setting(details)
      .setName('Expires In')
      .setDesc('Access token expiry in seconds (default: 3600)')
      .addText(text => {
        text.setValue(this.manualExpiresIn)
          .onChange(val => { this.manualExpiresIn = val; });
      });

    // ── Parse logic ──
    parseBtn.onclick = () => {
      const raw = parseRawInput || parseTextarea.value;
      // Reset status color
      parseStatus.removeClass('gdrive-sync-text-error');
      parseStatus.removeClass('gdrive-sync-text-success');
      parseStatus.removeClass('gdrive-sync-text-warning');

      if (!raw) {
        parseStatus.textContent = '⚠️ Please paste the HTTP response first';
        parseStatus.addClass('gdrive-sync-text-error');
        return;
      }

      // Extract JSON body: find the first { after a blank line (the HTTP body)
      const jsonMatch = raw.match(/\n\s*\n\s*(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : raw.match(/\{[\s\S]*\}/)?.[0];

      if (!jsonStr) {
        parseStatus.textContent = '⚠️ Could not find JSON body in the response';
        parseStatus.addClass('gdrive-sync-text-error');
        return;
      }

      try {
        const data = JSON.parse(jsonStr) as Record<string, unknown>;

        // Extract fields
        const parsedAccessToken = String(data.access_token || '');
        const parsedRefreshToken = String(data.refresh_token || '');
        const parsedExpiresIn = Number(data.expires_in) || 3600;
        const parsedScope = String(data.scope || '');

        // Extract client_id from the request (POST line)
        const clientIdMatch = raw.match(/client_id=([^&\s]+)/);
        const parsedClientId = clientIdMatch ? decodeURIComponent(clientIdMatch[1]) : '';

        // Validate required fields
        if (!parsedAccessToken) {
          parseStatus.textContent = '⚠️ No access_token found in JSON body';
          parseStatus.addClass('gdrive-sync-text-error');
          return;
        }

        // Validate scope
        if (parsedScope) {
          const scopes = parsedScope.split(' ').filter(Boolean);
          const hasDrive = scopes.some((s: string) =>
            s === 'https://www.googleapis.com/auth/drive'
          );
          const hasDriveFile = scopes.some((s: string) =>
            s === 'https://www.googleapis.com/auth/drive.file'
          );

          if (hasDrive) {
            parseStatus.textContent = `✅ Scope: OK${hasDriveFile ? ' (drive + drive.file)' : ' (drive)'}`;
            parseStatus.addClass('gdrive-sync-text-success');
          } else {
            parseStatus.textContent = `⚠️ Scope missing "drive"! Current: ${parsedScope}. Some sync features may not work.`;
            parseStatus.addClass('gdrive-sync-text-warning');
          }
        }

        // Store parsed values into instance properties
        this.manualClientId = parsedClientId;
        this.manualAccessToken = parsedAccessToken;
        this.manualRefreshToken = parsedRefreshToken;
        this.manualExpiresIn = String(parsedExpiresIn);

        // Re-render to show filled values in the manual inputs
        this.display();
        new Notice('Fields auto-filled from response! Check values and click Save Tokens.');

      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'invalid JSON';
        parseStatus.textContent = `⚠️ Parse error: ${message}`;
        parseStatus.addClass('gdrive-sync-text-error');
      }
    };

    // Save button
    new Setting(details)
      .addButton(btn => {
        btn.setButtonText('Save Tokens')
          .setCta()
          .onClick(async () => {
            if (!this.manualAccessToken) {
              new Notice('Please enter an access token');
              return;
            }
            const expiry = parseInt(this.manualExpiresIn) || 3600;
            await this.plugin.saveManualTokens(
              this.manualClientId,
              this.manualAccessToken,
              this.manualRefreshToken,
              expiry
            );
            // Clear persisted values after save
            this.manualClientId = '';
            this.manualAccessToken = '';
            this.manualRefreshToken = '';
            this.manualExpiresIn = '3600';
            new Notice('Tokens saved! You can now configure sync.');
            this.display();
          });
      });
  }

  private renderSyncConfigSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Sync Configuration').setHeading();

    const config = this.settingsManager.getConfig();

    new Setting(containerEl)
      .setName('Sync mode')
      .setDesc('Choose how sync is triggered')
      .addDropdown(dropdown => {
        dropdown
          .addOption('manual', 'Manual')
          .addOption('auto_pull', 'Auto download + manual upload')
          .addOption('auto_push', 'Auto upload + manual download')
          .addOption('auto', 'Full auto bidirectional')
          .setValue(config.sync.mode)
          .onChange(async (value: string) => {
            config.sync.mode = value as SyncMode;
            await this.settingsManager.saveConfig(config);
          });
      });

    new Setting(containerEl)
      .setName('Auto sync interval')
      .setDesc('Minutes between automatic sync checks')
      .addSlider(slider => {
        slider
          .setLimits(5, 120, 5)
          .setValue(config.sync.intervalMinutes)
          .onChange(async (value: number) => {
            config.sync.intervalMinutes = value;
            await this.settingsManager.saveConfig(config);
          });
      });

    new Setting(containerEl)
      .setName('Git auto commit')
      .setDesc('Automatically commit before and after sync')
      .addToggle(toggle => {
        toggle
          .setValue(config.sync.gitEnabled)
          .onChange(async (value: boolean) => {
            config.sync.gitEnabled = value;
            await this.settingsManager.saveConfig(config);
          });
      });
  }

  private renderMappingsSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Directory Mappings').setHeading();

    const config = this.settingsManager.getConfig();

    const testAllBtn = containerEl.createEl('button', { text: 'Test All', cls: 'gdrive-sync-mb-012' });

    if (config.mappings.length === 0) {
      containerEl.createEl('p', {
        text: 'No directory mappings configured. Add a mapping to sync a local folder with a Google Drive folder.',
        cls: 'setting-item-description',
      });
    }

    // Status indicators for each mapping row
    const statusIndicators: HTMLElement[] = [];

    config.mappings.forEach((mapping, index) => {
      const setting = new Setting(containerEl)
        .setName(`Mapping ${index + 1}: ${mapping.localPath}`)
        .setDesc(`→ ${mapping.driveFolderPath}`);

      // Status indicator (red/green icon)
      const statusSpan = setting.descEl.createEl('span', { cls: 'gdrive-sync-status-badge' });
      statusIndicators.push(statusSpan);

      setting.addToggle(toggle => {
        toggle
          .setValue(mapping.enabled)
          .onChange(async (value: boolean) => {
            config.mappings[index].enabled = value;
            await this.settingsManager.saveConfig(config);
          });
      });

      setting.addButton(btn => {
        btn.setIcon('pencil')
          .setTooltip('Edit mapping')
          .onClick(() => {
            const modal = new EditMappingModal(
              this.app,
              mapping,
              index,
              config,
              async (cfg) => this.settingsManager.saveConfig(cfg as any),
              () => this.display()
            );
            modal.open();
          });
      });

      setting.addButton(btn => {
        btn.setIcon('trash')
          .onClick(async () => {
            config.mappings.splice(index, 1);
            await this.settingsManager.saveConfig(config);
            this.display();
          });
        // Apply destructive styling via CSS class instead of setDestructive()
        // for compatibility with the declared minAppVersion
        btn.buttonEl.addClass('mod-destructive');
      });
    });

    // Test All button logic
    testAllBtn.onclick = async () => {
      const enabled = config.mappings.filter(m => m.enabled);
      if (enabled.length === 0) {
        new Notice('No enabled mappings to test');
        return;
      }
      testAllBtn.setAttr('disabled', 'true');
      testAllBtn.textContent = 'Testing...';

      // Clear all indicators
      statusIndicators.forEach(el => { el.textContent = ''; el.title = ''; });

      let passed = 0;
      let failed = 0;

      for (let i = 0; i < config.mappings.length; i++) {
        if (!config.mappings[i].enabled) continue;
        const statusEl = statusIndicators[i];
        // Clear previous color classes
        statusEl.removeClass('gdrive-sync-text-muted');
        statusEl.removeClass('gdrive-sync-text-success');
        statusEl.removeClass('gdrive-sync-text-error');

        try {
          statusEl.textContent = ' ⏳';
          statusEl.addClass('gdrive-sync-text-muted');
          await this.plugin.driveClient.getFile(config.mappings[i].driveFolderId);
          statusEl.textContent = ' ✓';
          statusEl.addClass('gdrive-sync-text-success');
          statusEl.title = 'Folder verified';
          passed++;
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          statusEl.textContent = ' ✗';
          statusEl.addClass('gdrive-sync-text-error');
          statusEl.title = errMsg;
          // Also append short error hint to the mapping description
          const shortErr = errMsg.length > 60 ? errMsg.substring(0, 57) + '...' : errMsg;
          statusEl.textContent = ` ✗ ${shortErr}`;
          failed++;
        }
      }

      testAllBtn.removeAttribute('disabled');
      testAllBtn.textContent = 'Test All';
      new Notice(`${passed} passed, ${failed} failed`);
    };

    let localPathInput: string = '';
    let driveIdInput: string = '';

    new Setting(containerEl)
      .setName('Add mapping')
      .setDesc('Map a local path to a Google Drive folder')
      .addText(text => {
        text.setPlaceholder('Local path (e.g. docs/)')
          .onChange(val => { localPathInput = val; });
      })
      .addText(text => {
        text.setPlaceholder('Drive folder ID')
          .onChange(val => { driveIdInput = val; });
      })
      .addButton(btn => {
        btn.setButtonText('Add')
          .setCta()
          .onClick(async () => {
            if (localPathInput && driveIdInput) {
              config.mappings.push({
                localPath: localPathInput,
                driveFolderId: driveIdInput,
                driveFolderPath: driveIdInput,
                enabled: true,
              });
              await this.settingsManager.saveConfig(config);
              this.display();
            } else {
              new Notice('Please fill in both local path and Drive folder ID');
            }
          });
      });
  }

  private renderIgnoreSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Ignore Rules').setHeading();

    const config = this.settingsManager.getConfig();

    new Setting(containerEl)
      .setName('Respect .gitignore')
      .setDesc('Automatically ignore files and folders listed in your vault\'s .gitignore file. ' +
        'When enabled, patterns from .gitignore are merged into the ignore rules below during sync.')
      .addToggle(toggle => {
        toggle
          .setValue(config.ignore.ignoreGitignore)
          .onChange(async (value: boolean) => {
            config.ignore.ignoreGitignore = value;
            await this.settingsManager.saveConfig(config);
          });
      });

    new Setting(containerEl)
      .setName('Ignored file patterns')
      .setDesc('Glob patterns of files to ignore (comma-separated)')
      .addText(text => {
        text.setValue(config.ignore.patterns.join(', '))
          .onChange(async (value: string) => {
            config.ignore.patterns = value.split(',').map(s => s.trim()).filter(Boolean);
            await this.settingsManager.saveConfig(config);
          });
      });

    new Setting(containerEl)
      .setName('Ignored folders')
      .setDesc('Folder names to ignore (comma-separated)')
      .addText(text => {
        text.setValue(config.ignore.folders.join(', '))
          .onChange(async (value: string) => {
            config.ignore.folders = value.split(',').map(s => s.trim()).filter(Boolean);
            await this.settingsManager.saveConfig(config);
          });
      });
  }
}