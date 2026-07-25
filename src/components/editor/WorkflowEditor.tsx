import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Save,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Variable,
  MousePointer2,
  Hand,
  Square,
  Undo2,
  Redo2,
  Eraser,
  Download,
  Upload,
  FilePlus,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';

import { NodeLibrary } from './NodeLibrary';
import { PropertyPanel } from './PropertyPanel';
import { VariablePanel } from './VariablePanel';
import { getNodeHandles, CustomNode, type CustomNodeType } from './CustomNode';
import { CustomEdge } from './CustomEdge';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAppStore } from '../../stores/appStore';
import { getNodeConfig, nodeConfigs, type NodeConfig } from './nodeConfigs';
import { isValidVarName } from './VarNameInput';
import type { FlowSchema } from '../../../types/flow-v2';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { simplifyError } from '../../lib/utils';

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};
const edgeTypes = {
  custom: CustomEdge,
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function WorkflowEditorInner() {
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<CustomNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isVariablePanelOpen, setIsVariablePanelOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; mode: 'normal' | 'quickAdd'; sourceNodeId?: string; sourceHandle?: string } | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isModifierPressed, setIsModifierPressed] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [hideSensitive, setHideSensitive] = useState(false);
  const [editingName, setEditingName] = useState('');
  const isSyncingFromStore = useRef(false);

  const {
    currentWorkflow,
    setSelectedNode,
    addNode,
    addNodeAfter,
    deleteNode,
    removeEdge,
    addEdgeToStore,
    nodePositions,
    setNodePosition,
    edges: storeEdges,
    setEdges: setStoreEdges,
    loadFromStorage,
    saveToStorage,
    initialized,
    recentNodeTypes,
    pinnedNodeTypes,
    syncNextNodesFromEdges,
    isRunning,
    startExecution,
    stopExecution,
    executionLogs,
    nodeExecutionStatus,
    nodeErrors,
    nodeOutputs,
    nodeResolvedParams,
    isDirty,
    originalWorkflowId,
    updateWorkflowMeta,
    undo,
    redo,
    canUndo,
    canRedo,
    clearCanvas,
    saveCurrentWorkflow,
    saveAsNewWorkflow,
    createNewCanvas,
    exportCurrentWorkflow,
    importToCanvas,
  } = useWorkflowStore();

  const { uiSettings } = useAppStore();

  const currentWorkflowId = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const [contextMenuFilter, setContextMenuFilter] = useState('');

  const validationWarnings = useMemo(() => {
    const emptyResult = { byNode: {} as Record<string, string[]>, all: [] as any[], errorCount: 0, warningCount: 0 };
    if (uiSettings.enableValidation === false) return emptyResult;
    if (!currentWorkflow) return emptyResult;

    const byNode: Record<string, string[]> = {};
    const all: { id: string; nodeId?: string; message: string; type: 'error' | 'warning' }[] = [];
    const nodes = currentWorkflow.nodes;

    if (nodes.length === 0) {
      all.push({
        id: 'empty-flow',
        message: '工作流为空，没有任何节点',
        type: 'error',
      });
      return { byNode, all, errorCount: 1, warningCount: 0 };
    }

    const startNodes = nodes.filter((n) => n.nodeType === 'control.start');
    if (startNodes.length === 0) {
      all.push({
        id: 'no-start',
        message: '缺少开始节点，工作流无法运行',
        type: 'error',
      });
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const outgoingEdges = new Map<string, string[]>();
    storeEdges.forEach((e) => {
      if (!outgoingEdges.has(e.source)) {
        outgoingEdges.set(e.source, []);
      }
      outgoingEdges.get(e.source)!.push(e.target);
    });

    const reachableNodeIds = new Set<string>();
    const queue = [...startNodes.map((n) => n.id)];
    startNodes.forEach((n) => reachableNodeIds.add(n.id));

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const next = outgoingEdges.get(nodeId) || [];
      next.forEach((nextId) => {
        if (!reachableNodeIds.has(nextId) && nodeMap.has(nextId)) {
          reachableNodeIds.add(nextId);
          queue.push(nextId);
        }
      });
    }

    const globalVarNames = new Set(Object.keys(currentWorkflow.globalVars || {}));
    const assignedVarNames = new Set<string>();
    const loopVarNames = new Set<string>();

    nodes.forEach((node) => {
      if (!reachableNodeIds.has(node.id)) return;
      const params = node.nodeParams as any;
      if (node.nodeType === 'control.var') {
        if (params?.varName) {
          assignedVarNames.add(String(params.varName));
        }
        if (params?.saveToNewVar && params?.outputVarName) {
          assignedVarNames.add(String(params.outputVarName));
        }
      } else if (node.nodeType === 'control.loop') {
        if (params?.loopType === 'for' && params?.iteratorVar) {
          loopVarNames.add(String(params.iteratorVar));
        } else if (params?.loopType === 'forEach') {
          if (params?.itemVar) {
            loopVarNames.add(String(params.itemVar));
          }
          if (params?.keyVar) {
            loopVarNames.add(String(params.keyVar));
          }
        }
      } else if (params?.outputVar) {
        assignedVarNames.add(String(params.outputVar));
      }
    });

    const allKnownVars = new Set([...globalVarNames, ...assignedVarNames, ...loopVarNames]);

    const extractVarRefs = (str: string): string[] => {
      const refs: string[] = [];
      const regex = /\{\{([\u4e00-\u9fa5\w.]+)\}\}/g;
      let match;
      while ((match = regex.exec(str)) !== null) {
        const fullPath = match[1];
        const baseVar = fullPath.split('.')[0];
        refs.push(baseVar);
      }
      return refs;
    };

    nodes.forEach((node) => {
      if (!reachableNodeIds.has(node.id)) return;
      const params = node.nodeParams as Record<string, unknown>;
      if (!params) return;

      const nodeWarnings = new Set<string>();

      Object.values(params).forEach((val) => {
        if (typeof val === 'string') {
          const refs = extractVarRefs(val);
          refs.forEach((ref) => {
            if (!allKnownVars.has(ref) && ref !== '') {
              const msg = `变量「${ref}」可能未定义`;
              if (!nodeWarnings.has(msg)) {
                nodeWarnings.add(msg);
                if (!byNode[node.id]) byNode[node.id] = [];
                byNode[node.id].push(msg);
                all.push({
                  id: `unknown-var-${node.id}-${ref}`,
                  nodeId: node.id,
                  message: msg,
                  type: 'warning',
                });
              }
            }
          });
        }
      });
    });

    nodes.forEach((node) => {
      if (!reachableNodeIds.has(node.id)) return;
      const params = node.nodeParams as Record<string, unknown>;
      if (!params) return;

      const nodeWarnings = new Set<string>();
      const addWarning = (msg: string) => {
        if (nodeWarnings.has(msg)) return;
        nodeWarnings.add(msg);
        if (!byNode[node.id]) byNode[node.id] = [];
        byNode[node.id].push(msg);
        all.push({
          id: `invalid-varname-${node.id}-${msg}`,
          nodeId: node.id,
          message: msg,
          type: 'warning',
        });
      };

      if (node.nodeType === 'control.var') {
        if (params.varName && typeof params.varName === 'string' && !isValidVarName(params.varName)) {
          addWarning(`变量名「${params.varName}」不合法`);
        }
        if (params.saveToNewVar && params.outputVarName && typeof params.outputVarName === 'string' && !isValidVarName(params.outputVarName)) {
          addWarning(`输出变量名「${params.outputVarName}」不合法`);
        }
      } else if (node.nodeType === 'control.loop') {
        if (params.loopType === 'for' && params.iteratorVar && typeof params.iteratorVar === 'string' && !isValidVarName(params.iteratorVar)) {
          addWarning(`迭代变量名「${params.iteratorVar}」不合法`);
        }
        if (params.loopType === 'forEach') {
          if (params.itemVar && typeof params.itemVar === 'string' && !isValidVarName(params.itemVar)) {
            addWarning(`项变量名「${params.itemVar}」不合法`);
          }
          if (params.keyVar && typeof params.keyVar === 'string' && !isValidVarName(params.keyVar)) {
            addWarning(`键变量名「${params.keyVar}」不合法`);
          }
        }
      } else if (params.outputVar && typeof params.outputVar === 'string' && !isValidVarName(params.outputVar)) {
        addWarning(`输出变量名「${params.outputVar}」不合法`);
      }
    });

    const errorCount = all.filter((w) => w.type === 'error').length;
    const warningCount = all.filter((w) => w.type === 'warning').length;

    return { byNode, all, errorCount, warningCount };
  }, [currentWorkflow, storeEdges, uiSettings.enableValidation]);

  const contextMenuPosition = useMemo(() => {
    if (!contextMenu) return { top: 0, left: 0 };
    const menuHeight = uiSettings.contextMenuMode === 'full' ? 360 : 320;
    const menuWidth = uiSettings.contextMenuMode === 'full' ? 256 : 224;
    let top = contextMenu.y;
    let left = contextMenu.x;

    if (top + menuHeight > window.innerHeight - 10) {
      top = Math.max(10, contextMenu.y - menuHeight);
    }
    if (left + menuWidth > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - menuWidth - 10);
    }

    return { top, left };
  }, [contextMenu, uiSettings.contextMenuMode]);

  const contextMenuNodes = useMemo(() => {
    const mode = uiSettings.contextMenuMode;

    if (mode === 'full') {
      const filter = contextMenuFilter.toLowerCase();
      const filtered = nodeConfigs.filter(
        (c) => !filter || c.name.toLowerCase().includes(filter) || c.type.toLowerCase().includes(filter)
      );

      const sort = uiSettings.fullMenuSort;
      let sorted = [...filtered];
      if (sort === 'name') {
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      } else if (sort === 'category') {
        sorted.sort((a, b) => {
          const catOrder = ['control', 'ai', 'data', 'browser'];
          const aIdx = catOrder.indexOf(a.category);
          const bIdx = catOrder.indexOf(b.category);
          if (aIdx !== bIdx) return aIdx - bIdx;
          return a.name.localeCompare(b.name, 'zh-CN');
        });
      }

      return sorted.map((config) => ({ config, section: 'all' as const }));
    }

    const result: { config: NodeConfig; section: 'recent' | 'pinned' }[] = [];
    const added = new Set<string>();

    const recentCount = uiSettings.recentNodeCount || 5;
    recentNodeTypes.slice(0, recentCount).forEach((type) => {
      const config = getNodeConfig(type);
      if (config && !added.has(type)) {
        result.push({ config, section: 'recent' });
        added.add(type);
      }
    });

    if (uiSettings.showAllPinned) {
      pinnedNodeTypes.forEach((type) => {
        const config = getNodeConfig(type);
        if (config && !added.has(type)) {
          result.push({ config, section: 'pinned' });
          added.add(type);
        }
      });
    }

    return result;
  }, [recentNodeTypes, pinnedNodeTypes, uiSettings, contextMenuFilter]);

  useEffect(() => {
    if (!initialized) {
      loadFromStorage();
    }
  }, [initialized, loadFromStorage]);

  useEffect(() => {
    const handleQuickAdd = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setContextMenuFilter('');
      setContextMenu({
        x: detail.x,
        y: detail.y,
        mode: 'quickAdd',
        sourceNodeId: detail.nodeId,
        sourceHandle: detail.handleId,
      });
    };
    window.addEventListener('workflow:quick-add', handleQuickAdd);
    return () => window.removeEventListener('workflow:quick-add', handleQuickAdd);
  }, []);

  useEffect(() => {
    if (currentWorkflow?.flowMeta?.name !== undefined) {
      setEditingName(currentWorkflow.flowMeta.name);
    } else {
      setEditingName('');
    }
  }, [currentWorkflow?.flowMeta?.name]);

  const workflowKey = currentWorkflow?.flowMeta?.name || null;
  const nodeIdsKey = currentWorkflow?.nodes.map(n => n.id).join(',') || '';

  useEffect(() => {
    if (!currentWorkflow || !initialized) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const flowNodes: CustomNodeType[] = currentWorkflow.nodes.map((node) => {
      const pos = nodePositions[node.id] || { x: 100, y: 0 };
      const status = nodeExecutionStatus[node.id] || 'idle';
      const errorMsg = nodeErrors[node.id];
      const output = nodeOutputs[node.id];
      const resolvedParams = nodeResolvedParams[node.id];
      return {
        id: node.id,
        type: 'custom',
        position: pos,
        data: {
          label: node.nodeName,
          nodeType: node.nodeType,
          executionStatus: status,
          errorMessage: errorMsg ? simplifyError(errorMsg) : undefined,
          nodeParams: node.nodeParams,
          output,
          resolvedParams,
        },
      } as CustomNodeType;
    });

    setNodes(flowNodes);

    const normalizedEdges = storeEdges.length > 0
      ? storeEdges.map(e => ({
          ...e,
          type: e.type || 'custom',
          sourceHandle: e.sourceHandle || 'out',
          targetHandle: e.targetHandle || 'in',
        }))
      : [];

    isSyncingFromStore.current = true;
    setEdges(normalizedEdges);
    requestAnimationFrame(() => {
      isSyncingFromStore.current = false;
    });
  }, [workflowKey, nodeIdsKey, initialized, storeEdges, setNodes, setEdges]);

  useEffect(() => {
    if (!currentWorkflow || !initialized) return;

    setNodes((nds) =>
      nds.map((node) => {
        const status = nodeExecutionStatus[node.id] || 'idle';
        const errorMsg = nodeErrors[node.id];
        const output = nodeOutputs[node.id];
        const resolvedParams = nodeResolvedParams[node.id];
        const warnings = validationWarnings.byNode[node.id];
        const shortError = errorMsg ? simplifyError(errorMsg) : undefined;
        if (
          node.data.executionStatus === status &&
          node.data.errorMessage === shortError &&
          node.data.output === output &&
          node.data.resolvedParams === resolvedParams &&
          node.data.validationWarnings === warnings
        ) {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            executionStatus: status,
            errorMessage: shortError,
            output,
            resolvedParams,
            validationWarnings: warnings,
          },
        };
      })
    );
  }, [nodeExecutionStatus, nodeErrors, nodeOutputs, nodeResolvedParams, validationWarnings.byNode, currentWorkflow, initialized, setNodes]);

  useEffect(() => {
    if (!currentWorkflow || !initialized) return;

    setNodes((nds) =>
      nds.map((node) => {
        const wfNode = currentWorkflow.nodes.find((n) => n.id === node.id);
        if (!wfNode) return node;
        if (wfNode.nodeParams === node.data.nodeParams && wfNode.nodeName === node.data.label) return node;
        return {
          ...node,
          data: {
            ...node.data,
            nodeParams: wfNode.nodeParams,
            label: wfNode.nodeName || node.data.label,
          },
        } as CustomNodeType;
      })
    );
  }, [currentWorkflow, initialized, setNodes]);

  const handleNodesChange: OnNodesChange<CustomNodeType> = useCallback(
    (changes) => {
      onNodesChange(changes);

      changes.forEach((change) => {
        if (change.type === 'position' && change.position) {
          setNodePosition(change.id, change.position);
        }
      });
    },
    [onNodesChange, setNodePosition],
  );

  const handleEdgesChange: OnEdgesChange<Edge> = useCallback(
    (changes) => {
      onEdgesChange(changes);
      if (isSyncingFromStore.current) return;
      const hasRemove = changes.some(c => c.type === 'remove');
      if (hasRemove) {
        const deletedIds = changes.filter(c => c.type === 'remove').map(c => c.id);
        deletedIds.forEach(id => removeEdge(id));
      }
    },
    [onEdgesChange, removeEdge],
  );

  useEffect(() => {
    if (!initialized) return;
    saveToStorage();
  }, [currentWorkflow, nodePositions, edges, initialized, saveToStorage]);

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;

      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      const sourceType = sourceNode.data?.nodeType as string;
      const sourceHandles = getNodeHandles(sourceType);
      const targetType = targetNode.data?.nodeType as string;
      const targetHandles = getNodeHandles(targetType);

      if (targetHandles.inputs === 0) return false;
      if (sourceHandles.outputs === 0) return false;

      const existingSourceEdges = edges.filter((e) => e.source === connection.source && e.sourceHandle === (connection.sourceHandle || 'out'));
      if (existingSourceEdges.length > 0) return false;

      const isLoopTarget = targetType === 'control.loop';
      if (isLoopTarget) {
        const targetHandle = connection.targetHandle || 'in';
        const existingTargetEdges = edges.filter(
          (e) => e.target === connection.target && e.targetHandle === targetHandle,
        );
        if (existingTargetEdges.length > 0) return false;

        if (targetHandle === 'in-left') {
          const hasRight = edges.some(
            (e) => e.target === connection.target && e.targetHandle === 'in-right',
          );
          if (hasRight) return false;
        }
        if (targetHandle === 'in-right') {
          const hasLeft = edges.some(
            (e) => e.target === connection.target && e.targetHandle === 'in-left',
          );
          if (hasLeft) return false;
        }
      }

      return true;
    },
    [nodes, edges],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
      ...params,
        type: 'custom',
        sourceHandle: params.sourceHandle || 'out',
        targetHandle: params.targetHandle || 'in',
        id: `edge-${Date.now()}`,
      } as Edge;
      addEdgeToStore(newEdge);
      syncNextNodesFromEdges();
    },
    [addEdgeToStore, syncNextNodesFromEdges],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((eds) => {
        const newEdges = eds.map((e) => {
          if (e.id === oldEdge.id) {
            return {
              ...e,
              source: newConnection.source || e.source,
              target: newConnection.target || e.target,
              sourceHandle: newConnection.sourceHandle || e.sourceHandle || 'out',
              targetHandle: newConnection.targetHandle || e.targetHandle || 'in',
            };
          }
          return e;
        });
        setStoreEdges(newEdges);
        return newEdges;
      });
      syncNextNodesFromEdges();
    },
    [setEdges, setStoreEdges, syncNextNodesFromEdges],
  );

  const onDelete = useCallback(() => {
    const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);

    if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;

    if (selectedNodeIds.length > 0) {
      selectedNodeIds.forEach((id) => deleteNode(id));
    }

    if (selectedEdgeIds.length > 0) {
      selectedEdgeIds.forEach((id) => removeEdge(id));
    }
  }, [nodes, edges, deleteNode, removeEdge]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        e.preventDefault();
        onDelete();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    const handleModifierDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        setIsModifierPressed(true);
      }
    };

    const handleModifierUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        setIsModifierPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keydown', handleModifierDown);
    window.addEventListener('keyup', handleModifierUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keydown', handleModifierDown);
      window.removeEventListener('keyup', handleModifierUp);
    };
  }, [onDelete, undo, redo]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const config = getNodeConfig(type);
      if (!config) return;

      addNode(type, { x: position.x - 100, y: position.y - 30 });
    },
    [screenToFlowPosition, addNode],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setContextMenu(null);
  }, [setSelectedNode]);

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      setContextMenuFilter('');
      setContextMenu({ x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY, mode: 'normal' });
    },
    [],
  );

  const handleAddNodeFromMenu = useCallback(
    (nodeType: string) => {
      if (!contextMenu || !currentWorkflow) return;
      if (contextMenu.mode === 'quickAdd' && contextMenu.sourceNodeId && contextMenu.sourceHandle) {
        addNodeAfter(contextMenu.sourceNodeId, contextMenu.sourceHandle, nodeType);
      } else {
        const position = screenToFlowPosition({
          x: contextMenu.x,
          y: contextMenu.y,
        });
        addNode(nodeType, { x: position.x - 100, y: position.y - 30 });
      }
      setContextMenu(null);
    },
    [contextMenu, currentWorkflow, screenToFlowPosition, addNode, addNodeAfter],
  );

  const handleRun = useCallback(() => {
    if (isRunning) {
      stopExecution();
      return;
    }
    if (validationWarnings.errorCount > 0) {
      return;
    }
    startExecution();
  }, [isRunning, startExecution, stopExecution, validationWarnings.errorCount]);

  const handleSave = useCallback(() => {
    setSaveStatus('saving');
    try {
      saveCurrentWorkflow();
      setSaveStatus('saved');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    } catch (error) {
      setSaveStatus('error');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    }
  }, [saveCurrentWorkflow]);

  const handleExport = useCallback(() => {
    const wf = exportCurrentWorkflow(hideSensitive);
    const blob = new Blob([JSON.stringify(wf, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wf.flowMeta.name || 'workflow'}.flow.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportDialog(false);
  }, [exportCurrentWorkflow, hideSensitive]);

  const handleSaveAs = useCallback(() => {
    const name = prompt('请输入新工作流的名称：', `${currentWorkflow?.flowMeta.name || '工作流'} (副本)`);
    if (name && name.trim()) {
      saveAsNewWorkflow(name.trim());
      setSaveStatus('saved');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    }
  }, [currentWorkflow, saveAsNewWorkflow]);

  const handleNewCanvas = useCallback(() => {
    if (isDirty) {
      const confirmed = confirm('当前画布有未保存的修改，确定要新建画布吗？未保存的修改将会丢失。');
      if (!confirmed) return;
    }
    createNewCanvas();
  }, [isDirty, createNewCanvas]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const proceed = () => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          importToCanvas(data);
        } catch (err) {
          alert('导入失败：文件格式不正确');
          console.error('Import failed:', err);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    if (isDirty) {
      const confirmed = confirm('当前画布有未保存的修改，导入将会覆盖当前内容。未保存的修改将会丢失。\n\n是否继续？');
      if (!confirmed) {
        e.target.value = '';
        return;
      }
    }
    proceed();
  }, [isDirty, importToCanvas]);

  const handleNameBlur = useCallback(() => {
    const trimmed = editingName.trim();
    if (trimmed === '') {
      setEditingName(currentWorkflow?.flowMeta?.name || '未命名工作流');
    } else if (trimmed !== currentWorkflow?.flowMeta?.name) {
      updateWorkflowMeta({ name: trimmed });
    }
  }, [editingName, currentWorkflow?.flowMeta?.name, updateWorkflowMeta]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNameBlur();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditingName(currentWorkflow?.flowMeta?.name || '');
      (e.target as HTMLInputElement).blur();
    }
  }, [handleNameBlur, currentWorkflow?.flowMeta?.name]);

  const isUndoDisabled = !canUndo();
  const isRedoDisabled = !canRedo();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__workflowStore = useWorkflowStore;
    }
  }, []);

  return (
    <div className="h-full w-full flex flex-col bg-gray-50">
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="h-14 px-4 bg-white/80 backdrop-blur-sm border-b border-gray-200 flex items-center justify-between z-10"
      >
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            placeholder="未命名工作流"
            className="text-base font-semibold text-gray-800 placeholder:text-gray-400 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none transition-colors px-1 py-0.5 w-48"
          />
          <div className="flex items-center gap-1.5">
            {isDirty ? (
              <span className="flex items-center gap-1 text-xs text-amber-600">
                <AlertCircle className="h-3 w-3" />
                未保存
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <Check className="h-3 w-3" />
                已保存
              </span>
            )}
          </div>
          <span className="text-xs text-gray-400">
            {currentWorkflow?.nodes.length || 0} 个节点
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleNewCanvas}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FilePlus className="h-4 w-4" />
            新建
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <button
            onClick={undo}
            disabled={isUndoDisabled}
            className={`p-2 rounded-lg transition-colors ${
              isUndoDisabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            onClick={redo}
            disabled={isRedoDisabled}
            className={`p-2 rounded-lg transition-colors ${
              isRedoDisabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'
            }`}
            title="反撤销 (Ctrl+Shift+Z / Ctrl+Y)"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            onClick={clearCanvas}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"
            title="清屏"
          >
            <Eraser className="h-4 w-4" />
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <button
            onClick={() => setIsVariablePanelOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Variable className="h-4 w-4" />
            变量
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <input
            ref={importFileInputRef}
            type="file"
            accept=".json,.flow.json"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => importFileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Upload className="h-4 w-4" />
            导入
          </button>
          <button
            onClick={() => setShowExportDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Download className="h-4 w-4" />
            导出
          </button>
          <button
            onClick={handleSaveAs}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Copy className="h-4 w-4" />
            另存为
          </button>
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg transition-all ${
              saveStatus === 'saved'
                ? 'bg-emerald-500 text-white'
                : saveStatus === 'error'
                ? 'bg-red-500 text-white'
                : saveStatus === 'saving'
                ? 'bg-gray-200 text-gray-500 cursor-wait'
                : 'bg-violet-500 text-white hover:bg-violet-600 shadow-md hover:shadow-lg active:scale-95'
            }`}
          >
            {saveStatus === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                保存中
              </>
            ) : saveStatus === 'saved' ? (
              <>
                <Check className="h-4 w-4" />
                已保存
              </>
            ) : saveStatus === 'error' ? (
              <>
                <AlertCircle className="h-4 w-4" />
                保存失败
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                保存
              </>
            )}
          </button>
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleRun}
                  disabled={!isRunning && validationWarnings.errorCount > 0}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-sm text-white rounded-lg transition-all shadow-md active:scale-95 ${
                    isRunning
                      ? 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 hover:shadow-lg'
                      : validationWarnings.errorCount > 0
                      ? 'bg-gray-400 cursor-not-allowed opacity-70'
                      : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 hover:shadow-lg'
                  }`}
                >
                  {isRunning ? (
                    <>
                      <Square className="h-4 w-4" />
                      停止
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      运行
                    </>
                  )}
                </button>
              </TooltipTrigger>
              {validationWarnings.errorCount > 0 && !isRunning && (
                <TooltipContent side="left" sideOffset={8} className="max-w-xs z-[9999]">
                  <div className="space-y-1">
                    <p className="font-medium text-red-600">无法运行</p>
                    {validationWarnings.all
                      .filter((w: any) => w.type === 'error')
                      .map((w: any, i: number) => (
                        <p key={i} className="text-xs text-gray-600">• {w.message}</p>
                      ))}
                  </div>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </motion.div>

      <div className="flex-1 relative overflow-hidden">
        <NodeLibrary
          onDragStart={() => {}}
          onDragEnd={() => {}}
        />

        <div className="w-full h-full" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges as any}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={{
              type: 'custom',
              reconnectable: true,
            }}
            proOptions={{ hideAttribution: true }}
            isValidConnection={isValidConnection}
            selectionOnDrag={isSelectionMode || isModifierPressed}
            panOnDrag={!isSelectionMode && !isModifierPressed}
            selectNodesOnDrag={isSelectionMode || isModifierPressed}
          >
            <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="#e5e7eb" />
          </ReactFlow>

          <PropertyPanel />

          <div className="absolute bottom-4 left-4 flex items-center gap-1.5 bg-white/80 backdrop-blur-md rounded-xl shadow-lg border border-gray-200 px-3 py-1.5 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono text-gray-600">Ctrl</kbd>
              <span>+ 拖拽圈选</span>
            </span>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono text-gray-600">Delete</kbd>
              <span>批量删除</span>
            </span>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono text-gray-600">#</kbd>
              <span>插入变量</span>
            </span>
          </div>

          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-gray-200 p-1.5">
            <button
              onClick={() => setIsSelectionMode(!isSelectionMode)}
              className={`p-2 rounded-xl transition-colors ${
                isSelectionMode ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-600'
              }`}
              title={isSelectionMode ? '选择模式（点击切换到手写模式）' : '手写模式（点击切换到选择模式）'}
            >
              {isSelectionMode ? <MousePointer2 className="h-4 w-4" /> : <Hand className="h-4 w-4" />}
            </button>
            <div className="h-5 w-px bg-gray-200 mx-0.5" />
            <button
              onClick={() => zoomIn({ duration: 200 })}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
              title="放大"
            >
              <ZoomIn className="h-4 w-4 text-gray-600" />
            </button>
            <button
              onClick={() => zoomOut({ duration: 200 })}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
              title="缩小"
            >
              <ZoomOut className="h-4 w-4 text-gray-600" />
            </button>
            <div className="h-5 w-px bg-gray-200 mx-0.5" />
            <button
              onClick={() => fitView({ padding: 0.2, duration: 300 })}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
              title="重置视图"
            >
              <Maximize2 className="h-4 w-4 text-gray-600" />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {contextMenu && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -5 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              className={`fixed z-[9999] bg-white/95 backdrop-blur-xl border border-gray-200 rounded-2xl shadow-2xl overflow-hidden ${
                uiSettings.contextMenuMode === 'full' ? 'w-64' : 'w-56'
              }`}
              style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
            >
              {uiSettings.contextMenuMode === 'full' && (
                <div className="p-2 border-b border-gray-100">
                  <input
                    type="text"
                    value={contextMenuFilter}
                    onChange={(e) => setContextMenuFilter(e.target.value)}
                    placeholder="搜索节点..."
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
                    autoFocus
                  />
                </div>
              )}
              <div className="max-h-80 overflow-y-auto scrollbar-hide p-1.5">
                {contextMenuNodes.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-gray-400">
                      {uiSettings.contextMenuMode === 'full' ? '未找到匹配节点' : '暂无固定节点'}
                    </p>
                    {uiSettings.contextMenuMode === 'simple' && (
                      <p className="text-[10px] text-gray-300 mt-1">在左侧节点库中点击图钉固定常用节点</p>
                    )}
                  </div>
                ) : uiSettings.contextMenuMode === 'full' && uiSettings.fullMenuSort === 'category' ? (
                  <>
                    {['control', 'ai', 'data', 'browser'].map((cat) => {
                      const catNodes = contextMenuNodes.filter((n) => n.config.category === cat);
                      if (catNodes.length === 0) return null;
                      const catLabels: Record<string, string> = {
                        control: '控制',
                        ai: 'AI 操作',
                        data: '数据',
                        browser: '浏览器',
                      };
                      return (
                        <div key={cat}>
                          <div className="px-2 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                            {catLabels[cat] || cat}
                          </div>
                          {catNodes.map(({ config }) => {
                            const Icon = config.icon;
                            return (
                              <button
                                key={config.type}
                                onClick={() => handleAddNodeFromMenu(config.type)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-indigo-50 rounded-xl transition-colors group"
                              >
                                <div
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                                  style={{ backgroundColor: `${config.color}15`, color: config.color }}
                                >
                                  {Icon && <Icon className="h-4 w-4" />}
                                </div>
                                <div className="flex-1 text-left">
                                  <div className="text-xs font-medium text-gray-700 group-hover:text-indigo-700">
                                    {config.name}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <>
                    {contextMenuNodes.some((n) => n.section === 'recent') && (
                      <>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                          最近使用
                        </div>
                        {contextMenuNodes
                          .filter((n) => n.section === 'recent')
                          .map(({ config }) => {
                            const Icon = config.icon;
                            return (
                              <button
                                key={config.type}
                                onClick={() => handleAddNodeFromMenu(config.type)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-indigo-50 rounded-xl transition-colors group"
                              >
                                <div
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                                  style={{ backgroundColor: `${config.color}15`, color: config.color }}
                                >
                                  {Icon && <Icon className="h-4 w-4" />}
                                </div>
                                <div className="flex-1 text-left">
                                  <div className="text-xs font-medium text-gray-700 group-hover:text-indigo-700">
                                    {config.name}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                      </>
                    )}
                    {contextMenuNodes.some((n) => n.section === 'pinned') && (
                      <>
                        <div className="px-2 py-1.5 mt-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                          固定节点
                        </div>
                        {contextMenuNodes
                          .filter((n) => n.section === 'pinned')
                          .map(({ config }) => {
                            const Icon = config.icon;
                            return (
                              <button
                                key={config.type}
                                onClick={() => handleAddNodeFromMenu(config.type)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-indigo-50 rounded-xl transition-colors group"
                              >
                                <div
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                                  style={{ backgroundColor: `${config.color}15`, color: config.color }}
                                >
                                  {Icon && <Icon className="h-4 w-4" />}
                                </div>
                                <div className="flex-1 text-left">
                                  <div className="text-xs font-medium text-gray-700 group-hover:text-indigo-700">
                                    {config.name}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                      </>
                    )}
                    {contextMenuNodes.every((n) => n.section === 'all') && uiSettings.fullMenuSort !== 'category' && (
                      <>
                        {contextMenuNodes.map(({ config }) => {
                          const Icon = config.icon;
                          return (
                            <button
                              key={config.type}
                              onClick={() => handleAddNodeFromMenu(config.type)}
                              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-indigo-50 rounded-xl transition-colors group"
                            >
                              <div
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                                style={{ backgroundColor: `${config.color}15`, color: config.color }}
                              >
                                {Icon && <Icon className="h-4 w-4" />}
                              </div>
                              <div className="flex-1 text-left">
                                <div className="text-xs font-medium text-gray-700 group-hover:text-indigo-700">
                                  {config.name}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <VariablePanel
          isOpen={isVariablePanelOpen}
          onClose={() => setIsVariablePanelOpen(false)}
        />

      </div>

      <AnimatePresence>
        {showExportDialog && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
              onClick={() => setShowExportDialog(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden z-50"
            >
              <div className="p-5 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-800">导出工作流</h3>
                <p className="text-sm text-gray-500 mt-1">
                  将当前工作流导出为 JSON 文件，可用于分享或备份
                </p>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                  <input
                    type="checkbox"
                    id="hideSensitive"
                    checked={hideSensitive}
                    onChange={(e) => setHideSensitive(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded text-violet-600 focus:ring-violet-500"
                  />
                  <div>
                    <label htmlFor="hideSensitive" className="text-sm font-medium text-gray-700 cursor-pointer">
                      隐藏敏感信息
                    </label>
                    <p className="text-xs text-gray-500 mt-0.5">
                      自动隐藏密码、API Key、Token 等敏感字段（替换为 ******）
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowExportDialog(false)}
                >
                  取消
                </Button>
                <Button onClick={handleExport}>
                  <Download className="h-4 w-4 mr-1.5" />
                  导出
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

interface WorkflowEditorProps {
  workflowId?: string;
}

export const WorkflowEditor: React.FC<WorkflowEditorProps> = () => {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  );
};
