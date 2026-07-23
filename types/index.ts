export interface ModelPricing {
  /** 输入 Token 单价：每 1000 tokens 价格（元） */
  inputPricePer1K: number;
  /** 输出 Token 单价：每 1000 tokens 价格（元） */
  outputPricePer1K: number;
  /** 货币代码，默认 CNY */
  currency: 'CNY' | 'USD';
}

export interface SubModelConfig {
  /** 模型 ID，如 doubao-vision-4k */
  model: string;
  /** 是否启用该子模型 */
  enabled: boolean;
  /** 该模型价格 */
  pricing: ModelPricing;
  /** 多模态模型单次请求最多可携带的图片数量（仅对多模态模型生效） */
  maxImagesPerRequest?: number;
}

export interface ModelProviderConfig {
  /** Provider 标识，如 doubao */
  name: string;
  /** 显示名称 */
  label: string;
  apiKey: string;
  baseUrl: string;
  /** 多模态大模型（必选）：视频解析、参考图定位等 */
  multimodalModel: SubModelConfig;
  /** 大语言模型（可选）：汇总清洗、对话、文本推理 */
  textModel?: SubModelConfig;
  /** ASR 模型（可选）：音频转录 */
  asrModel?: SubModelConfig;
}

/** 模型能力类型 */
export type ModelCapability = 'multimodal' | 'text' | 'asr' | 'midscene';

/** 统一的模型配置项，支持配置多个模型并在使用时选择 */
export interface ModelProfile {
  id: string;
  /** 用户自定义显示名称 */
  name: string;
  /** Provider 标识，如 doubao、openai */
  provider: string;
  /** 模型能力 */
  capability: ModelCapability;
  /** 请求 Base URL */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 模型 ID，如 doubao-vision-4k */
  modelId: string;
  /** 是否启用 */
  enabled: boolean;
  /** 价格配置 */
  pricing: ModelPricing;
  /** 请求超时（毫秒） */
  timeout?: number;
  /** 多模态专用：单次请求最大图片数 */
  maxImagesPerRequest?: number;
  /** Midscene 专用：是否默认启用 Deep Think */
  defaultDeepThink?: boolean;
  /** Midscene 专用：是否启用缓存 */
  cacheable?: boolean;
  /** 额外模型参数 */
  extraModelParams?: Record<string, unknown>;
}

/** 各场景默认选用的模型 ID */
export interface DefaultModelSelection {
  multimodal?: string;
  text?: string;
  asr?: string;
  midscene?: string;
}

export type OperationType =
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'drag'
  | 'scroll'
  | 'type'
  | 'hotkey'
  | 'wait'
  | 'matchImage';

export interface WorkflowStep {
  id: string;
  index: number;
  operation: string;
  target?: string;
  orientation?: string;
  condition?: string;
  think?: string;
  type: OperationType;
  params?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  source: 'video' | 'record' | 'chat';
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

export interface VideoParseOptions {
  mode: 'simple' | 'smart' | 'native';
  fps?: number;
  maxFrames?: number;
  sceneThreshold?: number;
  compress?: boolean;
  hasAudio?: boolean;
  /** 多模态模型单次请求最大图片数，默认从模型配置读取 */
  maxImagesPerRequest?: number;
  /** 多批次并发数，默认从应用配置读取 */
  concurrency?: number;
  /** 是否强制启用 LLM 汇总（默认按配置自动判断） */
  forceSummarize?: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelUsageRecord {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  feature: 'chat' | 'video-parse' | 'video-summary' | 'workflow-execute' | 'asr';
  usage: TokenUsage;
  cost: number;
  currency: 'CNY' | 'USD';
  /** 原始请求是否成功拿到 usage */
  hasUsage: boolean;
}

export interface UsageStatistics {
  /** 总请求次数（含未拿到 usage 的请求） */
  totalRequests: number;
  /** 成功拿到 usage 的请求次数 */
  usageKnownRequests: number;
  /** 总输入 tokens */
  totalPromptTokens: number;
  /** 总输出 tokens */
  totalCompletionTokens: number;
  /** 总 tokens */
  totalTokens: number;
  /** 估算总花费 */
  totalCost: number;
  /** 主货币 */
  primaryCurrency: 'CNY' | 'USD';
  /** 最近 20 条记录 */
  recentRecords: ModelUsageRecord[];
}

import type { ModelConfig } from './flow.js';

export interface AppConfig {
  /** 视频解析模型配置（多模态 + 可选 LLM/ASR） */
  modelProvider: ModelProviderConfig;
  /** Midscene 运行时视觉模型配置 */
  midsceneModel: ModelConfig;
  videoSavePath: string;
  /** 视频解析时多模态批次并发数 */
  videoParseConcurrency: number;
  shortcutKeys: {
    recordToggle: string;
    recordPause: string;
    voicePushToTalk: string;
    stopRecord: string;
  };
  ui: {
    sidebarCollapsed: boolean;
  };
}
