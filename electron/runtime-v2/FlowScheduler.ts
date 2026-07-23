import { EventEmitter } from 'events';
import type {
  FlowSchema,
  FlowNode,
  FlowNodeType,
  NodeState,
  FlowStatus,
  LogEntry,
  RuntimeEvent,
  EngineEvent,
  EngineInitConfig,
  ModelProfileLite,
  ModelInlineConfig,
} from '../../types/flow-v2.js';
import { EngineRegistry } from '../engines/EngineRegistry.js';
import { MidsceneEngine } from '../engines/MidsceneEngine.js';
import { getLogger } from '../logger.js';
import { getStore } from '../store.js';
import type { ModelProfile } from '../../types/index.js';

const CONTROL_NODE_TYPES: FlowNodeType[] = ['control.if', 'control.loop', 'control.var', 'control.log', 'control.start', 'control.end'];

function isControlNode(nodeType: FlowNodeType): boolean {
  return CONTROL_NODE_TYPES.includes(nodeType);
}

function getPathValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let val: unknown = obj;
  for (const k of keys) {
    if (val && typeof val === 'object') {
      val = (val as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return val;
}

function interpolateValue(val: unknown, pool: Record<string, unknown>): unknown {
  if (typeof val === 'string') {
    return val.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
      const value = getPathValue(pool, path);
      return String(value ?? '');
    });
  }
  if (Array.isArray(val)) {
    return val.map((item) => interpolateValue(item, pool));
  }
  if (val && typeof val === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      result[k] = interpolateValue(v, pool);
    }
    return result;
  }
  return val;
}

function evaluateCondition(expr: string, pool: Record<string, unknown>): boolean {
  try {
    const interpolated = String(interpolateValue(expr, pool));
    const fn = new Function('return ' + interpolated);
    return Boolean(fn());
  } catch (e) {
    console.warn('Condition evaluation failed:', expr, e);
    return false;
  }
}

export class FlowScheduler extends EventEmitter {
  private flow: FlowSchema;
  private nodeMap: Map<string, FlowNode> = new Map();
  private nodeStates: Map<string, NodeState> = new Map();
  private variablePool: Record<string, unknown> = {};
  private status: FlowStatus = 'idle';
  private abortController: AbortController | null = null;
  private startTime = 0;
  private logEntries: LogEntry[] = [];
  private engineRegistry: EngineRegistry;
  private log = getLogger();
  private flowId: string;

  constructor(flow: FlowSchema) {
    super();
    this.flow = flow;
    this.flowId = `flow-${Date.now()}`;

    for (const node of flow.nodes) {
      this.nodeMap.set(node.id, node);
      this.nodeStates.set(node.id, {
        nodeId: node.id,
        status: 'pending',
        retryCount: 0,
      });
    }

    this.variablePool = {
      globalVars: { ...flow.globalVars },
      outputs: {},
      system: {
        flowName: flow.flowMeta.name,
        platform: process.platform,
      },
    };

    this.engineRegistry = new EngineRegistry();
    this.engineRegistry.register(new MidsceneEngine());
  }

  getStatus(): FlowStatus {
    return this.status;
  }

  getNodeStates(): Map<string, NodeState> {
    return this.nodeStates;
  }

  getLogs(): LogEntry[] {
    return this.logEntries;
  }

  getVariablePool(): Record<string, unknown> {
    return this.variablePool;
  }

  private addLog(entry: Omit<LogEntry, 'timestamp'>): void {
    const fullEntry: LogEntry = {
      timestamp: Date.now(),
      ...entry,
    };
    this.logEntries.push(fullEntry);
    this.emit('event', { type: 'log', entry: fullEntry } as RuntimeEvent);

    if (entry.level === 'error') {
      this.log.error('[FlowScheduler] ' + entry.message, entry.data as Record<string, unknown> | undefined);
    } else if (entry.level === 'warn') {
      this.log.warn('[FlowScheduler] ' + entry.message, entry.data as Record<string, unknown> | undefined);
    } else {
      this.log.info('[FlowScheduler] ' + entry.message, entry.data as Record<string, unknown> | undefined);
    }
  }

  private async ensureEngineInitialized(engineName: string): Promise<void> {
    if (this.engineRegistry.isInitialized(engineName)) {
      return;
    }

    this.addLog({
      level: 'info',
      source: 'scheduler',
      message: `初始化引擎: ${engineName}`,
    });

    if (engineName === 'midscene') {
      await this.initMidsceneEngine();
    }
  }

