import { DriveFile as DriveFileType } from '../types';

export type { DriveFileType };

/** Raw JSON shape returned by the Google Drive API for a file resource. */
interface DriveFileJson {
  id?: string;
  name?: string;
  mimeType?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
}

export function driveFileFromJson(json: DriveFileJson): DriveFileType {
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