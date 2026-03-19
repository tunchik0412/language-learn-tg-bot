import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider, GenerationOptions, DEFAULT_GENERATION_OPTIONS } from './base.js';
import type { AIMessage, AIResponse, AIProvider } from '../../types/index.js';

export class ClaudeProvider extends BaseAIProvider {
  readonly name: AIProvider = 'claude';
  private client: Anthropic | null = null;

  override initialize(apiKey: string): void {
    super.initialize(apiKey);
    this.client = new Anthropic({ apiKey });
  }

  async generateCompletion(messages: AIMessage[], options?: GenerationOptions): Promise<AIResponse> {
    this.ensureConfigured();
    
    const opts = { ...DEFAULT_GENERATION_OPTIONS, ...options };

    try {
      // Extract system message
      const systemMessage = messages.find(m => m.role === 'system');
      const chatMessages = messages.filter(m => m.role !== 'system');

      const response = await this.client!.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: opts.maxTokens || 2048,
        system: systemMessage?.content,
        messages: chatMessages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
      });

      const content = response.content[0].type === 'text' 
        ? response.content[0].text 
        : '';
      
      return {
        content,
        provider: this.name,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      };
    } catch (error) {
      this.handleError(error, 'Claude completion');
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const tempClient = new Anthropic({ apiKey });
      await tempClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
