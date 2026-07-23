import { contextBridge, ipcRenderer } from 'electron';

export type IpcChannel =
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

const api = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },

  invoke: (channel: IpcChannel, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },

  once: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },
};

contextBridge.exposeInMainWorld('mimic', api);

export type MimicApi = typeof api;
