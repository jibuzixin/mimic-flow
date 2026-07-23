import Store from 'electron-store';
import type { ModelProviderConfig, UsageStatistics, ModelProfile, DefaultModelSelection } from '../types/index.js';
import type { ModelConfig } from '../types/flow.js';

interface AppStore {
  modelProvider: ModelProviderConfig;
  midsceneModel: ModelConfig;
  /** 新版多模型配置列表 */
  models: ModelProfile[];
  /** 各场景默认选用的模型 ID */
  defaultModelIds: DefaultModelSelection;
  videoSavePath: string;
  videoParseConcurrency: number;
  globalRuntimeOption: {
    defaultTimeout: number;
    defaultRetry: number;
  };
  shortcutKeys: {
    recordToggle: string;
    recordPause: string;
    voicePushToTalk: string;
    stopRecord: string;
  };
  ui: {
    sidebarCollapsed: boolean;
  };
  workflows: unknown[];
  usageStatistics: UsageStatistics;
}

const defaultPricing = {
  inputPricePer1K: 0,
  outputPricePer1K: 0,
  currency: 'CNY' as const,
};

const defaultSubModel = (model = '', maxImagesPerRequest?: number): ModelProviderConfig['multimodalModel'] => ({
  model,
  enabled: true,
  pricing: { ...defaultPricing },
  maxImagesPerRequest,
});

const defaultModelProvider: ModelProviderConfig = {
  name: 'doubao',
  label: '豆包',
  apiKey: '',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  multimodalModel: defaultSubModel('', 10),
  textModel: defaultSubModel(''),
  asrModel: defaultSubModel(''),
};

const defaultMidsceneModel: ModelConfig = {
  modelName: 'doubao-vision-4k',
  apiKey: '',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  defaultDeepThink: false,
  cacheable: true,
  timeout: 60000,
};

const defaultModels: ModelProfile[] = [
  {
    id: 'default-multimodal',
    name: '豆包多模态',
    provider: 'doubao',
    tags: ['multimodal', 'text'],
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    modelId: '',
    modelFamily: 'doubao-seed',
    enabled: true,
    pricing: { ...defaultPricing },
    timeout: 60000,
    retryCount: 1,
    reasoningEnabled: false,
    cacheable: true,
    maxImagesPerRequest: 10,
  },
];

const defaultModelIds: DefaultModelSelection = {
  defaultMultimodal: 'default-multimodal',
  executionEngines: {
    midscene: {
      defaultModelId: 'default-multimodal',
    },
  },
};

const defaultGlobalRuntimeOption: AppStore['globalRuntimeOption'] = {
  defaultTimeout: 300000,
  defaultRetry: 0,
};

const defaultUsageStatistics: UsageStatistics = {
  totalRequests: 0,
  usageKnownRequests: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  primaryCurrency: 'CNY',
  recentRecords: [],
};

let store: Store<AppStore> | null = null;

export function getStore(): Store<AppStore> {
  if (!store) {
    store = new Store<AppStore>({
      defaults: {
        modelProvider: defaultModelProvider,
        midsceneModel: defaultMidsceneModel,
        models: defaultModels,
        defaultModelIds: defaultModelIds,
        videoSavePath: '',
        videoParseConcurrency: 3,
        globalRuntimeOption: defaultGlobalRuntimeOption,
        shortcutKeys: {
          recordToggle: 'F9',
          recordPause: 'Shift+A',
          voicePushToTalk: 'Shift+V',
          stopRecord: 'Shift+S',
        },
        ui: {
          sidebarCollapsed: false,
        },
        workflows: [],
        usageStatistics: defaultUsageStatistics,
      },
    });

    // 迁移：若新版模型列表为空，从旧版 modelProvider + midsceneModel 迁移
    migrateLegacyModelsIfNeeded(store);
  }
  return store;
}

