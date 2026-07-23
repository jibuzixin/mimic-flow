import React, { useCallback, useState, useMemo, memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import { getNodeConfig } from './nodeConfigs';
import { useWorkflowStore } from '../../stores/workflowStore';

export interface CustomNodeData {
  label: string;
  nodeType: string;
  isSelected?: boolean;
  executionStatus?: 'idle' | 'running' | 'success' | 'error';
  [key: string]: unknown;
}

export type CustomNodeType = Node<CustomNodeData, 'custom'>;

export const getNodeHandles = (nodeType: string) => {
  const isStartNode = nodeType === 'control.start';
  const isEndNode = nodeType === 'control.end';
  const isControlNode = nodeType.startsWith('control.');
  const isIfNode = nodeType === 'control.if';
  const isLoopNode = nodeType === 'control.loop';

  return {
    inputs: isStartNode ? 0 : 1,
    outputs: isEndNode ? 0 : (isIfNode ? 2 : isLoopNode ? 1 : 1),
    outputLabels: isIfNode ? ['true', 'false'] : isLoopNode ? ['body'] : ['out'],
  };
};

export const CustomNode: React.FC<NodeProps<CustomNodeType>> = ({ id, data, selected }) => {
  const config = getNodeConfig(data.nodeType);
  const Icon = config?.icon;
  const color = config?.color || '#6b7280';
  const handles = useMemo(() => getNodeHandles(data.nodeType), [data.nodeType]);
  const status = data.executionStatus || 'idle';

  const statusBorder = {
    idle: '',
    running: 'ring-4 ring-amber-400/50 border-amber-500 animate-pulse',
    success: 'ring-4 ring-emerald-400/40 border-emerald-500',
    error: 'ring-4 ring-red-400/40 border-red-500',
  };

  const statusTopBorder = {
    idle: color,
    running: '#f59e0b',
    success: '#10b981',
    error: '#ef4444',
  };

  const { setSelectedNode } = useWorkflowStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(data.label);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditName(data.label);
  }, [data.label]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    if (editName !== data.label) {
      // TODO: 更新节点名称
    }
  }, [editName, data.label]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(data.label);
    }
  }, [handleBlur, data.label]);

  const handleSelect = useCallback(() => {
    setSelectedNode(id);
  }, [id, setSelectedNode]);

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`relative min-w-[200px] rounded-xl border-2 bg-white/90 backdrop-blur-sm shadow-lg transition-all ${
        selected
          ? 'border-blue-500 shadow-blue-500/30 ring-4 ring-blue-500/20'
          : status !== 'idle'
          ? statusBorder[status]
          : 'border-gray-200 hover:border-gray-300 hover:shadow-xl'
      } ${isEditing ? 'nodrag' : ''}`}
      style={{
        borderTopWidth: '4px',
        borderTopColor: statusTopBorder[status],
      }}
      onClick={handleSelect}
    >
      {handles.inputs > 0 && (
        <Handle
          type="target"
          position={Position.Top}
          id="in"
          className="!w-3.5 !h-3.5 !bg-white !border-2 !border-indigo-500 !shadow-md cursor-crosshair"
        />
      )}

      <div className="px-4 py-3">
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
            <div className="text-xs text-gray-400 mt-0.5">{config?.name || data.nodeType}</div>
          </div>
        </div>
      </div>

      {handles.outputs === 1 ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id="out"
          className="!w-3.5 !h-3.5 !bg-white !border-2 !border-indigo-500 !shadow-md cursor-crosshair"
        />
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
                  style={{ bottom: '-8px', left: '50%', transform: 'translateX(-50%)' }}
                  className="!w-3.5 !h-3.5 !bg-white !border-2 !shadow-md cursor-crosshair"
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
