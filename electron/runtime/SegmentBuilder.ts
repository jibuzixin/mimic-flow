import type { FlowNode, FlowNodeType } from '../../types/flow.js';

const CONTROL_NODE_TYPES: FlowNodeType[] = ['if', 'loop'];

/**
 * 从起始节点开始，收集一段连续的线性操作节点。
 * 遇到控制节点（if/loop）或分支立即截断。
 */
export function buildContinuousSegment(
  startNode: FlowNode,
  nodeMap: Map<string, FlowNode>
): FlowNode[] {
  const segment: FlowNode[] = [startNode];
  if (CONTROL_NODE_TYPES.includes(startNode.nodeType)) {
    return segment;
  }

  let cursor = startNode;
  while (true) {
    // 只取无条件单条后继
    const nextRoute = cursor.nextNodes.find((r) => !r.condition);
    if (!nextRoute) break;

    const nextNode = nodeMap.get(nextRoute.nodeId);
    if (!nextNode) break;

    // 遇到控制节点立刻截断
    if (CONTROL_NODE_TYPES.includes(nextNode.nodeType)) {
      break;
    }

    segment.push(nextNode);
    cursor = nextNode;
  }

  return segment;
}
