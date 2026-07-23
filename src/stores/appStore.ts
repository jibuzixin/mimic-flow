import { create } from 'zustand';
import type { ModelProviderConfig, ModelProfile, DefaultModelSelection } from '../../types';
import type { ModelConfig } from '../../types/flow';
import { invoke } from '../lib/api';

interface AppState {
  platform: string;
  sidebarCollapsed: boolean;
  modelProvider: ModelProviderConfig | null;
  midsceneModel: ModelConfig | null;
  models: ModelProfile[];
  defaultModelIds: DefaultModelSelection;
  videoSavePath: string;
  videoParseConcurrency: number;
  isLoading: boolean;

  init: () => Promise<void>;
  toggleSidebar: () => void;
  setModelProvider: (config: ModelProviderConfig) => Promise<void>;
  setMidsceneModel: (config: ModelConfig) => Promise<void>;
  setModels: (models: ModelProfile[]) => Promise<void>;
  setDefaultModelIds: (ids: DefaultModelSelection) => Promise<void>;
  setVideoSavePath: (path: string) => Promise<void>;
  setVideoParseConcurrency: (count: number) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  platform: window.mimic?.platform || 'unknown',
  sidebarCollapsed: false,
  modelProvider: null,
  midsceneModel: null,
  models: [],
  defaultModelIds: {},
  videoSavePath: '',
  videoParseConcurrency: 3,
  isLoading: true,

  init: async () => {
    const [
      sidebarCollapsed,
      modelProvider,
      midsceneModel,
      models,
      defaultModelIds,
      videoSavePath,
      videoParseConcurrency,
    ] = await Promise.all([
      invoke<boolean>('store:get', 'ui.sidebarCollapsed'),
      invoke<ModelProviderConfig>('store:get', 'modelProvider'),
      invoke<ModelConfig>('store:get', 'midsceneModel'),
      invoke<ModelProfile[]>('store:get', 'models'),
      invoke<DefaultModelSelection>('store:get', 'defaultModelIds'),
      invoke<string>('store:get', 'videoSavePath'),
      invoke<number>('store:get', 'videoParseConcurrency'),
    ]);
    set({
      sidebarCollapsed,
      modelProvider,
      midsceneModel,
      models: models || [],
      defaultModelIds: defaultModelIds || {},
      videoSavePath,
      videoParseConcurrency,
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

  setVideoSavePath: async (path) => {
    await invoke('store:set', 'videoSavePath', path);
    set({ videoSavePath: path });
  },

  setVideoParseConcurrency: async (count) => {
    const valid = Math.max(1, Math.min(10, count));
    await invoke('store:set', 'videoParseConcurrency', valid);
    set({ videoParseConcurrency: valid });
  },
}));
