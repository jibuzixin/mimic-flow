import { getStore } from '../store.js';
import { getLogger } from '../logger.js';
import { createDoubaoProvider } from './doubao.js';
import { createUsageTracker } from './usage.js';
import type { AIProvider, ChatOptions, ChatResponse } from './types.js';
import type { ModelProfile, ModelProviderConfig } from '../../types/index.js';

const usageTracker = createUsageTracker();

function createProvider(profile: ModelProfile): AIProvider {
  switch (profile.provider) {
    case 'doubao':
      return createDoubaoProvider({
        name: 'doubao',
        label: profile.name,
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        multimodalModel: { model: profile.modelId, enabled: profile.enabled, pricing: profile.pricing },
      } as ModelProviderConfig);
    default:
      throw new Error(`不支持的模型 Provider: ${profile.provider}`);
  }
}

function findModelByIdOrDefault(
  models: ModelProfile[],
  defaultIds: { multimodal?: string; text?: string; asr?: string; midscene?: string },
  modelType: ChatOptions['modelType'],
  requestedModelId?: string
): ModelProfile {
  let id = requestedModelId;
  if (!id) {
    id = defaultIds[modelType];
  }

  const model = id ? models.find((m) => m.id === id && m.enabled) : undefined;
  if (model) return model;

  // 按能力匹配兜底
  const fallback = models.find((m) => m.capability === modelType && m.enabled);
  if (fallback) return fallback;

  throw new Error(`未找到可用的 ${modelType} 模型，请先在设置中配置并启用`);
}

export async function aiChat(options: ChatOptions): Promise<ChatResponse> {
  const store = getStore();
  const models = store.get('models') || [];
  const defaultIds = store.get('defaultModelIds') || {};

  const model = findModelByIdOrDefault(models, defaultIds, options.modelType, options.modelId);

  if (!model.modelId) {
    throw new Error(`模型 ${model.name} 未设置模型 ID`);
  }

  const provider = createProvider(model);
  const log = getLogger();
  log.info('AI chat request', {
    provider: model.provider,
    modelType: options.modelType,
    model: model.modelId,
    feature: options.feature,
    messageCount: options.messages.length,
  });

  const response = await provider.chat({ ...options, model: model.modelId, modelType: options.modelType });
  const record = usageTracker.record(model.provider, model.modelId, options.feature, response.usage, model.pricing);

  log.info('AI chat response', {
    provider: model.provider,
    feature: options.feature,
    model: model.modelId,
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    totalTokens: response.usage.totalTokens,
    cost: record.cost,
    currency: record.currency,
  });

  return response;
}

export function getUsageStatistics() {
  return usageTracker.getStatistics();
}

export function resetUsageStatistics() {
  usageTracker.reset();
}

export type { ChatOptions, ChatResponse };
