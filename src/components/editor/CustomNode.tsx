import React, { useCallback, useState, useMemo, memo } from 'react';
import { Handle, Position, type Node, type NodeProps, useEdges } from '@xyflow/react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { getNodeConfig } from './nodeConfigs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAppStore } from '../../stores/appStore';

export interface CustomNodeData {
  label: string;
  nodeType: string;
  isSelected?: boolean;
  executionStatus?: 'idle' | 'running' | 'success' | 'error';
  errorMessage?: string;
  validationWarnings?: string[];
  nodeParams?: Record<string, unknown>;
  resolvedParams?: Record<string, unknown>;
  output?: unknown;
  [key: string]: unknown;
}

export type CustomNodeType = Node<CustomNodeData, 'custom'>;

export const getNodeHandles = (nodeType: string) => {
  const isStartNode = nodeType === 'control.start';
  const isEndNode = nodeType === 'control.end';
  const isIfNode = nodeType === 'control.if';
  const isLoopNode = nodeType === 'control.loop';
  const isBranchingWait = nodeType === 'system.waitForImage' || nodeType === 'midscene.waitFor';

  return {
    inputs: isStartNode ? 0 : 1,
    outputs: isEndNode ? 0 : (isIfNode || isBranchingWait ? 2 : isLoopNode ? 2 : 1),
    outputLabels: isIfNode || isBranchingWait ? ['true', 'false'] : isLoopNode ? ['body', 'exit'] : ['out'],
  };
};

