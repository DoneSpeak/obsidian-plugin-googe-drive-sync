import { Modal, App, requestUrl } from 'obsidian';
import { SyncAction } from '../types';

export class ConflictResolutionModal extends Modal {
  private resolvePromise!: (resolution: 'local' | 'drive' | 'both') => void;

  constructor(
    app: App,
    private action: SyncAction,
    private getDriveContent: (fileId: string) => Promise<string>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(`Conflict: ${this.action.localPath}`);

    const container = contentEl.createDiv();
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '1em';

    // Info row
    const infoRow = container.createDiv();
    infoRow.style.display = 'flex';
    infoRow.style.justifyContent = 'space-between';
    infoRow.style.padding = '8px';
    infoRow.style.background = 'var(--background-secondary)';
    infoRow.style.borderRadius = '4px';

    infoRow.createSpan({
      text: `Local: ${this.action.localFile ? new Date(this.action.localFile.modifiedTime).toLocaleString() : 'N/A'}`,
    });
    infoRow.createSpan({
      text: `Drive: ${this.action.driveFile ? new Date(this.action.driveFile.modifiedTime).toLocaleString() : 'N/A'}`,
    });

    // File info
    const fileInfo = container.createDiv();
    fileInfo.style.display = 'flex';
    fileInfo.style.justifyContent = 'space-between';
    fileInfo.style.padding = '4px 8px';
    fileInfo.style.fontSize = '0.9em';
    fileInfo.style.color = 'var(--text-muted)';

    if (this.action.localFile) {
      fileInfo.createSpan({ text: `Size: ${this.action.localFile.size} bytes` });
    }
    if (this.action.driveFile) {
      fileInfo.createSpan({ text: `Drive MD5: ${this.action.driveFile.md5Checksum.substring(0, 8)}...` });
    }

    // Action buttons
    const buttonRow = container.createDiv();
    buttonRow.style.display = 'flex';
    buttonRow.style.flexWrap = 'wrap';
    buttonRow.style.gap = '8px';
    buttonRow.style.justifyContent = 'center';
    buttonRow.style.marginTop = '1em';

    const localBtn = buttonRow.createEl('button', { text: 'Keep Local Version' });
    localBtn.className = 'mod-cta';
    localBtn.onclick = () => {
      this.resolvePromise('local');
      this.close();
    };

    const driveBtn = buttonRow.createEl('button', { text: 'Keep Drive Version' });
    driveBtn.onclick = () => {
      this.resolvePromise('drive');
      this.close();
    };

    const bothBtn = buttonRow.createEl('button', { text: 'Keep Both' });
    bothBtn.onclick = () => {
      this.resolvePromise('both');
      this.close();
    };

    // Warning text
    const warning = container.createEl('p', {
      text: 'Both versions have been modified since the last sync. Choose which version to keep, or keep both (the local file will be renamed).',
      cls: 'setting-item-description',
    });
    warning.style.marginTop = '0.5em';
    warning.style.fontSize = '0.85em';
  }

  onClose(): void {
    this.contentEl.empty();
  }

  async show(): Promise<'local' | 'drive' | 'both'> {
    this.open();
    return new Promise(resolve => {
      this.resolvePromise = resolve;
    });
  }
}