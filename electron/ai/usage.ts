import { randomUUID } from 'crypto';
import { getStore } from '../store.js';
import type { TokenUsage, ModelUsageRecord, UsageStatistics, UsageTracker } from './types.js';

function calculateCost(
  usage: TokenUsage,
  pricing: { inputPricePer1K: number; outputPricePer1K: number; currency: 'CNY' | 'USD' }
): number {
  const inputCost = (usage.promptTokens / 1000) * pricing.inputPricePer1K;
  const outputCost = (usage.completionTokens / 1000) * pricing.outputPricePer1K;
  return Number((inputCost + outputCost).toFixed(6));
}

export function createUsageTracker(): UsageTracker {
  return {
    record(provider, model, feature, usage, pricing) {
      const record: ModelUsageRecord = {
        id: randomUUID(),
        timestamp: Date.now(),
        provider,
        model,
        feature,
        usage,
        cost: calculateCost(usage, pricing),
        currency: pricing.currency,
        hasUsage: usage.totalTokens > 0,
      };

      const store = getStore();
      const stats = store.get('usageStatistics');
      const recent = [record, ...stats.recentRecords].slice(0, 20);

      store.set('usageStatistics', {
        totalRequests: stats.totalRequests + 1,
        usageKnownRequests: stats.usageKnownRequests + (record.hasUsage ? 1 : 0),
        totalPromptTokens: stats.totalPromptTokens + usage.promptTokens,
        totalCompletionTokens: stats.totalCompletionTokens + usage.completionTokens,
        totalTokens: stats.totalTokens + usage.totalTokens,
        totalCost: Number((stats.totalCost + record.cost).toFixed(6)),
        primaryCurrency: pricing.currency,
        recentRecords: recent,
      });

      return record;
    },

    getStatistics() {
      return getStore().get('usageStatistics');
    },

    reset() {
      getStore().set('usageStatistics', {
        totalRequests: 0,
        usageKnownRequests: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        primaryCurrency: 'CNY',
        recentRecords: [],
      });
    },
  };
}
