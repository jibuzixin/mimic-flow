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

function isSleepNode(nodeType: FlowNodeType): boolean {
  return nodeType === 'midscene.sleep';
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

function resolveVarPath(pool: Record<string, unknown>, path: string): unknown {
  const firstDot = path.indexOf('.');
  const topKey = firstDot === -1 ? path : path.slice(0, firstDot);
  const restPath = firstDot === -1 ? '' : path.slice(firstDot + 1);

  const reservedKeys = new Set(['globalVars', 'outputs', 'system', 'loop']);
  if (!reservedKeys.has(topKey)) {
    const topValue = pool[topKey];
    if (topValue !== undefined) {
      if (!restPath) return topValue;
      if (topValue && typeof topValue === 'object') {
        return getPathValue(topValue as Record<string, unknown>, restPath);
      }
      return undefined;
    }
  }

  const directValue = getPathValue(pool, path);
  if (directValue !== undefined) return directValue;

  const loopVars = pool.loop as Record<string, unknown> | undefined;
  if (loopVars && topKey in loopVars) {
    if (!restPath) return loopVars[topKey];
    return getPathValue(loopVars, path);
  }

  const globalVars = pool.globalVars as Record<string, unknown> | undefined;
  if (globalVars && topKey in globalVars) {
    if (!restPath) return globalVars[topKey];
    return getPathValue(globalVars, path);
  }

  const outputs = pool.outputs as Record<string, unknown> | undefined;
  if (outputs && topKey in outputs) {
    if (!restPath) return outputs[topKey];
    return getPathValue(outputs, path);
  }

  return undefined;
}

function interpolateValue(val: unknown, pool: Record<string, unknown>): unknown {
  if (typeof val === 'string') {
    let result = val;

    result = result.replace(/\\\{/g, '\u0000');
    result = result.replace(/\\\}/g, '\u0001');

    result = result.replace(/\{\{([\u4e00-\u9fa5\w.]+)\}\}/g, (_, path) => {
      const value = resolveVarPath(pool, path);
      return String(value ?? '');
    });

    result = result.replace(/\u0000/g, '{');
    result = result.replace(/\u0001/g, '}');

    return result;
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

  resetNodeStates(): void {
    for (const [nodeId, state] of this.nodeStates) {
      state.status = 'pending';
      state.startTime = undefined;
      state.endTime = undefined;
      state.output = undefined;
      state.error = undefined;
      state.retryCount = 0;
    }
    this.emit('event', { type: 'nodes:reset' } as RuntimeEvent);
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
    const store = getStore();
    const models: any[] = store.get('models') || [];
    const defaultIds: any = store.get('defaultModelIds') || {};

    const midsceneEngineConfig = defaultIds.executionEngines?.midscene || {};
    const globalDefaultMultimodal = defaultIds.defaultMultimodal;

    const defaultModelId = midsceneEngineConfig.defaultModelId || globalDefaultMultimodal;
    if (!defaultModelId) {
      throw new Error('未配置 Midscene 默认模型，请在设置页面的"高级设置"或"简单设置"中配置模型');
    }

    const defaultModel = models.find((m) => m.id === defaultModelId && m.enabled);
    if (!defaultModel) {
      throw new Error(`未找到 Midscene 默认模型: ${defaultModelId}（请在设置中确认模型已启用）`);
    }

    if (!defaultModel.apiKey) {
      throw new Error(`模型 ${defaultModel.name} 的 API Key 为空，请在设置页面配置`);
    }

    const insightModelId = midsceneEngineConfig.insightModelId;
    const planningModelId = midsceneEngineConfig.planningModelId;

    const insightModel = insightModelId
      ? models.find((m) => m.id === insightModelId && m.enabled)
      : undefined;

    const planningModel = planningModelId
      ? models.find((m) => m.id === planningModelId && m.enabled)
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
        preferredLanguage: m.preferredLanguage || 'zh',
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

      if ((this.status as FlowStatus) === 'stopped') {
        this.resetNodeStates();
      }

      await this.engineRegistry.disposeAll();
    }
  }

  stop(): void {
    if (this.status !== 'running') return;
    this.status = 'stopped';
    this.abortController?.abort();
    this.addLog({ level: 'warn', source: 'scheduler', message: '工作流被用户停止' });
    this.engineRegistry.disposeAll().catch(console.error);
  }

  private async executeNode(nodeId: string): Promise<void> {
    if (this.status !== 'running') return;

    const node = this.nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`节点不存在: ${nodeId}`);
    }

    const state = this.nodeStates.get(nodeId)!;
    const isLoopNode = node.nodeType === 'control.loop';

    if (!isLoopNode && (state.status === 'success' || state.status === 'running')) {
      return;
    }

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
      } else if (isSleepNode(node.nodeType) && this.isSleepStandalone(node)) {
        const duration = Number((node.nodeParams as any)?.duration ?? 1000);
        this.addLog({
          level: 'info',
          source: 'scheduler',
          nodeId,
          message: `⏱️ 等待 ${duration}ms`,
        });
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, duration);
          if (this.abortController) {
            this.abortController.signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          }
        });

        if (this.status !== 'running') {
          state.status = 'stopped';
          state.endTime = Date.now();
          return;
        }

        state.status = 'success';
        state.endTime = Date.now();
        state.output = duration;

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

        await this.executeNextNodes(node);
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
      case 'control.end': {
        const { message } = node.nodeParams as any;
        let content = '';
        if (message && typeof message === 'string') {
          const pureVarMatch = message.match(/^\s*\{\{\s*([^{}\s]+)\s*\}\}\s*$/);
          if (pureVarMatch) {
            const varName = pureVarMatch[1];
            const value = resolveVarPath(this.variablePool, varName);
            if (typeof value === 'object' && value !== null) {
              content = `[${varName}] = ${JSON.stringify(value, null, 2)}`;
            } else {
              content = String(value ?? '(undefined)');
            }
          } else {
            content = this.formatLogMessage(message);
          }
        } else if (message !== undefined && message !== null && typeof message !== 'string') {
          content = JSON.stringify(message, null, 2);
        }
        const state = this.nodeStates.get(node.id);
        if (state) {
          state.output = content;
        }
        this.addLog({ level: 'info', source: 'scheduler', nodeId: node.id, message: '🏁 工作流结束' + (content ? `\n${content}` : '') });
        return true;
      }
      case 'control.if':
        await this.executeIfNode(node);
        return false;
      case 'control.loop':
        await this.executeLoopNode(node);
        return false;
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
    const { message } = node.nodeParams as any;
    let content = '';

    if (message && typeof message === 'string') {
      const pureVarMatch = message.match(/^\s*\{\{\s*([^{}\s]+)\s*\}\}\s*$/);
      if (pureVarMatch) {
        const varName = pureVarMatch[1];
        const value = resolveVarPath(this.variablePool, varName);
        if (typeof value === 'object' && value !== null) {
          content = `[${varName}] = ${JSON.stringify(value, null, 2)}`;
        } else {
          content = String(value ?? '(undefined)');
        }
      } else {
        content = this.formatLogMessage(message);
      }
    } else if (message !== undefined && message !== null && typeof message !== 'string') {
      content = JSON.stringify(message, null, 2);
    } else {
      content = '(日志内容为空)';
    }

    const state = this.nodeStates.get(node.id);
    if (state) {
      state.output = content;
    }

    this.addLog({
      level: 'info',
      source: 'scheduler',
      nodeId: node.id,
      message: `📢 ${content}`,
    });
  }

  private formatLogMessage(message: string): string {
    const pool = this.variablePool;
    let result = message;

    result = result.replace(/\\\{/g, '\u0000');
    result = result.replace(/\\\}/g, '\u0001');

    result = result.replace(/\{\{([\u4e00-\u9fa5\w.]+)\}\}/g, (_, path) => {
      const value = resolveVarPath(pool, path);
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value, null, 2);
      }
      return String(value ?? '');
    });

    result = result.replace(/\u0000/g, '{');
    result = result.replace(/\u0001/g, '}');

    return result;
  }

  private executeVarNode(node: FlowNode): void {
    const params = node.nodeParams as any;
    const { varName, value, operation = 'set' } = params;
    const pool = this.variablePool;

    let resultVal: unknown = undefined;
    let initialized = false;

    const getCurrentValue = (): unknown => {
      if (initialized) return resultVal;
      return resolveVarPath(pool, varName as string);
    };

    const setValue = (val: unknown) => {
      resultVal = val;
      initialized = true;
    };

    const autoParseValue = (val: unknown): unknown => {
      if (typeof val !== 'string') return val;
      if (val === '') return '';
      if (val === 'true') return true;
      if (val === 'false') return false;
      const num = Number(val);
      if (!isNaN(num) && val.trim() !== '') return num;
      const trimmed = val.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          return JSON.parse(trimmed);
        } catch {
          return val;
        }
      }
      return val;
    };

    const isNumericOp = ['add', 'subtract', 'multiply', 'divide', 'increment', 'decrement', 'toInteger', 'abs', 'round', 'ceil', 'floor', 'toNumber', 'modulo'].includes(operation);
    const isStringOp = ['concat', 'toUpperCase', 'toLowerCase', 'trim', 'substring', 'charAt', 'replace', 'toString', 'startsWith', 'endsWith', 'includes', 'strLength'].includes(operation);
    const isArrayOp = ['arrayLength', 'arrayGet', 'arrayPush', 'arrayPop', 'arrayJoin'].includes(operation);

    const needsValue = !['toUpperCase', 'toLowerCase', 'trim', 'toInteger', 'abs', 'round', 'ceil', 'floor', 'toString', 'toNumber', 'arrayLength', 'arrayPop', 'strLength'].includes(operation);
    const needsValue2 = ['substring', 'replace', 'charAt', 'arrayGet', 'arrayPush', 'arrayJoin', 'modulo', 'startsWith', 'endsWith', 'includes', 'objectSet'].includes(operation);
    const interpolatedValue = needsValue ? interpolateValue(value, this.variablePool) : undefined;
    const interpolatedValue2 = needsValue2 && params.value2 !== undefined ? interpolateValue(String(params.value2), this.variablePool) : undefined;

    let numericValue = 1;
    if (needsValue && value !== undefined && value !== '') {
      numericValue = Number(interpolatedValue) || 0;
    }

    let stringValue = '';
    if (needsValue) {
      stringValue = String(interpolatedValue ?? '');
    }

    const ensureInitialized = () => {
      const current = getCurrentValue();
      if (current !== undefined) return;

      if (isNumericOp) {
        setValue(0);
      } else if (isStringOp) {
        setValue('');
      } else if (operation === 'set') {
        // set 操作不需要预初始化，直接赋值即可
      } else {
        setValue(0);
      }
    };

    switch (operation) {
      case 'set': {
        const valueType = String(params.setValueType || 'string');
        if (valueType === 'boolean') {
          const raw = params.value;
          setValue(raw === true || raw === 'true' || raw === 1 || raw === '1');
        } else if (valueType === 'number') {
          setValue(Number(interpolatedValue) || 0);
        } else if (valueType === 'array') {
          const rawLines = String(params.value ?? '').split('\n');
          const parsed: unknown[] = [];
          for (const line of rawLines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;
            const interpolated = interpolateValue(trimmed, this.variablePool);
            if (interpolated === 'true') {
              parsed.push(true);
            } else if (interpolated === 'false') {
              parsed.push(false);
            } else {
              const num = Number(interpolated);
              if (!isNaN(num) && String(interpolated).trim() !== '') {
                parsed.push(num);
              } else {
                parsed.push(interpolated);
              }
            }
          }
          setValue(parsed);
        } else if (valueType === 'object') {
          const rawStr = String(params.value ?? '{}');
          try {
            const parsed = JSON.parse(rawStr);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              setValue(parsed);
            } else {
              setValue({});
            }
          } catch {
            setValue({});
          }
        } else {
          setValue(String(interpolatedValue ?? ''));
        }
        break;
      }
      case 'increment':
      case 'add': {
        ensureInitialized();
        setValue(Number(getCurrentValue() ?? 0) + numericValue);
        break;
      }
      case 'decrement':
      case 'subtract': {
        ensureInitialized();
        setValue(Number(getCurrentValue() ?? 0) - numericValue);
        break;
      }
      case 'multiply': {
        ensureInitialized();
        setValue(Number(getCurrentValue() ?? 0) * numericValue);
        break;
      }
      case 'divide': {
        ensureInitialized();
        setValue(Number(getCurrentValue() ?? 0) / numericValue);
        break;
      }
      case 'concat': {
        ensureInitialized();
        setValue(String(getCurrentValue() ?? '') + stringValue);
        break;
      }
      case 'toUpperCase': {
        ensureInitialized();
        setValue(String(getCurrentValue() ?? '').toUpperCase());
        break;
      }
      case 'toLowerCase': {
        ensureInitialized();
        setValue(String(getCurrentValue() ?? '').toLowerCase());
        break;
      }
      case 'trim': {
        ensureInitialized();
        setValue(String(getCurrentValue() ?? '').trim());
        break;
      }
      case 'toInteger': {
        ensureInitialized();
        setValue(Math.trunc(Number(getCurrentValue() ?? 0)));
        break;
      }
      case 'abs': {
        ensureInitialized();
        setValue(Math.abs(Number(getCurrentValue() ?? 0)));
        break;
      }
      case 'round': {
        ensureInitialized();
        setValue(Math.round(Number(getCurrentValue() ?? 0)));
        break;
      }
      case 'ceil': {
        ensureInitialized();
        setValue(Math.ceil(Number(getCurrentValue() ?? 0)));
        break;
      }
      case 'floor': {
        ensureInitialized();
        setValue(Math.floor(Number(getCurrentValue() ?? 0)));
        break;
      }
      case 'modulo': {
        ensureInitialized();
        const val2 = Number(interpolatedValue2 ?? 0) || 1;
        setValue(Number(getCurrentValue() ?? 0) % val2);
        break;
      }
      case 'toString': {
        ensureInitialized();
        setValue(String(getCurrentValue() ?? ''));
        break;
      }
      case 'toNumber': {
        ensureInitialized();
        setValue(Number(getCurrentValue()) || 0);
        break;
      }
      case 'substring': {
        ensureInitialized();
        const str = String(getCurrentValue() ?? '');
        const start = Number(interpolatedValue ?? 0);
        const end = interpolatedValue2 !== undefined ? Number(interpolatedValue2) : undefined;
        setValue(end !== undefined ? str.substring(start, end) : str.substring(start));
        break;
      }
      case 'charAt': {
        ensureInitialized();
        const str = String(getCurrentValue() ?? '');
        const idx = Number(interpolatedValue ?? 0);
        setValue(str.charAt(idx));
        break;
      }
      case 'replace': {
        ensureInitialized();
        const str = String(getCurrentValue() ?? '');
        const search = String(interpolatedValue ?? '');
        const replacement = String(interpolatedValue2 ?? '');
        setValue(str.replace(search, replacement));
        break;
      }
      case 'startsWith': {
        ensureInitialized();
        const str = String(getCurrentValue() ?? '');
        const search = String(interpolatedValue ?? '');
        setValue(str.startsWith(search));
        break;
      }
      case 'endsWith': {
        ensureInitialized();
        const str = String(getCurrentValue() ?? '');
        const search = String(interpolatedValue ?? '');
        setValue(str.endsWith(search));
        break;
      }
      case 'includes': {
        ensureInitialized();
        const str = String(getCurrentValue() ?? '');
        const search = String(interpolatedValue ?? '');
        setValue(str.includes(search));
        break;
      }
      case 'strLength': {
        ensureInitialized();
        const str = String(getCurrentValue() ?? '');
        setValue(str.length);
        break;
      }
      case 'arrayLength': {
        ensureInitialized();
        const arr = getCurrentValue();
        if (Array.isArray(arr)) {
          setValue(arr.length);
        } else {
          setValue(0);
        }
        break;
      }
      case 'arrayGet': {
        ensureInitialized();
        const arr = getCurrentValue();
        const idx = Number(interpolatedValue ?? 0);
        if (Array.isArray(arr)) {
          setValue(arr[idx]);
        } else {
          setValue(undefined);
        }
        break;
      }
      case 'arrayPush': {
        ensureInitialized();
        let arr = getCurrentValue();
        if (!Array.isArray(arr)) arr = [];
        const newArr = [...(arr as unknown[])];
        const val = autoParseValue(interpolatedValue2);
        newArr.push(val);
        setValue(newArr);
        break;
      }
      case 'arrayPop': {
        ensureInitialized();
        let arr = getCurrentValue();
        if (!Array.isArray(arr)) arr = [];
        const newArr = [...(arr as unknown[])];
        const popped = newArr.pop();
        setValue(newArr);
        if (params.outputVar) {
          pool[String(params.outputVar)] = popped;
        }
        break;
      }
      case 'arrayJoin': {
        ensureInitialized();
        const arr = getCurrentValue();
        const separator = String(interpolatedValue ?? ',');
        if (Array.isArray(arr)) {
          setValue(arr.join(separator));
        } else {
          setValue('');
        }
        break;
      }
      case 'objectGet': {
        ensureInitialized();
        const obj = getCurrentValue();
        const path = String(interpolatedValue ?? '');
        if (typeof obj === 'object' && obj !== null) {
          setValue(resolveVarPath(obj as Record<string, unknown>, path));
        } else {
          setValue(undefined);
        }
        break;
      }
      case 'objectSet': {
        ensureInitialized();
        let obj = getCurrentValue();
        const path = String(interpolatedValue ?? '');
        const val = autoParseValue(interpolatedValue2);
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
          obj = {};
        }
        const newObj = JSON.parse(JSON.stringify(obj));
        const keys = path.split('.');
        let current: any = newObj;
        for (let i = 0; i < keys.length - 1; i++) {
          const key = keys[i];
          if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
            current[key] = {};
          }
          current = current[key];
        }
        current[keys[keys.length - 1]] = val;
        setValue(newObj);
        break;
      }
      case 'objectDelete': {
        ensureInitialized();
        let obj = getCurrentValue();
        const path = String(interpolatedValue ?? '');
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
          break;
        }
        const newObj = JSON.parse(JSON.stringify(obj));
        const keys = path.split('.');
        let current: any = newObj;
        for (let i = 0; i < keys.length - 1; i++) {
          const key = keys[i];
          if (!current[key] || typeof current[key] !== 'object') {
            break;
          }
          current = current[key];
        }
        if (keys.length > 0) {
          delete current[keys[keys.length - 1]];
        }
        setValue(newObj);
        break;
      }
      case 'objectKeys': {
        ensureInitialized();
        const obj = getCurrentValue();
        if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
          setValue(Object.keys(obj));
        } else {
          setValue([]);
        }
        break;
      }
      case 'objectValues': {
        ensureInitialized();
        const obj = getCurrentValue();
        if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
          setValue(Object.values(obj));
        } else {
          setValue([]);
        }
        break;
      }
      default:
        setValue(interpolatedValue);
    }

    const saveToNewVar = params.saveToNewVar === true;
    let finalVarName = varName as string;

    if (saveToNewVar) {
      finalVarName = params.outputVarName && String(params.outputVarName).trim()
        ? String(params.outputVarName).trim()
        : `return_${varName}`;
      const originalVal = resolveVarPath(pool, varName as string);
      if (operation === 'set') {
        // set 操作不需要原变量不变，结果存到新变量
      } else {
        // 其他操作：原变量保持不变，结果存到新变量
      }
    }

    if (initialized || operation === 'set') {
      pool[finalVarName] = resultVal;
    } else if (!saveToNewVar) {
      // 未初始化过，原变量保持原样
    }

    const opLabels: Record<string, string> = {
      set: '赋值',
      add: '加法',
      subtract: '减法',
      multiply: '乘法',
      divide: '除法',
      modulo: '取模',
      abs: '绝对值',
      round: '四舍五入',
      ceil: '向上取整',
      floor: '向下取整',
      toNumber: '转数字',
      toInteger: '转整数',
      toString: '转字符串',
      concat: '拼接',
      toUpperCase: '转大写',
      toLowerCase: '转小写',
      trim: '去空格',
      substring: '截取',
      charAt: '取字符',
      replace: '替换',
      strLength: '长度',
      startsWith: '开头匹配',
      endsWith: '结尾匹配',
      includes: '包含',
      arrayLength: '数组长度',
      arrayGet: '取元素',
      arrayPush: '添加元素',
      arrayPop: '移除元素',
      arrayJoin: '数组合并',
      objectGet: '获取属性',
      objectSet: '设置属性',
      objectDelete: '删除属性',
      objectKeys: '获取键列表',
      objectValues: '获取值列表',
    };
    const opLabel = opLabels[operation] || operation;

    this.addLog({
      level: 'debug',
      source: 'scheduler',
      nodeId: node.id,
      message: `变量赋值 [${opLabel}]: ${finalVarName} = ${JSON.stringify(resultVal)}`,
    });

    if (params.printResult) {
      const finalVal = pool[finalVarName];
      const formatted = typeof finalVal === 'object' && finalVal !== null
        ? JSON.stringify(finalVal, null, 2)
        : String(finalVal);
      const outputStr = `[${finalVarName}] = ${formatted}`;
      const state = this.nodeStates.get(node.id);
      if (state) {
        state.output = outputStr;
      }
      this.addLog({
        level: 'info',
        source: 'scheduler',
        nodeId: node.id,
        message: `📤 [${opLabel}] ${outputStr}`,
      });
    }
  }

  private parseValue(str: string): unknown {
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'null') return null;
    if (str === 'undefined') return undefined;
    const num = Number(str);
    if (!isNaN(num) && str.trim() !== '') return num;
    return str;
  }

  private compareValues(left: unknown, operator: string, right: unknown): boolean {
    const leftStr = String(left ?? '');
    const rightStr = String(right ?? '');
    
    switch (operator) {
      case '==':
        return left == right;
      case '!=':
        return left != right;
      case '>':
        return (left as number) > (right as number);
      case '<':
        return (left as number) < (right as number);
      case '>=':
        return (left as number) >= (right as number);
      case '<=':
        return (left as number) <= (right as number);
      case 'contains':
        return leftStr.includes(rightStr);
      case 'notContains':
        return !leftStr.includes(rightStr);
      case 'startsWith':
        return leftStr.startsWith(rightStr);
      case 'endsWith':
        return leftStr.endsWith(rightStr);
      default:
        return false;
    }
  }

  private async executeIfNode(node: FlowNode): Promise<void> {
    const params = node.nodeParams as any;
    let result = false;
    let displayExpr = '';

    const extractVarName = (input: string): string => {
      const match = input.match(/\{\{\s*([^{}\s]+)\s*\}\}/);
      return match ? match[1] : input;
    };

    if (params.expression) {
      const exprStr = String(params.expression);
      const interpolatedExpr = String(interpolateValue(exprStr, this.variablePool));
      result = evaluateCondition(exprStr, this.variablePool);
      displayExpr = interpolatedExpr;
    } else if (params.leftVar !== undefined) {
      const leftVarRaw = String(params.leftVar || '');
      const conditionType = String(params.conditionType || 'boolean');
      const leftVarName = extractVarName(leftVarRaw);
      const leftValue = resolveVarPath(this.variablePool, leftVarName);

      if (conditionType === 'boolean') {
        result = !!leftValue;
        displayExpr = `${leftVarName} = ${JSON.stringify(leftValue)} (${result})`;
      } else {
        const operator = String(params.operator || '==');
        const rightRaw = params.rightValue;
        let rightValue: unknown;

        if (typeof rightRaw === 'string' && rightRaw.includes('{{') && rightRaw.includes('}}')) {
          rightValue = interpolateValue(rightRaw, this.variablePool);
          rightValue = this.parseValue(String(rightValue));
        } else if (typeof rightRaw === 'string') {
          rightValue = this.parseValue(rightRaw);
        } else {
          rightValue = rightRaw;
        }

        result = this.compareValues(leftValue, operator, rightValue);
        displayExpr = `${leftVarName}(${JSON.stringify(leftValue)}) ${operator} ${JSON.stringify(rightValue)}`;
      }
    } else {
      displayExpr = 'undefined';
      result = false;
    }

    this.addLog({
      level: 'info',
      source: 'scheduler',
      nodeId: node.id,
      message: `条件判断: ${displayExpr} = ${result}`,
      data: { result },
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

  private resetLoopBodyNodes(loopNodeId: string, bodyStartNodeId: string): void {
    const visited = new Set<string>();
    const queue: string[] = [bodyStartNodeId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId) || currentId === loopNodeId) continue;
      visited.add(currentId);
      const currentNode = this.nodeMap.get(currentId);
      if (!currentNode) continue;
      const state = this.nodeStates.get(currentId);
      if (state) {
        state.status = 'pending';
        state.output = undefined;
        state.startTime = undefined;
        state.endTime = undefined;
      }
      for (const next of currentNode.nextNodes) {
        if (!visited.has(next.nodeId) && next.nodeId !== loopNodeId) {
          queue.push(next.nodeId);
        }
      }
    }
  }

  private async executeLoopNode(node: FlowNode): Promise<void> {
    const params = node.nodeParams as any;
    const loopType = params.loopType || 'for';
    const maxIterations = Number(params.maxIterations ?? 100);

    const bodyBranch = node.nextNodes.find((n) => n.condition === 'body');
    const exitBranch = node.nextNodes.find((n) => n.condition === 'exit');
    const bodyNodeId = bodyBranch?.nodeId;
    const exitNodeId = exitBranch?.nodeId;

    if (!bodyNodeId && !exitNodeId) {
      this.addLog({ level: 'warn', source: 'scheduler', nodeId: node.id, message: '循环没有连接 body 或 exit 分支，跳过' });
      return;
    }

    const loopStateKey = `__loop_${node.id}`;
    const pool = this.variablePool as Record<string, unknown>;
    const loopState = (pool[loopStateKey] as Record<string, unknown> | undefined) || {};

    let shouldContinue = false;
    let nextNodeId: string | undefined;
    let iteration = 0;

    if (loopType === 'for') {
      const from = Number(params.from ?? 0);
      const to = Number(params.to ?? 0);
      const step = Number(params.step ?? 1);
      const iteratorVar = String(params.iteratorVar || 'i');

      let current = loopState.current !== undefined ? Number(loopState.current) : from;
      iteration = Number(loopState.iteration ?? 0);

      if (iteration >= maxIterations) {
        this.addLog({ level: 'warn', source: 'scheduler', nodeId: node.id, message: `🔄 达到最大循环次数 ${maxIterations}，退出循环` });
        shouldContinue = false;
      } else if ((step > 0 && current <= to) || (step < 0 && current >= to)) {
        shouldContinue = true;
      } else {
        shouldContinue = false;
      }

      if (shouldContinue && bodyNodeId) {
        ((this.variablePool as any).loop = (this.variablePool as any).loop || {})[iteratorVar] = current;
        this.addLog({ level: 'info', source: 'scheduler', nodeId: node.id, message: `🔄 for 循环第 ${iteration + 1} 次: ${iteratorVar} = ${current}` });

        pool[loopStateKey] = {
          ...loopState,
          current: current + step,
          iteration: iteration + 1,
        };
        this.resetLoopBodyNodes(node.id, bodyNodeId);
        nextNodeId = bodyNodeId;
      } else if (exitNodeId) {
        this.addLog({ level: 'info', source: 'scheduler', nodeId: node.id, message: `🔄 for 循环结束，共执行 ${iteration} 次` });
        delete pool[loopStateKey];
        nextNodeId = exitNodeId;
      }
    } else if (loopType === 'while') {
      const condition = String(params.condition || '');
      const whileLeftVarRaw = String(params.whileLeftVar || '');
      const whileConditionType = String(params.whileConditionType || 'boolean');
      const extractVarName = (input: string): string => {
        const match = input.match(/\{\{\s*([^{}\s]+)\s*\}\}/);
        return match ? match[1] : input;
      };
      const whileLeftVar = extractVarName(whileLeftVarRaw);
      iteration = Number(loopState.iteration ?? 0);

      if (iteration >= maxIterations) {
        this.addLog({ level: 'warn', source: 'scheduler', nodeId: node.id, message: `🔄 达到最大循环次数 ${maxIterations}，退出循环` });
        shouldContinue = false;
      } else {
        try {
          if (whileLeftVar) {
            const leftValue = resolveVarPath(this.variablePool, whileLeftVar);
            
            if (whileConditionType === 'boolean') {
              shouldContinue = !!leftValue;
            } else {
              const whileOperator = String(params.whileOperator || '==');
              const whileRightRaw = params.whileRightValue;
              let rightValue: unknown;

              if (typeof whileRightRaw === 'string' && whileRightRaw.includes('{{') && whileRightRaw.includes('}}')) {
                rightValue = interpolateValue(whileRightRaw, this.variablePool);
                rightValue = this.parseValue(String(rightValue));
              } else if (typeof whileRightRaw === 'string') {
                rightValue = this.parseValue(whileRightRaw);
              } else {
                rightValue = whileRightRaw;
              }

              shouldContinue = this.compareValues(leftValue, whileOperator, rightValue);
            }
          } else if (condition) {
            shouldContinue = evaluateCondition(condition, this.variablePool);
          } else {
            shouldContinue = false;
          }
        } catch (e) {
          this.addLog({ level: 'error', source: 'scheduler', nodeId: node.id, message: `🔄 while 条件判断失败` });
          shouldContinue = false;
        }
      }

      if (shouldContinue && bodyNodeId) {
        this.addLog({ level: 'info', source: 'scheduler', nodeId: node.id, message: `🔄 while 循环第 ${iteration + 1} 次` });
        pool[loopStateKey] = { ...loopState, iteration: iteration + 1 };
        this.resetLoopBodyNodes(node.id, bodyNodeId);
        nextNodeId = bodyNodeId;
      } else if (exitNodeId) {
        this.addLog({ level: 'info', source: 'scheduler', nodeId: node.id, message: `🔄 while 循环结束，共执行 ${iteration} 次` });
        delete pool[loopStateKey];
        nextNodeId = exitNodeId;
      }
    } else if (loopType === 'forEach') {
      const arrayVarRaw = String(params.arrayVar || '');
      const extractVarName = (input: string): string => {
        const match = input.match(/\{\{\s*([^{}\s]+)\s*\}\}/);
        return match ? match[1] : input;
      };
      const arrayVar = extractVarName(arrayVarRaw);
      const itemVar = String(params.itemVar || 'item');
      const keyVar = String(params.keyVar || 'key');
      iteration = Number(loopState.iteration ?? 0);

      let items: { key: string | number; value: unknown }[] = [];
      const sourceVal = resolveVarPath(this.variablePool, arrayVar);
      if (Array.isArray(sourceVal)) {
        items = sourceVal.map((v, i) => ({ key: i, value: v }));
      } else if (typeof sourceVal === 'object' && sourceVal !== null) {
        items = Object.entries(sourceVal).map(([k, v]) => ({ key: k, value: v }));
      }

      if (iteration >= maxIterations || iteration >= items.length) {
        shouldContinue = false;
      } else {
        shouldContinue = true;
      }

      if (shouldContinue && bodyNodeId) {
        const item = items[iteration];
        ((this.variablePool as any).loop = (this.variablePool as any).loop || {})[itemVar] = item.value;
        ((this.variablePool as any).loop = (this.variablePool as any).loop || {})[keyVar] = item.key;
        const isObj = !Array.isArray(sourceVal) && typeof sourceVal === 'object' && sourceVal !== null;
        this.addLog({
          level: 'info',
          source: 'scheduler',
          nodeId: node.id,
          message: `🔄 forEach 第 ${iteration + 1} 次: ${keyVar}=${item.key}, ${itemVar}=${JSON.stringify(item.value)}`,
        });
        pool[loopStateKey] = { ...loopState, iteration: iteration + 1 };
        this.resetLoopBodyNodes(node.id, bodyNodeId);
        nextNodeId = bodyNodeId;
      } else if (exitNodeId) {
        const isObj = !Array.isArray(sourceVal) && typeof sourceVal === 'object' && sourceVal !== null;
        this.addLog({
          level: 'info',
          source: 'scheduler',
          nodeId: node.id,
          message: `🔄 forEach 循环结束，共执行 ${iteration} 次`,
        });
        delete pool[loopStateKey];
        nextNodeId = exitNodeId;
      }
    }

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

      if (isSleepNode(nextNode.nodeType)) {
        const afterNext = nextNode.nextNodes.find((n) => !n.condition);
        if (afterNext) {
          const afterNextNode = this.nodeMap.get(afterNext.nodeId);
          if (afterNextNode && !isControlNode(afterNextNode.nodeType) && !isSleepNode(afterNextNode.nodeType)) {
            const startEngine = this.engineRegistry.findEngineForNode(startNode.nodeType, startNode.engine);
            const afterNextEngine = this.engineRegistry.findEngineForNode(afterNextNode.nodeType, afterNextNode.engine);
            if (startEngine && afterNextEngine && startEngine.name === afterNextEngine.name) {
              segment.push(nextNode);
              cursor = nextNode;
              continue;
            }
          }
        }
        break;
      }

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

  private isSleepStandalone(node: FlowNode): boolean {
    if (!isSleepNode(node.nodeType)) return false;

    const prevNodes = this.findPrevNodes(node.id);
    const nextUnconditional = node.nextNodes.find((n) => !n.condition);
    const nextNode = nextUnconditional ? this.nodeMap.get(nextUnconditional.nodeId) : undefined;

    const prevHasMidscene = prevNodes.some((prevId) => {
      const prev = this.nodeMap.get(prevId);
      return prev && !isControlNode(prev.nodeType) && !isSleepNode(prev.nodeType);
    });

    const nextHasMidscene = nextNode && !isControlNode(nextNode.nodeType) && !isSleepNode(nextNode.nodeType);

    return !prevHasMidscene && !nextHasMidscene;
  }

  private findPrevNodes(nodeId: string): string[] {
    const result: string[] = [];
    for (const [id, node] of this.nodeMap) {
      const hasNext = node.nextNodes?.some((n) => n.nodeId === nodeId);
      if (hasNext) {
        result.push(id);
      }
    }
    return result;
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
