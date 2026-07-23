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
  Terminal,
  Undo2,
  Redo2,
  Trash2,
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
import { getNodeConfig, nodeConfigs, type NodeConfig } from './nodeConfigs';
import type { FlowSchema } from '../../../types/flow-v2';
import { Button } from '../ui/button';

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [hideSensitive, setHideSensitive] = useState(false);

  const {
    currentWorkflow,
    setSelectedNode,
    addNode,
    deleteNode,
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
  } = useWorkflowStore();

  const currentWorkflowId = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contextMenuNodes = useMemo(() => {
    const result: { config: NodeConfig; section: 'recent' | 'pinned' }[] = [];
    const added = new Set<string>();

    recentNodeTypes.forEach((type) => {
      const config = getNodeConfig(type);
      if (config && !added.has(type)) {
        result.push({ config, section: 'recent' });
        added.add(type);
      }
    });

    pinnedNodeTypes.forEach((type) => {
      const config = getNodeConfig(type);
      if (config && !added.has(type)) {
        result.push({ config, section: 'pinned' });
        added.add(type);
      }
    });

    return result;
  }, [recentNodeTypes, pinnedNodeTypes]);

  useEffect(() => {
    if (!initialized) {
      loadFromStorage();
    }
  }, [initialized, loadFromStorage]);

  useEffect(() => {
    if (!currentWorkflow || !initialized) {
      return;
    }

    const startNode = currentWorkflow.nodes.find(n => n.nodeType === 'control.start');
    const wfKey = startNode?.id || currentWorkflow.nodes[0]?.id || 'empty';
    if (currentWorkflowId.current === wfKey) {
      return;
    }
    currentWorkflowId.current = wfKey;

    const flowNodes: CustomNodeType[] = currentWorkflow.nodes.map((node) => {
      const pos = nodePositions[node.id] || { x: 100, y: 0 };
      const status = nodeExecutionStatus[node.id] || 'idle';
      return {
        id: node.id,
        type: 'custom',
        position: pos,
        data: {
          label: node.nodeName,
          nodeType: node.nodeType,
          executionStatus: status,
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

    setEdges(normalizedEdges);
  }, [currentWorkflow, initialized, nodePositions, storeEdges, nodeExecutionStatus, setNodes, setEdges]);

  useEffect(() => {
    if (!initialized || !currentWorkflow) return;

    const flowNodes: CustomNodeType[] = currentWorkflow.nodes.map((node) => {
      const pos = nodePositions[node.id] || { x: 100, y: 0 };
      const status = nodeExecutionStatus[node.id] || 'idle';
      return {
        id: node.id,
        type: 'custom',
        position: pos,
        data: {
          label: node.nodeName,
          nodeType: node.nodeType,
          executionStatus: status,
        },
      } as CustomNodeType;
    });

    setNodes(flowNodes);
  }, [nodeExecutionStatus, currentWorkflow, nodePositions, setNodes]);

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
      const hasRemove = changes.some(c => c.type === 'remove');
      if (hasRemove) {
        setTimeout(() => {
          const currentEdges = useWorkflowStore.getState().edges;
          const deletedIds = changes.filter(c => c.type === 'remove').map(c => c.id);
          const remaining = currentEdges.filter(e => !deletedIds.includes(e.id));
          setStoreEdges(remaining);
          syncNextNodesFromEdges();
        }, 0);
      }
    },
    [onEdgesChange, setStoreEdges, syncNextNodesFromEdges],
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

      const existingSourceEdges = edges.filter((e) => e.source === connection.source);
      if (existingSourceEdges.length >= sourceHandles.outputs) return false;

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
      setEdges((eds) => {
        const newEdges = addEdge(newEdge, eds);
        setStoreEdges(newEdges);
        return newEdges;
      });
      syncNextNodesFromEdges();
    },
    [setEdges, setStoreEdges, syncNextNodesFromEdges],
  );

  const onDelete = useCallback(() => {
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    let newEdges = edges;
    if (selectedEdgeIds.length > 0) {
      newEdges = edges.filter((e) => !selectedEdgeIds.includes(e.id));
      setEdges(newEdges);
      setStoreEdges(newEdges);
      syncNextNodesFromEdges();
    }
    const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    if (selectedNodeIds.length > 0) {
      selectedNodeIds.forEach((id) => deleteNode(id));
      setTimeout(() => {
        const remainingEdges = newEdges.filter(
          e => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)
        );
        setStoreEdges(remainingEdges);
        syncNextNodesFromEdges();
      }, 0);
    }
  }, [nodes, edges, deleteNode, setEdges, setStoreEdges, syncNextNodesFromEdges]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
      setContextMenu({ x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY });
    },
    [],
  );

  const handleAddNodeFromMenu = useCallback(
    (nodeType: string) => {
      if (!contextMenu || !currentWorkflow) return;
      const position = screenToFlowPosition({
        x: contextMenu.x,
        y: contextMenu.y,
      });
      addNode(nodeType, { x: position.x - 100, y: position.y - 30 });
      setContextMenu(null);
    },
    [contextMenu, currentWorkflow, screenToFlowPosition, addNode],
  );

  const handleRun = useCallback(() => {
    if (isRunning) {
      stopExecution();
    } else {
      startExecution();
    }
  }, [isRunning, startExecution, stopExecution]);

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

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateWorkflowMeta({ name: e.target.value });
  }, [updateWorkflowMeta]);

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
          <button
            onClick={handleNewCanvas}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="新建画布"
          >
            <FilePlus className="h-4 w-4 text-gray-600" />
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <input
            type="text"
            value={currentWorkflow?.flowMeta?.name || '未命名工作流'}
            onChange={handleNameChange}
            className="text-base font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none transition-colors px-1 py-0.5 w-48"
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
            <Trash2 className="h-4 w-4" />
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
          <button
            onClick={handleRun}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-sm text-white rounded-lg transition-all shadow-md hover:shadow-lg active:scale-95 ${
              isRunning
                ? 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600'
                : 'bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600'
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
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={{
              type: 'custom',
            }}
            proOptions={{ hideAttribution: true }}
            isValidConnection={isValidConnection}
            selectionOnDrag={isSelectionMode}
            panOnDrag={!isSelectionMode}
            selectNodesOnDrag={isSelectionMode}
          >
            <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="#e5e7eb" />
          </ReactFlow>

          <PropertyPanel />

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
              onClick={undo}
              disabled={isUndoDisabled}
              className={`p-2 rounded-xl transition-colors ${
                isUndoDisabled ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-600'
              }`}
              title="撤销"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={isRedoDisabled}
              className={`p-2 rounded-xl transition-colors ${
                isRedoDisabled ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-600'
              }`}
              title="反撤销"
            >
              <Redo2 className="h-4 w-4" />
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
              className="fixed z-50 w-56 bg-white/95 backdrop-blur-xl border border-gray-200 rounded-2xl shadow-2xl overflow-hidden"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <div className="max-h-80 overflow-y-auto p-1.5">
                {contextMenuNodes.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-gray-400">暂无固定节点</p>
                    <p className="text-[10px] text-gray-300 mt-1">在左侧节点库中点击图钉固定常用节点</p>
                  </div>
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

        <AnimatePresence>
          {executionLogs.length > 0 && (
            <motion.div
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 300, opacity: 0 }}
              className="absolute bottom-0 left-0 right-0 h-64 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-2xl flex flex-col rounded-t-2xl"
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">执行日志</span>
                  <span className="text-xs text-gray-400">({executionLogs.length})</span>
                </div>
                <div className="flex items-center gap-2">
                  {isRunning && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-xs text-amber-600">运行中</span>
                    </div>
                  )}
                  <button
                    onClick={() => useWorkflowStore.getState().clearExecutionState()}
                    className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs">
                {executionLogs.map((log) => {
                  const time = new Date(log.timestamp).toLocaleTimeString();
                  const colorMap: Record<string, string> = {
                    info: 'text-gray-600',
                    success: 'text-emerald-600',
                    error: 'text-red-600',
                    'node-start': 'text-amber-600',
                    'node-success': 'text-emerald-600',
                    'node-error': 'text-red-600',
                  };
                  return (
                    <div
                      key={log.id}
                      className={`flex gap-2 py-1 ${colorMap[log.type] || 'text-gray-600'}`}
                    >
                      <span className="text-gray-400 shrink-0">[{time}]</span>
                      <span className="break-all">{log.message}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
