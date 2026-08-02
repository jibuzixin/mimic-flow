import { contextBridge, ipcRenderer } from 'electron';

export type IpcChannel =
  | 'app:get-platform'
  | 'app:get-version'
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
  | 'dialog:select-folder'
  | 'dialog:select-file'
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
  | 'ai:chat-step'
  | 'usage:get'
  | 'usage:reset'
  | 'flow-v2:run'
  | 'flow-v2:stop'
  | 'flow-v2:status'
  | 'shell:open-path'
  | 'shell:open-external'
  | 'app:get-default-paths'
  | 'execution:list'
  | 'execution:get'
  | 'execution:delete'
  | 'execution:clear'
  | 'execution:stats'
  | 'execution:reportPath'
  | 'execution:openReport'
  | 'execution:getBaseDir'
  | 'system:pick-coordinate'
  | 'system:record-keys'
  | 'system:get-dpi-scale'
  | 'system:set-dpi-scale'
  | 'system:move-mouse'
  | 'system:open-clt-installer'
  | 'system:dev-mouse-click'
  | 'system:dev-mouse-down'
  | 'system:dev-mouse-up'
  | 'system:dev-mouse-scroll'
  | 'system:dev-get-mouse-pos'
  | 'system:dev-key-tap'
  | 'system:dev-key-down'
  | 'system:dev-key-up'
  | 'system:dev-smooth-move-mouse'
  | 'window:restore-main'
  | 'window:close-floating'
  | 'floating:get-state'
  | 'execution:setBaseDir'
  | 'scheduled-tasks:list'
  | 'scheduled-tasks:add'
  | 'scheduled-tasks:update'
  | 'scheduled-tasks:delete'
  | 'scheduled-tasks:run-now';

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
