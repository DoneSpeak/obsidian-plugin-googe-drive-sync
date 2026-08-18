export class CryptoUtils {
  private static ALGORITHM = 'AES-GCM';
  private static KEY_LENGTH = 256;

  static async generateKey(): Promise<string> {
    const key = await crypto.subtle.generateKey(
      { name: this.ALGORITHM, length: this.KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', key);
    return this.arrayBufferToBase64(exported);
  }

  static async encrypt(text: string, keyBase64: string): Promise<string> {
    const key = await this.importKey(keyBase64);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: this.ALGORITHM, iv },
      key,
      encoder.encode(text)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return this.arrayBufferToBase64(combined.buffer);
  }

  static async decrypt(encryptedBase64: string, keyBase64: string): Promise<string> {
    const key = await this.importKey(keyBase64);
    const combined = this.base64ToArrayBuffer(encryptedBase64);
    const iv = new Uint8Array(combined.slice(0, 12));
    const data = new Uint8Array(combined.slice(12));
    const decrypted = await crypto.subtle.decrypt(
      { name: this.ALGORITHM, iv },
      key,
      data
    );
    return new TextDecoder().decode(decrypted);
  }

  private static async importKey(keyBase64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      this.base64ToArrayBuffer(keyBase64),
      { name: this.ALGORITHM },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}