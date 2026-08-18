import { requestUrl, Notice } from 'obsidian';
import { DriveFile } from '../types';
import { TokenManager } from '../auth/TokenManager';
import { driveFileFromJson } from './DriveFile';

export class DriveClient {
  private static readonly API_BASE = 'https://www.googleapis.com/drive/v3';
  private static readonly UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
  private static readonly MAX_RETRIES = 3;
  private static readonly DRIVE_PARAMS = 'supportsAllDrives=true';
  private static readonly LIST_DRIVE_PARAMS = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

  constructor(private tokenManager: TokenManager) {}

  async listFiles(folderId: string = 'root'): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,md5Checksum,modifiedTime,size,parents,trashed),nextPageToken',
        pageSize: '1000',
      });
      // Add shared drive params
      params.append('supportsAllDrives', 'true');
      params.append('includeItemsFromAllDrives', 'true');
      params.append('corpora', 'allDrives');
      if (pageToken) params.set('pageToken', pageToken);

      const data = await this.apiRequest<{ files: any[]; nextPageToken?: string }>(
        `${DriveClient.API_BASE}/files?${params.toString()}`
      );

      if (data.files) {
        for (const f of data.files) {
          files.push(driveFileFromJson(f));
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return files;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: 'id,name,mimeType,md5Checksum,modifiedTime,size,parents,trashed',
    });
    params.append('supportsAllDrives', 'true');
    const data = await this.apiRequest<any>(
      `${DriveClient.API_BASE}/files/${fileId}?${params.toString()}`
    );
    return driveFileFromJson(data);
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const token = await this.tokenManager.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const response = await requestUrl({
      url: `${DriveClient.API_BASE}/files/${fileId}?alt=media&supportsAllDrives=true`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    return response.arrayBuffer;
  }

  async uploadFile(
    fileName: string,
    parentFolderId: string,
    data: ArrayBuffer,
    mimeType: string = 'text/markdown'
  ): Promise<DriveFile> {
    const token = await this.tokenManager.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    // Step 1: Create resumable upload session
    const metadata = { name: fileName, parents: [parentFolderId] };
    const sessionResponse = await requestUrl({
      url: `${DriveClient.UPLOAD_BASE}/files?uploadType=resumable&supportsAllDrives=true`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': data.byteLength.toString(),
      },
      body: JSON.stringify(metadata),
    });

    if (sessionResponse.status !== 200) {
      throw new Error(`Upload session creation failed: ${sessionResponse.status} ${sessionResponse.text}`);
    }

    const location = sessionResponse.headers?.['location'];
    if (!location) throw new Error('No upload URL returned from Drive API');

    // Step 2: Upload the file content
    const uploadResponse = await requestUrl({
      url: location,
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: data,
    });

    if (uploadResponse.status !== 200 && uploadResponse.status !== 201) {
      throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.text}`);
    }

    return driveFileFromJson(uploadResponse.json);
  }

  async updateFile(
    fileId: string,
    data: ArrayBuffer,
    mimeType: string = 'text/markdown'
  ): Promise<DriveFile> {
    const token = await this.tokenManager.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    // Step 1: Create resumable upload session
    const sessionResponse = await requestUrl({
      url: `${DriveClient.UPLOAD_BASE}/files/${fileId}?uploadType=resumable&supportsAllDrives=true`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': data.byteLength.toString(),
      },
      body: '{}',
    });

    if (sessionResponse.status !== 200) {
      throw new Error(`Update session creation failed: ${sessionResponse.status} ${sessionResponse.text}`);
    }

    const location = sessionResponse.headers?.['location'];
    if (!location) throw new Error('No upload URL returned from Drive API');

    // Step 2: Upload the file content
    const uploadResponse = await requestUrl({
      url: location,
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: data,
    });

    if (uploadResponse.status !== 200 && uploadResponse.status !== 201) {
      throw new Error(`Update failed: ${uploadResponse.status} ${uploadResponse.text}`);
    }

    return driveFileFromJson(uploadResponse.json);
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.apiRequest(`${DriveClient.API_BASE}/files/${fileId}?supportsAllDrives=true`, 'DELETE');
  }

  async createFolder(name: string, parentFolderId: string): Promise<DriveFile> {
    const data = await this.apiRequest<any>(
      `${DriveClient.API_BASE}/files`,
      'POST',
      {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      }
    );
    return driveFileFromJson(data);
  }

  private async apiRequest<T>(
    url: string,
    method: string = 'GET',
    body?: any
  ): Promise<T> {
    const token = await this.tokenManager.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < DriveClient.MAX_RETRIES; attempt++) {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
        };

        if (body && method !== 'GET') {
          headers['Content-Type'] = 'application/json';
        }

        const response = await requestUrl({
          url,
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        if (response.status === 429) {
          // Rate limited — wait and retry
          const retryAfter = parseInt(response.headers?.['retry-after'] || '5', 10);
          await this.sleep(retryAfter * 1000);
          continue;
        }

        if (response.status >= 400) {
          throw new Error(`API error ${response.status}: ${response.text}`);
        }

        return response.json as T;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        // Network errors (no response) — no point retrying if offline
        const msg = lastError.message;
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') ||
            msg.includes('net::ERR_') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
          throw new Error('Network error: cannot reach Google Drive. Check your internet connection.');
        }

        if (attempt < DriveClient.MAX_RETRIES - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}