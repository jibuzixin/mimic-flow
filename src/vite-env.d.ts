/// <reference types="vite/client" />

type MimicIpcChannel =
  | 'app:get-platform'
  | 'app:get-versions'
  | 'store:get'
  | 'store:set'
  | 'store:delete'
  | 'log:write'
  | 'logs:list-files'
  | 'logs:read-file'
  | 'logs:memory'
  | 'window:minimize'
  | 'window:maximize'
  | 'window:close'
  | 'dialog:select-video'
  | 'dialog:select-folder'
  | 'recorder:start'
  | 'recorder:stop'
  | 'recorder:pause'
  | 'recorder:resume'
  | 'recorder:save-blob'
  | 'workflow:list'
  | 'workflow:save'
  | 'workflow:delete'
  | 'workflow:execute'
  | 'flow:validate'
  | 'flow:run'
  | 'flow:stop'
  | 'file:save-flow'
  | 'file:open-flow'
  | 'config:get'
  | 'config:set'
  | 'dialog:select-flow-file'
  | 'dialog:save-flow-file'
  | 'ai:parse-video'
  | 'ai:chat-step'
  | 'usage:get'
  | 'usage:reset'
  | 'flow-v2:run'
  | 'flow-v2:stop'
  | 'flow-v2:status'
  | 'shell:open-path'
  | 'app:get-default-paths';

declare global {
  interface Window {
    mimic: {
      platform: string;
      versions: {
        node: string;
        chrome: string;
        electron: string;
      };
      invoke: (channel: MimicIpcChannel, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
      once: (channel: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

export {};

