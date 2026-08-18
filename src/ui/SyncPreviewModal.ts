import { Modal, App } from 'obsidian';
import { SyncPlan, SyncAction } from '../types';

export class SyncPreviewModal extends Modal {
  private userConfirmed = false;
  private resolvePromise!: (confirmed: boolean) => void;
  private actionCheckboxes: Map<string, boolean> = new Map();

  constructor(
    app: App,
    private plan: SyncPlan,
    private onResolveConflict: (action: SyncAction) => Promise<'local' | 'drive' | 'both'>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText('GDrive Sync Preview');

    // Upload section
    this.renderActionGroup(contentEl, '📤 Upload to Drive', 'upload', 'var(--color-green)');
    this.renderActionGroup(contentEl, '📥 Download from Drive', 'download', 'var(--color-blue)');
    this.renderActionGroup(contentEl, '⚠️ Conflicts', 'conflict', 'var(--color-red)');
    this.renderActionGroup(contentEl, '🗑️ Delete on Drive', 'delete_drive', 'var(--color-orange)');
    this.renderActionGroup(contentEl, '🗑️ Delete locally', 'delete_local', 'var(--color-orange)');

    contentEl.createDiv({ cls: 'setting-item' });

    // Buttons
    const buttonRow = contentEl.createDiv({ cls: 'gdrive-sync-btn-row-end-mt' });

    const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.userConfirmed = false;
      this.close();
    };

    const confirmBtn = buttonRow.createEl('button', { text: 'Confirm Sync' });
    confirmBtn.className = 'mod-cta';
    confirmBtn.onclick = () => {
      this.userConfirmed = true;
      this.close();
    };

    // Disable confirm if there are unresolved conflicts
    if (this.plan.hasConflicts) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Resolve conflicts first';
    }
  }

  private renderActionGroup(
    container: HTMLElement,
    title: string,
    type: string,
    color: string
  ): void {
    const actions = this.plan.actions.filter(a => a.type === type);
    if (actions.length === 0) return;

    const groupEl = container.createDiv({ cls: 'gdrive-sync-preview-group' });

    const headerEl = groupEl.createEl('h3', { text: `${title} (${actions.length})` });
    headerEl.addClass('gdrive-sync-preview-header');
    headerEl.addClass(`gdrive-sync-preview-header-${type}`);

    for (const action of actions) {
      const itemRow = groupEl.createDiv({ cls: 'gdrive-sync-preview-item' });

      if (action.type === 'conflict') {
        itemRow.addClass('gdrive-sync-preview-item-conflict');

        const label = itemRow.createSpan({
          text: `🔴 ${action.localPath} — Click to resolve`,
        });
        label.addClass('gdrive-sync-flex-1');

        const resolveBtn = itemRow.createEl('button', { text: 'Resolve' });
        resolveBtn.onclick = async (e) => {
          e.stopPropagation();
          const resolution = await this.onResolveConflict(action);
          if (resolution) {
            action.resolved = true;
            action.resolution = resolution;
            itemRow.addClass('gdrive-sync-preview-item-resolved');
            label.setText(`✅ ${action.localPath} — Resolved (keep ${resolution})`);
            resolveBtn.remove();

            // Check if all conflicts resolved
            this.checkAllResolved();
          }
        };
      } else {
        const checkbox = itemRow.createEl('input', { type: 'checkbox' });
        checkbox.checked = true;
        checkbox.addClass('gdrive-sync-checkbox');
        this.actionCheckboxes.set(action.localPath, true);
        checkbox.onchange = () => {
          this.actionCheckboxes.set(action.localPath, checkbox.checked);
        };

        const label = itemRow.createSpan({
          text: `${action.localPath}`,
        });
        label.addClass('gdrive-sync-flex-1');

        if (action.localFile) {
          itemRow.createSpan({
            text: `modified: ${new Date(action.localFile.modifiedTime).toLocaleTimeString()}`,
            cls: 'gdrive-sync-preview-subtitle',
          });
        }
      }
    }
  }

  private checkAllResolved(): void {
    const allResolved = this.plan.actions
      .filter(a => a.type === 'conflict')
      .every(a => a.resolved);

    if (allResolved) {
      const confirmBtn = this.contentEl.querySelector('.mod-cta') as HTMLButtonElement;
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm Sync';
      }
    }
  }

  onClose(): void {
    this.resolvePromise(this.userConfirmed);
    this.contentEl.empty();
  }

  async show(): Promise<boolean> {
    this.open();
    return new Promise(resolve => {
      this.resolvePromise = resolve;
    });
  }

  getSelectedActions(): SyncAction[] {
    return this.plan.actions.filter(a => {
      if (a.type === 'conflict') return a.resolved;
      return this.actionCheckboxes.get(a.localPath) !== false;
    });
  }
}