import type {
  FlowEngine,
  EngineEvent,
  SegmentResult,
  FlowNode,
  EngineInitConfig,
} from '../../types/flow-v2.js';
import { generateMidsceneYaml } from './yamlGenerator.js';
import { getLogger } from '../logger.js';
import { createRequire } from 'module';

export class MidsceneEngine implements FlowEngine {
  name = 'midscene';
  displayName = 'Midscene 桌面引擎';
  supportedNodeTypes = ['midscene.*'];

  private agent: any = null;
  private reportMerger: any = null;
  private segmentCount = 0;
  private initConfig: EngineInitConfig | null = null;
  private log = getLogger();
  private currentOnEvent: ((event: EngineEvent) => void) | null = null;
  private currentSegment: FlowNode[] = [];
  private isStopping = false;
  /** 匹配 Midscene 内部的「按键/点击/滚动」相关关键词，把 console 输出转发到软件日志页 */
  private static readonly KEY_LOG_REGEX = /(keyDown|keyup|keyboard|press|tap|type|click|mouse|scroll|drag|modifier|按下|抬起|按键|修饰符|快捷键|keyTap|keyToggle)/i;
  /** 临时保存劫持前的原生 console 引用（try 块定义的 const 在 catch 里取不到，放实例字段就两边都能访问） */
  private _savedConsole: {
    log?: (...args: any[]) => void;
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
    inHook?: boolean;
  } | null = null;

  private _restoreConsole(): void {
    if (!this._savedConsole) return;
    if (this._savedConsole.log) console.log = this._savedConsole.log;
    if (this._savedConsole.info) console.info = this._savedConsole.info;
    if (this._savedConsole.warn) console.warn = this._savedConsole.warn;
    if (this._savedConsole.error) console.error = this._savedConsole.error;
    this._savedConsole = null;
  }

  private requireMidscene(moduleName: string): any {
    const require = createRequire(import.meta.url);
    const modulePath = require.resolve(moduleName);
    
    Object.keys(require.cache).forEach((key) => {
      if (key.includes('@midscene') || key.includes('midscene')) {
        delete require.cache[key];
      }
    });
    
    return require(modulePath);
  }

  private checkImageMatchingDependencies(): { ok: boolean; details: { name: string; ok: boolean; error?: string }[] } {
    const require = createRequire(import.meta.url);
    const deps = [
      { name: 'opencv-wasm', desc: 'OpenCV WASM (图片模板匹配引擎)' },
      { name: 'sharp', desc: 'Sharp (图片处理/像素转换)' },
      { name: 'screenshot-desktop', desc: 'Screenshot Desktop (屏幕截图)' },
    ];
    const details = deps.map(({ name, desc }) => {
      try {
        const resolved = require.resolve(name);
        const mod = require(name);
        if (name === 'opencv-wasm') {
          const ready = mod.cvReady instanceof Promise ? 'Promise' : typeof mod.cvReady;
          const hasCv = !!mod.cv;
          return { name: `${name} (${desc})`, ok: hasCv, error: hasCv ? undefined : `cvReady=${ready} 但 cv 未导出` };
        }
        return { name: `${name} (${desc})`, ok: true, resolved };
      } catch (e: any) {
        return { name: `${name} (${desc})`, ok: false, error: e?.message || String(e) };
      }
    });
    const ok = details.every((d) => d.ok);
    return { ok, details };
  }

