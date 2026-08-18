import { normalizePath, DataAdapter } from 'obsidian';
import { PluginConfig, DEFAULT_CONFIG } from '../types';

export class SettingsManager {
  private config: PluginConfig;
  private pluginDir: string;

  constructor(private vaultAdapter: DataAdapter, pluginDir: string) {
    this.pluginDir = pluginDir;
    this.config = { ...DEFAULT_CONFIG };
  }

  async loadConfig(): Promise<PluginConfig> {
    try {
      const dataPath = normalizePath(`${this.pluginDir}/data.json`);
      const exists = await this.vaultAdapter.exists(dataPath);
      if (exists) {
        const content = await this.vaultAdapter.read(dataPath);
        const parsed = JSON.parse(content) as Partial<PluginConfig>;
        this.config = {
          ...DEFAULT_CONFIG,
          ...parsed,
          ignore: { ...DEFAULT_CONFIG.ignore, ...(parsed.ignore || {}) },
          mappings: parsed.mappings || DEFAULT_CONFIG.mappings,
        };
      }
    } catch (e) {
      console.error('Failed to load config, using defaults:', e);
    }
    return this.getConfig();
  }

  async saveConfig(config: PluginConfig): Promise<void> {
    this.config = { ...config };
    const dataPath = normalizePath(`${this.pluginDir}/data.json`);
    await this.vaultAdapter.write(dataPath, JSON.stringify(this.config, null, 2));
  }

  getConfig(): PluginConfig {
    return { ...this.config };
  }

  async updateAuthTokens(tokens: { accessToken: string; refreshToken: string; expiryTime: number }): Promise<void> {
    this.config.auth.accessToken = tokens.accessToken;
    this.config.auth.refreshToken = tokens.refreshToken;
    this.config.auth.tokenExpiry = new Date(tokens.expiryTime).toISOString();
    await this.saveConfig(this.config);
  }

  async clearAuthTokens(): Promise<void> {
    this.config.auth.accessToken = '';
    this.config.auth.refreshToken = '';
    this.config.auth.tokenExpiry = '';
    await this.saveConfig(this.config);
  }
}