  private async initMidsceneEngine(): Promise<void> {
    const midsceneModelConfig = this.flow.modelConfig.midscene;

    if (midsceneModelConfig?.inline) {
      const inline = midsceneModelConfig.inline;

      if (!inline.apiKey) {
        throw new Error('Midscene 模型配置缺少 apiKey');
      }

      const toLite = (m: any): any => ({
        id: 'inline-default',
        name: m.modelId,
        provider: 'inline',
        baseUrl: m.baseUrl,
        apiKey: m.apiKey,
        modelId: m.modelId,
        modelFamily: m.modelFamily || 'doubao-seed',
        advanced: {
          timeout: m.timeout ?? 180000,
          retryCount: m.retryCount ?? 1,
          reasoningEnabled: m.reasoningEnabled ?? false,
          preferredLanguage: m.preferredLanguage ?? 'zh',
        },
      });

      const initConfig: any = {
        displayId: this.flow.target.displayId,
        models: {
          default: toLite(inline),
          insight: inline.insightModelId ? toLite({ ...inline, modelId: inline.insightModelId }) : undefined,
          planning: inline.planningModelId ? toLite({ ...inline, modelId: inline.planningModelId }) : undefined,
        },
      };

      this.engineRegistry.setInitConfig('midscene', initConfig);
      this.addLog({ level: 'info', source: 'scheduler', message: `Midscene 引擎（内联配置）: ${inline.modelId}` });
      return;
    }

    const store = getStore();
    const models = store.get('models') || [];
    const defaultIds = store.get('defaultModelIds') || {};

    const defaultModelId = midsceneModelConfig?.defaultModelId || defaultIds.midscene;
    if (!defaultModelId) {
      throw new Error('未配置 Midscene 默认模型，请在设置页面配置模型');
    }

    const defaultModel = models.find((m: any) => m.id === defaultModelId && m.enabled);
    if (!defaultModel) {
      throw new Error(`未找到 Midscene 默认模型: ${defaultModelId}（请在设置中确认模型已启用）`);
    }

    if (!defaultModel.apiKey) {
      throw new Error(`模型 ${defaultModel.name} 的 API Key 为空，请在设置页面配置`);
    }

    const insightModel = midsceneModelConfig?.insightModelId
      ? models.find((m: any) => m.id === midsceneModelConfig.insightModelId && m.enabled)
      : undefined;

    const planningModel = midsceneModelConfig?.planningModelId
      ? models.find((m: any) => m.id === midsceneModelConfig.planningModelId && m.enabled)
      : undefined;

    const toLite = (m: any): any => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      modelId: m.modelId,
      modelFamily: m.modelFamily || 'doubao-seed',
      advanced: {
        timeout: m.timeout,
        retryCount: m.retryCount,
        reasoningEnabled: m.reasoningEnabled,
        preferredLanguage: m.preferredLanguage,
        cacheable: m.cacheable,
        extraBodyJson: m.extraModelParams,
      },
    });

    const initConfig: any = {
      displayId: this.flow.target.displayId,
      models: {
        default: toLite(defaultModel),
        insight: insightModel ? toLite(insightModel) : undefined,
        planning: planningModel ? toLite(planningModel) : undefined,
      },
    };

    this.engineRegistry.setInitConfig('midscene', initConfig);
    this.addLog({
      level: 'info',
      source: 'scheduler',
      message: `Midscene 引擎初始化: ${defaultModel.modelId}`,
      data: { model: defaultModel.modelId },
    });
  }

  async start(): Promise<void> {
    if (this.status === 'running') return;

    this.status = 'running';
    this.startTime = Date.now();
    this.abortController = new AbortController();

    console.log('[FlowScheduler] Starting flow:', this.flow.flowMeta.name, 'with', this.flow.nodes.length, 'nodes');
    this.addLog({ level: 'info', source: 'scheduler', message: '工作流开始执行' });
    this.emit('event', { type: 'flow:start', flowId: this.flowId } as RuntimeEvent);

    try {
      const startNode = this.flow.nodes.find((n) => n.nodeType === 'control.start') || this.flow.nodes[0];
      if (!startNode) {
        throw new Error('工作流没有节点');
      }

      console.log('[FlowScheduler] Executing first node:', startNode.id);
      await this.executeNode(startNode.id);

      if (this.status === 'running') {
        this.status = 'success';
        console.log('[FlowScheduler] Flow completed successfully');
        this.addLog({ level: 'info', source: 'scheduler', message: '工作流执行成功' });
      } else if (this.status === 'stopped') {
        console.log('[FlowScheduler] Flow stopped by user');
        this.addLog({ level: 'warn', source: 'scheduler', message: '工作流已停止' });
      }
    } catch (error) {
      console.error('[FlowScheduler] Flow execution error:', error);
      const statusNow = this.status as FlowStatus;
      if (statusNow !== 'stopped') {
        this.status = 'failed';
        const msg = error instanceof Error ? error.message : String(error);
        this.addLog({ level: 'error', source: 'scheduler', message: `工作流执行失败: ${msg}` });
      }
    } finally {
      const reportPath = this.getFinalReportPath();
      console.log('[FlowScheduler] Flow finished, status:', this.status, 'reportPath:', reportPath);
      this.emit('event', {
        type: 'flow:complete',
        status: this.status as 'success' | 'failed' | 'stopped',
        duration: Date.now() - this.startTime,
        reportPath,
      } as RuntimeEvent);

      await this.engineRegistry.disposeAll();
    }
  }

  stop(): void {
    if (this.status !== 'running') return;
    this.status = 'stopped';
    this.abortController?.abort();
    this.addLog({ level: 'warn', source: 'scheduler', message: '工作流被用户停止' });
  }

  private async executeNode(nodeId: string): Promise<void> {
    if (this.status !== 'running') return;

    const node = this.nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`节点不存在: ${nodeId}`);
    }

    const state = this.nodeStates.get(nodeId)!;
    state.status = 'running';
    state.startTime = Date.now();

    this.addLog({
      level: 'info',
      source: 'scheduler',
      nodeId,
      message: `开始执行节点: ${node.nodeName || node.nodeType}`,
    });

    this.emit('event', {
      type: 'node:start',
      nodeId,
      nodeType: node.nodeType,
      nodeName: node.nodeName,
    } as RuntimeEvent);

    try {
      if (isControlNode(node.nodeType)) {
        const continueNext = await this.executeControlNode(node);

        if (this.status !== 'running') {
          state.status = 'stopped';
          state.endTime = Date.now();
          return;
        }

        state.status = 'success';
        state.endTime = Date.now();

        this.addLog({
          level: 'info',
          source: 'scheduler',
          nodeId,
          message: `节点执行完成: ${node.nodeName || node.nodeType}`,
          data: { duration: state.endTime - state.startTime },
        });

        this.emit('event', {
          type: 'node:complete',
          nodeId,
          duration: state.endTime - state.startTime!,
          output: state.output,
        } as RuntimeEvent);

        if (continueNext) {
          await this.executeNextNodes(node);
        }
      } else {
        const success = await this.executeEngineNode(node);
        if (!success || this.status !== 'running') {
          return;
        }
        const segment = this.collectSegment(node);
        const lastNode = segment[segment.length - 1];
        await this.executeNextNodes(lastNode);
      }
    } catch (error) {
      state.retryCount++;
      const msg = error instanceof Error ? error.message : String(error);

      const maxRetry = node.runtime?.retry ?? this.flow.runtime.defaultRetry;
      if (state.retryCount <= maxRetry) {
        this.addLog({
          level: 'warn',
          source: 'scheduler',
          nodeId,
          message: `节点失败，第 ${state.retryCount}/${maxRetry} 次重试: ${msg}`,
        });

        this.emit('event', {
          type: 'node:error',
          nodeId,
          error: msg,
          willRetry: true,
        } as RuntimeEvent);

        state.status = 'pending';
        await this.executeNode(nodeId);
        return;
      }

      state.status = 'failed';
      state.endTime = Date.now();
      state.error = msg;

      this.addLog({
        level: 'error',
        source: 'scheduler',
        nodeId,
        message: `节点执行失败: ${msg}`,
      });

      this.emit('event', {
        type: 'node:error',
        nodeId,
        error: msg,
        willRetry: false,
      } as RuntimeEvent);

      const onError = node.runtime?.onError ?? this.flow.runtime.onError;
      if (onError === 'continue') {
        this.addLog({ level: 'warn', source: 'scheduler', nodeId, message: '失败策略: 继续执行下一个节点' });
        await this.executeNextNodes(node);
      } else {
        throw error;
      }
    }
  }

  private async executeControlNode(node: FlowNode): Promise<boolean> {
    switch (node.nodeType) {
      case 'control.start':
        this.addLog({ level: 'info', source: 'scheduler', nodeId: node.id, message: '▶️ 工作流开始' });
        return true;
      case 'control.end':
        this.addLog({ level: 'info', source: 'scheduler', nodeId: node.id, message: '🏁 工作流结束' });
        return true;
      case 'control.if':
        await this.executeIfNode(node);
        return false;
      case 'control.loop':
        await this.executeLoopNode(node);
        return true;
      case 'control.var':
        this.executeVarNode(node);
        return true;
      case 'control.log':
        this.executeLogNode(node);
        return true;
      default:
        throw new Error(`未知控制节点类型: ${node.nodeType}`);
    }
  }

  private executeLogNode(node: FlowNode): void {
    const { message, var: varName } = node.nodeParams as any;
    let content = '';

    if (varName) {
      const value = (this.variablePool.globalVars as Record<string, unknown>)[varName as string];
      content = `[${varName}] = ${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`;
    } else if (message) {
      content = String(interpolateValue(message, this.variablePool));
    } else {
      content = JSON.stringify(this.variablePool.globalVars, null, 2);
    }

    this.addLog({
      level: 'info',
      source: 'scheduler',
      nodeId: node.id,
      message: `📢 ${content}`,
    });
  }

  private executeVarNode(node: FlowNode): void {
    const { name, value, mode = 'set' } = node.nodeParams as any;
    const interpolatedValue = interpolateValue(value, this.variablePool);

    if (mode === 'set') {
      (this.variablePool.globalVars as Record<string, unknown>)[name as string] = interpolatedValue;
    } else if (mode === 'increment' || mode === 'incr' || mode === 'add') {
      const current = Number((this.variablePool.globalVars as Record<string, unknown>)[name as string] ?? 0);
      (this.variablePool.globalVars as Record<string, unknown>)[name as string] = current + Number(interpolatedValue);
    } else if (mode === 'decrement' || mode === 'decr' || mode === 'sub') {
      const current = Number((this.variablePool.globalVars as Record<string, unknown>)[name as string] ?? 0);
      (this.variablePool.globalVars as Record<string, unknown>)[name as string] = current - Number(interpolatedValue);
    } else if (mode === 'append') {
      const current = (this.variablePool.globalVars as Record<string, unknown>)[name as string];
      if (Array.isArray(current)) {
        current.push(interpolatedValue);
      } else {
        (this.variablePool.globalVars as Record<string, unknown>)[name as string] = [current, interpolatedValue].filter(Boolean);
      }
    }

    this.addLog({
      level: 'debug',
      source: 'scheduler',
      nodeId: node.id,
      message: `变量赋值: ${name} = ${JSON.stringify(interpolatedValue)}`,
    });
  }

  private async executeIfNode(node: FlowNode): Promise<void> {
    const { expression } = node.nodeParams as any;
    const exprStr = String(expression);
    const interpolatedExpr = String(interpolateValue(exprStr, this.variablePool));
    const result = evaluateCondition(exprStr, this.variablePool);

    this.addLog({
      level: 'info',
      source: 'scheduler',
      nodeId: node.id,
      message: `条件判断: ${interpolatedExpr} = ${result}`,
      data: { expression: exprStr, result },
    });

    const trueBranch = node.nextNodes.find((n) => n.condition === 'true' || n.condition === undefined && n.nodeId);
    const falseBranch = node.nextNodes.find((n) => n.condition === 'false');

    const nextNodeId = result
      ? trueBranch?.nodeId
      : falseBranch?.nodeId;

    if (nextNodeId) {
      try {
        await this.executeNode(nextNodeId);
      } catch (e) {
        if (this.status === 'running') {
          this.status = 'failed';
        }
      }
    }
  }

  private async executeLoopNode(node: FlowNode): Promise<void> {
    const params = node.nodeParams as any;
    const { type, maxIterations = 100, bodyNodeId } = params;
    const loopBodyNodeId = bodyNodeId || node.nextNodes[0]?.nodeId;

    if (!loopBodyNodeId) {
      this.addLog({ level: 'warn', source: 'scheduler', nodeId: node.id, message: '循环没有指定循环体节点，跳过' });
      return;
    }

    let iteration = 0;

    if (type === 'for') {
      const { from = 0, to = 0, step = 1, iteratorVar = 'i' } = params;
      const iterVar = String(iteratorVar);
      (this.variablePool as any).loop = { ...((this.variablePool as any).loop || {}) };

      for (let i = Number(from); i <= Number(to); i += Number(step)) {
        if (this.status !== 'running') break;
        if (iteration >= maxIterations) {
          this.addLog({ level: 'warn', source: 'scheduler', nodeId: node.id, message: `达到最大循环次数 ${maxIterations}` });
          break;
        }
        (this.variablePool as any).loop[iterVar] = i;
        this.addLog({ level: 'debug', source: 'scheduler', nodeId: node.id, message: `for 循环第 ${iteration + 1} 次: ${iterVar} = ${i}` });
        try {
          await this.executeNode(loopBodyNodeId);
        } catch (e) {
          if (this.status === 'running') {
            this.status = 'failed';
          }
          break;
        }
        iteration++;
      }
    } else if (type === 'while') {
      const { condition } = params;
      while (evaluateCondition(String(condition), this.variablePool)) {
        if (this.status !== 'running') break;
        if (iteration >= maxIterations) {
          this.addLog({ level: 'warn', source: 'scheduler', nodeId: node.id, message: `达到最大循环次数 ${maxIterations}` });
          break;
        }
        this.addLog({ level: 'debug', source: 'scheduler', nodeId: node.id, message: `while 循环第 ${iteration + 1} 次` });
        try {
          await this.executeNode(loopBodyNodeId);
        } catch (e) {
          if (this.status === 'running') {
            this.status = 'failed';
          }
          break;
        }
        iteration++;
      }
    } else if (type === 'forEach') {
      const { array, iteratorVar = 'item' } = params;
      const arr = Array.isArray(array) ? array : [];
      for (const item of arr) {
        if (this.status !== 'running') break;
        (this.variablePool as any).loop = { ...((this.variablePool as any).loop || {}), [iteratorVar]: item };
        this.addLog({ level: 'debug', source: 'scheduler', nodeId: node.id, message: `forEach 循环: ${iteratorVar} = ${JSON.stringify(item)}` });
        try {
          await this.executeNode(loopBodyNodeId);
        } catch (e) {
          if (this.status === 'running') {
            this.status = 'failed';
          }
          break;
        }
        iteration++;
      }
    }
  }

  private async executeEngineNode(startNode: FlowNode): Promise<boolean> {
    const engine = this.engineRegistry.findEngineForNode(startNode.nodeType, startNode.engine);
    if (!engine) {
      throw new Error(`未找到节点 ${startNode.nodeType} 对应的执行引擎`);
    }

    await this.ensureEngineInitialized(engine.name);

    const segment = this.collectSegment(startNode);

    this.addLog({
      level: 'info',
      source: `engine:${engine.name}`,
      message: `执行 ${segment.length} 个连续节点`,
      data: { nodeIds: segment.map((n) => n.id) },
    });

    for (const segNode of segment) {
      const state = this.nodeStates.get(segNode.id);
      if (state) {
        state.status = 'running';
        state.startTime = Date.now();
      }
      this.emit('event', {
        type: 'node:start',
        nodeId: segNode.id,
        nodeType: segNode.nodeType,
        nodeName: segNode.nodeName,
      } as RuntimeEvent);
      this.addLog({
        level: 'info',
        source: 'scheduler',
        nodeId: segNode.id,
        message: `开始执行节点: ${segNode.nodeName || segNode.nodeType}`,
      });
    }

    const onEngineEvent = (event: EngineEvent) => {
      if (event.type === 'node:complete') {
        const state = this.nodeStates.get(event.nodeId);
        if (state) {
          state.output = event.output;
        }
        const outputs = this.variablePool.outputs as Record<string, unknown>;
        if (event.output !== undefined) {
          outputs[event.nodeId] = event.output;
        }
      } else if (event.type === 'log') {
        this.addLog({
          level: event.level as any,
          source: `engine:${engine.name}`,
          message: event.message,
          data: event.data,
        });
      } else if (event.type === 'screenshot') {
        this.emit('event', {
          type: 'screenshot',
          nodeId: event.nodeId,
          dataUrl: event.dataUrl,
        } as RuntimeEvent);
      }
    };

    const result = await this.engineRegistry.executeSegment(
      engine.name,
      segment,
      this.variablePool,
      this.abortController!.signal,
      onEngineEvent,
    );

    if (result.aborted || this.status === 'stopped') {
      this.addLog({ level: 'warn', source: 'scheduler', message: '引擎执行已停止' });
      for (const segNode of segment) {
        const state = this.nodeStates.get(segNode.id);
        if (state && state.status === 'running') {
          state.status = 'stopped';
          state.endTime = Date.now();
        }
      }
      return false;
    }

    if (!result.success) {
      const firstNode = segment[0];
      const state = this.nodeStates.get(firstNode.id);
      if (state) {
        state.status = 'failed';
        state.endTime = Date.now();
        state.error = result.error || '引擎执行失败';
      }
      for (let i = 1; i < segment.length; i++) {
        const s = this.nodeStates.get(segment[i].id);
        if (s && s.status === 'running') {
          s.status = 'skipped';
          s.endTime = Date.now();
        }
      }
      throw new Error(result.error || '引擎执行失败');
    }

    for (const segNode of segment) {
      const state = this.nodeStates.get(segNode.id);
      if (state && state.status === 'running') {
        state.status = 'success';
        state.endTime = Date.now();
      }

      const nodeOutput = result.outputs[segNode.id];
      if (nodeOutput !== undefined) {
        const outputs = this.variablePool.outputs as Record<string, unknown>;
        outputs[segNode.id] = nodeOutput;

        const outputVar = segNode.nodeParams?.outputVar;
        if (outputVar && typeof outputVar === 'string') {
          (this.variablePool.globalVars as Record<string, unknown>)[outputVar] = nodeOutput;
          const outputStr = typeof nodeOutput === 'string'
            ? nodeOutput.slice(0, 200)
            : JSON.stringify(nodeOutput).slice(0, 200);
          this.addLog({
            level: 'info',
            source: 'scheduler',
            nodeId: segNode.id,
            message: `📤 查询结果 → ${outputVar}: ${outputStr}`,
          });
        }
      }

      this.emit('event', {
        type: 'node:complete',
        nodeId: segNode.id,
        duration: state?.endTime && state?.startTime ? state.endTime - state.startTime : 0,
        output: state?.output,
      } as RuntimeEvent);

      this.addLog({
        level: 'info',
        source: 'scheduler',
        nodeId: segNode.id,
        message: `✓ 节点完成: ${segNode.nodeName || segNode.nodeType}`,
      });
    }

    return true;
  }

  private collectSegment(startNode: FlowNode): FlowNode[] {
    const segment: FlowNode[] = [startNode];
    let cursor = startNode;

    while (true) {
      const next = cursor.nextNodes.find((n) => !n.condition);
      if (!next) break;

      const nextNode = this.nodeMap.get(next.nodeId);
      if (!nextNode) break;

      if (isControlNode(nextNode.nodeType)) break;

      if (nextNode.engine && nextNode.engine !== startNode.engine) break;

      const startEngine = this.engineRegistry.findEngineForNode(startNode.nodeType, startNode.engine);
      const nextEngine = this.engineRegistry.findEngineForNode(nextNode.nodeType, nextNode.engine);
      if (!startEngine || !nextEngine || startEngine.name !== nextEngine.name) break;

      if (nextNode.runtime?.timeout !== startNode.runtime?.timeout) break;
      if (nextNode.runtime?.retry !== startNode.runtime?.retry) break;

      segment.push(nextNode);
      cursor = nextNode;
    }

    return segment;
  }

  private async executeNextNodes(node: FlowNode): Promise<void> {
    const unconditionalNext = node.nextNodes.filter((n) => !n.condition);
    for (const next of unconditionalNext) {
      if (this.status !== 'running') break;
      try {
        await this.executeNode(next.nodeId);
      } catch (e) {
        if (this.status === 'running') {
          this.status = 'failed';
        }
        break;
      }
    }
  }

  private getFinalReportPath(): string | undefined {
    const midsceneEngine = this.engineRegistry.get('midscene') as any;
    if (midsceneEngine?.getReportPath) {
      return midsceneEngine.getReportPath() || undefined;
    }
    return undefined;
  }
}
