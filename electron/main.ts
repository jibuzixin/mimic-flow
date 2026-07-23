import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getStore } from './store.js';
import { getLogger } from './logger.js';
import { aiChat, getUsageStatistics, resetUsageStatistics } from './ai/index.js';
import { parseVideo } from './video/index.js';
import { registerRecorderIpc } from './recorder.js';
import { FlowRuntimeService } from './runtime/FlowRuntimeService.js';
import { MidsceneAdapter } from './midscene/adapter.js';
import { runFlowV2, stopFlowV2, getFlowStatusV2 } from './runtime-v2/FlowRuntimeService.js';
import type { FlowSchema, FlowFileWrapper } from '../types/flow.js';
import type { FlowSchema as FlowSchemaV2, RuntimeEvent as RuntimeEventV2 } from '../types/flow-v2.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

type StoreKey =
  | 'modelProvider'
  | 'midsceneModel'
  | 'videoSavePath'
  | 'videoParseConcurrency'
  | 'globalRuntimeOption'
  | 'shortcutKeys'
  | 'ui'
  | 'workflows'
  | 'usageStatistics'
  | 'models'
  | 'defaultModelIds'
  | 'logSavePath'
  | 'workflowSavePath'
  | 'ui.sidebarCollapsed';

const midsceneAdapter = new MidsceneAdapter();
const flowRuntimeService = new FlowRuntimeService(midsceneAdapter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createMainWindow() {
  const preloadPath = join(__dirname, 'preload.cjs');
  console.log('[Main] __dirname:', __dirname);
  console.log('[Main] preload path:', preloadPath);
  console.log('[Main] preload exists:', existsSync(preloadPath));

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page finished loading, checking window.mimic...');
    mainWindow.webContents.executeJavaScript('window.mimic ? "mimic EXISTS" : "mimic NOT FOUND"')
      .then((result) => console.log('[Main] window.mimic check:', result))
      .catch((e) => console.error('[Main] window.mimic check failed:', e));
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    getLogger().info('Main window ready to show');
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  flowRuntimeService.setMainWindow(mainWindow);

  return mainWindow;
}

app.whenReady().then(() => {
  getLogger().info('App ready', { platform: process.platform, version: app.getVersion() });
  registerRecorderIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('app:get-platform', () => process.platform);
ipcMain.handle('app:get-versions', () => ({
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
}));

ipcMain.handle('store:get', (_event, key: string) => getStore().get(key as StoreKey));
ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
  getStore().set(key as StoreKey, value);
  return true;
});
ipcMain.handle('store:delete', (_event, key: string) => {
  getStore().delete(key as StoreKey);
  return true;
});

ipcMain.handle('store:clear', () => {
  getStore().clear();
  return true;
});

ipcMain.handle('log:write', (_event, level: string, message: string, meta?: Record<string, unknown>) => {
  const log = getLogger();
  const logMethod = log[level as 'debug' | 'info' | 'warn' | 'error'];
  if (typeof logMethod === 'function') {
    logMethod.call(log, message, meta);
  }
});

ipcMain.handle('logs:list-files', () => {
  return { success: true, data: getLogger().listLogFiles() };
});

ipcMain.handle('logs:read-file', (_event, filePath: string, limit?: number, offset?: number) => {
  try {
    const result = getLogger().readLogFile(filePath, limit ?? 500, offset ?? 0);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: { code: 'READ_ERROR', message } };
  }
});

ipcMain.handle('logs:memory', () => {
  return { success: true, data: getLogger().getMemoryLogs() };
});

ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.minimize();
});
ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});
ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

ipcMain.handle('dialog:select-video', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:open-path', async (_event, path: string) => {
  if (!path) return false;
  try {
    const fs = await import('fs');
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
    }
    await shell.openPath(path);
    return true;
  } catch (e) {
    console.error('[shell:open-path] error:', e);
    return false;
  }
});

ipcMain.handle('app:get-default-paths', async () => {
  const userDataPath = app.getPath('userData');
  return {
    log: `${userDataPath}/logs`,
    workflow: `${userDataPath}/workflows`,
    userData: userDataPath,
  };
});

ipcMain.handle('workflow:list', async () => {
  return getStore().get('workflows') || [];
});

ipcMain.handle('workflow:save', async (_event, workflow: unknown) => {
  const workflows = (getStore().get('workflows') || []) as unknown[];
  const index = workflows.findIndex((w: any) => w.id === (workflow as any).id);
  if (index >= 0) {
    workflows[index] = workflow;
  } else {
    workflows.push(workflow);
  }
  getStore().set('workflows', workflows);
  return true;
});

ipcMain.handle('workflow:delete', async (_event, id: string) => {
  const workflows = (getStore().get('workflows') || []) as any[];
  getStore().set('workflows', workflows.filter((w) => w.id !== id));
  return true;
});

ipcMain.handle('workflow:execute', async (_event, _workflowId: string) => {
  getLogger().info('Workflow execute requested (placeholder)');
  return { success: false, error: '执行模块尚未实现' };
});

