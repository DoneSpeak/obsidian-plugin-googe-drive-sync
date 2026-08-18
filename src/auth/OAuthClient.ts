import { requestUrl } from 'obsidian';
import { DeviceCodeResponse, TokenResponse } from '../types';

export class OAuthClient {
  private static readonly DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
  private static readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private static readonly OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.file';

  async startDeviceCodeFlow(clientId: string): Promise<DeviceCodeResponse> {
    const response = await requestUrl({
      url: OAuthClient.DEVICE_CODE_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(OAuthClient.OAUTH_SCOPE)}`,
    });

    if (response.status !== 200) {
      throw new Error(`Device code request failed: ${response.status} ${response.text}`);
    }

    return response.json as DeviceCodeResponse;
  }

  async pollForToken(
    clientId: string,
    deviceCode: string,
    interval: number
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    // Polling loop: runs until we get a token or an error response.
    // Google's device code flow requires polling the token endpoint
    // at a specified interval until the user completes authorization.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.sleep(interval * 1000);

      try {
        const response = await requestUrl({
          url: OAuthClient.TOKEN_URL,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (response.status === 200) {
          return response.json as TokenResponse;
        }

        const data = response.json;
        if (data.error === 'authorization_pending') {
          // Still waiting for user — continue polling
          continue;
        } else if (data.error === 'slow_down') {
          // Google asks us to increase interval
          interval += 5;
          continue;
        } else if (data.error === 'access_denied') {
          throw new Error('User denied the authorization request');
        } else if (data.error === 'expired_token') {
          throw new Error('Device code expired. Please start again.');
        } else {
          throw new Error(`Token polling failed: ${data.error}`);
        }
      } catch (e) {
        if (e.message?.includes('authorization_pending') || e.message?.includes('slow_down')) {
          continue;
        }
        throw e;
      }
    }
  }

  async refreshAccessToken(clientId: string, refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await requestUrl({
      url: OAuthClient.TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (response.status !== 200) {
      throw new Error(`Token refresh failed: ${response.status} ${response.text}`);
    }

    return response.json as TokenResponse;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }
}