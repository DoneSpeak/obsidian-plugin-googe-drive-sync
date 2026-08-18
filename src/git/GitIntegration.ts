import { exec } from 'child_process';
import { SyncConfig } from '../types';

export class GitIntegration {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  async isGitRepo(): Promise<boolean> {
    try {
      const result = await this.execGit('rev-parse --git-dir');
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async preSyncCommit(config: SyncConfig): Promise<boolean> {
    if (!config.gitEnabled) return false;
    return this.commit(config.gitPreSyncMessage);
  }

  async postSyncCommit(config: SyncConfig): Promise<boolean> {
    if (!config.gitEnabled) return false;
    return this.commit(config.gitPostSyncMessage);
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const result = await this.execGit('status --porcelain');
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  }

  async getDiffForFile(filePath: string): Promise<string> {
    const result = await this.execGit(`diff HEAD -- "${filePath}"`);
    if (result.exitCode === 0 && result.stdout) {
      return result.stdout;
    }
    // Try staged diff
    const stagedResult = await this.execGit(`diff --cached -- "${filePath}"`);
    return stagedResult.exitCode === 0 ? stagedResult.stdout : '';
  }

  private async commit(message: string): Promise<boolean> {
    try {
      const hasChanges = await this.hasUncommittedChanges();
      if (!hasChanges) return true;

      // Add all files
      const addResult = await this.execGit('add -A');
      if (addResult.exitCode !== 0) {
        console.error('Git add failed:', addResult.stderr);
        return false;
      }

      // Commit
      const commitResult = await this.execGit(`commit -m "${message.replace(/"/g, '\\"')}"`);
      if (commitResult.exitCode !== 0) {
        console.error('Git commit failed:', commitResult.stderr);
        return false;
      }

      return true;
    } catch (e) {
      console.error('Git operation failed:', e);
      return false;
    }
  }

  private async execGit(args: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      exec(
        `git ${args}`,
        { cwd: this.vaultPath },
        (error: Error | null, stdout: string, stderr: string) => {
          resolve({
            exitCode: error ? Number((error as NodeJS.ErrnoException).code) || 1 : 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        }
      );
    });
  }
}