// ========== 流程调度 IPC ==========
ipcMain.handle('flow:validate', async (_event, flow: FlowSchema) => {
  return flowRuntimeService.validate(flow);
});

ipcMain.handle('flow:run', async (_event, flow: FlowSchema) => {
  return flowRuntimeService.run(flow);
});

ipcMain.handle('flow:stop', async (_event, runInstanceId: string) => {
  return flowRuntimeService.stop(runInstanceId);
});

// ========== v2 工作流运行时 IPC ==========
ipcMain.handle('flow-v2:run', async (event, flow: FlowSchemaV2) => {
  console.log('[flow-v2:run] Received flow run request:', flow?.flowMeta?.name);
  const webContents = event.sender;

  runFlowV2(flow, (evt: RuntimeEventV2) => {
    try {
      webContents.send('flow-v2:event', evt);
    } catch (e) {
      console.error('[flow-v2:run] Failed to send event to renderer:', e);
    }
  }).catch((err) => {
    console.error('[flow-v2:run] Flow execution error:', err);
    // 发送错误事件到前端
    try {
      webContents.send('flow-v2:event', {
        type: 'flow:complete',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {}
  });

  console.log('[flow-v2:run] Flow execution started in background');
  return { success: true };
});

ipcMain.handle('flow-v2:stop', async () => {
  console.log('[flow-v2:stop] Stop request received');
  stopFlowV2();
  return { success: true };
});

ipcMain.handle('flow-v2:status', async () => {
  return getFlowStatusV2();
});

// ========== 流程文件 IPC ==========
ipcMain.handle('file:save-flow', async (_event, filePath: string, wrapper: FlowFileWrapper) => {
  try {
    writeFileSync(filePath, JSON.stringify(wrapper, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: { code: 'SAVE_ERROR', message } };
  }
});

ipcMain.handle('file:open-flow', async (_event, filePath: string) => {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const wrapper = JSON.parse(content) as FlowFileWrapper;
    return { success: true, data: wrapper };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: { code: 'OPEN_ERROR', message } };
  }
});

// ========== 全局配置 IPC ==========
ipcMain.handle('config:get', async () => {
  return {
    success: true,
    data: {
      defaultMidsceneModel: getStore().get('midsceneModel'),
      videoParseModel: getStore().get('modelProvider'),
      globalRuntimeOption: getStore().get('globalRuntimeOption'),
      models: getStore().get('models'),
      defaultModelIds: getStore().get('defaultModelIds'),
    },
  };
});

ipcMain.handle('config:set', async (_event, config: { midsceneModel?: unknown; modelProvider?: unknown; globalRuntimeOption?: unknown; models?: unknown; defaultModelIds?: unknown }) => {
  if (config.midsceneModel) getStore().set('midsceneModel', config.midsceneModel);
  if (config.modelProvider) getStore().set('modelProvider', config.modelProvider);
  if (config.globalRuntimeOption) getStore().set('globalRuntimeOption', config.globalRuntimeOption);
  if (config.models) getStore().set('models', config.models);
  if (config.defaultModelIds) getStore().set('defaultModelIds', config.defaultModelIds);
  return { success: true };
});

ipcMain.handle('dialog:select-flow-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Flow Files', extensions: ['flow.json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:save-flow-file', async (_event, defaultName?: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName || 'untitled.flow.json',
    filters: [
      { name: 'Flow Files', extensions: ['flow.json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('ai:parse-video', async (_event, videoPath: string, options?: { mode?: 'simple' | 'smart' | 'native'; compress?: boolean; fps?: number; maxFrames?: number; maxImagesPerRequest?: number; concurrency?: number; prompt?: string }) => {
  getLogger().info('AI parse video requested', { videoPath, options });
  const result = await parseVideo({
    videoPath,
    compress: options?.compress ?? true,
    frameOptions: {
      mode: options?.mode ?? 'smart',
      fps: options?.fps,
      maxFrames: options?.maxFrames,
    },
    maxImagesPerRequest: options?.maxImagesPerRequest,
    concurrency: options?.concurrency,
    customPrompt: options?.prompt,
  });
  return result;
});

ipcMain.handle('ai:chat-step', async (_event, prompt: string) => {
  try {
    const response = await aiChat({
      modelType: 'text',
      messages: [
        { role: 'system', content: '你是桌面操作助手，用户会描述他想让电脑执行的操作。请给出简洁、可执行的下一步建议。' },
        { role: 'user', content: prompt },
      ],
      feature: 'chat',
    });
    return { success: true, content: response.content, usage: response.usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getLogger().error('AI chat step failed', { error: message });
    return { success: false, error: message };
  }
});

ipcMain.handle('usage:get', async () => {
  return getUsageStatistics();
});

ipcMain.handle('usage:reset', async () => {
  resetUsageStatistics();
  getLogger().info('Usage statistics reset');
  return true;
});
