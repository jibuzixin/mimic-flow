import React from 'react';
import {
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';

export type CustomEdgeType = Edge<{ label?: string }>;

export const CustomEdge: React.FC<EdgeProps<CustomEdgeType>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
}) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const gradientId = `edge-gradient-${id}`;
  const glowFilterId = `edge-glow-${id}`;

  const minX = Math.min(sourceX, targetX);
  const maxX = Math.max(sourceX, targetX);
  const gradX1 = minX - 50;
  const gradX2 = maxX + 50;

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={gradX1}
          y1="0"
          x2={gradX2}
          y2="0"
        >
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
        <filter id={glowFilterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d={edgePath}
        fill="none"
        strokeWidth={16}
        stroke="transparent"
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
      />
      <path
        d={edgePath}
        fill="none"
        strokeWidth={selected ? 4 : 3}
        stroke={`url(#${gradientId})`}
        style={{
          filter: selected ? `url(#${glowFilterId})` : 'none',
          transition: 'stroke-width 0.2s ease',
          pointerEvents: 'none',
          ...style,
        }}
        markerEnd={markerEnd}
      />
      <path
        d={edgePath}
        fill="none"
        strokeWidth={selected ? 4 : 3}
        strokeDasharray="8 12"
        strokeLinecap="round"
        style={{
          stroke: 'rgba(255, 255, 255, 0.7)',
          animation: 'flowDash 1.5s linear infinite',
          pointerEvents: 'none',
        }}
      />
      <style>{`
        @keyframes flowDash {
          to {
            stroke-dashoffset: -40;
          }
        }
      `}</style>
    </>
  );
};
