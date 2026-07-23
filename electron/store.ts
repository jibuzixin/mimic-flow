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
    capability: 'multimodal',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    modelId: '',
    enabled: true,
    pricing: { ...defaultPricing },
    timeout: 60000,
    maxImagesPerRequest: 10,
  },
  {
    id: 'default-text',
    name: '豆包文本',
    provider: 'doubao',
    capability: 'text',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    modelId: '',
    enabled: false,
    pricing: { ...defaultPricing },
    timeout: 60000,
  },
  {
    id: 'default-asr',
    name: '豆包 ASR',
    provider: 'doubao',
    capability: 'asr',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    modelId: '',
    enabled: false,
    pricing: { ...defaultPricing },
    timeout: 60000,
  },
  {
    id: 'default-midscene',
    name: '豆包 Midscene',
    provider: 'doubao',
    capability: 'midscene',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    modelId: 'doubao-vision-4k',
    enabled: true,
    pricing: { ...defaultPricing },
    timeout: 60000,
    defaultDeepThink: false,
    cacheable: true,
  },
];

const defaultModelIds: DefaultModelSelection = {
  multimodal: 'default-multimodal',
  text: 'default-text',
  asr: 'default-asr',
  midscene: 'default-midscene',
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
  if (existing && existing.length > 0) return;

  const legacyProvider = store.get('modelProvider');
  const legacyMidscene = store.get('midsceneModel');
  const migrated: ModelProfile[] = [];
  const defaultIds: DefaultModelSelection = {};

  if (legacyProvider?.multimodalModel?.model) {
    const id = 'migrated-multimodal';
    migrated.push({
      id,
      name: `${legacyProvider.label || legacyProvider.name} 多模态`,
      provider: legacyProvider.name,
      capability: 'multimodal',
      baseUrl: legacyProvider.baseUrl,
      apiKey: legacyProvider.apiKey,
      modelId: legacyProvider.multimodalModel.model,
      enabled: true,
      pricing: legacyProvider.multimodalModel.pricing,
      timeout: 60000,
      maxImagesPerRequest: legacyProvider.multimodalModel.maxImagesPerRequest ?? 10,
    });
    defaultIds.multimodal = id;
  }

  if (legacyProvider?.textModel?.enabled && legacyProvider.textModel.model) {
    const id = 'migrated-text';
    migrated.push({
      id,
      name: `${legacyProvider.label || legacyProvider.name} 文本`,
      provider: legacyProvider.name,
      capability: 'text',
      baseUrl: legacyProvider.baseUrl,
      apiKey: legacyProvider.apiKey,
      modelId: legacyProvider.textModel.model,
      enabled: true,
      pricing: legacyProvider.textModel.pricing,
      timeout: 60000,
    });
    defaultIds.text = id;
  }

  if (legacyProvider?.asrModel?.enabled && legacyProvider.asrModel.model) {
    const id = 'migrated-asr';
    migrated.push({
      id,
      name: `${legacyProvider.label || legacyProvider.name} ASR`,
      provider: legacyProvider.name,
      capability: 'asr',
      baseUrl: legacyProvider.baseUrl,
      apiKey: legacyProvider.apiKey,
      modelId: legacyProvider.asrModel.model,
      enabled: true,
      pricing: legacyProvider.asrModel.pricing,
      timeout: 60000,
    });
    defaultIds.asr = id;
  }

  if (legacyMidscene?.modelName) {
    const id = 'migrated-midscene';
    migrated.push({
      id,
      name: `${legacyMidscene.modelName}`,
      provider: 'doubao',
      capability: 'midscene',
      baseUrl: legacyMidscene.baseUrl,
      apiKey: legacyMidscene.apiKey,
      modelId: legacyMidscene.modelName,
      enabled: true,
      pricing: { ...defaultPricing },
      timeout: legacyMidscene.timeout ?? 60000,
      defaultDeepThink: legacyMidscene.defaultDeepThink,
      cacheable: legacyMidscene.cacheable,
    });
    defaultIds.midscene = id;
  }

  if (migrated.length > 0) {
    store.set('models', migrated);
    store.set('defaultModelIds', { ...defaultModelIds, ...defaultIds });
  }
}
