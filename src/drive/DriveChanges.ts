import { requestUrl } from 'obsidian';
import { ChangesResult, DriveFile } from '../types';
import { TokenManager } from '../auth/TokenManager';
import { driveFileFromJson } from './DriveFile';

export class DriveChanges {
  private static readonly API_BASE = 'https://www.googleapis.com/drive/v3';

  constructor(private tokenManager: TokenManager) {}

  async getStartPageToken(): Promise<string> {
    const token = await this.tokenManager.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const response = await requestUrl({
      url: `${DriveChanges.API_BASE}/changes/startPageToken`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    return response.json.startPageToken;
  }

  async getChanges(pageToken: string): Promise<ChangesResult> {
    const token = await this.tokenManager.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const params = new URLSearchParams({
      pageToken,
      pageSize: '500',
      fields: 'changes(type,fileId,removed,file(id,name,mimeType,md5Checksum,modifiedTime,size,parents,trashed)),newStartPageToken,nextPageToken',
    });

    const allChanges: ChangesResult['changes'] = [];
    let currentPageToken = pageToken;
    let newStartPageToken = '';
    let nextPageToken: string | undefined;

    do {
      const response = await requestUrl({
        url: `${DriveChanges.API_BASE}/changes?${params.toString()}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = response.json;
      if (data.changes) {
        for (const change of data.changes) {
          const file: DriveFile | undefined = change.file
            ? driveFileFromJson(change.file)
            : undefined;

          allChanges.push({
            type: file?.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
            file,
            removed: change.removed || false,
            fileId: change.fileId,
          });
        }
      }

      newStartPageToken = data.newStartPageToken || '';
      nextPageToken = data.nextPageToken;
      currentPageToken = nextPageToken || '';
    } while (nextPageToken);

    return {
      changes: allChanges,
      newStartPageToken,
    };
  }
}