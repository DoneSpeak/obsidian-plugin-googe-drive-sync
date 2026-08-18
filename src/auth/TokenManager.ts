import { Notice } from 'obsidian';
import { SettingsManager } from '../settings/SettingsManager';
import { OAuthClient } from './OAuthClient';
import { CryptoUtils } from '../utils/CryptoUtils';
import { PluginConfig } from '../types';

export class TokenManager {
  private encryptionKey: string | null = null;

  constructor(
    private settingsManager: SettingsManager,
    private oauthClient: OAuthClient
  ) {}

  async initialize(): Promise<void> {
    const config = this.settingsManager.getConfig();

    // Reuse existing encryption key, or generate and persist one
    if (config.auth.encryptionKey) {
      this.encryptionKey = config.auth.encryptionKey;
    } else {
      this.encryptionKey = await CryptoUtils.generateKey();
      config.auth.encryptionKey = this.encryptionKey;

      // If there are tokens but no encryption key, they were encrypted with a
      // previous random key — clear them so the user re-enters.
      if (config.auth.accessToken) {
        config.auth.accessToken = '';
        config.auth.refreshToken = '';
        config.auth.tokenExpiry = '';
      }

      await this.settingsManager.saveConfig(config);
    }
  }

  async getAccessToken(): Promise<string | null> {
    const config = this.settingsManager.getConfig();
    if (!config.auth.accessToken || !config.auth.refreshToken) {
      return null;
    }

    // Check if token is expired
    if (this.isTokenExpired(config)) {
      const refreshed = await this.refreshIfNeeded();
      if (!refreshed) {
        return null;
      }
    }

    try {
      return await CryptoUtils.decrypt(config.auth.accessToken, this.encryptionKey!);
    } catch {
      // Decryption failed — likely a key mismatch. Clear tokens so user re-authenticates.
      console.warn('Token decryption failed, clearing tokens');
      await this.clearTokens();
      return null;
    }
  }

  async refreshIfNeeded(): Promise<boolean> {
    const config = this.settingsManager.getConfig();
    if (!config.auth.refreshToken || !config.auth.clientId) {
      return false;
    }

    try {
      let refreshToken: string;
      try {
        refreshToken = await CryptoUtils.decrypt(config.auth.refreshToken, this.encryptionKey!);
      } catch {
        console.warn('Refresh token decryption failed, clearing tokens');
        await this.clearTokens();
        return false;
      }

      const tokenResponse = await this.oauthClient.refreshAccessToken(
        config.auth.clientId,
        refreshToken
      );

      const accessTokenEncrypted = await CryptoUtils.encrypt(
        tokenResponse.access_token,
        this.encryptionKey!
      );

      const newRefreshToken = tokenResponse.refresh_token || config.auth.refreshToken;
      const refreshTokenEncrypted = await CryptoUtils.encrypt(
        newRefreshToken,
        this.encryptionKey!
      );

      await this.settingsManager.updateAuthTokens({
        accessToken: accessTokenEncrypted,
        refreshToken: refreshTokenEncrypted,
        expiryTime: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
      });

      return true;
    } catch (e) {
      console.error('Token refresh failed:', e);
      new Notice('Google Drive auth expired. Please sign in again.');
      return false;
    }
  }

  async storeTokens(
    clientId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number
  ): Promise<void> {
    const accessTokenEncrypted = await CryptoUtils.encrypt(accessToken, this.encryptionKey!);
    const refreshTokenEncrypted = await CryptoUtils.encrypt(refreshToken, this.encryptionKey!);

    const config = this.settingsManager.getConfig();
    config.auth.clientId = clientId;
    await this.settingsManager.updateAuthTokens({
      accessToken: accessTokenEncrypted,
      refreshToken: refreshTokenEncrypted,
      expiryTime: Date.now() + expiresIn * 1000,
    });
  }

  async clearTokens(): Promise<void> {
    await this.settingsManager.clearAuthTokens();
  }

  private isTokenExpired(config: PluginConfig): boolean {
    if (!config.auth.tokenExpiry) return true;
    const expiry = new Date(config.auth.tokenExpiry).getTime();
    return Date.now() >= expiry - 5 * 60 * 1000; // 5 min buffer
  }
}