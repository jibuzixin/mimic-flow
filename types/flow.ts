// Midscene 可视化编排桌面端 - 共享 Flow 类型定义
// UI 层与调度层共用此文件，避免类型漂移

export const IPC_CHANNEL = {
  FLOW_VALIDATE: 'flow:validate',
  FLOW_RUN: 'flow:run',
  FLOW_STOP: 'flow:stop',
  VIDEO_PARSE_FLOW: 'video:parse-flow',
  FILE_SAVE_FLOW: 'file:save-flow',
  FILE_OPEN_FLOW: 'file:open-flow',
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  RUNTIME_EVENT: 'runtime:event',
} as const;

export type FlowNodeType =
  | 'navigate'
  | 'aiTap'
  | 'aiInput'
  | 'aiQuery'
  | 'aiAssert'
  | 'sleep'
  | 'if'
  | 'loop';

export interface ModelConfig {
  modelName: string;
  apiKey: string;
  baseUrl: string;
  defaultDeepThink: boolean;
  cacheable: boolean;
  timeout: number;
  extraModelParams?: Record<string, unknown>;
}

export interface GlobalAppConfig {
  /** Midscene 运行时视觉模型默认配置 */
  defaultMidsceneModel: ModelConfig;
  /** 视频解析专用多模态模型配置 */
  videoParseModel: ModelConfig;
  /** 全局运行参数 */
  globalRuntimeOption: {
    defaultTimeout: number;
    defaultRetry: number;
  };
}

export interface FlowMeta {
  name: string;
  desc: string;
  tags: string[];
  triggerType: 'manual';
  cronExpr?: string;
  globalTimeout: number;
  globalRetry: number;
  failStrategy: 'terminate' | 'skip';
  version: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DeviceConfig {
  type: 'web' | 'android' | 'ios';
  url?: string;
  viewport: { width: number; height: number };
  userAgent?: string;
  cookiePath?: string;
  deviceConnectOpts?: Record<string, unknown>;
}

export interface AiGlobalConfig {
  /** 关联的模型配置 ID */
  modelId?: string;
  modelName: string;
  apiKey: string;
  baseUrl: string;
  actionContext: string;
  defaultDeepThink: boolean;
  cacheable: boolean;
  timeout: number;
  extraModelParams?: Record<string, unknown>;
}

export interface GlobalVarItem {
  key: string;
  value: string | number | boolean;
  encrypt: boolean;
  comment?: string;
}

export interface NextNodeRoute {
  nodeId: string;
  condition?: string;
}

export interface FlowNode {
  nodeId: string;
  nodeType: FlowNodeType;
  nodeName: string;
  timeout: number;
  retryCount: number;
  failStrategy?: 'terminate' | 'skip';
  outputVar?: string;
  nodeParams: Record<string, unknown>;
  nextNodes: NextNodeRoute[];
  comment?: string;
  catchNodeId?: string;
  disabled?: boolean;
}

export interface FlowSchema {
  flowId: string;
  flowMeta: FlowMeta;
  deviceConfig: DeviceConfig;
  aiGlobalConfig: AiGlobalConfig;
  globalVars: GlobalVarItem[];
  nodeList: FlowNode[];
}

export interface FlowFileWrapper {
  schemaFormat: 'midscene-desktop-flow';
  schemaVersion: '1.0.0';
  payload: FlowSchema;
}

export interface MidsceneSegmentTask {
  modelConfig: ModelConfig;
  actionContext: string;
  deviceConfig: DeviceConfig;
  actions: Array<{
    nodeId: string;
    nodeType: FlowNodeType;
    params: Record<string, unknown>;
  }>;
  variables: Record<string, unknown>;
}

export interface MidsceneRawLog {
  type: 'plan' | 'action' | 'assert' | 'error' | 'info';
  content: string;
}

export interface MidsceneSegmentResult {
  success: boolean;
  error?: { code: string; message: string };
  extracted: Record<string, { nodeId: string; value: unknown }>;
  screenshots: string[];
  rawLogs: MidsceneRawLog[];
}

export type RuntimeEventPayload =
  | {
      type: 'node-start';
      runInstanceId: string;
      nodeId: string;
    }
  | {
      type: 'node-success';
      runInstanceId: string;
      nodeId: string;
      screenshots: string[];
      logs: MidsceneRawLog[];
      extractedData?: Record<string, unknown>;
    }
  | {
      type: 'node-fail';
      runInstanceId: string;
      nodeId: string;
      errorMessage: string;
      screenshots: string[];
      logs: MidsceneRawLog[];
    }
  | {
      type: 'flow-finish';
      runInstanceId: string;
      success: boolean;
      reason: 'complete' | 'stopped' | 'error';
      reportFilePath?: string;
    };

export interface IpcEnvelope<T> {
  channel: string;
  requestId?: string;
  payload: T;
  timestamp: number;
}

export interface IpcResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// nodeParams 具体结构（用于前端表单与调度器校验）
export interface NavigateParams {
  url: string;
}

export interface AiTapParams {
  locate: string;
  referenceImage?: string;
}

export interface AiInputParams {
  locate: string;
  text: string;
}

export interface AiQueryParams {
  dataDemand: string;
  schemaDesc?: string;
}

export interface AiAssertParams {
  assertion: string;
}

export interface SleepParams {
  duration: number;
}

export interface IfParams {
  expr: string;
}

export interface LoopParams {
  expr: string;
  maxIteration: number;
}