function migrateLegacyModelsIfNeeded(store: Store<AppStore>) {
  const existing = store.get('models');
  if (existing && existing.length > 0) {
    const needsMigration = existing.some((m: any) => m.capability && !m.tags);
    if (!needsMigration) return;

    const migrated: ModelProfile[] = existing.map((m: any) => {
      const tags: string[] = [];
      if (m.capability === 'multimodal') tags.push('multimodal', 'text');
      else if (m.capability === 'text') tags.push('text');
      else if (m.capability === 'asr') tags.push('asr');
      else if (m.capability === 'midscene') tags.push('multimodal', 'text');

      return {
        id: m.id,
        name: m.name,
        provider: m.provider,
        tags,
        baseUrl: m.baseUrl,
        apiKey: m.apiKey,
        modelId: m.modelId,
        modelFamily: m.modelFamily || 'doubao-seed',
        enabled: m.enabled,
        pricing: m.pricing,
        timeout: m.timeout,
        retryCount: m.retryCount ?? 1,
        reasoningEnabled: m.reasoningEnabled ?? m.defaultDeepThink ?? false,
        cacheable: m.cacheable ?? true,
        maxImagesPerRequest: m.maxImagesPerRequest,
        extraModelParams: m.extraModelParams,
      } as ModelProfile;
    });

    const oldDefaultIds = store.get('defaultModelIds') as any;
    const newDefaultIds: DefaultModelSelection = {
      defaultMultimodal: oldDefaultIds?.multimodal || oldDefaultIds?.midscene,
      executionEngines: {
        midscene: {
          defaultModelId: oldDefaultIds?.midscene || oldDefaultIds?.multimodal,
        },
      },
    };

    store.set('models', migrated);
    store.set('defaultModelIds', newDefaultIds);
    return;
  }

  const legacyProvider = store.get('modelProvider');
  const legacyMidscene = store.get('midsceneModel');
  const migrated: ModelProfile[] = [];
  let defaultMultimodalId: string | undefined;
  let midsceneDefaultId: string | undefined;

  if (legacyProvider?.multimodalModel?.model) {
    const id = 'migrated-multimodal';
    migrated.push({
      id,
      name: `${legacyProvider.label || legacyProvider.name} 多模态`,
      provider: legacyProvider.name,
      tags: ['multimodal', 'text'],
      baseUrl: legacyProvider.baseUrl,
      apiKey: legacyProvider.apiKey,
      modelId: legacyProvider.multimodalModel.model,
      modelFamily: 'doubao-seed',
      enabled: true,
      pricing: legacyProvider.multimodalModel.pricing,
      timeout: 60000,
      retryCount: 1,
      reasoningEnabled: false,
      cacheable: true,
      maxImagesPerRequest: legacyProvider.multimodalModel.maxImagesPerRequest ?? 10,
    });
    defaultMultimodalId = id;
    midsceneDefaultId = id;
  }

  if (legacyProvider?.textModel?.enabled && legacyProvider.textModel.model) {
    const id = 'migrated-text';
    migrated.push({
      id,
      name: `${legacyProvider.label || legacyProvider.name} 文本`,
      provider: legacyProvider.name,
      tags: ['text'],
      baseUrl: legacyProvider.baseUrl,
      apiKey: legacyProvider.apiKey,
      modelId: legacyProvider.textModel.model,
      modelFamily: 'doubao-seed',
      enabled: true,
      pricing: legacyProvider.textModel.pricing,
      timeout: 60000,
      retryCount: 1,
      reasoningEnabled: false,
      cacheable: true,
    });
  }

  if (legacyProvider?.asrModel?.enabled && legacyProvider.asrModel.model) {
    const id = 'migrated-asr';
    migrated.push({
      id,
      name: `${legacyProvider.label || legacyProvider.name} ASR`,
      provider: legacyProvider.name,
      tags: ['asr'],
      baseUrl: legacyProvider.baseUrl,
      apiKey: legacyProvider.apiKey,
      modelId: legacyProvider.asrModel.model,
      modelFamily: 'doubao-seed',
      enabled: true,
      pricing: legacyProvider.asrModel.pricing,
      timeout: 60000,
      retryCount: 1,
      reasoningEnabled: false,
      cacheable: true,
    });
  }

  if (legacyMidscene?.modelName) {
    const id = 'migrated-midscene';
    migrated.push({
      id,
      name: `${legacyMidscene.modelName}`,
      provider: 'doubao',
      tags: ['multimodal', 'text'],
      baseUrl: legacyMidscene.baseUrl,
      apiKey: legacyMidscene.apiKey,
      modelId: legacyMidscene.modelName,
      modelFamily: 'doubao-seed',
      enabled: true,
      pricing: { ...defaultPricing },
      timeout: legacyMidscene.timeout ?? 60000,
      retryCount: 1,
      reasoningEnabled: legacyMidscene.defaultDeepThink ?? false,
      cacheable: legacyMidscene.cacheable ?? true,
    });
    midsceneDefaultId = id;
    if (!defaultMultimodalId) defaultMultimodalId = id;
  }

  if (migrated.length > 0) {
    const newDefaultIds: DefaultModelSelection = {
      defaultMultimodal: defaultMultimodalId,
      executionEngines: {
        midscene: {
          defaultModelId: midsceneDefaultId,
        },
      },
    };
    store.set('models', migrated);
    store.set('defaultModelIds', newDefaultIds);
  }
}
