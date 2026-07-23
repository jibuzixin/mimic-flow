import { BrowserWindow } from 'electron';
import { FlowInstance, type MidsceneAdapter } from './FlowInstance.js';
import type { FlowSchema, IpcResponse, RuntimeEventPayload } from '../../types/flow.js';
import { IPC_CHANNEL } from '../../types/flow.js';
import { getLogger } from '../logger.js';
import { getStore } from '../store.js';
import type { ModelProfile } from '../../types/index.js';

export class FlowRuntimeService {
  private instances = new Map<string, FlowInstance>();
  private mainWindow: BrowserWindow | null = null;
  private adapter: MidsceneAdapter;

  constructor(adapter: MidsceneAdapter) {
    this.adapter = adapter;
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  async run(flow: FlowSchema): Promise<IpcResponse<{ runInstanceId: string }>> {
    // MVP：同时只允许一个活跃实例
    for (const instance of this.instances.values()) {
      if (instance.isRunning) {
        return {
          success: false,
          error: { code: 'INSTANCE_EXISTS', message: '当前已有正在执行的流程，请先停止' },
        };
      }
    }

    const resolvedFlow = this.resolveFlowModelConfig(flow);
    const instance = new FlowInstance(resolvedFlow, this.adapter);
    this.instances.set(instance.runInstanceId, instance);

    instance.on('runtime-event', (payload: RuntimeEventPayload) => {
      this.pushEvent(payload);
    });

    instance.on('runtime-event', async (payload: RuntimeEventPayload) => {
      if (payload.type === 'flow-finish') {
        await this.adapter.close?.();
        // 流程结束后保留实例一段时间再清理，方便前端查询
        setTimeout(() => this.instances.delete(instance.runInstanceId), 30000);
      }
    });

    // 异步启动，不阻塞 invoke 返回
    instance.start().catch((err) => {
      getLogger().error('Flow instance start error', { runInstanceId: instance.runInstanceId, error: String(err) });
    });

    return { success: true, data: { runInstanceId: instance.runInstanceId } };
  }

  async stop(runInstanceId: string): Promise<IpcResponse<{ stopped: boolean }>> {
    const instance = this.instances.get(runInstanceId);
    if (!instance) {
      return { success: false, error: { code: 'INSTANCE_NOT_FOUND', message: '运行实例不存在' } };
    }
    instance.stop();
    return { success: true, data: { stopped: true } };
  }

  validate(flow: FlowSchema): IpcResponse<{ valid: boolean; errors: Array<{ nodeId?: string; message: string }> }> {
    const errors: Array<{ nodeId?: string; message: string }> = [];
    const nodeMap = new Map(flow.nodeList.map((n) => [n.nodeId, n]));

    if (!flow.flowMeta?.name) {
      errors.push({ message: '流程名称不能为空' });
    }

    if (!flow.deviceConfig?.type) {
      errors.push({ message: '设备类型不能为空' });
    }

    if (!flow.aiGlobalConfig?.modelId) {
      errors.push({ message: '请在工作流全局配置中选择 Midscene 模型' });
    }

    for (const node of flow.nodeList) {
      if (node.disabled) continue;

      if (!node.nodeType) {
        errors.push({ nodeId: node.nodeId, message: '节点类型不能为空' });
      }

      if (node.nodeType === 'navigate') {
        const url = (node.nodeParams as { url?: string }).url;
        if (!url) {
          errors.push({ nodeId: node.nodeId, message: '打开页面节点缺少 URL' });
        }
      }

      if (node.nodeType === 'aiTap' || node.nodeType === 'aiInput') {
        const locate = (node.nodeParams as { locate?: string }).locate;
        if (!locate) {
          errors.push({ nodeId: node.nodeId, message: `${node.nodeName} 缺少定位描述` });
        }
      }

      if (node.nodeType === 'if' || node.nodeType === 'loop') {
        const expr = (node.nodeParams as { expr?: string }).expr;
        if (!expr) {
          errors.push({ nodeId: node.nodeId, message: `${node.nodeName} 缺少条件表达式` });
        }
      }

      for (const route of node.nextNodes) {
        if (!nodeMap.has(route.nodeId)) {
          errors.push({ nodeId: node.nodeId, message: `引用了不存在的下游节点 ${route.nodeId}` });
        }
      }
    }

    return { success: true, data: { valid: errors.length === 0, errors } };
  }

  private pushEvent(payload: RuntimeEventPayload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send(IPC_CHANNEL.RUNTIME_EVENT, {
      channel: IPC_CHANNEL.RUNTIME_EVENT,
      payload,
      timestamp: Date.now(),
    });
  }

  private resolveFlowModelConfig(flow: FlowSchema): FlowSchema {
    const models = getStore().get('models') || [];
    const defaultIds = getStore().get('defaultModelIds') || {};
    const midsceneConfig = (defaultIds as any).executionEngines?.midscene || {};
    const modelId = flow.aiGlobalConfig.modelId || midsceneConfig.defaultModelId;
    const model = modelId
      ? (models as ModelProfile[]).find((m) => m.id === modelId && m.enabled && m.tags.includes('multimodal'))
      : undefined;

    if (!model) return flow;

    return {
      ...flow,
      aiGlobalConfig: {
        ...flow.aiGlobalConfig,
        modelName: model.modelId || flow.aiGlobalConfig.modelName,
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        timeout: model.timeout ?? flow.aiGlobalConfig.timeout,
        defaultDeepThink: model.reasoningEnabled ?? flow.aiGlobalConfig.defaultDeepThink,
        cacheable: model.cacheable ?? flow.aiGlobalConfig.cacheable,
      },
    };
  }
}
