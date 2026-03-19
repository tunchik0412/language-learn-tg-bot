import OpenAI from 'openai';
import { BaseAIProvider, GenerationOptions, DEFAULT_GENERATION_OPTIONS } from './base.js';
import type { AIMessage, AIResponse, AIProvider } from '../../types/index.js';

export class OpenAIProvider extends BaseAIProvider {
  readonly name: AIProvider = 'openai';
  private client: OpenAI | null = null;

  override initialize(apiKey: string): void {
    super.initialize(apiKey);
    this.client = new OpenAI({ apiKey });
  }

  async generateCompletion(messages: AIMessage[], options?: GenerationOptions): Promise<AIResponse> {
    this.ensureConfigured();
    
    const opts = { ...DEFAULT_GENERATION_OPTIONS, ...options };

    try {
      const response = await this.client!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        top_p: opts.topP,
        stop: opts.stopSequences,
      });

      const content = response.choices[0]?.message?.content || '';
      
      return {
        content,
        provider: this.name,
        tokensUsed: response.usage?.total_tokens,
      };
    } catch (error) {
      this.handleError(error, 'OpenAI completion');
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const tempClient = new OpenAI({ apiKey });
      await tempClient.models.list();
      return true;
    } catch {
      return false;
    }
  }
}
