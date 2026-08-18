import { DriveFile as DriveFileType } from '../types';

export type { DriveFileType };

export function driveFileFromJson(json: any): DriveFileType {
  return {
    id: json.id || '',
    name: json.name || '',
    mimeType: json.mimeType || '',
    md5Checksum: json.md5Checksum || '',
    modifiedTime: json.modifiedTime || '',
    size: parseInt(json.size || '0', 10),
    parents: json.parents || [],
    trashed: json.trashed || false,
  };
}