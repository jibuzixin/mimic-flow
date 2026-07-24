import React, { useCallback, useRef, useState } from 'react';
import {
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
  type Edge,
  Position,
  useReactFlow,
} from '@xyflow/react';
import { useAppStore } from '../../stores/appStore';

export type CustomEdgeType = Edge<{
  label?: string;
  controlOffset?: { x: number; y: number };
}>;

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
  data,
}) => {
  const edgeStyle = useAppStore((s) => s.uiSettings.edgeStyle);
  const { setEdges } = useReactFlow();
  const dragRef = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const controlOffset = data?.controlOffset || { x: 0, y: 0 };

  const getControlPoints = useCallback(() => {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;

    if (edgeStyle === 'straight') return null;

    const defaultOffsetX = Math.abs(dx) * 0.5;
    const defaultOffsetY = Math.abs(dy) * 0.5;

    return {
      c1x: sourceX + (sourcePosition === Position.Right || sourcePosition === Position.Left ? defaultOffsetX * Math.sign(dx) : 0) + controlOffset.x,
      c1y: sourceY + (sourcePosition === Position.Top || sourcePosition === Position.Bottom ? defaultOffsetY * Math.sign(dy) : 0) + controlOffset.y,
      c2x: targetX - (targetPosition === Position.Right || targetPosition === Position.Left ? defaultOffsetX * Math.sign(dx) : 0) + controlOffset.x,
      c2y: targetY - (targetPosition === Position.Top || targetPosition === Position.Bottom ? defaultOffsetY * Math.sign(dy) : 0) + controlOffset.y,
    };
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, edgeStyle, controlOffset]);

  const edgePath = (() => {
    const midX = (sourceX + targetX) / 2 + controlOffset.x;
    const midY = (sourceY + targetY) / 2 + controlOffset.y;
    const hasOffset = controlOffset.x !== 0 || controlOffset.y !== 0;

    switch (edgeStyle) {
      case 'straight':
        if (hasOffset) {
          return `M ${sourceX},${sourceY} L ${midX},${midY} L ${targetX},${targetY}`;
        }
        return getStraightPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
        })[0];
      case 'smoothstep':
        if (hasOffset) {
          const dx = targetX - sourceX;
          const dy = targetY - sourceY;
          const isHorizontal = Math.abs(dx) > Math.abs(dy);

          const [p1] = getSmoothStepPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX: midX,
            targetY: midY,
            targetPosition: isHorizontal ? Position.Top : Position.Left,
            borderRadius: 8,
          });

          const [p2] = getSmoothStepPath({
            sourceX: midX,
            sourceY: midY,
            sourcePosition: isHorizontal ? Position.Bottom : Position.Right,
            targetX,
            targetY,
            targetPosition,
            borderRadius: 8,
          });

          return p1 + ' ' + p2.replace(/^M[^L]*L/, 'L');
        }
        return getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 8,
        })[0];
      case 'bezier':
      default: {
        const cp = getControlPoints();
        if (!cp) return getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];
        return `M ${sourceX},${sourceY} C ${cp.c1x},${cp.c1y} ${cp.c2x},${cp.c2y} ${targetX},${targetY}`;
      }
    }
  })();

  const handlePointPos = (() => {
    const midX = (sourceX + targetX) / 2 + controlOffset.x;
    const midY = (sourceY + targetY) / 2 + controlOffset.y;
    if (edgeStyle === 'bezier') {
      const cp = getControlPoints();
      if (cp) return { x: (cp.c1x + cp.c2x) / 2, y: (cp.c1y + cp.c2y) / 2 };
    }
    return { x: midX, y: midY };
  })();

  const onControlPointMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startOffset: { ...controlOffset },
      };

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = moveEvent.clientX - dragRef.current.startX;
        const dy = moveEvent.clientY - dragRef.current.startY;

        setEdges((eds) =>
          eds.map((ed) =>
            ed.id === id
              ? {
                  ...ed,
                  data: {
                    ...ed.data,
                    controlOffset: {
                      x: dragRef.current!.startOffset.x + dx,
                      y: dragRef.current!.startOffset.y + dy,
                    },
                  },
                }
              : ed,
          ),
        );
      };

      const onMouseUp = () => {
        setIsDragging(false);
        dragRef.current = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [edgeStyle, controlOffset, id, setEdges],
  );

  const gradientId = `edge-gradient-${id}`;
  const glowFilterId = `edge-glow-${id}`;

  const minX = Math.min(sourceX, targetX);
  const maxX = Math.max(sourceX, targetX);
  const gradX1 = minX - 50;
  const gradX2 = maxX + 50;

  const showControlPoint = selected;

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
      {showControlPoint && (
        <circle
          cx={handlePointPos.x}
          cy={handlePointPos.y}
          r={8}
          fill="white"
          stroke="#8b5cf6"
          strokeWidth={2}
          style={{
            cursor: isDragging ? 'grabbing' : 'grab',
            pointerEvents: 'all',
          }}
          onMouseDown={onControlPointMouseDown}
        />
      )}
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
