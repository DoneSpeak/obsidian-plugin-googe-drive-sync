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
    switch (state.type) {
      case 'idle':
        this.statusBarItem.setText(`☁️ GDrive: idle (${state.lastSync})`);
        this.statusBarItem.style.color = '';
        break;
      case 'syncing':
        this.statusBarItem.setText(`☁️ GDrive: syncing... ${state.current}/${state.total}`);
        this.statusBarItem.style.color = 'var(--text-accent)';
        break;
      case 'conflict':
        this.statusBarItem.setText(`☁️ GDrive: ⚠️ ${state.count} conflicts`);
        this.statusBarItem.style.color = 'var(--text-warning)';
        break;
      case 'error':
        this.statusBarItem.setText(`☁️ GDrive: ❌ ${state.message}`);
        this.statusBarItem.style.color = 'var(--text-error)';
        break;
      case 'unauthenticated':
        this.statusBarItem.setText('☁️ GDrive: sign in required');
        this.statusBarItem.style.color = 'var(--text-muted)';
        break;
    }
  }

  dispose(): void {
    this.statusBarItem.remove();
  }
}