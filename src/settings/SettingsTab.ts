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
    private saveConfig: (config: any) => Promise<void>,
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
        text.inputEl.style.width = '100%';
      });

    new Setting(contentEl)
      .setName('Drive Folder ID')
      .setDesc('Google Drive folder ID')
      .addText(text => {
        text.setValue(this.newDriveFolderId)
          .onChange(val => { this.newDriveFolderId = val; });
        text.inputEl.style.width = '100%';
      });

    // Buttons
    const btnRow = contentEl.createDiv();
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '16px';

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
      await this.saveConfig(this.config);
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
    containerEl.createEl('h2', { text: 'Google Account' });

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
              this.plugin.startOAuthFlow();
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
    summary.style.cursor = 'pointer';
    summary.style.fontWeight = 'bold';
    summary.style.marginBottom = '4px';

    const desc = details.createEl('p', {
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
    const link = linkPara.createEl('a', {
      text: 'Google OAuth 2.0 Playground',
      href: 'https://developers.google.com/oauthplayground',
    });
    link.style.marginBottom = '12px';

    // Instructions
    const steps = details.createEl('ol');
    steps.style.fontSize = 'var(--font-small)';
    steps.style.marginBottom = '12px';
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
    const parseHeader = details.createEl('h4', { text: 'Parse from OAuth Playground Response' });
    parseHeader.style.marginBottom = '4px';

    const parseDesc = details.createEl('p', {
      text: 'Paste the full HTTP request/response from the "Exchange authorization code for tokens" step, then click Parse.',
      cls: 'setting-item-description',
    });

    let parseRawInput = '';

    const parseTextarea = details.createEl('textarea');
    parseTextarea.style.width = '100%';
    parseTextarea.style.minHeight = '160px';
    parseTextarea.style.fontFamily = 'monospace';
    parseTextarea.style.fontSize = '11px';
    parseTextarea.style.marginBottom = '8px';
    parseTextarea.placeholder = 'Paste the full HTTP request + response here...\n\ne.g.\nPOST /token HTTP/1.1\nHost: oauth2.googleapis.com\n...\n\n{\n  "access_token": "ya29...",\n  "refresh_token": "1//0g...",\n  "expires_in": 3599,\n  "scope": "https://www.googleapis.com/auth/drive",\n  ...\n}';
    parseTextarea.onchange = () => { parseRawInput = parseTextarea.value; };
    parseTextarea.oninput = () => { parseRawInput = parseTextarea.value; };

    const parseBtnRow = details.createEl('div');
    parseBtnRow.style.display = 'flex';
    parseBtnRow.style.gap = '8px';
    parseBtnRow.style.marginBottom = '16px';

    const parseBtn = parseBtnRow.createEl('button', { text: 'Parse & Fill' });
    parseBtn.className = 'mod-cta';

    const parseStatus = parseBtnRow.createEl('span');
    parseStatus.style.fontSize = 'var(--font-small)';
    parseStatus.style.alignSelf = 'center';

    // Separator
    const separator = details.createEl('hr');
    separator.style.margin = '12px 0';

    // ── Manual input fields ──
    const manualHeader = details.createEl('h4', { text: 'Or Enter Manually' });
    manualHeader.style.marginBottom = '4px';

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
        textarea.inputEl.style.width = '100%';
        textarea.inputEl.style.minHeight = '60px';
        textarea.inputEl.style.fontFamily = 'monospace';
        textarea.inputEl.style.fontSize = '12px';
      });

    // Refresh Token input
    new Setting(details)
      .setName('Refresh Token')
      .setDesc('Paste your refresh token (1//0g...)')
      .addTextArea(textarea => {
        textarea.setPlaceholder('1//0g...')
          .setValue(this.manualRefreshToken)
          .onChange(val => { this.manualRefreshToken = val; });
        textarea.inputEl.style.width = '100%';
        textarea.inputEl.style.minHeight = '40px';
        textarea.inputEl.style.fontFamily = 'monospace';
        textarea.inputEl.style.fontSize = '12px';
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
      if (!raw) {
        parseStatus.textContent = '⚠️ Please paste the HTTP response first';
        parseStatus.style.color = 'var(--color-red)';
        return;
      }

      // Extract JSON body: find the first { after a blank line (the HTTP body)
      const jsonMatch = raw.match(/\n\s*\n\s*(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : raw.match(/\{[\s\S]*\}/)?.[0];

      if (!jsonStr) {
        parseStatus.textContent = '⚠️ Could not find JSON body in the response';
        parseStatus.style.color = 'var(--color-red)';
        return;
      }

      try {
        const data = JSON.parse(jsonStr);

        // Extract fields
        const parsedAccessToken = data.access_token || '';
        const parsedRefreshToken = data.refresh_token || '';
        const parsedExpiresIn = data.expires_in || 3600;
        const parsedScope = data.scope || '';

        // Extract client_id from the request (POST line)
        const clientIdMatch = raw.match(/client_id=([^&\s]+)/);
        const parsedClientId = clientIdMatch ? decodeURIComponent(clientIdMatch[1]) : '';

        // Validate required fields
        if (!parsedAccessToken) {
          parseStatus.textContent = '⚠️ No access_token found in JSON body';
          parseStatus.style.color = 'var(--color-red)';
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
            parseStatus.style.color = 'var(--color-green)';
          } else {
            parseStatus.textContent = `⚠️ Scope missing "drive"! Current: ${parsedScope}. Some sync features may not work.`;
            parseStatus.style.color = 'var(--color-orange)';
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

      } catch (e) {
        parseStatus.textContent = `⚠️ Parse error: ${e instanceof Error ? e.message : 'invalid JSON'}`;
        parseStatus.style.color = 'var(--color-red)';
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
    containerEl.createEl('h2', { text: 'Sync Settings' });

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
          .setDynamicTooltip()
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
    const headingRow = containerEl.createDiv();
    headingRow.style.display = 'flex';
    headingRow.style.alignItems = 'center';
    headingRow.style.justifyContent = 'space-between';
    headingRow.createEl('h2', { text: 'Directory Mappings' });

    const testAllBtn = headingRow.createEl('button', { text: 'Test All' });
    testAllBtn.style.marginBottom = '12px';

    const config = this.settingsManager.getConfig();

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
      const statusSpan = setting.descEl.createEl('span');
      statusSpan.style.marginLeft = '10px';
      statusSpan.style.fontWeight = 'bold';
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
              config as any,
              async (cfg) => this.settingsManager.saveConfig(cfg),
              () => this.display()
            );
            modal.open();
          });
      });

      setting.addButton(btn => {
        btn.setIcon('trash')
          .setWarning()
          .onClick(async () => {
            config.mappings.splice(index, 1);
            await this.settingsManager.saveConfig(config);
            this.display();
          });
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
        try {
          statusEl.textContent = ' ⏳';
          statusEl.style.color = 'var(--text-muted)';
          const file = await this.plugin.driveClient.getFile(config.mappings[i].driveFolderId);
          const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
          statusEl.textContent = ' ✓';
          statusEl.style.color = 'var(--color-green)';
          statusEl.title = 'Folder verified';
          passed++;
        } catch (e: any) {
          const errMsg = e.message || String(e);
          statusEl.textContent = ' ✗';
          statusEl.style.color = 'var(--color-red)';
          statusEl.title = errMsg; // Show error as tooltip on hover
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
    containerEl.createEl('h2', { text: 'Ignore Rules' });

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