import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, Settings, Trash2, X, ChevronUp, MousePointerClick } from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { getNodeConfig, type PropertyField } from './nodeConfigs';
import { VariableInput } from './VariableInput';

interface HelpTooltipProps {
  text: string;
}

const HelpTooltip: React.FC<HelpTooltipProps> = ({ text }) => {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const iconRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    }
  }, []);

  useEffect(() => {
    if (show) {
      updatePosition();
      const handler = () => updatePosition();
      window.addEventListener('scroll', handler, true);
      window.addEventListener('resize', handler);
      return () => {
        window.removeEventListener('scroll', handler, true);
        window.removeEventListener('resize', handler);
      };
    }
  }, [show, updatePosition]);

  return (
    <>
      <div
        ref={iconRef}
        className="flex items-center"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
      </div>
      {show &&
        createPortal(
          <div
            className="fixed z-[9999] px-3 py-2 text-xs bg-gray-800 text-white rounded-xl shadow-2xl whitespace-nowrap pointer-events-none"
            style={{
              left: position.x,
              top: position.y - 8,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {text}
            <div
              className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-gray-800"
            />
          </div>,
          document.body
        )}
    </>
  );
};

export const PropertyPanel: React.FC = () => {
  const { currentWorkflow, selectedNodeId, setSelectedNode, updateNodeParams, updateNode, deleteNode } =
    useWorkflowStore();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const selectedNode = currentWorkflow?.nodes.find((n) => n.id === selectedNodeId);
  const config = selectedNode ? getNodeConfig(selectedNode.nodeType) : null;

  const getPrecedingNodeVars = useCallback((): string[] => {
    if (!currentWorkflow || !selectedNodeId) return [];

    const startNode = currentWorkflow.nodes.find((n) => n.nodeType === 'control.start');
    if (!startNode) return [];

    const visited = new Set<string>();
    const precedingNodes: string[] = [];
    const queue: string[] = [startNode.id];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      if (nodeId === selectedNodeId) continue;

      visited.add(nodeId);
      precedingNodes.push(nodeId);

      const node = currentWorkflow.nodes.find((n) => n.id === nodeId);
      if (node?.nextNodes) {
        node.nextNodes.forEach((next) => {
          if (!visited.has(next.nodeId) && next.nodeId !== selectedNodeId) {
            queue.push(next.nodeId);
          }
        });
      }
    }

    const nodeVars = precedingNodes
      .map((id) => {
        const node = currentWorkflow.nodes.find((n) => n.id === id);
        return (node?.nodeParams as any)?.outputVar;
      })
      .filter((v): v is string => !!v);

    return nodeVars;
  }, [currentWorkflow, selectedNodeId]);

  const globalVarNames = useMemo(() => {
    if (!currentWorkflow?.globalVars) return [];
    return Object.keys(currentWorkflow.globalVars);
  }, [currentWorkflow?.globalVars]);

  const nodeOutputVars = useMemo(() => getPrecedingNodeVars(), [getPrecedingNodeVars]);

  const variables = useMemo(() => {
    const allVars: string[] = [];
    globalVarNames.forEach((v) => allVars.push(v));
    nodeOutputVars.forEach((v) => allVars.push(v));
    return allVars;
  }, [globalVarNames, nodeOutputVars]);

  useEffect(() => {
    if (selectedNodeId) {
      setIsCollapsed(false);
    }
  }, [selectedNodeId]);

  const handleParamChange = (key: string, value: unknown) => {
    if (!selectedNode) return;
    updateNodeParams(selectedNode.id, { [key]: value });
  };

  const handleNameChange = (name: string) => {
    if (!selectedNode) return;
    updateNode(selectedNode.id, { nodeName: name });
  };

  const renderField = (field: PropertyField) => {
    const value = (selectedNode?.nodeParams as Record<string, unknown>)?.[field.key];

    switch (field.type) {
      case 'text':
        return (
          <VariableInput
            value={String(value ?? '')}
            onChange={(v) => handleParamChange(field.key, v)}
            placeholder={field.placeholder}
            variables={variables}
            globalVariables={globalVarNames}
            nodeVariables={nodeOutputVars}
          />
        );

      case 'textarea':
        return (
          <VariableInput
            value={String(value ?? '')}
            onChange={(v) => handleParamChange(field.key, v)}
            placeholder={field.placeholder}
            variables={variables}
            globalVariables={globalVarNames}
            nodeVariables={nodeOutputVars}
            multiline
          />
        );

      case 'number':
        return (
          <input
            type="number"
            value={Number(value ?? 0)}
            onChange={(e) => handleParamChange(field.key, Number(e.target.value))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
          />
        );

      case 'select':
        return (
          <select
            value={String(value ?? '')}
            onChange={(e) => handleParamChange(field.key, e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case 'switch':
        return (
          <button
            onClick={() => handleParamChange(field.key, !value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              value ? 'bg-indigo-500' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                value ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        );

      case 'variable':
        return (
          <VariableInput
            value={String(value ?? '')}
            onChange={(v) => handleParamChange(field.key, v)}
            placeholder={field.placeholder}
            variables={variables}
            globalVariables={globalVarNames}
            nodeVariables={nodeOutputVars}
          />
        );

      default:
        return null;
    }
  };

  const hasSelection = !!selectedNode && !!config;
  const Icon = config?.icon;

  const shouldExpand = hasSelection && !isCollapsed;

  return (
    <div
      className={`absolute right-4 top-4 z-10 w-80 flex flex-col ${shouldExpand ? 'bottom-4' : ''}`}
    >
      <div className={`bg-white/90 backdrop-blur-xl border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden ${shouldExpand ? 'flex-1' : ''}`}>
        {/* 头部 - 永远显示 */}
        <div
          className="p-4 border-b border-gray-100 bg-gradient-to-l from-gray-50/50 to-white cursor-pointer select-none"
          onClick={() => hasSelection && setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center gap-2.5">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${hasSelection ? 'bg-indigo-50 text-indigo-500' : 'bg-gray-100 text-gray-400'}`}>
              <Settings className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-800">属性面板</h3>
              <p className="text-xs text-gray-500 truncate">
                {hasSelection ? config!.name : '请选择节点'}
              </p>
            </div>
            {hasSelection && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNode(null);
                  }}
                  className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors"
                  title="关闭"
                >
                  <X className="h-4 w-4 text-gray-400" />
                </button>
                <div
                  className={`transform transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}
                >
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                </div>
              </>
            )}
          </div>
        </div>

        {/* 有选中节点且未收起时显示内容 */}
        {hasSelection && !isCollapsed && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-4 py-3 border-b border-gray-100 shrink-0">
              <div
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ backgroundColor: `${config!.color}10` }}
              >
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${config!.color}20`, color: config!.color }}
                >
                  {Icon && <Icon className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={selectedNode!.nodeName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="w-full text-sm font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 focus:outline-none transition-colors"
                  />
                  <div className="text-xs text-gray-500 mt-0.5">{config!.name}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-400">
                节点 ID: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{selectedNode!.id}</code>
              </div>
            </div>

            <div className="overflow-y-auto p-4 flex-1 min-h-0 space-y-4">
              {config!.propertyFields.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">该节点无参数配置</p>
              ) : (
                config!.propertyFields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      <label className="text-xs font-semibold text-gray-700">{field.label}</label>
                      {field.description && <HelpTooltip text={field.description} />}
                    </div>
                    {renderField(field)}
                  </div>
                ))
              )}

              <div className="pt-4 mt-4 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                  <span className="w-1 h-3.5 bg-gray-400 rounded-full"></span>
                  通用设置
                </h4>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-600">超时时间 (ms)</label>
                    <input
                      type="number"
                      value={30000}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-600">重试次数</label>
                    <input
                      type="number"
                      value={1}
                      min={0}
                      max={10}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-gray-100">
                <button
                  onClick={() => {
                    deleteNode(selectedNode!.id);
                    setSelectedNode(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 rounded-xl transition-colors font-medium"
                >
                  <Trash2 className="h-4 w-4" />
                  删除节点
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-2">
                  选中节点后按 Backspace 也可删除
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 未选中时的提示 */}
        {!hasSelection && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gray-100 flex items-center justify-center">
              <MousePointerClick className="h-7 w-7 text-gray-400" />
            </div>
            <p className="text-sm text-gray-500">选择一个节点</p>
            <p className="text-xs text-gray-400 mt-1">查看和编辑属性</p>
          </div>
        )}
      </div>
    </div>
  );
};
