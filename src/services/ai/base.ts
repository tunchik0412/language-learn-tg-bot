import type { AIMessage, AIResponse, AIProvider } from '../../types/index.js';
import { AIProviderError } from '../../types/index.js';

/**
 * Base interface for AI providers
 */
export interface IAIProvider {
  readonly name: AIProvider;
  
  /**
   * Initialize the provider with an API key
   */
  initialize(apiKey: string): void;
  
  /**
   * Check if the provider is properly configured
   */
  isConfigured(): boolean;
  
  /**
   * Generate a completion from the AI
   */
  generateCompletion(messages: AIMessage[], options?: GenerationOptions): Promise<AIResponse>;
  
  /**
   * Validate an API key by making a test request
   */
  validateApiKey(apiKey: string): Promise<boolean>;
}

export interface GenerationOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

export const DEFAULT_GENERATION_OPTIONS: GenerationOptions = {
  maxTokens: 2048,
  temperature: 0.7,
  topP: 0.9,
};

/**
 * Base class for AI providers with common functionality
 */
export abstract class BaseAIProvider implements IAIProvider {
  abstract readonly name: AIProvider;
  protected apiKey: string | null = null;

  initialize(apiKey: string): void {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  abstract generateCompletion(messages: AIMessage[], options?: GenerationOptions): Promise<AIResponse>;
  
  abstract validateApiKey(apiKey: string): Promise<boolean>;

  protected handleError(error: unknown, operation: string): never {
    const message = error instanceof Error ? error.message : String(error);
    throw new AIProviderError(
      `${operation} failed: ${message}`,
      this.name,
      error instanceof Error ? error : undefined
    );
  }

  protected ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new AIProviderError(
        `${this.name} provider is not configured. Please set an API key.`,
        this.name
      );
    }
  }
}
