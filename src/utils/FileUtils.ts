import { normalizePath, Vault } from 'obsidian';
import { FileInfo } from '../types';
import { createHash } from 'crypto';

export class FileUtils {
  static async computeMD5(vault: Vault, filePath: string): Promise<string> {
    try {
      const content = await vault.adapter.readBinary(normalizePath(filePath));
      const hash = createHash('md5').update(new Uint8Array(content)).digest('hex');
      return hash;
    } catch {
      return '';
    }
  }

  static computeMD5FromString(content: string): string {
    const hash = createHash('md5').update(content).digest('hex');
    return hash;
  }

  static async getFileInfo(vault: Vault, filePath: string): Promise<FileInfo> {
    const normalizedPath = normalizePath(filePath);
    try {
      const stat = await vault.adapter.stat(normalizedPath);
      if (!stat) {
        return { path: filePath, md5: '', modifiedTime: '', size: 0, exists: false };
      }
      const md5 = await this.computeMD5(vault, normalizedPath);
      return {
        path: filePath,
        md5,
        modifiedTime: new Date(stat.mtime).toISOString(),
        size: stat.size,
        exists: true,
      };
    } catch {
      return { path: filePath, md5: '', modifiedTime: '', size: 0, exists: false };
    }
  }

  static getRelativePath(vaultPath: string, filePath: string): string {
    const vaultNorm = normalizePath(vaultPath).replace(/\/$/, '');
    const fileNorm = normalizePath(filePath);
    if (fileNorm.startsWith(vaultNorm + '/')) {
      return fileNorm.slice(vaultNorm.length + 1);
    }
    return fileNorm;
  }

  static async fileExists(vault: Vault, filePath: string): Promise<boolean> {
    try {
      return await vault.adapter.exists(normalizePath(filePath));
    } catch {
      return false;
    }
  }

  static async readFileContent(vault: Vault, filePath: string): Promise<string> {
    return vault.adapter.read(normalizePath(filePath));
  }

  static async writeFileContent(vault: Vault, filePath: string, content: string): Promise<void> {
    await vault.adapter.write(normalizePath(filePath), content);
  }

  static async readBinary(vault: Vault, filePath: string): Promise<ArrayBuffer> {
    return vault.adapter.readBinary(normalizePath(filePath));
  }

  static async writeBinary(vault: Vault, filePath: string, data: ArrayBuffer): Promise<void> {
    await vault.adapter.writeBinary(normalizePath(filePath), data);
  }

  static async deleteFile(vault: Vault, filePath: string): Promise<void> {
    await vault.adapter.remove(normalizePath(filePath));
  }

  static async listFilesRecursive(vault: Vault, dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const normalized = normalizePath(dirPath);

    const entries = await vault.adapter.list(normalized);
    files.push(...entries.files);
    for (const subdir of entries.folders) {
      const subFiles = await this.listFilesRecursive(vault, subdir);
      files.push(...subFiles);
    }

    return files;
  }

  /**
   * Detect if a file is binary by its extension.
   * Returns true for images, PDFs, archives, etc.
   */
  static isBinaryFile(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return BINARY_EXTENSIONS.has(ext);
  }

  /**
   * Get MIME type for a file based on its extension.
   */
  static getMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return MIME_TYPES[ext] || 'application/octet-stream';
  }
}

const BINARY_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'tiff', 'tif', 'avif', 'heic', 'heif',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pub',
  // Archives
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst',
  // Audio/Video
  'mp3', 'mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'wav', 'flac', 'ogg', 'm4a', 'aac',
  // Executables
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat',
  // Design
  'psd', 'ai', 'eps', 'sketch', 'fig',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Other
  'iso', 'dmg', 'pkg', 'swf', 'wasm', 'parquet',
]);

const MIME_TYPES: Record<string, string> = {
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'bmp': 'image/bmp',
  'ico': 'image/x-icon',
  'tiff': 'image/tiff',
  'tif': 'image/tiff',
  'avif': 'image/avif',
  'heic': 'image/heic',
  'heif': 'image/heif',
  'svg': 'image/svg+xml',
  'pdf': 'application/pdf',
  'zip': 'application/zip',
  'mp3': 'audio/mpeg',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'wav': 'audio/wav',
  'json': 'application/json',
};