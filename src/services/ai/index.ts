import { config } from '../../config/index.js';
import { encryptionService } from '../encryption.js';
import { prisma } from '../database.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { ClaudeProvider } from './claude.js';
import type { IAIProvider, GenerationOptions } from './base.js';
import type { AIMessage, AIResponse, AIProvider, AITokens } from '../../types/index.js';
import { AIProviderError } from '../../types/index.js';

/**
 * Main AI Service that manages multiple providers and handles fallback
 */
export class AIService {
  private providers: Map<AIProvider, IAIProvider> = new Map();
  private fallbackOrder: AIProvider[] = ['gemini', 'openai', 'claude'];

  constructor() {
    // Initialize provider instances
    this.providers.set('gemini', new GeminiProvider());
    this.providers.set('openai', new OpenAIProvider());
    this.providers.set('claude', new ClaudeProvider());
  }

  /**
   * Get the appropriate provider for a user
   */
  async getProviderForUser(telegramId: bigint): Promise<{ provider: IAIProvider; providerName: AIProvider }> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      select: { preferredAi: true, apiTokens: true },
    });

    const preferredProvider = (user?.preferredAi as AIProvider) || config.DEFAULT_AI_PROVIDER;
    const tokens = user?.apiTokens 
      ? encryptionService.decryptTokens(user.apiTokens as string)
      : {} as AITokens;

    // Try providers in order: preferred first, then fallbacks
    const providerOrder = [
      preferredProvider,
      ...this.fallbackOrder.filter(p => p !== preferredProvider),
    ];

    for (const providerName of providerOrder) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      // Try user's token first
      const userToken = tokens[providerName];
      if (userToken) {
        provider.initialize(userToken);
        return { provider, providerName };
      }

      // Try fallback environment token
      const envToken = this.getEnvToken(providerName);
      if (envToken) {
        provider.initialize(envToken);
        return { provider, providerName };
      }
    }

    throw new AIProviderError(
      'No AI provider configured. Please set up an API token using /settings.',
      preferredProvider
    );
  }

  /**
   * Generate a completion with automatic fallback
   */
  async generateWithFallback(
    telegramId: bigint,
    messages: AIMessage[],
    options?: GenerationOptions
  ): Promise<AIResponse> {
    const errors: AIProviderError[] = [];
    
    const user = await prisma.user.findUnique({
      where: { telegramId },
      select: { preferredAi: true, apiTokens: true },
    });

    const preferredProvider = (user?.preferredAi as AIProvider) || config.DEFAULT_AI_PROVIDER;
    const tokens = user?.apiTokens 
      ? encryptionService.decryptTokens(user.apiTokens as string)
      : {} as AITokens;

    // Try providers in order
    const providerOrder = [
      preferredProvider,
      ...this.fallbackOrder.filter(p => p !== preferredProvider),
    ];

    for (const providerName of providerOrder) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      // Try user's token first
      const userToken = tokens[providerName];
      const envToken = this.getEnvToken(providerName);
      const tokenToUse = userToken || envToken;

      if (!tokenToUse) continue;

      try {
        provider.initialize(tokenToUse);
        const response = await provider.generateCompletion(messages, options);
        return response;
      } catch (error) {
        const aiError = error instanceof AIProviderError 
          ? error 
          : new AIProviderError(
              error instanceof Error ? error.message : 'Unknown error',
              providerName
            );
        errors.push(aiError);
        console.error(`Provider ${providerName} failed:`, aiError.message);
        continue;
      }
    }

    // All providers failed
    const errorMessages = errors.map(e => `${e.provider}: ${e.message}`).join('; ');
    throw new AIProviderError(
      `All AI providers failed. Errors: ${errorMessages}`,
      preferredProvider
    );
  }

  /**
   * Validate and set a user's API token
   */
  async setUserToken(
    telegramId: bigint,
    provider: AIProvider,
    token: string
  ): Promise<{ success: boolean; message: string }> {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      return { success: false, message: `Unknown provider: ${provider}` };
    }

    // Validate token format
    if (!encryptionService.validateTokenFormat(provider, token)) {
      return { 
        success: false, 
        message: `Invalid token format for ${provider}. Please check your API key.` 
      };
    }

    // Validate by making a test request
    const isValid = await providerInstance.validateApiKey(token);
    if (!isValid) {
      return { 
        success: false, 
        message: `Invalid API key for ${provider}. The key was rejected by the service.` 
      };
    }

    // Encrypt and store
    const user = await prisma.user.findUnique({
      where: { telegramId },
      select: { apiTokens: true },
    });

    const encryptedTokens = encryptionService.encryptToken(
      user?.apiTokens as string | null,
      provider,
      token
    );

    await prisma.user.update({
      where: { telegramId },
      data: { 
        apiTokens: encryptedTokens,
        preferredAi: provider, // Set as preferred since they just added it
      },
    });

    return { 
      success: true, 
      message: `${provider.charAt(0).toUpperCase() + provider.slice(1)} API key saved successfully!` 
    };
  }

  /**
   * Remove a user's token for a specific provider
   */
  async removeUserToken(telegramId: bigint, provider: AIProvider): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      select: { apiTokens: true, preferredAi: true },
    });

    if (user?.apiTokens) {
      const updatedTokens = encryptionService.removeToken(
        user.apiTokens as string,
        provider
      );

      await prisma.user.update({
        where: { telegramId },
        data: {
          apiTokens: updatedTokens,
          // Reset preferred if it was this provider
          ...(user.preferredAi === provider && { preferredAi: null }),
        },
      });
    }
  }

  /**
   * Get configured providers for a user
   */
  async getUserProviders(telegramId: bigint): Promise<{
    configured: AIProvider[];
    preferred: AIProvider | null;
    available: AIProvider[];
  }> {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      select: { preferredAi: true, apiTokens: true },
    });

    const tokens = user?.apiTokens 
      ? encryptionService.decryptTokens(user.apiTokens as string)
      : {} as AITokens;

    const configured: AIProvider[] = [];
    const available: AIProvider[] = [];

    for (const provider of this.fallbackOrder) {
      if (tokens[provider]) {
        configured.push(provider);
        available.push(provider);
      } else if (this.getEnvToken(provider)) {
        available.push(provider);
      }
    }

    return {
      configured,
      preferred: user?.preferredAi as AIProvider | null,
      available,
    };
  }

  /**
   * Set the preferred AI provider for a user
   */
  async setPreferredProvider(telegramId: bigint, provider: AIProvider): Promise<void> {
    await prisma.user.update({
      where: { telegramId },
      data: { preferredAi: provider },
    });
  }

  private getEnvToken(provider: AIProvider): string | undefined {
    switch (provider) {
      case 'gemini':
        return config.GEMINI_API_KEY;
      case 'openai':
        return config.OPENAI_API_KEY;
      case 'claude':
        return config.ANTHROPIC_API_KEY;
      default:
        return undefined;
    }
  }
}

// Singleton instance
export const aiService = new AIService();

// Re-export types
export type { IAIProvider, GenerationOptions };
