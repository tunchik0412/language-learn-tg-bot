import { GoogleGenerativeAI, GenerativeModel, Content } from '@google/generative-ai';
import { BaseAIProvider, GenerationOptions, DEFAULT_GENERATION_OPTIONS } from './base.js';
import type { AIMessage, AIResponse, AIProvider } from '../../types/index.js';

export class GeminiProvider extends BaseAIProvider {
  readonly name: AIProvider = 'gemini';
  private client: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;

  override initialize(apiKey: string): void {
    super.initialize(apiKey);
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async generateCompletion(messages: AIMessage[], options?: GenerationOptions): Promise<AIResponse> {
    this.ensureConfigured();
    
    const opts = { ...DEFAULT_GENERATION_OPTIONS, ...options };

    try {
      // Convert messages to Gemini format
      const systemMessage = messages.find(m => m.role === 'system');
      const chatMessages = messages.filter(m => m.role !== 'system');
      
      const history: Content[] = chatMessages.slice(0, -1).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      }));

      const lastMessage = chatMessages[chatMessages.length - 1];
      
      const chat = this.model!.startChat({
        history,
        generationConfig: {
          maxOutputTokens: opts.maxTokens,
          temperature: opts.temperature,
          topP: opts.topP,
          stopSequences: opts.stopSequences,
        },
        ...(systemMessage && {
          systemInstruction: { role: 'user', parts: [{ text: systemMessage.content }] },
        }),
      });

      const result = await chat.sendMessage(lastMessage.content);
      const response = result.response;
      const text = response.text();

      return {
        content: text,
        provider: this.name,
        tokensUsed: response.usageMetadata?.totalTokenCount,
      };
    } catch (error) {
      this.handleError(error, 'Gemini completion');
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const tempClient = new GoogleGenerativeAI(apiKey);
      const tempModel = tempClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await tempModel.generateContent('Hello');
      return true;
    } catch (error) {
      console.log('Gemini API key validation failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }
}
