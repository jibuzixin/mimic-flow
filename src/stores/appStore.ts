import { create } from 'zustand';
import type { ModelProviderConfig, ModelProfile, DefaultModelSelection, ExecutionEngineConfig } from '../../types';
import type { ModelConfig } from '../../types/flow';
import { invoke } from '../lib/api';

interface AppState {
  platform: string;
  sidebarCollapsed: boolean;
  modelProvider: ModelProviderConfig | null;
  midsceneModel: ModelConfig | null;
  models: ModelProfile[];
  defaultModelIds: DefaultModelSelection;
  logSavePath: string;
  workflowSavePath: string;
  isLoading: boolean;

  init: () => Promise<void>;
  toggleSidebar: () => void;
  setModelProvider: (config: ModelProviderConfig) => Promise<void>;
  setMidsceneModel: (config: ModelConfig) => Promise<void>;
  setModels: (models: ModelProfile[]) => Promise<void>;
  setDefaultModelIds: (ids: DefaultModelSelection) => Promise<void>;
  setLogSavePath: (path: string) => Promise<void>;
  setWorkflowSavePath: (path: string) => Promise<void>;
  resetSettings: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

const getDefaultModelIds = (): DefaultModelSelection => ({
  executionEngines: {
    midscene: {},
  },
});

export const useAppStore = create<AppState>((set, get) => ({
  platform: window.mimic?.platform || 'unknown',
  sidebarCollapsed: false,
  modelProvider: null,
  midsceneModel: null,
  models: [],
  defaultModelIds: getDefaultModelIds(),
  logSavePath: '',
  workflowSavePath: '',
  isLoading: true,

  init: async () => {
    const [
      sidebarCollapsed,
      modelProvider,
      midsceneModel,
      models,
      defaultModelIds,
      logSavePath,
      workflowSavePath,
    ] = await Promise.all([
      invoke<boolean>('store:get', 'ui.sidebarCollapsed'),
      invoke<ModelProviderConfig>('store:get', 'modelProvider'),
      invoke<ModelConfig>('store:get', 'midsceneModel'),
      invoke<ModelProfile[]>('store:get', 'models'),
      invoke<DefaultModelSelection>('store:get', 'defaultModelIds'),
      invoke<string>('store:get', 'logSavePath'),
      invoke<string>('store:get', 'workflowSavePath'),
    ]);
    set({
      sidebarCollapsed,
      modelProvider,
      midsceneModel,
      models: models || [],
      defaultModelIds: defaultModelIds || getDefaultModelIds(),
      logSavePath: logSavePath || '',
      workflowSavePath: workflowSavePath || '',
      isLoading: false,
    });
  },

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    invoke('store:set', 'ui.sidebarCollapsed', next);
  },

  setModelProvider: async (config) => {
    await invoke('store:set', 'modelProvider', config);
    set({ modelProvider: config });
  },

  setMidsceneModel: async (config) => {
    await invoke('store:set', 'midsceneModel', config);
    set({ midsceneModel: config });
  },

  setModels: async (models) => {
    await invoke('store:set', 'models', models);
    set({ models });
  },

  setDefaultModelIds: async (ids) => {
    await invoke('store:set', 'defaultModelIds', ids);
    set({ defaultModelIds: ids });
  },

  setLogSavePath: async (path) => {
    await invoke('store:set', 'logSavePath', path);
    set({ logSavePath: path });
  },

  setWorkflowSavePath: async (path) => {
    await invoke('store:set', 'workflowSavePath', path);
    set({ workflowSavePath: path });
  },

  resetSettings: async () => {
    const keys = [
      'ui.sidebarCollapsed',
      'defaultModelIds',
      'logSavePath',
      'workflowSavePath',
    ];
    for (const key of keys) {
      await invoke('store:delete', key);
    }
    set({
      sidebarCollapsed: false,
      defaultModelIds: getDefaultModelIds(),
      logSavePath: '',
      workflowSavePath: '',
    });
  },

  clearAllData: async () => {
    await invoke('store:clear');
    set({
      sidebarCollapsed: false,
      modelProvider: null,
      midsceneModel: null,
      models: [],
      defaultModelIds: getDefaultModelIds(),
      logSavePath: '',
      workflowSavePath: '',
    });
  },
}));
