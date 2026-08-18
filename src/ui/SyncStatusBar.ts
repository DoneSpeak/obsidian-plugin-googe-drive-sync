import { Plugin } from 'obsidian';

export type SyncStatusState =
  | { type: 'idle'; lastSync: string }
  | { type: 'syncing'; current: number; total: number }
  | { type: 'conflict'; count: number }
  | { type: 'error'; message: string }
  | { type: 'unauthenticated' };

export class SyncStatusBar {
  private statusBarItem: HTMLElement;

  constructor(plugin: Plugin) {
    this.statusBarItem = plugin.addStatusBarItem();
    this.statusBarItem.setText('☁️ GDrive: idle');
  }

  update(state: SyncStatusState): void {
    // Remove all color classes first
    this.statusBarItem.removeClass('gdrive-sync-text-accent');
    this.statusBarItem.removeClass('gdrive-sync-text-warning');
    this.statusBarItem.removeClass('gdrive-sync-text-error');
    this.statusBarItem.removeClass('gdrive-sync-text-muted');

    switch (state.type) {
      case 'idle':
        this.statusBarItem.setText(`☁️ GDrive: idle (${state.lastSync})`);
        break;
      case 'syncing':
        this.statusBarItem.setText(`☁️ GDrive: syncing... ${state.current}/${state.total}`);
        this.statusBarItem.addClass('gdrive-sync-text-accent');
        break;
      case 'conflict':
        this.statusBarItem.setText(`☁️ GDrive: ⚠️ ${state.count} conflicts`);
        this.statusBarItem.addClass('gdrive-sync-text-warning');
        break;
      case 'error':
        this.statusBarItem.setText(`☁️ GDrive: ❌ ${state.message}`);
        this.statusBarItem.addClass('gdrive-sync-text-error');
        break;
      case 'unauthenticated':
        this.statusBarItem.setText('☁️ GDrive: sign in required');
        this.statusBarItem.addClass('gdrive-sync-text-muted');
        break;
    }
  }

  dispose(): void {
    this.statusBarItem.remove();
  }
}