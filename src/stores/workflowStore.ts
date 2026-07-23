import { create } from 'zustand';
import type { Edge } from '@xyflow/react';
import type { FlowSchema, RuntimeEvent, FlowNode, FlowNodeType } from '../../types/flow-v2';
import { getNodeConfig } from '../components/editor/nodeConfigs';

const STORAGE_KEY = 'mimic-flow-workflow-state';
const DRAFT_KEY = 'mimic-flow-draft-workflow';
const WORKFLOWS_KEY = 'mimic-flow-workflows';
const RECENT_NODES_KEY = 'mimic-flow-recent-nodes';
const PINNED_NODES_KEY = 'mimic-flow-pinned-nodes';

const MAX_RECENT_NODES = 3;
const MAX_PINNED_NODES = 10;
const MAX_HISTORY_STEPS = 50;

let eventUnsubscribe: (() => void) | null = null;

const CARD_GRADIENTS = [
  'from-violet-400 to-fuchsia-400',
  'from-sky-400 to-cyan-400',
  'from-amber-400 to-orange-400',
  'from-emerald-400 to-teal-400',
  'from-rose-400 to-pink-400',
  'from-indigo-400 to-blue-400',
];

function getRandomGradient(): string {
  return CARD_GRADIENTS[Math.floor(Math.random() * CARD_GRADIENTS.length)];
}

export interface WorkflowRecord {
  id: string;
  workflow: FlowSchema;
  nodePositions: Record<string, { x: number; y: number }>;
  edges: Edge[];
  createdAt: number;
  updatedAt: number;
  bgGradient: string;
  bgImage?: string;
}

interface HistoryState {
  workflow: FlowSchema;
  nodePositions: Record<string, { x: number; y: number }>;
  edges: Edge[];
}

interface WorkflowState {
  workflows: WorkflowRecord[];
  currentWorkflow: FlowSchema | null;
  originalWorkflowId: string | null;
  isDirty: boolean;
  selectedNodeId: string | null;
  isRunning: boolean;
  isPaused: boolean;
  currentRunningNodeId: string | null;
  nodeExecutionStatus: Record<string, 'idle' | 'running' | 'success' | 'error'>;
  nodeErrors: Record<string, string>;
  executionLogs: Array<{
    id: string;
    timestamp: number;
    type: 'info' | 'success' | 'error' | 'node-start' | 'node-success' | 'node-error';
    nodeId?: string;
    nodeName?: string;
    message: string;
  }>;
  nodePositions: Record<string, { x: number; y: number }>;
  edges: Edge[];
  initialized: boolean;
  recentNodeTypes: string[];
  pinnedNodeTypes: string[];

  history: HistoryState[];
  historyIndex: number;

  setWorkflow: (wf: FlowSchema) => void;
  setSelectedNode: (id: string | null) => void;
  addNode: (type: string, position?: { x: number; y: number }) => void;
  updateNode: (nodeId: string, updates: Partial<FlowNode>) => void;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>) => void;
  deleteNode: (nodeId: string) => void;
  updateWorkflowMeta: (updates: Partial<{ name: string; desc: string }>) => void;
  addGlobalVar: (name: string, value: unknown) => void;
  updateGlobalVar: (name: string, value: unknown) => void;
  deleteGlobalVar: (name: string) => void;
  setRunning: (running: boolean) => void;
  startExecution: () => void;
  stopExecution: () => void;
  pauseExecution: () => void;
  resumeExecution: () => void;
  clearExecutionState: () => void;
  addExecutionLog: (log: Omit<{ id: string; timestamp: number; type: string; nodeId?: string; nodeName?: string; message: string }, 'id' | 'timestamp'>) => void;

  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setEdges: (edges: Edge[]) => void;
  addEdge: (edge: Edge) => void;
  removeEdge: (edgeId: string) => void;
  syncNextNodesFromEdges: () => void;

  pinNode: (nodeType: string) => void;
  unpinNode: (nodeType: string) => void;
  isNodePinned: (nodeType: string) => boolean;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearCanvas: () => void;
  pushHistory: () => void;

  createWorkflow: (name?: string) => string;
  openWorkflow: (id: string) => void;
  saveCurrentWorkflow: () => void;
  saveAsNewWorkflow: (name?: string) => string;
  deleteWorkflow: (id: string) => void;
  duplicateWorkflow: (id: string) => string;
  renameWorkflow: (id: string, name: string) => void;
  setWorkflowGradient: (id: string, gradient: string) => void;
  setWorkflowBgImage: (id: string, imageDataUrl: string | null) => void;
  createNewCanvas: () => void;
  loadWorkflowToCanvas: (id: string) => void;
  importToCanvas: (workflow: FlowSchema) => void;
  hasUnsavedChanges: () => boolean;

  exportWorkflow: (id: string, hideSensitive?: boolean) => FlowSchema;
  exportCurrentWorkflow: (hideSensitive?: boolean) => FlowSchema;
  importWorkflow: (workflow: FlowSchema) => string;

  saveWorkflowsToStorage: () => void;
  saveDraftToStorage: () => void;
  loadDraftFromStorage: () => void;

  loadFromStorage: () => void;
  saveToStorage: () => void;

  createEmptyWorkflow: (name?: string) => FlowSchema;
}

