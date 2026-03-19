import CryptoJS from 'crypto-js';
import { config } from '../config/index.js';
import type { AITokens } from '../types/index.js';

/**
 * Encryption service for securing user API tokens
 * Uses AES-256 encryption with the ENCRYPTION_KEY from environment
 */
export class EncryptionService {
  private readonly key: string;

  constructor() {
    this.key = config.ENCRYPTION_KEY;
  }

  /**
   * Encrypt a string value
   */
  encrypt(plainText: string): string {
    if (!plainText) return '';
    return CryptoJS.AES.encrypt(plainText, this.key).toString();
  }

  /**
   * Decrypt an encrypted string
   */
  decrypt(cipherText: string): string {
    if (!cipherText) return '';
    try {
      const bytes = CryptoJS.AES.decrypt(cipherText, this.key);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch {
      console.error('Failed to decrypt value');
      return '';
    }
  }

  /**
   * Encrypt AI tokens object
   */
  encryptTokens(tokens: AITokens): string {
    const json = JSON.stringify(tokens);
    return this.encrypt(json);
  }

  /**
   * Decrypt AI tokens
   */
  decryptTokens(encryptedTokens: string): AITokens {
    if (!encryptedTokens) return {};
    try {
      const json = this.decrypt(encryptedTokens);
      return JSON.parse(json) as AITokens;
    } catch {
      console.error('Failed to decrypt tokens');
      return {};
    }
  }

  /**
   * Encrypt a single token for a specific provider
   */
  encryptToken(currentEncrypted: string | null, provider: string, token: string): string {
    const tokens = currentEncrypted ? this.decryptTokens(currentEncrypted) : {};
    tokens[provider as keyof AITokens] = token;
    return this.encryptTokens(tokens);
  }

  /**
   * Get a specific decrypted token
   */
  getToken(encryptedTokens: string | null, provider: string): string | undefined {
    if (!encryptedTokens) return undefined;
    const tokens = this.decryptTokens(encryptedTokens);
    return tokens[provider as keyof AITokens];
  }

  /**
   * Remove a token for a specific provider
   */
  removeToken(currentEncrypted: string, provider: string): string {
    const tokens = this.decryptTokens(currentEncrypted);
    delete tokens[provider as keyof AITokens];
    return this.encryptTokens(tokens);
  }

  /**
   * Validate that a token looks like a valid API key format
   */
  validateTokenFormat(provider: string, token: string): boolean {
    const patterns: Record<string, RegExp> = {
      gemini: /^[A-Za-z0-9_-]{39}$/, // Google API keys
      openai: /^sk-(proj-)?[A-Za-z0-9_-]{32,}$/, // OpenAI keys: sk-... or sk-proj-...
      claude: /^sk-ant-[A-Za-z0-9_-]{90,}$/, // Anthropic keys
    };

    const pattern = patterns[provider];
    if (!pattern) return true; // Unknown provider, accept any non-empty string
    return pattern.test(token.trim());
  }

  /**
   * Mask a token for display (show first and last few characters)
   */
  maskToken(token: string): string {
    if (!token || token.length < 10) return '****';
    const start = token.slice(0, 6);
    const end = token.slice(-4);
    return `${start}...${end}`;
  }
}

// Singleton instance
export const encryptionService = new EncryptionService();
