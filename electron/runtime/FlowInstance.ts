import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { FlowSchema, FlowNode, RuntimeEventPayload, MidsceneSegmentTask, MidsceneRawLog } from '../../types/flow.js';
import { getLogger } from '../logger.js';
import { buildContinuousSegment } from './SegmentBuilder.js';
import { resolveVariableInterpolate, evaluateExpression } from './VariableResolver.js';

export interface MidsceneAdapter {
  runTask(task: MidsceneSegmentTask, signal: AbortSignal): Promise<{
    success: boolean;
    error?: { code: string; message: string };
    extracted: Record<string, { nodeId: string; value: unknown }>;
    screenshots: string[];
    rawLogs: MidsceneRawLog[];
  }>;
  close?(): Promise<void>;
}

export class FlowInstance extends EventEmitter {
  public readonly runInstanceId: string;
  public readonly flowSchema: FlowSchema;
  public abortController: AbortController;
  public isRunning = false;

  private variablePool: Record<string, unknown> = {};
  private nodeMap = new Map<string, FlowNode>();
  private currentNodeId: string | null = null;
  private adapter: MidsceneAdapter;

  constructor(flowSchema: FlowSchema, adapter: MidsceneAdapter) {
    super();
    this.runInstanceId = uuidv4();
    this.flowSchema = flowSchema;
    this.abortController = new AbortController();
    this.adapter = adapter;

    for (const node of flowSchema.nodeList) {
      this.nodeMap.set(node.nodeId, node);
    }

    for (const v of flowSchema.globalVars) {
      this.variablePool[v.key] = v.value;
    }

    this.currentNodeId = this.findStartNodeId();
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    getLogger().info('Flow instance start', { runInstanceId: this.runInstanceId, flowId: this.flowSchema.flowId });

    try {
      await this.mainLoop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().error('Flow instance error', { runInstanceId: this.runInstanceId, error: message });
      this.emitFlowFinish(false, 'error');
    } finally {
      this.isRunning = false;
    }
  }

  public stop() {
    getLogger().info('Flow instance stop requested', { runInstanceId: this.runInstanceId });
    this.abortController.abort();
  }

  private findStartNodeId(): string | null {
    const allTargetIds = new Set<string>();
    for (const node of this.flowSchema.nodeList) {
      for (const route of node.nextNodes) {
        allTargetIds.add(route.nodeId);
      }
    }
    const startNodes = this.flowSchema.nodeList.filter((n) => !allTargetIds.has(n.nodeId));
    return startNodes[0]?.nodeId ?? this.flowSchema.nodeList[0]?.nodeId ?? null;
  }

