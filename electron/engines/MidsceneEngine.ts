import type {
  FlowEngine,
  EngineEvent,
  SegmentResult,
  FlowNode,
  EngineInitConfig,
} from '../../types/flow-v2.js';
import { generateMidsceneYaml } from './yamlGenerator.js';
import { getLogger } from '../logger.js';

export class MidsceneEngine implements FlowEngine {
  name = 'midscene';
  displayName = 'Midscene 桌面引擎';
  supportedNodeTypes = ['midscene.*'];

  private agent: any = null;
  private reportMerger: any = null;
  private segmentCount = 0;
  private initConfig: EngineInitConfig | null = null;
  private log = getLogger();

  async initialize(config: EngineInitConfig): Promise<void> {
    this.initConfig = config;
    this.segmentCount = 0;

    try {
      const { ReportMergingTool } = await import('@midscene/core/report');
      this.reportMerger = new ReportMergingTool();
    } catch (e) {
      this.log.warn('[MidsceneEngine] ReportMergingTool not available, report merging disabled');
    }

    const defaultModel = config.models.default;

    process.env.MIDSCENE_MODEL_NAME = defaultModel.modelId;
    process.env.MIDSCENE_MODEL_BASE_URL = defaultModel.baseUrl;
    process.env.MIDSCENE_MODEL_API_KEY = defaultModel.apiKey;
    process.env.MIDSCENE_MODEL_FAMILY = defaultModel.modelFamily;

    if (config.models.insight) {
      process.env.MIDSCENE_INSIGHT_MODEL_NAME = config.models.insight.modelId;
    }
    if (config.models.planning) {
      process.env.MIDSCENE_PLANNING_MODEL_NAME = config.models.planning.modelId;
    }

    if (defaultModel.advanced?.timeout !== undefined) {
      process.env.MIDSCENE_MODEL_TIMEOUT = String(defaultModel.advanced.timeout);
    }
    if (defaultModel.advanced?.retryCount !== undefined) {
      process.env.MIDSCENE_MODEL_RETRY_COUNT = String(defaultModel.advanced.retryCount);
    }
    if (defaultModel.advanced?.reasoningEnabled !== undefined) {
      process.env.MIDSCENE_MODEL_REASONING_ENABLED = String(defaultModel.advanced.reasoningEnabled);
    }
    if (defaultModel.advanced?.preferredLanguage) {
      process.env.MIDSCENE_PREFERRED_LANGUAGE = defaultModel.advanced.preferredLanguage;
    }

    this.log.info('[MidsceneEngine] Initializing agent', {
      model: defaultModel.modelId,
      family: defaultModel.modelFamily,
      displayId: config.displayId,
    });

    try {
      this.log.info('[MidsceneEngine] Importing @midscene/computer...');
      const { agentForComputer } = await import('@midscene/computer');
      this.log.info('[MidsceneEngine] Creating agent...');

      // 加 30 秒超时保护，防止 agentForComputer 卡死
      const initPromise = agentForComputer({
        displayId: config.displayId,
        generateReport: true,
        aiActionContext: config.actionContext || '',
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Midscene agent 初始化超时（30秒），可能是屏幕截图权限被拒绝')), 30000);
      });

      this.agent = await Promise.race([initPromise, timeoutPromise]);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.log.error('[MidsceneEngine] Failed to initialize agent: ' + errMsg);
      throw new Error(`Midscene agent 初始化失败: ${errMsg}`);
    }

    this.log.info('[MidsceneEngine] Agent initialized');
  }

  async executeSegment(
    segment: FlowNode[],
    variablePool: Record<string, unknown>,
    signal: AbortSignal,
    onEvent: (event: EngineEvent) => void,
  ): Promise<SegmentResult> {
    if (!this.agent) {
      return { success: false, outputs: {}, error: 'Midscene agent not initialized' };
    }

    const yaml = generateMidsceneYaml(segment, variablePool, {
      displayId: this.initConfig?.displayId,
    });

    this.log.info('[MidsceneEngine] Executing segment', {
      nodeCount: segment.length,
      nodeIds: segment.map((n) => n.id),
    });

    this.log.debug('[MidsceneEngine] YAML:\n' + yaml);

    const startTime = Date.now();

    const abortHandler = () => {
      this.log.warn('[MidsceneEngine] Abort signal received, destroying agent...');
      if (this.agent?.destroy) {
        this.agent.destroy().catch((e: Error) => {
          this.log.warn('[MidsceneEngine] Error during abort destroy:', { error: e.message });
        });
      }
    };
    signal.addEventListener('abort', abortHandler);

    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });

    try {
      const runPromise = this.agent.runYaml(yaml);
      const { result } = await Promise.race([runPromise, abortPromise]);
      signal.removeEventListener('abort', abortHandler);

      const duration = Date.now() - startTime;
      this.log.info('[MidsceneEngine] Segment completed', { duration, nodeCount: segment.length });

      if (this.reportMerger && this.agent.reportFile) {
        try {
          this.reportMerger.append({
            reportFilePath: this.agent.reportFile,
            reportAttributes: {
              testId: `segment-${this.segmentCount}`,
              testTitle: segment.map((n) => n.nodeName || n.id).join(' → '),
              testDescription: `${segment.length} 个节点`,
              testDuration: duration,
              testStatus: 'passed',
            },
          });
          this.segmentCount++;
        } catch (e) {
          this.log.warn('[MidsceneEngine] Failed to append report', { error: String(e) });
        }
      }

      const outputs: Record<string, unknown> = {};
      for (const node of segment) {
        const nodeOutput = result?.[node.id];
        outputs[node.id] = nodeOutput;
        onEvent({ type: 'node:complete', nodeId: node.id, output: nodeOutput });
      }

      return { success: true, outputs };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      signal.removeEventListener('abort', abortHandler);

      if (signal.aborted || errorMsg === 'aborted') {
        this.log.info('[MidsceneEngine] Segment aborted by user', { duration });
        return { success: false, outputs: {}, error: '用户取消', aborted: true };
      }

      this.log.error('[MidsceneEngine] Segment failed', { error: errorMsg, duration });

      if (this.reportMerger && this.agent?.reportFile) {
        try {
          this.reportMerger.append({
            reportFilePath: this.agent.reportFile,
            reportAttributes: {
              testId: `segment-${this.segmentCount}`,
              testTitle: segment.map((n) => n.nodeName || n.id).join(' → '),
              testStatus: 'failed',
              testDuration: duration,
            },
          });
          this.segmentCount++;
        } catch (e) {
          this.log.warn('[MidsceneEngine] Failed to append report', { error: String(e) });
        }
      }

      return { success: false, outputs: {}, error: errorMsg };
    }
  }

  getReportPath(): string | null {
    if (!this.reportMerger) return null;
    try {
      return this.reportMerger.mergeReports('workflow-report', {
        rmOriginalReports: true,
        overwrite: true,
      });
    } catch (e) {
      this.log.warn('[MidsceneEngine] Failed to merge reports', { error: String(e) });
      return null;
    }
  }

  async dispose(): Promise<void> {
    this.agent = null;
    this.reportMerger = null;
    this.initConfig = null;
    this.log.info('[MidsceneEngine] Disposed');
  }
}
