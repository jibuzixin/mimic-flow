import { v4 as uuidv4 } from 'uuid';
import type {
  FlowSchema,
  FlowNode,
  FlowNodeType,
  FlowMeta,
  DeviceConfig,
  AiGlobalConfig,
  GlobalVarItem,
} from '../../types/flow.js';

export const NODE_TYPE_META: Record<
  FlowNodeType,
  { label: string; color: string; description: string; defaultName: string }
> = {
  navigate: {
    label: '打开页面',
    color: 'bg-sky-100 text-sky-700 border-sky-200',
    description: '导航到指定 URL',
    defaultName: '打开页面',
  },
  aiTap: {
    label: 'AI 点击',
    color: 'bg-violet-100 text-violet-700 border-violet-200',
    description: '点击页面元素',
    defaultName: 'AI 点击',
  },
  aiInput: {
    label: 'AI 输入',
    color: 'bg-violet-100 text-violet-700 border-violet-200',
    description: '在输入框中填入文本',
    defaultName: 'AI 输入',
  },
  aiQuery: {
    label: 'AI 查询',
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    description: '从页面提取结构化数据',
    defaultName: 'AI 查询',
  },
  aiAssert: {
    label: 'AI 断言',
    color: 'bg-rose-100 text-rose-700 border-rose-200',
    description: '验证页面状态',
    defaultName: 'AI 断言',
  },
  sleep: {
    label: '等待',
    color: 'bg-slate-100 text-slate-700 border-slate-200',
    description: '暂停指定毫秒',
    defaultName: '等待',
  },
  if: {
    label: '条件分支',
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    description: '根据表达式选择分支',
    defaultName: '条件判断',
  },
  loop: {
    label: '循环',
    color: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    description: '按条件重复执行',
    defaultName: '循环',
  },
};

const DEFAULT_FLOW_META: FlowMeta = {
  name: '未命名流程',
  desc: '',
  tags: [],
  triggerType: 'manual',
  globalTimeout: 300000,
  globalRetry: 0,
  failStrategy: 'terminate',
  version: '1.0.0',
};

const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  type: 'web',
  url: 'https://www.google.com',
  viewport: { width: 1280, height: 800 },
};

const DEFAULT_AI_CONFIG: AiGlobalConfig = {
  modelName: '',
  apiKey: '',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  actionContext: '',
  defaultDeepThink: false,
  cacheable: true,
  timeout: 60000,
};

export function createEmptyFlow(): FlowSchema {
  return {
    flowId: uuidv4(),
    flowMeta: { ...DEFAULT_FLOW_META },
    deviceConfig: { ...DEFAULT_DEVICE_CONFIG },
    aiGlobalConfig: { ...DEFAULT_AI_CONFIG },
    globalVars: [],
    nodeList: [],
  };
}

export function createNode(type: FlowNodeType, overrides?: Partial<FlowNode>): FlowNode {
  const meta = NODE_TYPE_META[type];
  const base: FlowNode = {
    nodeId: uuidv4(),
    nodeType: type,
    nodeName: meta.defaultName,
    timeout: 300000,
    retryCount: 0,
    failStrategy: 'terminate',
    nextNodes: [],
    nodeParams: {},
    comment: '',
    disabled: false,
  };

  switch (type) {
    case 'navigate':
      base.nodeParams = { url: '' };
      break;
    case 'aiTap':
      base.nodeParams = { locate: '' };
      break;
    case 'aiInput':
      base.nodeParams = { locate: '', text: '' };
      break;
    case 'aiQuery':
      base.nodeParams = { dataDemand: '', schemaDesc: '' };
      break;
    case 'aiAssert':
      base.nodeParams = { assertion: '' };
      break;
    case 'sleep':
      base.nodeParams = { duration: 1000 };
      break;
    case 'if':
      base.nodeParams = { expr: '', trueNodeId: '', falseNodeId: '' };
      break;
    case 'loop':
      base.nodeParams = { expr: '', maxIteration: 10, bodyNodeId: '', exitNodeId: '', loopBackNodeId: '' };
      break;
  }

  return { ...base, ...overrides };
}

export function rebuildNextNodes(flow: FlowSchema): FlowSchema {
  const nodes = flow.nodeList.map((n) => ({ ...n, nextNodes: [...n.nextNodes] }));
  const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));

  // 默认线性连接
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const next = nodes[i + 1];
    if (next && !['if', 'loop'].includes(node.nodeType)) {
      node.nextNodes = [{ nodeId: next.nodeId }];
    } else if (!['if', 'loop'].includes(node.nodeType)) {
      node.nextNodes = [];
    }
  }

  // 控制节点使用配置面板中的分支目标
  for (const node of nodes) {
    if (node.nodeType === 'if') {
      const { expr = '', trueNodeId = '', falseNodeId = '' } = node.nodeParams as {
        expr?: string;
        trueNodeId?: string;
        falseNodeId?: string;
      };
      const routes: FlowNode['nextNodes'] = [];
      if (trueNodeId && nodeMap.has(trueNodeId)) {
        routes.push({ nodeId: trueNodeId, condition: expr });
      }
      if (falseNodeId && nodeMap.has(falseNodeId)) {
        routes.push({ nodeId: falseNodeId });
      }
      node.nextNodes = routes;
    }

    if (node.nodeType === 'loop') {
      const { expr = '', maxIteration = 10, bodyNodeId = '', exitNodeId = '', loopBackNodeId = '' } = node.nodeParams as {
        expr?: string;
        maxIteration?: number;
        bodyNodeId?: string;
        exitNodeId?: string;
        loopBackNodeId?: string;
      };
      node.nodeParams = { expr, maxIteration, bodyNodeId, exitNodeId, loopBackNodeId };
      const routes: FlowNode['nextNodes'] = [];
      if (bodyNodeId && nodeMap.has(bodyNodeId)) {
        routes.push({ nodeId: bodyNodeId, condition: expr });
      }
      if (exitNodeId && nodeMap.has(exitNodeId)) {
        routes.push({ nodeId: exitNodeId });
      }
      node.nextNodes = routes;

      // 循环体结束节点回连到循环节点
      if (loopBackNodeId && nodeMap.has(loopBackNodeId)) {
        const backNode = nodeMap.get(loopBackNodeId)!;
        backNode.nextNodes = [{ nodeId: node.nodeId }];
      }
    }
  }

  return { ...flow, nodeList: nodes };
}