  private async mainLoop() {
    const startTime = Date.now();
    const globalTimeout = this.flowSchema.flowMeta.globalTimeout || 300000;

    while (this.currentNodeId && !this.abortController.signal.aborted) {
      if (Date.now() - startTime > globalTimeout) {
        this.emitRuntimeEvent({
          type: 'node-fail',
          runInstanceId: this.runInstanceId,
          nodeId: this.currentNodeId,
          errorMessage: '流程全局超时',
          screenshots: [],
          logs: [{ type: 'error' as const, content: '流程全局超时' }],
        });
        this.emitFlowFinish(false, 'error');
        return;
      }

      const node = this.nodeMap.get(this.currentNodeId);
      if (!node) break;

      if (node.disabled) {
        const nextRoute = node.nextNodes.find((r) => !r.condition);
        this.currentNodeId = nextRoute?.nodeId ?? null;
        continue;
      }

      // 分支节点
      if (node.nodeType === 'if') {
        const expr = String(node.nodeParams.expr ?? '');
        const pass = evaluateExpression(expr, this.variablePool);
        const nextRoute = node.nextNodes.find((route) => {
          if (!route.condition) return pass;
          return evaluateExpression(route.condition, this.variablePool);
        });
        this.currentNodeId = nextRoute?.nodeId ?? null;
        continue;
      }

      // 循环节点
      if (node.nodeType === 'loop') {
        const expr = String(node.nodeParams.expr ?? '');
        const maxIter = Number(node.nodeParams.maxIteration ?? 10);
        const loopKey = `_loop_${node.nodeId}_iter`;
        const currentIter = (this.variablePool[loopKey] as number) ?? 0;

        if (currentIter >= maxIter) {
          this.variablePool[loopKey] = 0;
          // 走出循环：找 condition 为 false 或默认出口
          const exitRoute = node.nextNodes.find((r) => r.condition && !evaluateExpression(r.condition, this.variablePool))
            ?? node.nextNodes.find((r) => !r.condition);
          this.currentNodeId = exitRoute?.nodeId ?? null;
          continue;
        }

        const pass = evaluateExpression(expr, this.variablePool);
        if (!pass) {
          this.variablePool[loopKey] = 0;
          const exitRoute = node.nextNodes.find((r) => !r.condition);
          this.currentNodeId = exitRoute?.nodeId ?? null;
          continue;
        }

        // 进入循环体
        this.variablePool[loopKey] = currentIter + 1;
        const bodyRoute = node.nextNodes.find((r) => r.condition && evaluateExpression(r.condition, this.variablePool))
          ?? node.nextNodes.find((r) => !r.condition);
        this.currentNodeId = bodyRoute?.nodeId ?? null;
        continue;
      }

      // 线性操作节点：收集连续分片
      const segmentNodes = buildContinuousSegment(node, this.nodeMap);
      const resolvedActions = segmentNodes.map((n) => ({
        nodeId: n.nodeId,
        nodeType: n.nodeType,
        params: resolveVariableInterpolate(n.nodeParams, this.variablePool),
      }));

      const task: MidsceneSegmentTask = {
        modelConfig: {
          modelName: this.flowSchema.aiGlobalConfig.modelName,
          apiKey: this.flowSchema.aiGlobalConfig.apiKey,
          baseUrl: this.flowSchema.aiGlobalConfig.baseUrl,
          defaultDeepThink: this.flowSchema.aiGlobalConfig.defaultDeepThink,
          cacheable: this.flowSchema.aiGlobalConfig.cacheable,
          timeout: node.timeout || this.flowSchema.aiGlobalConfig.timeout,
        },
        actionContext: this.flowSchema.aiGlobalConfig.actionContext,
        deviceConfig: this.flowSchema.deviceConfig,
        actions: resolvedActions,
        variables: { ...this.variablePool },
      };

      this.emitRuntimeEvent({
        type: 'node-start',
        runInstanceId: this.runInstanceId,
        nodeId: node.nodeId,
      });

      let result: Awaited<ReturnType<MidsceneAdapter['runTask']>>;
      let retryCount = 0;
      const maxRetry = Math.max(0, node.retryCount ?? this.flowSchema.flowMeta.globalRetry ?? 0);

      while (true) {
        result = await this.adapter.runTask(task, this.abortController.signal);
        if (result.success || retryCount >= maxRetry || this.abortController.signal.aborted) break;
        retryCount++;
        getLogger().warn('Node execution retry', { runInstanceId: this.runInstanceId, nodeId: node.nodeId, retryCount });
        await new Promise((r) => setTimeout(r, 1000));
      }

      // 回填变量池（aiQuery）
      for (const [varKey, item] of Object.entries(result!.extracted)) {
        this.variablePool[varKey] = item.value;
      }

      if (result!.success) {
        this.emitRuntimeEvent({
          type: 'node-success',
          runInstanceId: this.runInstanceId,
          nodeId: node.nodeId,
          screenshots: result!.screenshots,
          logs: result!.rawLogs,
          extractedData: result!.extracted,
        });
        const nextRoute = node.nextNodes.find((r) => !r.condition);
        this.currentNodeId = nextRoute?.nodeId ?? null;
      } else {
        const strategy = node.failStrategy ?? this.flowSchema.flowMeta.failStrategy;
        this.emitRuntimeEvent({
          type: 'node-fail',
          runInstanceId: this.runInstanceId,
          nodeId: node.nodeId,
          errorMessage: result!.error?.message ?? '未知错误',
          screenshots: result!.screenshots,
          logs: result!.rawLogs,
        });
        if (strategy === 'terminate') {
          this.emitFlowFinish(false, 'error');
          break;
        } else {
          const nextRoute = node.nextNodes.find((r) => !r.condition);
          this.currentNodeId = nextRoute?.nodeId ?? null;
        }
      }
    }

    if (this.abortController.signal.aborted) {
      this.emitFlowFinish(false, 'stopped');
    } else {
      this.emitFlowFinish(true, 'complete');
    }
  }

  private emitRuntimeEvent(payload: RuntimeEventPayload) {
    this.emit('runtime-event', payload);
  }

  private emitFlowFinish(success: boolean, reason: 'complete' | 'stopped' | 'error') {
    this.emit('runtime-event', {
      type: 'flow-finish',
      runInstanceId: this.runInstanceId,
      success,
      reason,
    });
  }
}
