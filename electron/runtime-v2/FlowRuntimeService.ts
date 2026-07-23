import { FlowScheduler } from './FlowScheduler.js';
import type { FlowSchema, RuntimeEvent } from '../../types/flow-v2.js';

let currentScheduler: FlowScheduler | null = null;

export function getV2Scheduler(): FlowScheduler | null {
  return currentScheduler;
}

export async function runFlowV2(flow: FlowSchema, onEvent?: (event: RuntimeEvent) => void): Promise<void> {
  if (currentScheduler && currentScheduler.getStatus() === 'running') {
    throw new Error('已有工作流正在运行，请先停止');
  }

  currentScheduler = new FlowScheduler(flow);

  if (onEvent) {
    currentScheduler.on('event', onEvent);
  }

  try {
    await currentScheduler.start();
  } finally {
    // 保留 scheduler 用于查询结果，下次运行时覆盖
  }
}

export function stopFlowV2(): void {
  if (currentScheduler) {
    currentScheduler.stop();
  }
}

export function getFlowStatusV2() {
  if (!currentScheduler) {
    return { status: 'idle' as const };
  }
  return {
    status: currentScheduler.getStatus(),
    nodeStates: Object.fromEntries(currentScheduler.getNodeStates()),
    logs: currentScheduler.getLogs(),
    variables: currentScheduler.getVariablePool(),
  };
}
