import type { TokenUsage, ModelProviderConfig, ModelUsageRecord, UsageStatistics } from '../../types/index.js';

export { TokenUsage, ModelProviderConfig, ModelUsageRecord, UsageStatistics };

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatOptions {
  modelType: 'multimodal' | 'text' | 'asr';
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  feature: ModelUsageRecord['feature'];
  /** 指定使用的模型配置 ID，不指定则使用默认模型 */
  modelId?: string;
  /** ASR 场景下的音频文件路径 */
  audioPath?: string;
}

export interface ProviderChatOptions extends ChatOptions {
  /** 由调用方根据 modelType 解析出的具体模型 ID */
  model: string;
  /** ASR 场景下的音频文件路径 */
  audioPath?: string;
}

export interface ChatResponse {
  content: string;
  usage: TokenUsage;
  raw: unknown;
}

export interface AIProvider {
  readonly name: string;
  chat(options: ProviderChatOptions): Promise<ChatResponse>;
}

export interface UsageTracker {
  record(provider: string, model: string, feature: ModelUsageRecord['feature'], usage: TokenUsage, pricing: { inputPricePer1K: number; outputPricePer1K: number; currency: 'CNY' | 'USD' }): ModelUsageRecord;
  getStatistics(): UsageStatistics;
  reset(): void;
}
