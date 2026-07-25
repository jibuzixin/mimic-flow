export type ExecutionStatus = 'success' | 'failed' | 'stopped' | 'running';

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  startTime: number;
  endTime: number;
  duration: number;
  directory: string;
  nodeTotal: number;
  nodeSuccess: number;
  nodeFailed: number;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
  cost: number;
  hasMidsceneReport: boolean;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: 'scheduler' | 'engine' | 'node' | 'variable';
  message: string;
  nodeId?: string;
  nodeName?: string;
  data?: Record<string, unknown>;
}

export interface ExecutionDetail extends ExecutionRecord {
  logs: LogEntry[];
  midsceneReportPath?: string;
  midsceneReportUrl?: string;
}

export interface ExecutionListQuery {
  workflowId?: string;
  status?: ExecutionStatus;
  startDate?: number;
  endDate?: number;
  page?: number;
  pageSize?: number;
}

export interface ExecutionListResult {
  items: ExecutionRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardStats {
  totalExecutions: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalTokenInput: number;
  totalTokenOutput: number;
  totalToken: number;
  totalCost: number;
  workflowCount: number;
  recentExecutions: ExecutionRecord[];
  executionTrend: Array<{ date: string; total: number; success: number; failed: number }>;
}
