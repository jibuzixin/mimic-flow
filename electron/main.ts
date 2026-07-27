import { app, BrowserWindow, ipcMain, dialog, shell, Notification, protocol, screen } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';
import { getStore } from './store.js';
import { getLogger } from './logger.js';
import { aiChat, getUsageStatistics, resetUsageStatistics } from './ai/index.js';
import { FlowRuntimeService } from './runtime/FlowRuntimeService.js';
import { MidsceneAdapter } from './midscene/adapter.js';
import { runFlowV2, stopFlowV2, getFlowStatusV2, getV2Scheduler } from './runtime-v2/FlowRuntimeService.js';
import { getExecutionRecordService } from './execution/ExecutionRecordService.js';
import type { FlowSchema, FlowFileWrapper } from '../types/flow.js';
import type { FlowSchema as FlowSchemaV2, RuntimeEvent as RuntimeEventV2 } from '../types/flow-v2.js';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';

type StoreKey =
  | 'modelProvider'
  | 'midsceneModel'
  | 'globalRuntimeOption'
  | 'shortcutKeys'
  | 'ui'
  | 'workflows'
  | 'usageStatistics'
  | 'models'
  | 'defaultModelIds'
  | 'logSavePath'
  | 'workflowSavePath'
  | 'ui.sidebarCollapsed'
  | 'systemDpiScale';

const midsceneAdapter = new MidsceneAdapter();
const flowRuntimeService = new FlowRuntimeService(midsceneAdapter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = (process.env.NODE_ENV === 'development' || !app.isPackaged) && process.env.MIMIC_FORCE_PROD !== 'true';

function getDistPath(...paths: string[]) {
  return join(__dirname, '..', '..', 'dist', ...paths);
}

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;

interface FloatingState {
  workflowName: string;
  currentNode: string;
  startTime: number;
  totalNodes: number;
  completedNodes: number;
  lastDuration: number | null;
  status: 'idle' | 'running' | 'success' | 'failed' | 'stopped';
  runningNodes: string[];
  currentEngine: string;
}

let floatingState: FloatingState = {
  workflowName: '',
  currentNode: '',
  startTime: 0,
  totalNodes: 0,
  completedNodes: 0,
  lastDuration: null,
  status: 'idle',
  runningNodes: [],
  currentEngine: '',
};

function createFloatingWindow(): Promise<BrowserWindow> {
  return new Promise((resolve, reject) => {
    if (floatingWindow) {
      floatingWindow.focus();
      resolve(floatingWindow);
      return;
    }

    const preloadPath = join(__dirname, 'preload.cjs');
    const { width: displayWidth, height: displayHeight } =
      screen.getPrimaryDisplay().workAreaSize;

    const windowWidth = 320;
    const windowHeight = 260;
    const margin = 24;

    floatingWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: displayWidth - windowWidth - margin,
      y: displayHeight - windowHeight - margin,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      roundedCorners: true,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    floatingWindow.on('closed', () => {
      floatingWindow = null;
    });

    const handleFailed = (error: Error) => {
      reject(error);
    };

    floatingWindow.webContents.once('did-finish-load', () => {
      floatingWindow?.webContents.removeListener('did-fail-load', handleFailed as any);
      if (floatingWindow) {
        floatingWindow.showInactive();
        floatingWindow.setOpacity(0);
        let opacity = 0;
        const fadeIn = setInterval(() => {
          opacity += 0.1;
          if (opacity >= 1) {
            opacity = 1;
            clearInterval(fadeIn);
          }
          floatingWindow?.setOpacity(opacity);
        }, 16);
        resolve(floatingWindow);
      }
    });

    floatingWindow.webContents.once('did-fail-load', handleFailed as any);

    if (isDev) {
      floatingWindow.loadURL('http://localhost:5173/floating');
    } else {
      floatingWindow.loadFile(getDistPath('index.html'), {
        hash: '/floating',
      });
    }
  });
}

function closeFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    const win = floatingWindow;
    let opacity = 1;
    const fadeOut = setInterval(() => {
      opacity -= 0.15;
      if (opacity <= 0) {
        clearInterval(fadeOut);
        if (!win.isDestroyed()) {
          win.close();
        }
      } else {
        win.setOpacity(opacity);
      }
    }, 16);
  }
}

function sendToFloating(channel: string, data: unknown) {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send(channel, data);
  }
}

