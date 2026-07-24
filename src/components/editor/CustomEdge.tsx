import React, { useMemo } from 'react';
import {
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
  type Edge,
  useNodes,
  type Node,
  Position,
} from '@xyflow/react';
import { useAppStore } from '../../stores/appStore';

export type CustomEdgeType = Edge<{ label?: string }>;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pointInRect(px: number, py: number, rect: Rect, padding = 10): boolean {
  return (
    px >= rect.x - padding &&
    px <= rect.x + rect.width + padding &&
    py >= rect.y - padding &&
    py <= rect.y + rect.height + padding
  );
}

function sampleBezierPoints(
  sx: number,
  sy: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  tx: number,
  ty: number,
  samples = 20,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const x = mt * mt * mt * sx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tx;
    const y = mt * mt * mt * sy + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ty;
    points.push({ x, y });
  }
  return points;
}

function pathIntersectsRect(pathD: string, rect: Rect, padding = 10): boolean {
  const commands = pathD.match(/[MLCQ][^MLCQ]*/gi) || [];
  let cx = 0;
  let cy = 0;

  for (const cmd of commands) {
    const type = cmd[0].toUpperCase();
    const nums = cmd
      .slice(1)
      .trim()
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => !isNaN(n));

    if (type === 'M') {
      cx = nums[0];
      cy = nums[1];
    } else if (type === 'L') {
      const tx = nums[0];
      const ty = nums[1];
      const steps = Math.max(Math.abs(tx - cx), Math.abs(ty - cy), 1);
      for (let i = 0; i <= steps; i += 5) {
        const t = i / steps;
        if (pointInRect(cx + (tx - cx) * t, cy + (ty - cy) * t, rect, padding)) {
          return true;
        }
      }
      cx = tx;
      cy = ty;
    } else if (type === 'C') {
      const c1x = nums[0];
      const c1y = nums[1];
      const c2x = nums[2];
      const c2y = nums[3];
      const tx = nums[4];
      const ty = nums[5];
      const points = sampleBezierPoints(cx, cy, c1x, c1y, c2x, c2y, tx, ty, 24);
      for (const p of points) {
        if (pointInRect(p.x, p.y, rect, padding)) {
          return true;
        }
      }
      cx = tx;
      cy = ty;
    } else if (type === 'Q') {
      const cx1 = nums[0];
      const cy1 = nums[1];
      const tx = nums[2];
      const ty = nums[3];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const mt = 1 - t;
        const x = mt * mt * cx + 2 * mt * t * cx1 + t * t * tx;
        const y = mt * mt * cy + 2 * mt * t * cy1 + t * t * ty;
        if (pointInRect(x, y, rect, padding)) {
          return true;
        }
      }
      cx = tx;
      cy = ty;
    }
  }

  return false;
}

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
  source,
  target,
}) => {
  const edgeStyle = useAppStore((s) => s.uiSettings.edgeStyle);
  const edgeAvoidNodes = useAppStore((s) => s.uiSettings.edgeAvoidNodes);
  const nodes = useNodes();

  const edgePath = useMemo(() => {
    const getDefaultPath = (): string => {
      switch (edgeStyle) {
        case 'smoothstep':
          return getSmoothStepPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
            borderRadius: 8,
          })[0];
        case 'straight':
          return getStraightPath({
            sourceX,
            sourceY,
            targetX,
            targetY,
          })[0];
        case 'bezier':
        default:
          return getBezierPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
          })[0];
      }
    };

    if (!edgeAvoidNodes || edgeStyle === 'straight') {
      return getDefaultPath();
    }

    const nodeRects: Rect[] = nodes
      .filter((n: Node) => n.id !== source && n.id !== target)
      .map((n: Node) => ({
        x: n.position.x,
        y: n.position.y,
        width: n.width || 220,
        height: n.height || 80,
      }))
      .filter((rect) => {
        const minX = Math.min(sourceX, targetX);
        const maxX = Math.max(sourceX, targetX);
        const minY = Math.min(sourceY, targetY);
        const maxY = Math.max(sourceY, targetY);
        return (
          rect.x + rect.width > minX - 30 &&
          rect.x < maxX + 30 &&
          rect.y + rect.height > minY - 30 &&
          rect.y < maxY + 30
        );
      });

    const defaultPath = getDefaultPath();

    const pathHitsAnyNode = (path: string, padding = 0): boolean => {
      for (const rect of nodeRects) {
        if (pathIntersectsRect(path, rect, padding)) {
          return true;
        }
      }
      return false;
    };

    if (!pathHitsAnyNode(defaultPath)) {
      return defaultPath;
    }

    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const isHorizontal = Math.abs(dx) > Math.abs(dy);

    const tryOffset = (offset: number): string | null => {
      let p: string;

      if (edgeStyle === 'smoothstep') {
        const offsetX = isHorizontal ? 0 : offset;
        const offsetY = isHorizontal ? offset : 0;
        const midX = (sourceX + targetX) / 2 + offsetX;
        const midY = (sourceY + targetY) / 2 + offsetY;

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

        p = p1 + ' ' + p2.replace(/^M[^L]*L/, 'L');
      } else {
        let c1x = sourceX;
        let c1y = sourceY;
        let c2x = targetX;
        let c2y = targetY;

        if (isHorizontal) {
          c1x = sourceX + dx * 0.5;
          c2x = targetX - dx * 0.5;
          c1y = sourceY + offset;
          c2y = targetY + offset;
        } else {
          c1y = sourceY + dy * 0.5;
          c2y = targetY - dy * 0.5;
          c1x = sourceX + offset;
          c2x = targetX + offset;
        }

        p = `M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`;
      }

      return pathHitsAnyNode(p) ? null : p;
    };

    const baseOffset = 60;
    const offsets = [
      baseOffset,
      -baseOffset,
      baseOffset * 2,
      -baseOffset * 2,
      baseOffset * 3,
      -baseOffset * 3,
      baseOffset * 1.5,
      -baseOffset * 1.5,
    ];

    for (const offset of offsets) {
      const result = tryOffset(offset);
      if (result) return result;
    }

    return defaultPath;
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, edgeStyle, edgeAvoidNodes, nodes, source, target]);

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
