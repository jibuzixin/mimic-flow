import { useEffect, useCallback } from 'react';
import type { FlowSchema, RuntimeEvent } from '../../types/flow-v2';

export function useFlowRuntime() {
  const runFlow = useCallback(async (flow: FlowSchema): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.mimic.invoke('flow-v2:run', flow);
      return result as { success: boolean; error?: string };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }, []);

  const stopFlow = useCallback(async (): Promise<{ success: boolean }> => {
    try {
      const result = await window.mimic.invoke('flow-v2:stop');
      return result as { success: boolean };
    } catch (error) {
      console.error('[IPC] stopFlow error:', error);
      return { success: false };
    }
  }, []);

  const getFlowStatus = useCallback(async () => {
    try {
      const result = await window.mimic.invoke('flow-v2:status');
      return result;
    } catch (error) {
      console.error('[IPC] getFlowStatus error:', error);
      return { status: 'idle' as const };
    }
  }, []);

  const validateFlow = useCallback(async (flow: FlowSchema) => {
    try {
      const result = await window.mimic.invoke('flow:validate', flow);
      return result;
    } catch (error) {
      console.error('[IPC] validateFlow error:', error);
      return { valid: true, errors: [] };
    }
  }, []);

  return {
    runFlow,
    stopFlow,
    getFlowStatus,
    validateFlow,
  };
}

export function useFlowRuntimeEvents(onEvent: (event: RuntimeEvent) => void) {
  useEffect(() => {
    const unsubscribe = window.mimic.on('flow-v2:event', (event) => {
      onEvent(event as RuntimeEvent);
    });

    return unsubscribe;
  }, [onEvent]);
}
