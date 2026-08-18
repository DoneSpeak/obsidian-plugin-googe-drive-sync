import { Modal, App } from 'obsidian';
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

    const container = contentEl.createDiv({ cls: 'gdrive-sync-flex-col' });

    // Info row
    const infoRow = container.createDiv({ cls: 'gdrive-sync-info-row' });

    infoRow.createSpan({
      text: `Local: ${this.action.localFile ? new Date(this.action.localFile.modifiedTime).toLocaleString() : 'N/A'}`,
    });
    infoRow.createSpan({
      text: `Drive: ${this.action.driveFile ? new Date(this.action.driveFile.modifiedTime).toLocaleString() : 'N/A'}`,
    });

    // File info
    const fileInfo = container.createDiv({ cls: 'gdrive-sync-file-info' });

    if (this.action.localFile) {
      fileInfo.createSpan({ text: `Size: ${this.action.localFile.size} bytes` });
    }
    if (this.action.driveFile) {
      fileInfo.createSpan({ text: `Drive MD5: ${this.action.driveFile.md5Checksum.substring(0, 8)}...` });
    }

    // Action buttons
    const buttonRow = container.createDiv({ cls: 'gdrive-sync-flex-center' });

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
      cls: 'gdrive-sync-warning-text',
    });
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