  async initialize(config: EngineInitConfig): Promise<void> {
    this.initConfig = config;
    this.segmentCount = 0;

    if (!config.models || !config.models.default) {
      throw new Error('Midscene engine requires a default model configuration');
    }

    const depCheck = this.checkImageMatchingDependencies();
    if (!depCheck.ok) {
      const failedList = depCheck.details.filter((d) => !d.ok);
      const summary = failedList
        .map((d) => `  - ❌ ${d.name}: ${d.error || '加载失败'}`)
        .join('\n');
      this.log.error('[MidsceneEngine] 图片匹配依赖缺失，打包后未正确包含:\n' + summary);
    } else {
      this.log.info('[MidsceneEngine] 图片匹配依赖检查通过', {
        deps: depCheck.details.map((d) => d.name),
      });
    }

    try {
      const { ReportMergingTool } = this.requireMidscene('@midscene/core/report');
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
      const { agentForComputer } = this.requireMidscene('@midscene/computer');
      this.log.info('[MidsceneEngine] Creating agent...');

      // 加 30 秒超时保护，防止 agentForComputer 卡死
      const initPromise = agentForComputer({
        displayId: config.displayId,
        generateReport: true,
        aiActionContext: config.actionContext || '',
        onTaskStartTip: (tip: string) => {
          if (this.isStopping) {
            this.log.info('[MidsceneEngine] Task started but engine is stopping, ignoring', { tip });
            return;
          }
          this.log.info('[MidsceneEngine] Task started', { tip });
          if (this.currentOnEvent) {
            this.currentOnEvent({ type: 'log', level: 'info', message: `[MIDSCENE 🤖 步骤] ${tip}` });
            const currentIndex = this.currentSegment.findIndex(
              (n) => tip.includes(n.nodeName || n.nodeType)
            );
            if (currentIndex >= 0) {
              this.currentOnEvent({
                type: 'node:start',
                nodeId: this.currentSegment[currentIndex].id,
              });
            }
          }
        },
        onStep: (step: any) => {
          try {
            const text = typeof step === 'string' ? step : (step?.tip || step?.message || step?.description || JSON.stringify(step));
            if (!text || text === '{}') return;
            this.log.info('[MidsceneEngine] Step', { step: text });
            if (this.currentOnEvent) {
              this.currentOnEvent({ type: 'log', level: 'info', message: `[MIDSCENE 🤖 执行] ${text}` });
            }
          } catch { /* noop */ }
        },
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

    this.currentSegment = segment;
    this.currentOnEvent = onEvent;

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
      this.isStopping = true;
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
      // 在 Midscene 执行期间劫持 console.log/info/warn/error：
      // 把「按键/鼠标/滚动/修饰符」相关的详细输出同步写入 this.log（软件日志页能看到）
      // + 推给前端 onEvent（运行时控制台也能看到）。Midscene 内部本身会 console.log 每一次 keyDown/keyUp。
      // 用实例字段 _savedConsole 保存引用，保证 try/catch 两条路径都能正确还原。
      this._savedConsole = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        inHook: false,
      };
      const forward = (level: 'info' | 'warn' | 'error', args: any[]) => {
        const saved = this._savedConsole;
        if (!saved || saved.inHook) return; // 防止递归：this.log.info 内部也会 console.log
        try {
          const line = args
            .map((a) => {
              if (a == null) return String(a);
              if (typeof a === 'string') return a;
              if (a instanceof Error) return a.message + '\n' + (a.stack || '');
              try { return JSON.stringify(a); } catch { return String(a); }
            })
            .join(' ');
          if (line.length > 0 && MidsceneEngine.KEY_LOG_REGEX.test(line)) {
            saved.inHook = true;
            const prefix = level === 'warn' ? '[MIDSCENE ⚠️]' : level === 'error' ? '[MIDSCENE ❌]' : '[MIDSCENE 🤖]';
            const msg = `${prefix} ${line}`;
            if (level === 'error') this.log.error(msg);
            else if (level === 'warn') this.log.warn(msg);
            else this.log.info(msg);
            if (this.currentOnEvent) {
              this.currentOnEvent({ type: 'log', level, message: msg });
            }
          }
        } catch {
          /* noop */
        } finally {
          if (saved) saved.inHook = false;
        }
      };
      console.log = (...args: any[]) => { this._savedConsole?.log?.apply(console, args); forward('info', args); };
      console.info = (...args: any[]) => { this._savedConsole?.info?.apply(console, args); forward('info', args); };
      console.warn = (...args: any[]) => { this._savedConsole?.warn?.apply(console, args); forward('warn', args); };
      console.error = (...args: any[]) => { this._savedConsole?.error?.apply(console, args); forward('error', args); };

      const runPromise = this.agent.runYaml(yaml);
      const { result } = await Promise.race([runPromise, abortPromise]);
      this._restoreConsole();
      signal.removeEventListener('abort', abortHandler);

      const duration = Date.now() - startTime;
      this.log.info('[MidsceneEngine] Segment completed', { duration, nodeCount: segment.length });

      try {
        this.log.debug('[MidsceneEngine] Raw Midscene result keys: ' + Object.keys(result || {}).join(', '));
        this.log.debug('[MidsceneEngine] Raw Midscene result content: ' + JSON.stringify(result || {}, null, 2));
      } catch (e) {
        this.log.debug('[MidsceneEngine] Failed to serialize Midscene result', { error: String(e) });
      }

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
        let outputKey: string = node.id;
        const params = node.nodeParams || {};

        switch (node.nodeType) {
          case 'midscene.query':
          case 'midscene.assert':
          case 'midscene.boolean':
            if (params.outputVar) {
              outputKey = String(params.outputVar);
            }
            break;
        }

        let nodeOutput = result?.[outputKey];
        if (node.nodeType === 'midscene.waitFor') {
          nodeOutput = true;
        }
        if (nodeOutput === undefined && outputKey !== node.id) {
          nodeOutput = result?.[node.id];
        }
        this.log.debug('[MidsceneEngine] Extracting node output', {
          nodeId: node.id,
          nodeType: node.nodeType,
          outputKey,
          hasOutputVar: !!params.outputVar,
          nodeOutputExists: nodeOutput !== undefined,
          resultKeys: Object.keys(result || {}),
        });
        outputs[node.id] = nodeOutput;
        onEvent({ type: 'node:complete', nodeId: node.id, output: nodeOutput });
      }

      return { success: true, outputs };
    } catch (error) {
      // 错误/取消路径也要还原 console，防止后面的全局 console 被永久劫持
      this._restoreConsole();
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      signal.removeEventListener('abort', abortHandler);

      if (signal.aborted || errorMsg === 'aborted') {
        this.log.info('[MidsceneEngine] Segment aborted by user', { duration });
        return { success: false, outputs: {}, error: '用户取消', aborted: true };
      }

      const lastNode = segment[segment.length - 1];
      if (segment.length === 1 && lastNode.nodeType === 'midscene.waitFor') {
        this.log.info('[MidsceneEngine] waitFor timed out, returning false', { duration });
        const outputs: Record<string, unknown> = {};
        outputs[lastNode.id] = false;
        onEvent({ type: 'node:complete', nodeId: lastNode.id, output: false });
        return { success: true, outputs };
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
    this.isStopping = false;
    this.currentSegment = [];
    this.currentOnEvent = null;
    this.log.info('[MidsceneEngine] Disposed');
  }
}