export const CustomNode: React.FC<NodeProps<CustomNodeType>> = ({ id, data, selected }) => {
  const config = getNodeConfig(data.nodeType);
  const Icon = config?.icon;
  const color = config?.color || '#6b7280';
  const handles = useMemo(() => getNodeHandles(data.nodeType), [data.nodeType]);
  const executionStatus = data.executionStatus || 'idle';
  const errorMessage = data.errorMessage;
  const validationWarnings = data.validationWarnings || [];
  const hasWarning = validationWarnings.length > 0 && executionStatus !== 'error';
  const edges = useEdges();

  const isLoopNode = data.nodeType === 'control.loop';

  const loopInputHandles = useMemo(() => {
    if (!isLoopNode) return { showLeft: false, showRight: false, showTop: true };

    const connectedTargets = new Set(
      edges
        .filter((e) => e.target === id)
        .map((e) => e.targetHandle || 'in'),
    );

    const hasLeft = connectedTargets.has('in-left');
    const hasRight = connectedTargets.has('in-right');

    return {
      showTop: true,
      showLeft: !hasRight,
      showRight: !hasLeft,
    };
  }, [isLoopNode, edges, id]);

  const statusBorder = {
    idle: hasWarning ? 'ring-4 ring-amber-400/40 border-amber-500' : '',
    running: 'ring-4 ring-amber-400/50 border-amber-500 animate-pulse',
    success: 'ring-4 ring-emerald-400/40 border-emerald-500',
    error: 'ring-4 ring-red-400/40 border-red-500',
  };

  const statusTopBorder = {
    idle: hasWarning ? '#f59e0b' : color,
    running: '#f59e0b',
    success: '#10b981',
    error: '#ef4444',
  };

  const { setSelectedNode, updateNode } = useWorkflowStore();
  const { uiSettings } = useAppStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(data.label);

  const isLogNode = data.nodeType === 'control.log';
  const isEndNode = data.nodeType === 'control.end';
  const isVarNode = data.nodeType === 'control.var';

  const nodeParams = data.nodeParams as Record<string, unknown> | undefined;
  const resolvedParams = data.resolvedParams as Record<string, unknown> | undefined;
  const effectiveParams = (executionStatus === 'success' && resolvedParams) ? resolvedParams : nodeParams;
  const printResult = isVarNode && nodeParams?.printResult === true;
  const showContent = isLogNode || isEndNode || printResult;

  const nodeWidth = useMemo(() => {
    const baseWidth = showContent ? 280 : 220;
    const maxWidth = baseWidth * uiSettings.nodeWidthMultiplier;
    return { base: baseWidth, max: maxWidth };
  }, [uiSettings.nodeWidthMultiplier, showContent]);

  const contentMessage = nodeParams?.message as string | undefined;
  const output = data.output as string | undefined;
  const displayContent = output !== undefined ? output : contentMessage;

  const subtitle = useMemo(() => {
    const params = effectiveParams || {};
    const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s;

    switch (data.nodeType) {
      case 'control.var': {
        const varName = params.varName as string || '?';
        const op = params.operation as string;
        const val = params.value as string;
        switch (op) {
          case 'set': return `${varName} = ${truncate(val || '', 20)}`;
          case 'add': return val && val !== '1' ? `${varName} += ${truncate(val, 20)}` : `${varName}++`;
          case 'subtract': return val && val !== '1' ? `${varName} -= ${truncate(val, 20)}` : `${varName}--`;
          case 'multiply': return `${varName} *= ${truncate(val || '', 20)}`;
          case 'divide': return `${varName} /= ${truncate(val || '', 20)}`;
          case 'concat': return `${varName} += "${truncate(val || '', 15)}"`;
          case 'toUpperCase': return `${varName}.toUpperCase()`;
          case 'toLowerCase': return `${varName}.toLowerCase()`;
          case 'trim': return `${varName}.trim()`;
          case 'toInteger': return `parseInt(${varName})`;
          default: return `${varName} = ${truncate(val || '', 20)}`;
        }
      }
      case 'control.sleep':
      case 'midscene.sleep': {
        const ms = params.duration || params.ms || params.time;
        return ms ? `等待 ${ms}ms` : '等待';
      }
      case 'control.if': {
        const cond = params.condition as string;
        return `if ${truncate(cond || '', 25)}`;
      }
      case 'control.loop': {
        const loopType = params.loopType as string || 'for';
        if (loopType === 'for') {
          const it = params.iteratorVar as string || 'i';
          const from = params.from ?? 0;
          const to = params.to ?? 0;
          return `for ${it}=${from}..${to}`;
        } else if (loopType === 'while') {
          const cond = params.condition as string;
          return `while ${truncate(cond || 'true', 20)}`;
        } else if (loopType === 'forEach') {
          const arr = params.arrayVar as string || 'arr';
          const item = params.itemVar as string || 'item';
          return `forEach ${item} in ${arr}`;
        }
        return '循环';
      }
      case 'control.log': {
        if (params.var) return `log [${params.var}]`;
        if (params.message) return `log "${truncate(params.message as string, 25)}"`;
        return 'log all';
      }
      case 'control.end': {
        if (params.message) return `end: ${truncate(params.message as string, 25)}`;
        return '结束';
      }
      case 'control.start':
        return '开始';

      case 'midscene.act': {
        const prompt = params.prompt as string;
        return truncate(prompt || '', 30);
      }
      case 'midscene.tap': {
        const target = params.target as string;
        return `点击: ${truncate(target || '', 25)}`;
      }
      case 'midscene.doubleClick': {
        const target = params.target as string;
        return `双击: ${truncate(target || '', 25)}`;
      }
      case 'midscene.rightClick': {
        const target = params.target as string;
        return `右键: ${truncate(target || '', 25)}`;
      }
      case 'midscene.input': {
        const target = params.target as string;
        const val = params.value as string;
        return `输入: "${truncate(val || '', 15)}" → ${truncate(target || '', 15)}`;
      }
      case 'midscene.clearInput': {
        const target = params.target as string;
        return `清空: ${truncate(target || '', 25)}`;
      }
      case 'midscene.keyboardPress': {
        const key = params.keyName as string;
        const target = params.target as string;
        return `按键: ${key || '?'}${target ? ' → ' + truncate(target, 15) : ''}`;
      }
      case 'midscene.query': {
        const prompt = params.prompt as string;
        return `查询: ${truncate(prompt || '', 25)}`;
      }
      case 'midscene.scroll': {
        const dir = params.direction as string || 'down';
        const target = params.target as string;
        return `滚动: ${dir}${target ? ' → ' + truncate(target, 15) : ''}`;
      }
      case 'midscene.hover': {
        const target = params.target as string;
        return `悬停: ${truncate(target || '', 25)}`;
      }
      case 'midscene.assert': {
        const prompt = params.prompt as string;
        return `断言: ${truncate(prompt || '', 25)}`;
      }
      case 'midscene.waitFor': {
        const prompt = params.prompt as string;
        return `等待: ${truncate(prompt || '', 25)}`;
      }
      default:
        return config?.name || data.nodeType;
    }
  }, [data.nodeType, effectiveParams, config?.name]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditName(data.label);
  }, [data.label]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    const finalName = editName.trim() || data.label;
    if (finalName !== data.label) {
      // 写入 workflowStore 的节点 nodeName 字段（和属性面板 handleNameChange 保持一致）
      updateNode(id, { nodeName: finalName });
    }
  }, [editName, data.label, id, updateNode]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBlur();
    }
    if (e.key === 'Escape') {
      // Esc 回滚到原始名称，不保存
      setIsEditing(false);
      setEditName(data.label);
    }
  }, [handleBlur, data.label]);

  const handleSelect = useCallback(() => {
    setSelectedNode(id);
  }, [id, setSelectedNode]);

  const handleOutputClick = useCallback((e: React.MouseEvent, handleId: string) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('workflow:quick-add', {
      detail: {
        nodeId: id,
        handleId,
        x: e.clientX,
        y: e.clientY,
      },
    }));
  }, [id]);

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`relative rounded-xl border-2 bg-white/90 backdrop-blur-sm shadow-lg transition-all ${
        selected
          ? 'border-blue-500 shadow-blue-500/30 ring-4 ring-blue-500/20'
          : executionStatus !== 'idle'
          ? statusBorder[executionStatus]
          : 'border-gray-200 hover:border-gray-300 hover:shadow-xl'
      } ${isEditing ? 'nodrag' : ''}`}
      style={{
        minWidth: nodeWidth.base,
        maxWidth: nodeWidth.max,
        width: 'auto',
        borderTopWidth: '4px',
        borderTopColor: statusTopBorder[executionStatus],
      }}
      onClick={handleSelect}
    >
      {isLoopNode ? (
        <>
          {loopInputHandles.showTop && (
            <Handle
              type="target"
              position={Position.Top}
              id="in"
              className="!w-3.5 !h-3.5 !bg-white !border-2 !border-indigo-500 !shadow-md cursor-crosshair"
            />
          )}
          {loopInputHandles.showLeft && (
            <Handle
              type="target"
              position={Position.Left}
              id="in-left"
              className="!w-3.5 !h-3.5 !bg-white !border-2 !border-indigo-500 !shadow-md cursor-crosshair"
              style={{ left: '-8px', top: '50%', transform: 'translateY(-50%)' }}
            />
          )}
          {loopInputHandles.showRight && (
            <Handle
              type="target"
              position={Position.Right}
              id="in-right"
              className="!w-3.5 !h-3.5 !bg-white !border-2 !border-indigo-500 !shadow-md cursor-crosshair"
              style={{ right: '-8px', top: '50%', transform: 'translateY(-50%)' }}
            />
          )}
        </>
      ) : handles.inputs > 0 ? (
        <Handle
          type="target"
          position={Position.Top}
          id="in"
          className="!w-3.5 !h-3.5 !bg-white !border-2 !border-indigo-500 !shadow-md cursor-crosshair"
        />
      ) : null}

      <div className="px-4 py-3 relative">
        {executionStatus === 'error' && errorMessage && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute -top-2 -right-2 z-20 cursor-help">
                  <AlertCircle className="h-5 w-5 text-red-500 fill-white" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="end" sideOffset={8} className="max-w-xs text-xs z-[9999]">
                <p className="font-medium text-red-600">执行失败</p>
                <p className="text-gray-600 mt-1">{errorMessage}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {hasWarning && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute -top-2 -right-2 z-20 cursor-help">
                  <div className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold fill-white">
                    !
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="end" sideOffset={8} className="max-w-xs text-xs z-[9999]">
                <p className="font-medium text-amber-600">检查发现 {validationWarnings.length} 个问题</p>
                <div className="text-gray-600 mt-1 space-y-1">
                  {validationWarnings.map((w, i) => (
                    <p key={i}>• {w}</p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${color}15`, color }}
          >
            {Icon && <Icon className="h-4.5 w-4.5" />}
          </div>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoFocus
                className="w-full text-sm font-semibold text-gray-900 bg-transparent border-b border-blue-500 outline-none"
              />
            ) : (
              <div
                className="text-sm font-semibold text-gray-900 truncate cursor-text"
                onDoubleClick={handleDoubleClick}
              >
                {data.label}
              </div>
            )}
            {!showContent && (
              <div className="text-xs text-gray-400 mt-0.5 font-mono leading-relaxed line-clamp-2" style={{ wordBreak: 'break-all' }}>{subtitle}</div>
            )}
          </div>
        </div>

        {showContent && displayContent && (
          <div
            className={`mt-3 pt-3 border-t text-xs rounded-lg p-2.5 font-mono whitespace-pre-wrap break-all line-clamp-3 ${
              output !== undefined
                ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800'
                : 'border-gray-100 bg-gray-50/50 text-gray-600'
            }`}
            style={{ maxHeight: '72px', overflow: 'hidden' }}
          >
            {displayContent}
          </div>
        )}

        {showContent && !displayContent && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="text-xs text-gray-400 italic flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-gray-300"></span>
              {isLogNode ? '暂无日志内容' : '暂无输出内容'}
            </div>
          </div>
        )}
      </div>

      {handles.outputs === 1 ? (
        <div className="relative">
          <Handle
            type="source"
            position={Position.Bottom}
            id="out"
            onClick={(e) => handleOutputClick(e, 'out')}
            className="!w-3.5 !h-3.5 !bg-white !border-2 !border-indigo-500 !shadow-md cursor-crosshair hover:!w-5 hover:!h-5 hover:!border-indigo-400 transition-all"
          />
        </div>
      ) : handles.outputs > 1 ? (
        <div className="relative h-6">
          {handles.outputLabels.map((label, idx) => {
            const pos = idx === 0 ? '25%' : '75%';
            const labelColor = idx === 0 ? '#22c55e' : '#ef4444';
            return (
              <div key={label} className="absolute" style={{ left: pos, transform: 'translateX(-50%)' }}>
                <Handle
                  type="source"
                  position={Position.Bottom}
                  id={label}
                  onClick={(e) => handleOutputClick(e, label)}
                  style={{ bottom: '-8px', left: '50%', transform: 'translateX(-50%)' }}
                  className="!w-3.5 !h-3.5 !bg-white !border-2 !shadow-md cursor-crosshair hover:!w-5 hover:!h-5 transition-all"
                />
                <div
                  className="text-[10px] font-medium text-center mt-3 whitespace-nowrap"
                  style={{ color: labelColor }}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </motion.div>
  );
};

export const nodeTypes = {
  custom: memo(CustomNode),
};
