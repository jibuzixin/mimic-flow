import { create } from 'zustand';
import type { UsageStatistics } from '../../types';
import { invoke } from '../lib/api';

interface UsageState {
  stats: UsageStatistics | null;
  isLoading: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => Promise<void>;
}

export const useUsageStore = create<UsageState>((set) => ({
  stats: null,
  isLoading: false,

  load: async () => {
    set({ isLoading: true });
    const stats = await invoke<UsageStatistics>('usage:get');
    set({ stats, isLoading: false });
  },

  refresh: async () => {
    const stats = await invoke<UsageStatistics>('usage:get');
    set({ stats });
  },

  reset: async () => {
    await invoke('usage:reset');
    const stats = await invoke<UsageStatistics>('usage:get');
    set({ stats });
  },
}));