export function addNode(flow: FlowSchema, type: FlowNodeType, index?: number): FlowSchema {
  const node = createNode(type);
  const nodes = [...flow.nodeList];
  const insertAt = index ?? nodes.length;
  nodes.splice(insertAt, 0, node);
  return rebuildNextNodes({ ...flow, nodeList: nodes });
}

export function removeNode(flow: FlowSchema, nodeId: string): FlowSchema {
  const nodes = flow.nodeList.filter((n) => n.nodeId !== nodeId);
  return rebuildNextNodes({ ...flow, nodeList: nodes });
}

export function moveNode(flow: FlowSchema, fromIndex: number, toIndex: number): FlowSchema {
  const nodes = [...flow.nodeList];
  const [moved] = nodes.splice(fromIndex, 1);
  nodes.splice(toIndex, 0, moved);
  return rebuildNextNodes({ ...flow, nodeList: nodes });
}

export function updateNode(flow: FlowSchema, nodeId: string, patch: Partial<FlowNode>): FlowSchema {
  const nodes = flow.nodeList.map((n) => (n.nodeId === nodeId ? { ...n, ...patch } : n));
  return rebuildNextNodes({ ...flow, nodeList: nodes });
}

export function updateFlowMeta(flow: FlowSchema, patch: Partial<FlowMeta>): FlowSchema {
  return { ...flow, flowMeta: { ...flow.flowMeta, ...patch } };
}

export function updateDeviceConfig(flow: FlowSchema, patch: Partial<DeviceConfig>): FlowSchema {
  return { ...flow, deviceConfig: { ...flow.deviceConfig, ...patch } };
}

export function updateAiConfig(flow: FlowSchema, patch: Partial<AiGlobalConfig>): FlowSchema {
  return { ...flow, aiGlobalConfig: { ...flow.aiGlobalConfig, ...patch } };
}

export function addGlobalVar(flow: FlowSchema, item?: Partial<GlobalVarItem>): FlowSchema {
  const newVar: GlobalVarItem = {
    key: '',
    value: '',
    encrypt: false,
    comment: '',
    ...item,
  };
  return { ...flow, globalVars: [...flow.globalVars, newVar] };
}

export function updateGlobalVar(flow: FlowSchema, index: number, patch: Partial<GlobalVarItem>): FlowSchema {
  const vars = [...flow.globalVars];
  vars[index] = { ...vars[index], ...patch };
  return { ...flow, globalVars: vars };
}

export function removeGlobalVar(flow: FlowSchema, index: number): FlowSchema {
  const vars = [...flow.globalVars];
  vars.splice(index, 1);
  return { ...flow, globalVars: vars };
}

export function getDefaultBranchTargets(flow: FlowSchema, node: FlowNode): { trueNodeId?: string; falseNodeId?: string; bodyNodeId?: string; exitNodeId?: string } {
  const result: ReturnType<typeof getDefaultBranchTargets> = {};
  const nodes = flow.nodeList;
  const idx = nodes.findIndex((n) => n.nodeId === node.nodeId);

  if (node.nodeType === 'if') {
    const trueRoute = node.nextNodes.find((r) => r.condition);
    const falseRoute = node.nextNodes.find((r) => !r.condition);
    result.trueNodeId = trueRoute?.nodeId;
    result.falseNodeId = falseRoute?.nodeId;
    if (!result.trueNodeId && idx >= 0 && idx < nodes.length - 1) {
      result.trueNodeId = nodes[idx + 1].nodeId;
    }
    if (!result.falseNodeId && idx >= 0 && idx < nodes.length - 2) {
      result.falseNodeId = nodes[idx + 2]?.nodeId;
    }
  }

  if (node.nodeType === 'loop') {
    const bodyRoute = node.nextNodes.find((r) => r.condition);
    const exitRoute = node.nextNodes.find((r) => !r.condition);
    result.bodyNodeId = bodyRoute?.nodeId;
    result.exitNodeId = exitRoute?.nodeId;
    if (!result.bodyNodeId && idx >= 0 && idx < nodes.length - 1) {
      result.bodyNodeId = nodes[idx + 1].nodeId;
    }
    if (!result.exitNodeId && idx >= 0 && idx < nodes.length - 2) {
      result.exitNodeId = nodes[idx + 2]?.nodeId;
    }
  }

  return result;
}