let nodeCounter = 0;
const genNodeId = () => `node-${++nodeCounter}`;

const generateDefaultWorkflowName = () => {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `新建工作流 ${dateStr} ${timeStr}`;
};

const generateEdgesFromWorkflow = (wf: FlowSchema): Edge[] => {
  const edges: Edge[] = [];
  wf.nodes.forEach((node) => {
    node.nextNodes?.forEach((next, idx) => {
      edges.push({
        id: `${node.id}-${next.nodeId}-${idx}`,
        source: node.id,
        target: next.nodeId,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'custom',
      });
    });
  });
  return edges;
};

const generateDefaultPositions = (wf: FlowSchema): Record<string, { x: number; y: number }> => {
  const positions: Record<string, { x: number; y: number }> = {};
  wf.nodes.forEach((node, index) => {
    positions[node.id] = { x: 100, y: index * 120 };
  });
  return positions;
};

const cloneHistoryState = (wf: FlowSchema | null, positions: Record<string, { x: number; y: number }>, edges: Edge[]): HistoryState | null => {
  if (!wf) return null;
  return {
    workflow: JSON.parse(JSON.stringify(wf)),
    nodePositions: { ...positions },
    edges: JSON.parse(JSON.stringify(edges)),
  };
};

const maskSensitiveData = (workflow: FlowSchema): FlowSchema => {
  const sensitiveKeywords = ['password', 'apikey', 'api_key', 'secret', 'token'];
  const masked = JSON.parse(JSON.stringify(workflow)) as FlowSchema;
  
  masked.nodes = masked.nodes.map((node) => {
    const config = getNodeConfig(node.nodeType);
    
    const sensitiveKeys = new Set<string>();
    if (config) {
      config.propertyFields.forEach((field) => {
        if (field.sensitive) {
          sensitiveKeys.add(field.key);
        }
      });
    }
    
    const maskedParams: Record<string, unknown> = {};
    Object.entries(node.nodeParams).forEach(([key, value]) => {
      const isMarkedSensitive = sensitiveKeys.has(key);
      const isKeywordSensitive = sensitiveKeywords.some(
        (kw) => key.toLowerCase().includes(kw.toLowerCase())
      );
      if ((isMarkedSensitive || isKeywordSensitive) && typeof value === 'string' && value.length > 0) {
        maskedParams[key] = '******';
      } else {
        maskedParams[key] = value;
      }
    });
    
    return { ...node, nodeParams: maskedParams };
  });
  
  return masked;
};

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  originalWorkflowId: null,
  isDirty: false,
  selectedNodeId: null,
  isRunning: false,
  isPaused: false,
  currentRunningNodeId: null,
  nodeExecutionStatus: {},
  nodeErrors: {},
  executionLogs: [],
  nodePositions: {},
  edges: [],
  initialized: false,
  recentNodeTypes: [],
  pinnedNodeTypes: [],
  history: [],
  historyIndex: -1,

  setWorkflow: (wf) => {
    set({ currentWorkflow: wf });

    let maxNum = 0;
    wf.nodes.forEach((n) => {
      const match = n.id.match(/node-(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > maxNum) maxNum = num;
      }
    });
    if (maxNum > nodeCounter) nodeCounter = maxNum;

    const state = get();
    if (state.edges.length === 0) {
      set({ edges: generateEdgesFromWorkflow(wf) });
    }
    if (Object.keys(state.nodePositions).length === 0) {
      set({ nodePositions: generateDefaultPositions(wf) });
    }
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  pushHistory: () => {
    const state = get();
    const snapshot = cloneHistoryState(state.currentWorkflow, state.nodePositions, state.edges);
    if (!snapshot) return;

    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(snapshot);
    
    if (newHistory.length > MAX_HISTORY_STEPS) {
      newHistory.shift();
    } else {
      set({ historyIndex: state.historyIndex + 1 });
    }
    
    set({ history: newHistory });
  },

  addNode: (type, position) => {
    const config = getNodeConfig(type);
    if (!config) return;

    const wf = get().currentWorkflow;
    if (!wf) return;

    const newNode: FlowNode = {
      id: genNodeId(),
      nodeType: type as FlowNodeType,
      nodeName: config.name,
      nodeParams: { ...config.defaultParams },
      nextNodes: [],
    };

    const nodeCount = wf.nodes.length;
    const newPosition = position || { x: 100, y: nodeCount * 120 };

    set({
      currentWorkflow: {
        ...wf,
        nodes: [...wf.nodes, newNode],
      },
      selectedNodeId: newNode.id,
      nodePositions: {
        ...get().nodePositions,
        [newNode.id]: newPosition,
      },
      isDirty: true,
    });

    const recent = get().recentNodeTypes.filter((t) => t !== type);
    recent.unshift(type);
    const trimmed = recent.slice(0, MAX_RECENT_NODES);
    set({ recentNodeTypes: trimmed });
    try {
      localStorage.setItem(RECENT_NODES_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Failed to save recent nodes:', e);
    }

    get().pushHistory();
  },

  updateNode: (nodeId, updates) => {
    const wf = get().currentWorkflow;
    if (!wf) return;

    set({
      currentWorkflow: {
        ...wf,
        nodes: wf.nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
      },
      isDirty: true,
    });

    get().pushHistory();
  },

  updateNodeParams: (nodeId, params) => {
    const wf = get().currentWorkflow;
    if (!wf) return;

    set({
      currentWorkflow: {
        ...wf,
        nodes: wf.nodes.map((n) =>
          n.id === nodeId ? { ...n, nodeParams: { ...n.nodeParams, ...params } } : n,
        ),
      },
      isDirty: true,
    });

    get().pushHistory();
  },

  deleteNode: (nodeId) => {
    const wf = get().currentWorkflow;
    if (!wf) return;

    const { [nodeId]: _, ...restPositions } = get().nodePositions;

    set({
      currentWorkflow: {
        ...wf,
        nodes: wf.nodes.filter((n) => n.id !== nodeId),
      },
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
      nodePositions: restPositions,
      edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      isDirty: true,
    });

    get().pushHistory();
  },

  updateWorkflowMeta: (updates) => {
    const wf = get().currentWorkflow;
    if (!wf) return;

    set({
      currentWorkflow: {
        ...wf,
        flowMeta: {
          ...wf.flowMeta,
          ...updates,
        },
      },
      isDirty: true,
    });

    get().pushHistory();
  },

  addGlobalVar: (name, value) => {
    const wf = get().currentWorkflow;
    if (!wf) return;

    set({
      currentWorkflow: {
        ...wf,
        globalVars: { ...wf.globalVars, [name]: value },
      },
      isDirty: true,
    });

    get().pushHistory();
  },

  updateGlobalVar: (name, value) => {
    get().addGlobalVar(name, value);
  },

  deleteGlobalVar: (name) => {
    const wf = get().currentWorkflow;
    if (!wf) return;

    const { [name]: _, ...rest } = wf.globalVars;
    set({
      currentWorkflow: {
        ...wf,
        globalVars: rest,
      },
      isDirty: true,
    });

    get().pushHistory();
  },

  setRunning: (running) => set({ isRunning: running }),

  clearExecutionState: () => {
    set({
      isRunning: false,
      isPaused: false,
      currentRunningNodeId: null,
      nodeExecutionStatus: {},
      nodeErrors: {},
      executionLogs: [],
    });
  },

  addExecutionLog: (log) => {
    const newLog = {
      ...log,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    } as WorkflowState['executionLogs'][0];
    set({
      executionLogs: [...get().executionLogs, newLog],
    });
  },

  startExecution: async () => {
    const state = get();
    if (!state.currentWorkflow || state.isRunning) return;

    const initialStatus: Record<string, 'idle' | 'running' | 'success' | 'error'> = {};
    state.currentWorkflow.nodes.forEach((n) => {
      initialStatus[n.id] = 'idle';
    });

    set({
      isRunning: true,
      isPaused: false,
      currentRunningNodeId: null,
      nodeExecutionStatus: initialStatus,
      nodeErrors: {},
      executionLogs: [],
    });

    get().addExecutionLog({
      type: 'info',
      message: '🚀 工作流开始执行',
    });

    const startNode = state.currentWorkflow.nodes.find((n) => n.nodeType === 'control.start');
    if (!startNode) {
      get().addExecutionLog({
        type: 'error',
        message: '❌ 找不到开始节点',
      });
      set({ isRunning: false });
      return;
    }

    if (!window.mimic) {
      get().addExecutionLog({
        type: 'error',
        message: '❌ 调度层不可用（浏览器模式）',
      });
      set({ isRunning: false });
      return;
    }

    if (eventUnsubscribe) {
      eventUnsubscribe();
    }

    eventUnsubscribe = window.mimic.on('flow-v2:event', (event) => {
      const runtimeEvent = event as RuntimeEvent;
      switch (runtimeEvent.type) {
        case 'node:start': {
          const { nodeId, nodeType, nodeName } = runtimeEvent;
          set({
            currentRunningNodeId: nodeId,
            nodeExecutionStatus: {
              ...get().nodeExecutionStatus,
              [nodeId]: 'running',
            },
          });
          get().addExecutionLog({
            type: 'node-start',
            nodeId,
            nodeName: nodeName || nodeType,
            message: `▶️ 开始执行: ${nodeName || nodeType}`,
          });
          break;
        }
        case 'node:complete': {
          const { nodeId, duration, output } = runtimeEvent;
          const newErrors = { ...get().nodeErrors };
          delete newErrors[nodeId];
          set({
            nodeExecutionStatus: {
              ...get().nodeExecutionStatus,
              [nodeId]: 'success',
            },
            nodeErrors: newErrors,
          });
          const status = get();
          const node = status.currentWorkflow?.nodes.find((n: FlowNode) => n.id === nodeId);
          const nodeName = node?.nodeName || node?.nodeType || nodeId;
          const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : '';
          get().addExecutionLog({
            type: 'node-success',
            nodeId,
            nodeName,
            message: `✅ 执行成功: ${nodeName}${durationStr}`,
          });
          if (output) {
            get().addExecutionLog({
              type: 'info',
              message: `📤 输出: ${JSON.stringify(output)}`,
            });
          }
          break;
        }
        case 'node:error': {
          const { nodeId, error, willRetry } = runtimeEvent;
          set({
            nodeExecutionStatus: {
              ...get().nodeExecutionStatus,
              [nodeId]: 'error',
            },
            nodeErrors: {
              ...get().nodeErrors,
              [nodeId]: error,
            },
          });
          const status = get();
          const node = status.currentWorkflow?.nodes.find((n: FlowNode) => n.id === nodeId);
          const nodeName = node?.nodeName || node?.nodeType || nodeId;
          get().addExecutionLog({
            type: 'node-error',
            nodeId,
            nodeName,
            message: `❌ 执行失败: ${nodeName} - ${error}${willRetry ? ' (将重试)' : ''}`,
          });
          break;
        }
        case 'flow:complete': {
          const { status: flowStatus, duration, reportPath } = runtimeEvent;
          set({
            isRunning: false,
            currentRunningNodeId: null,
          });
          const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : '';
          if (flowStatus === 'success') {
            get().addExecutionLog({
              type: 'success',
              message: `🎉 工作流执行完成${durationStr}`,
            });
          } else if (flowStatus === 'failed') {
            get().addExecutionLog({
              type: 'error',
              message: `💥 工作流执行失败${durationStr}`,
            });
          } else if (flowStatus === 'stopped') {
            get().addExecutionLog({
              type: 'info',
              message: `⏹️ 工作流已停止${durationStr}`,
            });
          }
          if (reportPath) {
            get().addExecutionLog({
              type: 'info',
              message: `📄 报告路径: ${reportPath}`,
            });
          }
          if (eventUnsubscribe) {
            eventUnsubscribe();
            eventUnsubscribe = null;
          }
          break;
        }
        case 'flow:start': {
          get().addExecutionLog({
            type: 'info',
            message: `🚀 工作流 ${runtimeEvent.flowId} 开始执行`,
          });
          break;
        }
        case 'log': {
          const { entry } = runtimeEvent;
          const levelMap: Record<string, string> = {
            debug: 'info',
            info: 'info',
            warn: 'info',
            error: 'error',
          };
          get().addExecutionLog({
            type: levelMap[entry.level] || 'info',
            nodeId: entry.nodeId,
            message: `[${entry.source}] ${entry.message}${entry.data ? ` - ${JSON.stringify(entry.data)}` : ''}`,
          });
          break;
        }
        case 'screenshot': {
          const { nodeId, dataUrl } = runtimeEvent;
          get().addExecutionLog({
            type: 'info',
            nodeId,
            message: `📷 截图已保存${nodeId ? ` (节点: ${nodeId})` : ''}`,
          });
          break;
        }
        default:
          console.log('[RuntimeEvent] Unhandled event:', runtimeEvent);
      }
    });

    try {
      const result = await window.mimic.invoke('flow-v2:run', state.currentWorkflow);
      if (!result || !(result as any).success) {
        const errorMessage = (result as any)?.error || '启动工作流失败';
        get().addExecutionLog({
          type: 'error',
          message: `❌ ${errorMessage}`,
        });
        set({ isRunning: false });
        if (eventUnsubscribe) {
          eventUnsubscribe();
          eventUnsubscribe = null;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      get().addExecutionLog({
        type: 'error',
        message: `❌ 启动工作流出错: ${message}`,
      });
      set({ isRunning: false });
      if (eventUnsubscribe) {
        eventUnsubscribe();
        eventUnsubscribe = null;
      }
    }
  },

  stopExecution: async () => {
    if (!window.mimic) {
      set({
        isRunning: false,
        isPaused: false,
        currentRunningNodeId: null,
      });
      get().addExecutionLog({
        type: 'info',
        message: '⏹️ 工作流已停止（浏览器模式）',
      });
      return;
    }

    try {
      await window.mimic.invoke('flow-v2:stop');
    } catch (error) {
      console.error('[IPC] stopExecution error:', error);
    }

    if (eventUnsubscribe) {
      eventUnsubscribe();
      eventUnsubscribe = null;
    }
  },

  pauseExecution: () => {
    set({ isPaused: true });
    get().addExecutionLog({
      type: 'info',
      message: '⏸️ 工作流已暂停',
    });
  },

  resumeExecution: () => {
    set({ isPaused: false });
    get().addExecutionLog({
      type: 'info',
      message: '▶️ 工作流继续执行',
    });
  },

  setNodePosition: (nodeId, position) => {
    set({
      nodePositions: {
        ...get().nodePositions,
        [nodeId]: position,
      },
    });
  },

  setEdges: (edges) => {
    set({ edges });
  },

  addEdge: (edge) => {
    set({
      edges: [...get().edges, edge],
      isDirty: true,
    });
    get().pushHistory();
  },

  removeEdge: (edgeId) => {
    set({
      edges: get().edges.filter((e) => e.id !== edgeId),
      isDirty: true,
    });
    get().pushHistory();
  },

  syncNextNodesFromEdges: () => {
    const state = get();
    if (!state.currentWorkflow) return;

    const nextNodesMap: Record<string, { nodeId: string; condition?: string }[]> = {};
    state.edges.forEach((e) => {
      if (!nextNodesMap[e.source]) {
        nextNodesMap[e.source] = [];
      }
      const condition = e.sourceHandle && e.sourceHandle !== 'out' ? e.sourceHandle : undefined;
      nextNodesMap[e.source].push({
        nodeId: e.target,
        condition,
      });
    });

    const updatedNodes = state.currentWorkflow.nodes.map((node) => ({
      ...node,
      nextNodes: nextNodesMap[node.id] || [],
    }));

    set({
      currentWorkflow: {
        ...state.currentWorkflow,
        nodes: updatedNodes,
      },
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;

    const prevIndex = state.historyIndex - 1;
    const prevState = state.history[prevIndex];
    if (!prevState) return;

    nodeCounter = 0;
    prevState.workflow.nodes.forEach((n) => {
      const match = n.id.match(/node-(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > nodeCounter) nodeCounter = num;
      }
    });

    set({
      currentWorkflow: prevState.workflow,
      nodePositions: prevState.nodePositions,
      edges: prevState.edges,
      historyIndex: prevIndex,
      isDirty: true,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;

    const nextIndex = state.historyIndex + 1;
    const nextState = state.history[nextIndex];
    if (!nextState) return;

    nodeCounter = 0;
    nextState.workflow.nodes.forEach((n) => {
      const match = n.id.match(/node-(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > nodeCounter) nodeCounter = num;
      }
    });

    set({
      currentWorkflow: nextState.workflow,
      nodePositions: nextState.nodePositions,
      edges: nextState.edges,
      historyIndex: nextIndex,
      isDirty: true,
    });
  },

  canUndo: () => {
    return get().historyIndex > 0;
  },

  canRedo: () => {
    return get().historyIndex < get().history.length - 1;
  },

  clearCanvas: () => {
    if (!confirm('确定要清空画布吗？此操作可以撤销。')) return;
    
    const emptyWf = get().createEmptyWorkflow('未命名工作流');
    const positions = generateDefaultPositions(emptyWf);
    const edges = generateEdgesFromWorkflow(emptyWf);

    nodeCounter = 0;

    set({
      currentWorkflow: emptyWf,
      nodePositions: positions,
      edges: edges,
      selectedNodeId: null,
      isDirty: true,
    });

    get().pushHistory();
  },

  loadFromStorage: () => {
    let workflows: WorkflowRecord[] = [];

    try {
      const saved = localStorage.getItem(WORKFLOWS_KEY);
      if (saved) {
        workflows = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load workflows from storage:', e);
    }

    if (workflows.length === 0) {
      try {
        const oldSaved = localStorage.getItem(STORAGE_KEY);
        if (oldSaved) {
          const data = JSON.parse(oldSaved);
          if (data.workflow) {
            const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const now = Date.now();
            const savedEdges = data.edges || [];
            const edgesWithType = savedEdges.map((e: Edge) => ({
              ...e,
              type: e.type || 'custom',
              sourceHandle: e.sourceHandle || 'out',
              targetHandle: e.targetHandle || 'in',
            }));

            workflows = [
              {
                id,
                workflow: data.workflow,
                nodePositions: data.nodePositions || generateDefaultPositions(data.workflow),
                edges: edgesWithType.length > 0 ? edgesWithType : generateEdgesFromWorkflow(data.workflow),
                createdAt: now,
                updatedAt: now,
                bgGradient: getRandomGradient(),
              },
            ];
          }
        }
      } catch (e) {
        console.warn('Failed to migrate old workflow data:', e);
      }
    }

    set({
      workflows,
      initialized: true,
    });

    get().loadDraftFromStorage();

    try {
      const recentSaved = localStorage.getItem(RECENT_NODES_KEY);
      if (recentSaved) {
        set({ recentNodeTypes: JSON.parse(recentSaved) });
      }
      const pinnedSaved = localStorage.getItem(PINNED_NODES_KEY);
      if (pinnedSaved) {
        set({ pinnedNodeTypes: JSON.parse(pinnedSaved) });
      }
    } catch (e) {
      console.warn('Failed to load node preferences:', e);
    }
  },

  loadDraftFromStorage: () => {
    try {
      const draftStr = localStorage.getItem(DRAFT_KEY);
      if (draftStr) {
        const draft = JSON.parse(draftStr);
        if (draft.workflow) {
          nodeCounter = 0;
          draft.workflow.nodes.forEach((n: FlowNode) => {
            const match = n.id.match(/node-(\d+)/);
            if (match) {
              const num = parseInt(match[1]);
              if (num > nodeCounter) nodeCounter = num;
            }
          });

          const edgesWithType = (draft.edges || []).map((e: Edge) => ({
            ...e,
            type: e.type || 'custom',
            sourceHandle: e.sourceHandle || 'out',
            targetHandle: e.targetHandle || 'in',
          }));

          const initialHistory: HistoryState[] = [{
            workflow: draft.workflow,
            nodePositions: draft.nodePositions || {},
            edges: edgesWithType,
          }];

          set({
            currentWorkflow: draft.workflow,
            originalWorkflowId: draft.originalWorkflowId || null,
            isDirty: draft.isDirty || false,
            nodePositions: draft.nodePositions || {},
            edges: edgesWithType,
            history: initialHistory,
            historyIndex: 0,
            selectedNodeId: null,
          });
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to load draft from storage:', e);
    }

    get().createNewCanvas();
  },

  saveToStorage: () => {
    get().saveDraftToStorage();
  },

  saveDraftToStorage: () => {
    const state = get();
    if (!state.currentWorkflow || !state.initialized) return;

    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          workflow: state.currentWorkflow,
          nodePositions: state.nodePositions,
          edges: state.edges,
          originalWorkflowId: state.originalWorkflowId,
          isDirty: state.isDirty,
        })
      );
    } catch (e) {
      console.warn('Failed to save draft to storage:', e);
    }
  },

  pinNode: (nodeType) => {
    const pinned = get().pinnedNodeTypes;
    if (pinned.includes(nodeType)) return;
    if (pinned.length >= MAX_PINNED_NODES) {
      console.warn('已达到最大固定节点数');
      return;
    }
    const next = [...pinned, nodeType];
    set({ pinnedNodeTypes: next });
    try {
      localStorage.setItem(PINNED_NODES_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Failed to save pinned nodes:', e);
    }
  },

  unpinNode: (nodeType) => {
    const next = get().pinnedNodeTypes.filter((t) => t !== nodeType);
    set({ pinnedNodeTypes: next });
    try {
      localStorage.setItem(PINNED_NODES_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Failed to save pinned nodes:', e);
    }
  },

  isNodePinned: (nodeType) => {
    return get().pinnedNodeTypes.includes(nodeType);
  },

  // ==================== 多工作流管理 ====================

  createWorkflow: (name = '新建工作流') => {
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const workflow = get().createEmptyWorkflow(name);
    const nodePositions = generateDefaultPositions(workflow);
    const edges = generateEdgesFromWorkflow(workflow);

    const record: WorkflowRecord = {
      id,
      workflow,
      nodePositions,
      edges,
      createdAt: now,
      updatedAt: now,
      bgGradient: getRandomGradient(),
    };

    set({
      workflows: [...get().workflows, record],
    });

    get().saveWorkflowsToStorage();
    return id;
  },

  createNewCanvas: () => {
    const wf = get().createEmptyWorkflow('未命名工作流');
    const positions = generateDefaultPositions(wf);
    const edges = generateEdgesFromWorkflow(wf);

    nodeCounter = 0;

    const initialHistory: HistoryState[] = [{
      workflow: wf,
      nodePositions: positions,
      edges: edges,
    }];

    set({
      currentWorkflow: wf,
      originalWorkflowId: null,
      isDirty: false,
      nodePositions: positions,
      edges: edges,
      selectedNodeId: null,
      history: initialHistory,
      historyIndex: 0,
    });

    get().saveDraftToStorage();
  },

  loadWorkflowToCanvas: (id) => {
    const record = get().workflows.find((w) => w.id === id);
    if (!record) return;

    nodeCounter = 0;
    record.workflow.nodes.forEach((n) => {
      const match = n.id.match(/node-(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > nodeCounter) nodeCounter = num;
      }
    });

    const edgesWithType = record.edges.map((e) => ({
      ...e,
      type: e.type || 'custom',
      sourceHandle: e.sourceHandle || 'out',
      targetHandle: e.targetHandle || 'in',
    }));

    const initialHistory: HistoryState[] = [{
      workflow: JSON.parse(JSON.stringify(record.workflow)),
      nodePositions: { ...record.nodePositions },
      edges: JSON.parse(JSON.stringify(edgesWithType)),
    }];

    set({
      currentWorkflow: JSON.parse(JSON.stringify(record.workflow)),
      originalWorkflowId: id,
      isDirty: false,
      nodePositions: { ...record.nodePositions },
      edges: edgesWithType,
      selectedNodeId: null,
      history: initialHistory,
      historyIndex: 0,
    });

    get().saveDraftToStorage();
  },

  importToCanvas: (workflow: FlowSchema) => {
    nodeCounter = 0;
    workflow.nodes.forEach((n: FlowNode) => {
      const match = n.id.match(/node-(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > nodeCounter) nodeCounter = num;
      }
    });

    const nodePositions = generateDefaultPositions(workflow);
    const edges = generateEdgesFromWorkflow(workflow);
    const edgesWithType = edges.map((e) => ({
      ...e,
      type: (e as any).type || 'custom',
      sourceHandle: (e as any).sourceHandle || 'out',
      targetHandle: (e as any).targetHandle || 'in',
    }));

    const initialHistory: HistoryState[] = [{
      workflow: JSON.parse(JSON.stringify(workflow)),
      nodePositions: { ...nodePositions },
      edges: JSON.parse(JSON.stringify(edgesWithType)),
    }];

    set({
      currentWorkflow: JSON.parse(JSON.stringify(workflow)),
      originalWorkflowId: null,
      isDirty: true,
      nodePositions: nodePositions,
      edges: edgesWithType,
      selectedNodeId: null,
      history: initialHistory,
      historyIndex: 0,
    });

    get().saveDraftToStorage();
  },

  openWorkflow: (id) => {
    get().loadWorkflowToCanvas(id);
  },

  hasUnsavedChanges: () => {
    return get().isDirty;
  },

  saveCurrentWorkflow: () => {
    const state = get();
    if (!state.currentWorkflow) return;

    const now = Date.now();
    const updatedWorkflow = {
      ...state.currentWorkflow,
      flowMeta: {
        ...state.currentWorkflow.flowMeta,
        updatedAt: now,
      },
    };

    if (state.originalWorkflowId) {
      set({
        workflows: state.workflows.map((w) =>
          w.id === state.originalWorkflowId
            ? {
                ...w,
                workflow: updatedWorkflow,
                nodePositions: state.nodePositions,
                edges: state.edges,
                updatedAt: now,
              }
            : w
        ),
        isDirty: false,
      });
    } else {
      const newId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const newRecord: WorkflowRecord = {
        id: newId,
        workflow: updatedWorkflow,
        nodePositions: state.nodePositions,
        edges: state.edges,
        createdAt: now,
        updatedAt: now,
        bgGradient: getRandomGradient(),
      };

      set({
        workflows: [...state.workflows, newRecord],
        originalWorkflowId: newId,
        isDirty: false,
      });
    }

    get().saveWorkflowsToStorage();
    get().saveDraftToStorage();
  },

  saveAsNewWorkflow: (name) => {
    const state = get();
    if (!state.currentWorkflow) return '';

    const newId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const wfName = name || `${state.currentWorkflow.flowMeta.name || '工作流'} (副本)`;

    const newRecord: WorkflowRecord = {
      id: newId,
      workflow: {
        ...JSON.parse(JSON.stringify(state.currentWorkflow)),
        flowMeta: {
          ...state.currentWorkflow.flowMeta,
          name: wfName,
          updatedAt: now,
        },
      },
      nodePositions: { ...state.nodePositions },
      edges: JSON.parse(JSON.stringify(state.edges)),
      createdAt: now,
      updatedAt: now,
      bgGradient: getRandomGradient(),
    };

    set({
      workflows: [...state.workflows, newRecord],
      originalWorkflowId: newId,
      isDirty: false,
    });

    get().saveWorkflowsToStorage();
    get().saveDraftToStorage();
    return newId;
  },

  deleteWorkflow: (id) => {
    const state = get();
    const remaining = state.workflows.filter((w) => w.id !== id);

    set({
      workflows: remaining,
    });

    if (state.originalWorkflowId === id) {
      set({
        originalWorkflowId: null,
      });
    }

    get().saveWorkflowsToStorage();
  },

  duplicateWorkflow: (id) => {
    const record = get().workflows.find((w) => w.id === id);
    if (!record) return '';

    const newId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const newRecord: WorkflowRecord = {
      id: newId,
      workflow: JSON.parse(JSON.stringify(record.workflow)),
      nodePositions: { ...record.nodePositions },
      edges: [...record.edges],
      createdAt: now,
      updatedAt: now,
      bgGradient: getRandomGradient(),
    };

    newRecord.workflow.flowMeta = {
      ...newRecord.workflow.flowMeta,
      name: `${record.workflow.flowMeta.name} (副本)`,
    };

    set({
      workflows: [...get().workflows, newRecord],
    });

    get().saveWorkflowsToStorage();
    return newId;
  },

  renameWorkflow: (id, name) => {
    const state = get();
    const now = Date.now();

    set({
      workflows: state.workflows.map((w) =>
        w.id === id
          ? {
              ...w,
              workflow: {
                ...w.workflow,
                flowMeta: { ...w.workflow.flowMeta, name },
              },
              updatedAt: now,
            }
          : w
      ),
    });

    get().saveWorkflowsToStorage();
  },

  setWorkflowGradient: (id, gradient) => {
    const state = get();
    const now = Date.now();

    set({
      workflows: state.workflows.map((w) =>
        w.id === id
          ? {
              ...w,
              bgGradient: gradient,
              updatedAt: now,
            }
          : w
      ),
    });

    get().saveWorkflowsToStorage();
  },

  setWorkflowBgImage: (id, imageDataUrl) => {
    const state = get();
    const now = Date.now();

    set({
      workflows: state.workflows.map((w) =>
        w.id === id
          ? {
              ...w,
              bgImage: imageDataUrl || undefined,
              updatedAt: now,
            }
          : w
      ),
    });

    get().saveWorkflowsToStorage();
  },

  // ==================== 导入导出 ====================

  exportWorkflow: (id, hideSensitive = false) => {
    const record = get().workflows.find((w) => w.id === id);
    if (record) {
      return hideSensitive ? maskSensitiveData(record.workflow) : record.workflow;
    }
    return get().exportCurrentWorkflow(hideSensitive);
  },

  exportCurrentWorkflow: (hideSensitive = false) => {
    if (get().currentWorkflow) {
      return hideSensitive
        ? maskSensitiveData(get().currentWorkflow!)
        : get().currentWorkflow!;
    }
    return get().createEmptyWorkflow();
  },

  importWorkflow: (workflow) => {
    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const nodePositions = generateDefaultPositions(workflow);
    const edges = generateEdgesFromWorkflow(workflow);

    const record: WorkflowRecord = {
      id,
      workflow: {
        ...workflow,
        flowMeta: {
          ...workflow.flowMeta,
          createdAt: now,
          updatedAt: now,
        },
      },
      nodePositions,
      edges,
      createdAt: now,
      updatedAt: now,
      bgGradient: getRandomGradient(),
    };

    set({
      workflows: [...get().workflows, record],
    });

    get().saveWorkflowsToStorage();
    return id;
  },

  saveWorkflowsToStorage: () => {
    try {
      localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(get().workflows));
    } catch (e) {
      console.warn('Failed to save workflows to storage:', e);
    }
  },

  createEmptyWorkflow: (name) => {
    const workflowName = name || generateDefaultWorkflowName();
    nodeCounter = 0;

    const wf: FlowSchema = {
      version: '2.0',
      flowMeta: { name: workflowName, desc: '' },
      globalVars: {},
      runtime: {
        defaultTimeout: 30000,
        defaultRetry: 1,
        onError: 'stop',
      },
      modelConfig: {
        midscene: { defaultModelId: 'default' },
      },
      target: { type: 'computer' },
      nodes: [],
    };

    return wf;
  },
}));
