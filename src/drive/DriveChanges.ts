import { requestUrl } from 'obsidian';
import { ChangesResult, DriveFile } from '../types';
import { TokenManager } from '../auth/TokenManager';
import { driveFileFromJson } from './DriveFile';

/** Raw JSON shape of a single change resource from the Drive API. */
interface ChangeResourceJson {
  type?: string;
  fileId?: string;
  removed?: boolean;
  file?: Record<string, unknown>;
}

/** Raw JSON shape of the changes list response. */
interface ChangesListJson {
  changes?: ChangeResourceJson[];
  newStartPageToken?: string;
  nextPageToken?: string;
}

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

    const data = response.json as { startPageToken?: string };
    return data.startPageToken || '';
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
    let newStartPageToken = '';
    let nextPageToken: string | undefined;

    do {
      const response = await requestUrl({
        url: `${DriveChanges.API_BASE}/changes?${params.toString()}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = response.json as ChangesListJson;
      if (data.changes) {
        for (const change of data.changes) {
          const file: DriveFile | undefined = change.file
            ? driveFileFromJson(change.file)
            : undefined;

          allChanges.push({
            type: file?.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
            file,
            removed: change.removed || false,
            fileId: change.fileId || '',
          });
        }
      }

      newStartPageToken = data.newStartPageToken || '';
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    return {
      changes: allChanges,
      newStartPageToken,
    };
  }
}