import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion } from 'framer-motion';

const initialNodes: Node[] = [
  {
    id: '1',
    position: { x: 100, y: 100 },
    data: { label: '开始' },
  },
  {
    id: '2',
    position: { x: 100, y: 300 },
    data: { label: '结束' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2' },
];

function SimpleFlowEditor() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  console.log('[SimpleFlowEditor] Rendering, nodes:', nodes.length);

  return (
    <div className="h-full w-full flex flex-col bg-gray-50">
      <div className="h-14 px-4 bg-white/80 backdrop-blur-sm border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-gray-800">测试工作流</span>
          <span className="text-xs text-gray-400">{nodes.length} 个节点</span>
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
        </ReactFlow>
      </div>
    </div>
  );
}

export const TestReactFlow: React.FC = () => {
  console.log('[TestReactFlow] Mounting');
  return (
    <ReactFlowProvider>
      <SimpleFlowEditor />
    </ReactFlowProvider>
  );
};
