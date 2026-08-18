import { IgnoreConfig } from '../types';

export class IgnoreUtils {
  static shouldIgnore(filePath: string, ignoreConfig: IgnoreConfig): boolean {
    const normalized = filePath.replace(/\\/g, '/');

    // Check if path starts with any ignored folder
    for (const folder of ignoreConfig.folders) {
      const folderPath = folder.endsWith('/') ? folder : `${folder}/`;
      if (normalized === folder || normalized.startsWith(folderPath)) {
        return true;
      }
    }

    // Check glob patterns
    for (const pattern of ignoreConfig.patterns) {
      if (this.matchGlob(normalized, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse .gitignore content into patterns and folders arrays
   * compatible with IgnoreConfig.
   *
   * Handles:
   * - Comment lines (#)
   * - Empty lines
   * - Trailing whitespace
   * - Directory patterns (trailing /)
   * - Negation patterns (!) - skipped
   * - Simple glob patterns (*, ?)
   * - Path-based patterns (containing /)
   */
  static parseGitignoreContent(content: string): { patterns: string[]; folders: string[] } {
    const patterns: string[] = [];
    const folders: string[] = [];
    const negations: string[] = [];

    const lines = content.split('\n');
    for (let line of lines) {
      // Remove trailing whitespace (but keep escaped spaces)
      line = line.replace(/\\\s$/, ' ');
      line = line.trim();

      if (!line || line.startsWith('#')) continue;

      // Handle negation
      if (line.startsWith('!')) {
        negations.push(line.slice(1));
        continue;
      }

      // Directory pattern (trailing /)
      if (line.endsWith('/')) {
        folders.push(line.slice(0, -1));
      } else {
        patterns.push(line);
      }
    }

    // Remove negated patterns from the lists
    if (negations.length > 0) {
      for (const neg of negations) {
        const negDir = neg.endsWith('/') ? neg.slice(0, -1) : neg;
        // Remove from folders
        const folderIdx = folders.indexOf(negDir);
        if (folderIdx >= 0) folders.splice(folderIdx, 1);
        // Remove from patterns
        const patIdx = patterns.indexOf(neg);
        if (patIdx >= 0) patterns.splice(patIdx, 1);
      }
    }

    return { patterns, folders };
  }

  private static matchGlob(filePath: string, pattern: string): boolean {
    const fileName = filePath.split('/').pop() || filePath;

    // For patterns containing '/', also match against the full path
    if (pattern.includes('/')) {
      if (this.matchPathGlob(filePath, pattern)) return true;
    }

    // Handle *.ext patterns
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      return fileName.endsWith(ext);
    }

    // Handle *name* patterns
    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      const search = pattern.slice(1, -1);
      return fileName.includes(search);
    }

    if (pattern.startsWith('*')) {
      return fileName.endsWith(pattern.slice(1));
    }

    if (pattern.endsWith('*')) {
      return fileName.startsWith(pattern.slice(0, -1));
    }

    return fileName === pattern;
  }

  /**
   * Match glob patterns that contain '/' against the full path.
   * Supports:
   * - pattern - match pattern in any directory
   * - dir/pattern - match pattern inside dir
   * - dir/*.ext - match extension in dir
   * - /anchored/pattern - anchored to vault root
   */
  private static matchPathGlob(filePath: string, pattern: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    const cleanPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern;

    // Handle **/ prefix - matches in any directory
    if (cleanPattern.startsWith('**/')) {
      const suffix = cleanPattern.slice(3);
      // Check if any path suffix matches
      if (normalized.endsWith(suffix)) return true;
      if (normalized.includes('/' + suffix)) return true;
      // Also check the filename against the suffix
      const fileName = normalized.split('/').pop() || '';
      if (this.matchSimpleGlob(fileName, suffix)) return true;
      // Check each path component
      for (const part of normalized.split('/')) {
        if (this.matchSimpleGlob(part, suffix)) return true;
      }
      return false;
    }

    // Handle ** anywhere in pattern
    if (cleanPattern.includes('**')) {
      const parts = cleanPattern.split('**');
      if (parts.length === 2 && parts[0] === '') {
        // Already handled above
      } else if (parts.length === 2) {
        // prefix/**/suffix - match prefix, then any dirs, then suffix
        if (normalized.startsWith(parts[0].replace(/\/$/, '') + '/') &&
            normalized.endsWith(parts[1])) {
          return true;
        }
      }
      return false;
    }

    // For simple dir/pattern matching
    const slashIdx = cleanPattern.indexOf('/');
    if (slashIdx > 0) {
      const prefix = cleanPattern.substring(0, slashIdx);
      const suffix = cleanPattern.substring(slashIdx + 1);

      // Check if path starts with prefix/
      if (normalized.startsWith(prefix + '/')) {
        const rest = normalized.substring(prefix.length + 1);
        if (this.matchSimpleGlob(rest, suffix)) return true;
      }

      // Check if prefix is somewhere in the path (for nested dirs)
      // e.g. pattern "dist/*.js" should match "subdir/dist/foo.js"
      const searchPrefix = '/' + prefix + '/';
      const idx = normalized.indexOf(searchPrefix);
      if (idx >= 0) {
        const rest = normalized.substring(idx + searchPrefix.length);
        if (this.matchSimpleGlob(rest, suffix)) return true;
      }
    }

    return false;
  }

  /**
   * Simple glob matching against a path segment (no directory separator).
   * Supports *, *., .*, *name*, *name, name*, and exact match.
   */
  private static matchSimpleGlob(segment: string, pattern: string): boolean {
    if (pattern === '*' || pattern === '**') return true;
    if (pattern === segment) return true;

    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      return segment.endsWith(ext);
    }

    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      const search = pattern.slice(1, -1);
      return segment.includes(search);
    }

    if (pattern.startsWith('*')) {
      return segment.endsWith(pattern.slice(1));
    }

    if (pattern.endsWith('*')) {
      return segment.startsWith(pattern.slice(0, -1));
    }

    return false;
  }
}