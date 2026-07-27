// FlowSchema v2 - 桌面自动化工作流编排标准数据格式
// UI 层 / 调度层 / 引擎层之间的契约

export type FlowNodeType =
  // --- Midscene 引擎节点 ---
  | 'midscene.act'
  | 'midscene.tap'
  | 'midscene.doubleClick'
  | 'midscene.rightClick'
  | 'midscene.hover'
  | 'midscene.input'
  | 'midscene.clearInput'
  | 'midscene.keyboardPress'
  | 'midscene.scroll'
  | 'midscene.query'
  | 'midscene.assert'
  | 'midscene.boolean'
  | 'midscene.waitFor'
  | 'midscene.sleep'
  // --- System 系统操作引擎节点 ---
  | 'system.click'
  | 'system.doubleClick'
  | 'system.rightClick'
  | 'system.hover'
  | 'system.input'
  | 'system.keyboard'
  | 'system.scroll'
  | 'system.waitForImage'
  | 'system.sleep'
  // --- 控制流节点（调度层原生处理）---
  | 'control.start'
  | 'control.end'
  | 'control.if'
  | 'control.loop'
  | 'control.var'
  | 'control.log'
  // --- Nut.js 引擎节点 ---
  | 'nutjs.hotkey'
  | 'nutjs.clipboard';

export interface FlowNodeNext {
  nodeId: string;
  condition?: string;
}

export interface FlowNodeRuntime {
  timeout?: number;
  retry?: number;
  onError?: 'stop' | 'continue';
}

export interface FlowNode {
  id: string;
  nodeType: FlowNodeType;
  nodeName?: string;
  nodeParams: Record<string, unknown>;
  nextNodes: FlowNodeNext[];
  runtime?: FlowNodeRuntime;
  engine?: string;
}

export interface FlowTarget {
  type: 'computer';
  displayId?: string;
}

export interface FlowRuntimeConfig {
  defaultTimeout: number;
  defaultRetry: number;
  onError: 'stop' | 'continue';
}

export interface FlowModelConfig {
  midscene?: {
    /** 引用 Settings store 中的模型 ID */
    defaultModelId?: string;
    insightModelId?: string;
    planningModelId?: string;
    /** 内联模型配置（优先级高于 defaultModelId，用于测试） */
    inline?: ModelInlineConfig;
  };
}

/** 内联模型配置，直接在 FlowJson 中配置模型参数 */
export interface ModelInlineConfig {
  /** 模型 ID，如 doubao-vision-4k */
  modelId: string;
  /** API Key */
  apiKey: string;
  /** Base URL，如 https://ark.cn-beijing.volces.com/api/v3 */
  baseUrl: string;
  /** 模型家族，如 doubao-seed、openai 等 */
  modelFamily?: string;
  /** Insight 意图模型（可选） */
  insightModelId?: string;
  /** Planning 意图模型（可选） */
  planningModelId?: string;
  /** 超时（毫秒），默认 180000 */
  timeout?: number;
  /** 重试次数，默认 1 */
  retryCount?: number;
  /** 原生思考，默认 false */
  reasoningEnabled?: boolean;
  /** 响应语言，默认 zh */
  preferredLanguage?: string;
}

export interface FlowMeta {
  name: string;
  desc?: string;
  source?: 'manual' | 'video' | 'nl' | 'file';
  createdAt?: number;
  updatedAt?: number;
}

export interface FlowSchema {
  version: '2.0';
  flowMeta: FlowMeta;
  globalVars: Record<string, unknown>;
  runtime: FlowRuntimeConfig;
  modelConfig: FlowModelConfig;
  target: FlowTarget;
  nodes: FlowNode[];
}

// --- 引擎相关类型 ---

export type EngineEvent =
  | { type: 'node:start'; nodeId: string }
  | { type: 'node:complete'; nodeId: string; output?: unknown }
  | { type: 'node:error'; nodeId: string; error: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error' | 'debug'; message: string; data?: unknown }
  | { type: 'screenshot'; nodeId?: string; dataUrl: string };

export interface SegmentResult {
  success: boolean;
  outputs: Record<string, unknown>;
  error?: string;
  aborted?: boolean;
}

export interface EngineInitConfig {
  displayId?: string;
  models?: {
    default: ModelProfileLite;
    insight?: ModelProfileLite;
    planning?: ModelProfileLite;
  };
  actionContext?: string;
  reportDir?: string;
}

export interface ModelProfileLite {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelFamily: string;
  advanced?: {
    timeout?: number;
    retryCount?: number;
    reasoningEnabled?: boolean;
    preferredLanguage?: string;
    cacheable?: boolean;
    extraBodyJson?: Record<string, unknown>;
  };
}

export interface FlowEngine {
  name: string;
  displayName: string;
  supportedNodeTypes: string[];

  initialize?(config: EngineInitConfig): Promise<void>;

  executeSegment(
    segment: FlowNode[],
    variablePool: Record<string, unknown>,
    signal: AbortSignal,
    onEvent: (event: EngineEvent) => void,
  ): Promise<SegmentResult>;

  getReportPath?(): string | null;

  dispose?(): Promise<void>;
}

// --- 调度层类型 ---

export type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'stopped';

export interface NodeState {
  nodeId: string;
  status: NodeStatus;
  startTime?: number;
  endTime?: number;
  output?: unknown;
  error?: string;
  retryCount: number;
}

export type FlowStatus = 'idle' | 'running' | 'paused' | 'success' | 'failed' | 'stopped';

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  nodeId?: string;
  message: string;
  data?: unknown;
}

export type RuntimeEvent =
  | { type: 'flow:start'; flowId: string }
  | { type: 'flow:complete'; status: 'success' | 'failed' | 'stopped'; duration: number; reportPath?: string }
  | { type: 'node:start'; nodeId: string; nodeType: string; nodeName?: string }
  | { type: 'node:complete'; nodeId: string; duration: number; output?: unknown; resolvedParams?: Record<string, unknown> }
  | { type: 'node:error'; nodeId: string; error: string; willRetry: boolean }
  | { type: 'log'; entry: LogEntry }
  | { type: 'screenshot'; nodeId?: string; dataUrl: string }
  | { type: 'nodes:reset' };