function createMainWindow() {
  const preloadPath = join(__dirname, 'preload.cjs');
  console.log('[Main] __dirname:', __dirname);
  console.log('[Main] preload path:', preloadPath);
  console.log('[Main] preload exists:', existsSync(preloadPath));

  const win = new BrowserWindow({
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

  mainWindow = win;

  win.webContents.on('did-finish-load', () => {
    console.log('[Main] Page finished loading, checking window.mimic...');
    win.webContents.executeJavaScript('window.mimic ? "mimic EXISTS" : "mimic NOT FOUND"')
      .then((result) => console.log('[Main] window.mimic check:', result))
      .catch((e) => console.error('[Main] window.mimic check failed:', e));
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(getDistPath('index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
    getLogger().info('Main window ready to show');
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  flowRuntimeService.setMainWindow(win);

  return win;
}

app.whenReady().then(async () => {
  getLogger().info('App ready', { platform: process.platform, version: app.getVersion() });
  try {
    const customLogPath = getStore().get('logSavePath') as string | undefined;
    await getExecutionRecordService().init(customLogPath || undefined);
    getLogger().info('ExecutionRecordService initialized', { baseDir: getExecutionRecordService().getBaseDir() });
  } catch (e) {
    getLogger().error('Failed to initialize ExecutionRecordService', { error: e instanceof Error ? e.message : String(e) });
  }

  protocol.handle('midscene-report', (request) => {
    try {
      const url = new URL(request.url);
      const relativePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const baseDir = getExecutionRecordService().getBaseDir();
      const resolvedPath = path.resolve(baseDir, relativePath);
      
      if (!resolvedPath.startsWith(baseDir)) {
        return new Response('Forbidden', { status: 403 });
      }
      
      if (!existsSync(resolvedPath)) {
        return new Response('Not Found', { status: 404 });
      }
      
      const stat = statSync(resolvedPath);
      if (stat.isDirectory()) {
        return new Response('Not Found', { status: 404 });
      }
      
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      
      const data = readFileSync(resolvedPath);
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': contentType },
      });
    } catch (e) {
      console.error('[midscene-report] protocol error:', e);
      return new Response('Internal Server Error', { status: 500 });
    }
  });

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

ipcMain.handle('window:restore-main', () => {
  if (mainWindow) {
    mainWindow.setOpacity(1);
    mainWindow.show();
    mainWindow.focus();
  }
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.close();
    floatingWindow = null;
  }
});

ipcMain.handle('window:close-floating', () => {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.close();
    floatingWindow = null;
  }
  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.setOpacity(1);
    mainWindow.show();
  }
});

ipcMain.handle('floating:get-state', () => {
  return { ...floatingState };
});

ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:select-file', async (_event, options?: { multiSelections?: boolean; filters?: { name: string; extensions: string[] }[] }) => {
  const properties: ('openFile' | 'multiSelections')[] = ['openFile'];
  if (options?.multiSelections) properties.push('multiSelections');
  const result = await dialog.showOpenDialog({
    properties,
    filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled) return null;
  return options?.multiSelections ? result.filePaths : result.filePaths[0];
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

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (!url) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch (e) {
    console.error('[shell:open-external] error:', e);
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

function getWorkflowsDir(): string {
  const customPath = getStore().get('workflowSavePath') as string | undefined;
  return customPath || join(app.getPath('userData'), 'workflows');
}

function ensureWorkflowsDir(): string {
  const dir = getWorkflowsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
}

ipcMain.handle('workflow:list', async () => {
  const dir = ensureWorkflowsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const workflows: unknown[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const data = JSON.parse(content);
      if (data.id) {
        workflows.push(data);
      }
    } catch (e) {
      console.warn('[workflow:list] Failed to read workflow file:', file, e);
    }
  }
  return workflows;
});

ipcMain.handle('workflow:get', async (_event, id: string) => {
  const dir = ensureWorkflowsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const data = JSON.parse(content);
      if (data.id === id) {
        return data;
      }
    } catch {}
  }
  return null;
});

ipcMain.handle('workflow:save', async (_event, workflow: any) => {
  const dir = ensureWorkflowsDir();
  const id = workflow.id;
  const name = sanitizeFilename(workflow.name || workflow.flowMeta?.name || id);
  const filename = `${name}_${id}.json`;
  const filePath = join(dir, filename);
  
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const filePathOld = join(dir, file);
      const content = readFileSync(filePathOld, 'utf-8');
      const data = JSON.parse(content);
      if (data.id === id && file !== filename) {
        unlinkSync(filePathOld);
      }
    } catch {}
  }
  
  writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('workflow:delete', async (_event, id: string) => {
  const dir = ensureWorkflowsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const data = JSON.parse(content);
      if (data.id === id) {
        unlinkSync(join(dir, file));
        break;
      }
    } catch {}
  }
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
ipcMain.handle('flow-v2:run', async (event, flow: FlowSchemaV2, options?: { workflowId?: string }) => {
  console.log('[flow-v2:run] Received flow run request:', flow?.flowMeta?.name);
  const webContents = event.sender;
  const win = BrowserWindow.fromWebContents(webContents);

  const startNode = flow.nodes.find((n) => n.nodeType === 'control.start');
  let windowMode = startNode?.nodeParams?.windowMode as string | undefined;
  if (!windowMode && startNode?.nodeParams?.minimizeWindow === true) {
    windowMode = 'minimize';
  }
  windowMode = windowMode || 'none';

  if (windowMode === 'minimize' && win) {
    win.minimize();
  } else if (windowMode === 'floating' && win) {
    try {
      await createFloatingWindow();
      win.hide();
      win.setOpacity(1);
    } catch (e) {
      console.error('[flow-v2:run] Failed to create floating window:', e);
    }
  }

  let flowName = flow.flowMeta?.name || '工作流';
  let wfId = options?.workflowId || flowName;
  let totalNodes = flow.nodes.filter((n) => n.nodeType !== 'control.start' && n.nodeType !== 'control.end').length;

  let lastDuration: number | null = null;
  try {
    const result = getExecutionRecordService().listExecutions({
      workflowId: wfId,
      status: 'success',
      pageSize: 1,
      page: 1,
    });
    if (result && result.items && result.items.length > 0) {
      lastDuration = result.items[0].duration || null;
    }
  } catch (e) {
    console.warn('[flow-v2:run] Failed to get last execution duration:', e);
  }

  floatingState = {
    workflowName: flowName,
    currentNode: '准备中...',
    startTime: Date.now(),
    totalNodes,
    completedNodes: 0,
    lastDuration,
    status: 'running',
    runningNodes: [],
    currentEngine: '',
  };

  let completedNodes = 0;

  runFlowV2(flow, (evt: RuntimeEventV2) => {
    try {
      webContents.send('flow-v2:event', evt);
    } catch (e) {
      console.error('[flow-v2:run] Failed to send event to renderer:', e);
    }

    if (evt.type === 'flow:start') {
      const startTime = (evt as any).startTime || Date.now();
      floatingState.startTime = startTime;
      floatingState.status = 'running';
      sendToFloating('floating:flow-start', {
        workflowName: flowName,
        startTime,
        totalNodes,
        lastDuration,
      });
    } else if (evt.type === 'node:start') {
      const nodeName = (evt as any).nodeName || (evt as any).nodeType || '';
      const nodeType = (evt as any).nodeType || '';
      const engine = nodeType.startsWith('midscene.') ? 'Midscene' : '内置引擎';
      floatingState.currentNode = nodeName;
      if (floatingState.runningNodes.length === 0) {
        floatingState.currentEngine = engine;
      }
      floatingState.runningNodes.push(nodeName);
      sendToFloating('floating:node-start', {
        nodeId: (evt as any).nodeId,
        nodeName,
        nodeType,
        engine,
        runningNodes: [...floatingState.runningNodes],
        currentEngine: floatingState.currentEngine,
      });
    } else if (evt.type === 'node:complete') {
      completedNodes++;
      floatingState.completedNodes = completedNodes;
      const nodeName = floatingState.runningNodes.shift();
      sendToFloating('floating:node-complete', {
        nodeId: (evt as any).nodeId,
        duration: (evt as any).duration,
        completedNodes,
        nodeName,
        runningNodes: [...floatingState.runningNodes],
      });
    } else if (evt.type === 'node:error') {
      completedNodes++;
      floatingState.completedNodes = completedNodes;
      const nodeName = floatingState.runningNodes.shift();
      sendToFloating('floating:node-error', {
        nodeId: (evt as any).nodeId,
        duration: (evt as any).duration,
        error: (evt as any).error,
        nodeName,
        runningNodes: [...floatingState.runningNodes],
      });
    }

    if (evt.type === 'flow:complete') {
      const status = (evt as any).status;
      const duration = (evt as any).duration || 0;
      const durationSec = (duration / 1000).toFixed(1);
      const logs = (evt as any).logs || [];
      const nodeStats = (evt as any).nodeStats || { total: 0, success: 0, failed: 0 };
      const reportPath = (evt as any).reportPath;
      const eventWorkflowId = (evt as any).workflowId || wfId;
      const eventWorkflowName = (evt as any).workflowName || flowName;
      const eventStartTime = (evt as any).startTime || (Date.now() - duration);
      const eventEndTime = (evt as any).endTime || Date.now();
      
      floatingState.status = status;
      floatingState.currentNode = status === 'success' ? '执行完成' : status === 'stopped' ? '已停止' : '执行失败';
      
      sendToFloating('floating:flow-complete', {
        status,
        duration,
      });
      
      try {
        getExecutionRecordService().saveExecution(
          {
            workflowId: eventWorkflowId,
            workflowName: eventWorkflowName,
            status,
            startTime: eventStartTime,
            endTime: eventEndTime,
            duration,
            nodeTotal: nodeStats.total,
            nodeSuccess: nodeStats.success,
            nodeFailed: nodeStats.failed,
            tokenInput: 0,
            tokenOutput: 0,
            tokenTotal: 0,
            cost: 0,
          },
          logs,
          reportPath || undefined,
        );
      } catch (e) {
        console.error('[flow-v2:run] Failed to save execution record:', e);
      }
      
      let title = '';
      let body = '';
      if (status === 'success') {
        title = '✅ 工作流执行成功';
        body = `${flowName} 已完成，耗时 ${durationSec} 秒`;
      } else if (status === 'failed') {
        title = '❌ 工作流执行失败';
        body = `${flowName} 执行失败，请查看日志`;
      } else if (status === 'stopped') {
        title = '⏹️ 工作流已停止';
        body = `${flowName} 已被用户停止`;
      }

      if (Notification.isSupported() && title) {
        new Notification({ title, body }).show();
      }
    }
  }, { workflowId: wfId, workflowName: flowName }).catch((err) => {
    console.error('[flow-v2:run] Flow execution error:', err);
    // 发送错误事件到前端
    try {
      webContents.send('flow-v2:event', {
        type: 'flow:complete',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {}

    sendToFloating('floating:flow-complete', {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });

    if (Notification.isSupported()) {
      new Notification({
        title: '❌ 工作流执行失败',
        body: `${flowName} 执行失败: ${err instanceof Error ? err.message : String(err)}`,
      }).show();
    }
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

// ========== 执行记录 IPC ==========
ipcMain.handle('execution:list', async (_event, query?: any) => {
  try {
    const result = getExecutionRecordService().listExecutions(query || {});
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('execution:get', async (_event, id: string) => {
  try {
    const detail = getExecutionRecordService().getExecution(id);
    return { success: true, data: detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('execution:delete', async (_event, id: string) => {
  try {
    const result = getExecutionRecordService().deleteExecution(id);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('execution:clear', async (_event, days: number) => {
  try {
    const count = getExecutionRecordService().clearOldExecutions(days);
    return { success: true, data: { count } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('execution:stats', async () => {
  try {
    const stats = getExecutionRecordService().getDashboardStats();
    return { success: true, data: stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('execution:reportPath', async (_event, id: string) => {
  try {
    const path = getExecutionRecordService().getMidsceneReportPath(id);
    return { success: true, data: path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('execution:openReport', async (_event, id: string) => {
  try {
    const path = getExecutionRecordService().getMidsceneReportPath(id);
    if (path) {
      shell.openExternal(`file://${path}`);
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('execution:getBaseDir', async () => {
  try {
    const dir = getExecutionRecordService().getBaseDir();
    return { success: true, data: dir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('execution:setBaseDir', async (_event, dir: string) => {
  try {
    await getExecutionRecordService().setBaseDir(dir);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
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

// ====== System IPC Handlers ======

let robot: any = null;
let systemRobotLoaded = false;

function loadSystemRobot(): any {
  if (systemRobotLoaded) return robot;
  systemRobotLoaded = true;
  try {
    const { createRequire } = require('module');
    const req = createRequire(import.meta.url);
    robot = req('robotjs');
    getLogger().info('[System] robotjs loaded');
    return robot;
  } catch (e) {
    getLogger().warn('[System] robotjs not available', { error: (e as Error).message });
    return null;
  }
}

ipcMain.handle('system:pick-coordinate', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('无法获取窗口');

  const display = screen.getPrimaryDisplay();
  const pickerWin = new BrowserWindow({
    width: display.bounds.width,
    height: display.bounds.height,
    x: display.bounds.x,
    y: display.bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  pickerWin.setAlwaysOnTop(true, 'screen-saver');
  pickerWin.setIgnoreMouseEvents(false);

  const crosshairHtml = `
    <html>
    <head><style>
      * { box-sizing: border-box; }
      body { margin:0; cursor:crosshair; background:rgba(0,0,0,0.1); 
        width:100vw; height:100vh; overflow:hidden; }
      .hint { position:fixed; top:24px; left:50%; transform:translateX(-50%); 
        background:rgba(0,0,0,0.75); color:white; padding:10px 20px; border-radius:8px;
        font-family:system-ui; font-size:13px; pointer-events:none; z-index:9999;
        white-space:nowrap; }
      .crosshair-v { position:fixed; top:0; bottom:0; width:1px; 
        background:rgba(255,107,107,0.5); pointer-events:none; z-index:9998; }
      .crosshair-h { position:fixed; left:0; right:0; height:1px; 
        background:rgba(255,107,107,0.5); pointer-events:none; z-index:9998; }
    </style></head>
    <body>
      <div class="hint">点击屏幕任意位置拾取坐标 &nbsp;|&nbsp; 按 ESC 取消</div>
      <div class="crosshair-v" id="cv"></div>
      <div class="crosshair-h" id="ch"></div>
      <script>
        window.__pickClicked = false;
        window.__pickCancelled = false;
        var cv = document.getElementById('cv');
        var ch = document.getElementById('ch');
        document.addEventListener('mousemove', function(e) {
          cv.style.left = e.clientX + 'px';
          ch.style.top = e.clientY + 'px';
        });
        document.addEventListener('click', function() {
          window.__pickClicked = true;
        });
        document.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          window.__pickCancelled = true;
        });
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') {
            window.__pickCancelled = true;
          }
        });
      </script>
    </body>
    </html>
  `;

  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(crosshairHtml);
  await pickerWin.loadURL(dataUrl);

  win.hide();
  pickerWin.focus();

  return new Promise<{ x: number; y: number }>((resolve, reject) => {
    const cleanup = () => {
      try {
        if (!pickerWin.isDestroyed()) {
          pickerWin.close();
        }
      } catch (e) {}
      win.show();
      win.focus();
    };

    pickerWin.on('closed', () => {
      reject(new Error('用户取消拾取'));
    });

    const checkResult = setInterval(() => {
      if (pickerWin.isDestroyed()) {
        clearInterval(checkResult);
        return;
      }
      pickerWin.webContents.executeJavaScript('window.__pickClicked || window.__pickCancelled').then((clicked: any) => {
        if (clicked) {
          clearInterval(checkResult);
          pickerWin.webContents.executeJavaScript('window.__pickCancelled').then((cancelled: any) => {
            const point = screen.getCursorScreenPoint();
            cleanup();
            if (cancelled) {
              reject(new Error('用户取消拾取'));
            } else {
              resolve({ x: point.x, y: point.y });
            }
          }).catch(() => {
            cleanup();
            reject(new Error('拾取失败'));
          });
        }
      }).catch(() => {});
    }, 30);
  });
});

ipcMain.handle('system:record-keys', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('无法获取窗口');

  return new Promise<{ keys: string[] }>((resolve, reject) => {
    try {
      win.webContents.send('system:start-key-record');

      const onRecordResult = (_event: any, result: { keys: string[]; cancelled: boolean }) => {
        ipcMain.removeListener('system:key-record-result', onRecordResult);
        if (result.cancelled) {
          reject(new Error('用户取消录制'));
        } else {
          resolve({ keys: result.keys });
        }
      };

      ipcMain.on('system:key-record-result', onRecordResult);
    } catch (e) {
      reject(e);
    }
  });
});

ipcMain.handle('system:get-dpi-scale', async () => {
  const stored = getStore().get('systemDpiScale') as number | undefined;
  if (stored !== undefined && stored !== null) {
    return stored;
  }
  const platform = process.platform;
  if (platform === 'darwin') return 2.0;
  return 1.0;
});

ipcMain.handle('system:set-dpi-scale', async (_event, scale: number) => {
  getStore().set('systemDpiScale', scale);
  return true;
});
