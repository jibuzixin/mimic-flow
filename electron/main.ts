import { app, BrowserWindow, ipcMain, dialog, shell, Notification, protocol, screen } from 'electron';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
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
import type { ScheduledTask } from './store.js';

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
  /** 参与进度计算的总节点数（去重后、排除 start/end），用作进度条分母 */
  totalNodes: number;
  /** 去重后的已完成节点数（分子），进度条 = uniqueCompletedNodes/totalNodes，不会因循环越界 */
  uniqueCompletedNodes: number;
  /** 累计执行次数（含循环节点重复执行），仅用于展示「已经跑了多少步」」 */
  totalInvocations: number;
  /** 兼容旧字段：deprecated，等于 totalInvocations；UI 优先用 uniqueCompletedNodes/totalInvocations */
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
  uniqueCompletedNodes: 0,
  totalInvocations: 0,
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

  const startNode2 = flow.nodes.find((n) => n.nodeType === 'control.start');
  const reachableNodeIds = new Set<string>();
  if (startNode2) {
    const queue: string[] = [startNode2.id];
    reachableNodeIds.add(startNode2.id);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = flow.nodes.find((n) => n.id === currentId);
      if (!currentNode) continue;
      const nextList = currentNode.nextNodes || [];
      for (const next of nextList) {
        if (!reachableNodeIds.has(next.nodeId)) {
          reachableNodeIds.add(next.nodeId);
          queue.push(next.nodeId);
        }
      }
    }
  }
  let totalNodes = Array.from(reachableNodeIds).filter((id) => {
    const node = flow.nodes.find((n) => n.id === id);
    return node && node.nodeType !== 'control.start' && node.nodeType !== 'control.end';
  }).length;

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
    uniqueCompletedNodes: 0,
    totalInvocations: 0,
    completedNodes: 0,
    lastDuration,
    status: 'running',
    runningNodes: [],
    currentEngine: '',
  };

  let completedNodes = 0;
  const uniqueCompletedNodeIds = new Set<string>();

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
      const nodeId = (evt as any).nodeId;
      if (nodeId) uniqueCompletedNodeIds.add(nodeId);
      floatingState.uniqueCompletedNodes = uniqueCompletedNodeIds.size;
      floatingState.totalInvocations = completedNodes;
      floatingState.completedNodes = completedNodes;
      const nodeName = floatingState.runningNodes.shift();
      sendToFloating('floating:node-complete', {
        nodeId,
        duration: (evt as any).duration,
        completedNodes,
        uniqueCompletedNodes: uniqueCompletedNodeIds.size,
        totalInvocations: completedNodes,
        totalNodes,
        nodeName,
        runningNodes: [...floatingState.runningNodes],
      });
    } else if (evt.type === 'node:error') {
      completedNodes++;
      const nodeId = (evt as any).nodeId;
      if (nodeId) uniqueCompletedNodeIds.add(nodeId);
      floatingState.uniqueCompletedNodes = uniqueCompletedNodeIds.size;
      floatingState.totalInvocations = completedNodes;
      floatingState.completedNodes = completedNodes;
      const nodeName = floatingState.runningNodes.shift();
      sendToFloating('floating:node-error', {
        nodeId,
        duration: (evt as any).duration,
        error: (evt as any).error,
        completedNodes,
        uniqueCompletedNodes: uniqueCompletedNodeIds.size,
        totalInvocations: completedNodes,
        totalNodes,
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
      // flow-complete 时进度直接修正到 100%（避免循环等边界情况差一点没满）
      floatingState.uniqueCompletedNodes = floatingState.totalNodes || uniqueCompletedNodeIds.size;
      floatingState.totalInvocations = completedNodes;
      floatingState.completedNodes = completedNodes;

      sendToFloating('floating:flow-complete', {
        status,
        duration,
        // 把最终的进度也一起带过去，flow-complete 直接拉满 100% 视觉
        uniqueCompletedNodes: floatingState.uniqueCompletedNodes,
        totalInvocations: completedNodes,
        totalNodes: floatingState.totalNodes,
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
/** 跟踪鼠标按下状态 — 平滑移动时有按下键就用 dragMouse，否则 moveMouse */
const devPressedMouseButtons = new Set<string>();
const MODIFIER_KEYS = new Set(['control', 'shift', 'command', 'alt']);

function loadSystemRobot(): any {
  if (systemRobotLoaded) return robot;
  systemRobotLoaded = true;
  try {
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

ipcMain.handle('system:move-mouse', async (_event, x: number, y: number) => {
  try {
    const robot = loadSystemRobot();
    if (!robot) return false;
    robot.moveMouse(x, y);
    return true;
  } catch (error) {
    console.error('[system:move-mouse] failed:', error);
    return false;
  }
});

// macOS：一键唤起系统自带的 Xcode Command Line Tools 安装弹框
// ⚠️ 不会「静默安装」：xcode-select --install 只会弹出 macOS 标准的 CLT 安装窗口，
//    用户需要手动点击「安装」→「同意许可」，安装进程归系统所有，我们不做任何绕过。
ipcMain.handle('system:open-clt-installer', async () => {
  if (process.platform !== 'darwin') return { ok: false, reason: 'only-macos' };
  try {
    const cp = await import('child_process');
    cp.execFile('/usr/bin/xcode-select', ['--install'], (err) => {
      if (err) {
        // xcode-select --install 正常情况下会启动安装弹框然后立即 exit(1) 加 stderr 提示，
        // 这是 Apple 设计的行为，不是错误。
        console.warn('[system:open-clt-installer] xcode-select exit (expected):', String(err?.message || err));
      }
    });
    return { ok: true, note: '已弹出 macOS 系统安装引导，请在系统弹窗中点击「安装」' };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
});

// ========== 开发者模式：系统底层功能测试 API（单个操作）==========
ipcMain.handle('system:dev-get-mouse-pos', async () => {
  try {
    const robot = loadSystemRobot();
    if (!robot) return null;
    return robot.getMousePos();
  } catch (e) {
    return null;
  }
});

ipcMain.handle('system:dev-mouse-click', async (_event, button: 'left' | 'right' | 'middle' = 'left') => {
  try {
    const robot = loadSystemRobot();
    if (!robot) return { ok: false, error: 'robotjs 未加载' };
    robot.mouseClick(button);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
});

ipcMain.handle('system:dev-mouse-down', async (_event, button: 'left' | 'right' | 'middle' = 'left') => {
  try {
    const r = loadSystemRobot();
    if (!r) return { ok: false, error: 'robotjs 未加载' };
    // robotjs: mouseToggle(state, button)
    r.mouseToggle('down', button);
    devPressedMouseButtons.add(button);

    // macOS Finder 拖拽必须：120ms 等待 Finder 进入准备拖动状态 + 轻微抖动突破 drag-threshold
    await new Promise((res) => setTimeout(res, 120));
    const p = r.getMousePos();
    const jx = Number(p.x) || 0;
    const jy = Number(p.y) || 0;
    r.dragMouse(jx + 3, jy + 2);
    await new Promise((res) => setTimeout(res, 20));
    r.dragMouse(jx, jy);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
});

ipcMain.handle('system:dev-mouse-up', async (_event, button: 'left' | 'right' | 'middle' = 'left') => {
  try {
    const r = loadSystemRobot();
    if (!r) return { ok: false, error: 'robotjs 未加载' };
    r.mouseToggle('up', button);
    devPressedMouseButtons.delete(button);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
});

ipcMain.handle('system:dev-mouse-scroll', async (_event, direction: 'up' | 'down' | 'left' | 'right' = 'down', amount = 3) => {
  try {
    const robot = loadSystemRobot();
    if (!robot) return { ok: false, error: 'robotjs 未加载' };
    const map: Record<string, [number, number]> = {
      up: [0, amount],
      down: [0, -amount],
      left: [-amount, 0],
      right: [amount, 0],
    };
    const [dx, dy] = map[direction] || map.down;
    robot.scrollMouse(dx, dy);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
});

ipcMain.handle('system:dev-smooth-move-mouse', async (_event, payload: { x: number; y: number; duration?: number; mode?: 'ease' | 'linear' }) => {
  try {
    const r = loadSystemRobot();
    if (!r) return { ok: false, error: 'robotjs 未加载' };
    const duration = Math.max(0, Number(payload.duration ?? 200));
    const mode = payload.mode === 'linear' ? 'linear' : 'ease';
    const isDrag = devPressedMouseButtons.size > 0;
    const stepFn = (x: number, y: number) =>
      isDrag ? r.dragMouse(x, y) : r.moveMouse(x, y);

    const startPos = r.getMousePos();
    const fromX = Number(startPos.x) || 0;
    const fromY = Number(startPos.y) || 0;
    const dx = payload.x - fromX;
    const dy = payload.y - fromY;

    if (duration <= 0 || (dx === 0 && dy === 0)) {
      stepFn(payload.x, payload.y);
      return { ok: true };
    }

    const stepInterval = 8;
    const totalSteps = Math.max(1, Math.round(duration / stepInterval));
    const actualInterval = duration / totalSteps;

    for (let i = 1; i <= totalSteps; i++) {
      const t = i / totalSteps;
      const easeT = mode === 'linear' ? t : t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = Math.round(fromX + dx * easeT);
      const y = Math.round(fromY + dy * easeT);
      stepFn(x, y);
      if (i < totalSteps) {
        await new Promise((res) => setTimeout(res, actualInterval));
      }
    }
    stepFn(payload.x, payload.y);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
});

function normalizeKeyName(raw: string): string {
  const map: Record<string, string> = {
    ctrl: 'control', control: 'control',
    shift: 'shift',
    alt: 'alt', option: 'alt',
    cmd: 'command', command: 'command', win: 'command', meta: 'command', '⌘': 'command',
    ' ': 'space', space: 'space',
    return: 'enter', '↵': 'enter',
    esc: 'escape',
    '←': 'left', '→': 'right', '↑': 'up', '↓': 'down',
  };
  const lower = raw.trim().toLowerCase();
  return map[lower] ?? lower;
}

ipcMain.handle('system:dev-key-tap', async (_event, keys: string[]) => {
  try {
    const robot = loadSystemRobot();
    if (!robot) return { ok: false, error: 'robotjs 未加载' };
    const arr = Array.isArray(keys) ? keys.map((k) => normalizeKeyName(k)) : [];
    if (arr.length === 0) return { ok: false, error: '未指定按键' };
    if (arr.length === 1) {
      robot.keyTap(arr[0]);
    } else {
      robot.keyTap(arr[arr.length - 1], arr.slice(0, -1));
    }
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
});

ipcMain.handle('system:dev-key-down', async (_event, keys: string[]) => {
  try {
    const r = loadSystemRobot();
    if (!r) return { ok: false, error: 'robotjs 未加载' };
    const arr = Array.isArray(keys) ? keys.map((k) => normalizeKeyName(k)) : [];
    if (arr.length === 0) return { ok: false, error: '未指定按键' };

    const modifiers = arr.filter((k) => MODIFIER_KEYS.has(k));
    const nonModifiers = arr.filter((k) => !MODIFIER_KEYS.has(k));

    // 修饰键：用 keyToggle 逐个保持按下
    for (const m of modifiers) {
      r.keyToggle(m, 'down');
      await new Promise((res) => setTimeout(res, 8));
    }
    // 非修饰字符：一个都不 keyToggle 'down'（macOS 会判定为"长按字符输入"→ 触发输入法）
    //              → 全部改用 keyTap(普通键, [已按下的修饰符]) 一次完成
    if (nonModifiers.length > 0) {
      for (let n = 0; n < nonModifiers.length - 1; n++) {
        r.keyTap(nonModifiers[n], modifiers.slice());
        await new Promise((res) => setTimeout(res, 50));
      }
      const last = nonModifiers[nonModifiers.length - 1];
      r.keyTap(last, modifiers.slice());
    }
    return { ok: true, keys: arr };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
});

ipcMain.handle('system:dev-key-up', async (_event, keys: string[]) => {
  try {
    const r = loadSystemRobot();
    if (!r) return { ok: false, error: 'robotjs 未加载' };
    const arr = Array.isArray(keys) ? keys.map((k) => normalizeKeyName(k)) : [];

    const modifiers = arr.filter((k) => MODIFIER_KEYS.has(k));
    const nonModifiers = arr.filter((k) => !MODIFIER_KEYS.has(k));

    // 先兜底抬起非修饰符（虽然 keyTap 通常自己弹了，但 keyToggle 可能保持，安全起见挨个 up 一下）
    for (let i = nonModifiers.length - 1; i >= 0; i--) {
      try { r.keyToggle(nonModifiers[i], 'up'); } catch { /* noop */ }
      await new Promise((res) => setTimeout(res, 5));
    }
    // 修饰键逆序抬起
    for (let i = modifiers.length - 1; i >= 0; i--) {
      r.keyToggle(modifiers[i], 'up');
      await new Promise((res) => setTimeout(res, 8));
    }
    return { ok: true, keys: arr };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
});

// ========== 定时任务调度器 ==========
interface PendingRun {
  taskId: string;
  scheduledAt: number;
  trigger: 'schedule' | 'manual';
}

let taskQueue: PendingRun[] = [];
let taskRunning = false;
let taskPollTimer: NodeJS.Timeout | null = null;
let taskRunInstanceId: string | null = null;

function parseCronField(field: string, min: number, max: number): number[] {
  const result: number[] = [];
  if (field === '*') {
    for (let i = min; i <= max; i++) result.push(i);
    return result;
  }
  const parts = field.split(',');
  for (const part of parts) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const base = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    let start = min;
    let end = max;
    if (base !== '*') {
      const rangeMatch = base.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        start = parseInt(rangeMatch[1], 10);
        end = parseInt(rangeMatch[2], 10);
      } else {
        start = parseInt(base, 10);
        end = start;
      }
    }
    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max && !result.includes(i)) result.push(i);
    }
  }
  return result.sort((a, b) => a - b);
}

function computeCronNextRun(expr: string, from: number): number {
  const fields = expr.trim().split(/\s+/);
  const hasSecond = fields.length === 6;
  if (fields.length !== 5 && !hasSecond) {
    throw new Error('Cron 表达式需要 5~6 段');
  }
  const sField = hasSecond ? fields.shift()! : '0';
  const [minF, hourF, domF, monthF, dowF] = fields;
  const secs = parseCronField(sField, 0, 59);
  const mins = parseCronField(minF, 0, 59);
  const hours = parseCronField(hourF, 0, 23);
  const doms = parseCronField(domF, 1, 31);
  const months = parseCronField(monthF, 1, 12);
  const dows = parseCronField(dowF, 0, 6);
  const d = new Date(from + 1000);
  d.setMilliseconds(0);
  for (let i = 0; i < 366 * 24 * 60 * 60; i++) {
    if (!months.includes(d.getMonth() + 1)) { d.setDate(1); d.setMonth(d.getMonth() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!doms.includes(d.getDate()) || !dows.includes(d.getDay())) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!hours.includes(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!mins.includes(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    if (!secs.includes(d.getSeconds())) { d.setSeconds(d.getSeconds() + 1, 0); continue; }
    return d.getTime();
  }
  return from + 86400000;
}

function computeNextRunAt(task: ScheduledTask, after: number = Date.now()): number {
  if (task.triggerType === 'once') return task.nextRunAt;
  if (task.triggerType === 'interval' && task.intervalMs) {
    const base = Math.max(after, task.nextRunAt || after);
    if (base <= after) {
      const delta = after - base;
      const steps = Math.floor(delta / task.intervalMs) + 1;
      return base + steps * task.intervalMs;
    }
    return base;
  }
  if (task.triggerType === 'cron' && task.cronExpression) {
    try { return computeCronNextRun(task.cronExpression, after); } catch (e) { /* ignore */ }
  }
  return after + 86400000;
}

function rescheduleTask(taskId: string) {
  const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) return;
  const task = tasks[idx];
  const now = Date.now();
  task.lastRunAt = now;
  if (task.triggerType === 'once') {
    task.enabled = false;
  } else {
    task.nextRunAt = computeNextRunAt(task, now);
  }
  task.updatedAt = now;
  tasks[idx] = task;
  getStore().set('scheduledTasks', tasks);
}

function findWorkflowData(workflowId: string): FlowSchemaV2 | null {
  try {
    const dir = ensureWorkflowsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), 'utf-8');
        const data = JSON.parse(content);
        if (data.id === workflowId) {
          return (data.workflow as FlowSchemaV2) || null;
        }
      } catch {
        // continue
      }
    }
  } catch (e) {
    console.warn('[scheduler] findWorkflowData failed:', e);
  }
  return null;
}

async function runNextPendingTask() {
  if (taskRunning || taskQueue.length === 0) return;
  taskRunning = true;
  try {
    while (taskQueue.length > 0) {
      const next = taskQueue.shift()!;
      const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
      const task = tasks.find((t) => t.id === next.taskId);
      if (!task) continue;
      const flow = findWorkflowData(task.workflowId);
      if (!flow) {
        console.warn('[scheduler] 定时任务对应工作流不存在:', task.workflowId);
        rescheduleTask(task.id);
        continue;
      }
      try {
        console.log(`[scheduler] 触发定时任务: ${task.name} (workflow=${task.workflowId})`);
        if (Notification.isSupported()) {
          new Notification({
            title: '⏰ 定时任务触发',
            body: `正在执行：${task.name}`,
          }).show();
        }

        const flowName = task.workflowName || flow.flowMeta?.name || '工作流';
        const wfId = task.workflowId;

        let completedNodes = 0;
        const startNode2 = flow.nodes.find((n) => n.nodeType === 'control.start');
        const reachableNodeIds = new Set<string>();
        if (startNode2) {
          const queue2: string[] = [startNode2.id];
          reachableNodeIds.add(startNode2.id);
          while (queue2.length > 0) {
            const currentId = queue2.shift()!;
            const currentNode = flow.nodes.find((n) => n.id === currentId);
            if (!currentNode) continue;
            const nextList = currentNode.nextNodes || [];
            for (const nx of nextList) {
              if (!reachableNodeIds.has(nx.nodeId)) { reachableNodeIds.add(nx.nodeId); queue2.push(nx.nodeId); }
            }
          }
        }
        const totalNodes = Array.from(reachableNodeIds).filter((id) => {
          const n = flow.nodes.find((x) => x.id === id);
          return n && n.nodeType !== 'control.start' && n.nodeType !== 'control.end';
        }).length;

        const res = await runFlowV2(flow, (evt: any) => {
          try { mainWindow?.webContents.send('flow-v2:event', evt); } catch {}
          if (evt.type === 'node:complete') completedNodes++;
          if (evt.type === 'flow:complete') {
            const status = (evt as any).status;
            const duration = (evt as any).duration || 0;
            const logs = (evt as any).logs || [];
            const nodeStats = (evt as any).nodeStats || { total: totalNodes, success: completedNodes, failed: 0 };
            const reportPath = (evt as any).reportPath;
            const eventStartTime = (evt as any).startTime || (Date.now() - duration);
            const eventEndTime = (evt as any).endTime || Date.now();
            try {
              getExecutionRecordService().saveExecution(
                {
                  workflowId: wfId,
                  workflowName: flowName,
                  status,
                  startTime: eventStartTime,
                  endTime: eventEndTime,
                  duration,
                  nodeTotal: nodeStats.total || totalNodes,
                  nodeSuccess: nodeStats.success ?? completedNodes,
                  nodeFailed: nodeStats.failed ?? 0,
                  tokenInput: 0, tokenOutput: 0, tokenTotal: 0, cost: 0,
                },
                logs,
                reportPath || undefined,
              );
            } catch (e) {
              console.error('[scheduler] Failed to save execution record:', e);
            }
            const durationSec = (duration / 1000).toFixed(1);
            let title = ''; let body = '';
            if (status === 'success') { title = '✅ 定时任务执行成功'; body = `${task.name} 已完成，耗时 ${durationSec} 秒`; }
            else if (status === 'failed') { title = '❌ 定时任务执行失败'; body = `${task.name} 失败，请查看日志`; }
            else if (status === 'stopped') { title = '⏹️ 定时任务已停止'; body = `${task.name} 已被停止`; }
            if (Notification.isSupported() && title) new Notification({ title, body }).show();
          }
        }, { workflowId: wfId, workflowName: flowName });
        taskRunInstanceId = (res as any)?.instanceId || null;
        await (getV2Scheduler() as any)?.waitForDone?.().catch(() => {});
      } catch (e) {
        console.error('[scheduler] 定时任务执行失败:', e);
      } finally {
        rescheduleTask(task.id);
      }
    }
  } finally {
    taskRunning = false;
    taskRunInstanceId = null;
    broadcastTasksState();
  }
}

function taskPollTick() {
  const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
  const now = Date.now();
  const changedTasks: ScheduledTask[] = [];
  for (const task of tasks) {
    if (!task.enabled) continue;
    // 排队中已经有该任务就不重复加了
    if (taskQueue.some((p) => p.taskId === task.id)) continue;
    // 运行中的工作流如果就是这个任务，也跳过（防止递归）
    if (taskRunning && taskQueue.length === 0) { /* still running previous one */ }
    if (now >= task.nextRunAt) {
      // 需要排队，告诉用户（如果正在运行别的任务）
      if (taskRunning) {
        if (Notification.isSupported()) {
          new Notification({
            title: '⏰ 定时任务排队',
            body: `「${task.name}」触发时间到，当前有任务执行中，已加入队列。`,
          }).show();
        }
      }
      taskQueue.push({ taskId: task.id, scheduledAt: task.nextRunAt, trigger: 'schedule' });
      changedTasks.push(task);
    }
  }
  if (changedTasks.length > 0) broadcastTasksState();
  runNextPendingTask().catch((e) => console.error('[scheduler] runNext error', e));
}

function startTaskPolling() {
  if (taskPollTimer) return;
  taskPollTimer = setInterval(taskPollTick, 10_000);
  taskPollTick();
}

function broadcastTasksState() {
  try {
    const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
    mainWindow?.webContents.send('scheduled-tasks:update', {
      tasks,
      running: taskRunning,
      queueSize: taskQueue.length,
      runInstanceId: taskRunInstanceId,
    });
  } catch (e) { /* ignore */ }
}

ipcMain.handle('scheduled-tasks:list', async () => {
  const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
  // 顺手刷新一次下次运行时间（保证 UI 看起来准确）
  const now = Date.now();
  const updated = tasks.map((t) => {
    if (!t.enabled) return t;
    if (t.nextRunAt <= now && t.triggerType !== 'once') {
      return { ...t, nextRunAt: computeNextRunAt(t, now) };
    }
    return t;
  });
  return {
    tasks: updated,
    running: taskRunning,
    queueSize: taskQueue.length,
    runInstanceId: taskRunInstanceId,
  };
});

ipcMain.handle('scheduled-tasks:add', async (_event, payload: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'nextRunAt'> & { nextRunAt?: number }) => {
  const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  let nextRunAt = payload.nextRunAt || now + 60_000;
  const draft: ScheduledTask = {
    ...payload,
    id,
    nextRunAt,
    createdAt: now,
    updatedAt: now,
  };
  if (!payload.nextRunAt) draft.nextRunAt = computeNextRunAt(draft, now);
  tasks.push(draft);
  getStore().set('scheduledTasks', tasks);
  broadcastTasksState();
  return draft;
});

ipcMain.handle('scheduled-tasks:update', async (_event, id: string, patch: Partial<ScheduledTask>) => {
  const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) throw new Error('任务不存在');
  const merged: ScheduledTask = { ...tasks[idx], ...patch, updatedAt: Date.now() };
  merged.nextRunAt = computeNextRunAt(merged, Date.now());
  tasks[idx] = merged;
  getStore().set('scheduledTasks', tasks);
  broadcastTasksState();
  return merged;
});

ipcMain.handle('scheduled-tasks:delete', async (_event, id: string) => {
  const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
  const remaining = tasks.filter((t) => t.id !== id);
  taskQueue = taskQueue.filter((q) => q.taskId !== id);
  getStore().set('scheduledTasks', remaining);
  broadcastTasksState();
  return true;
});

ipcMain.handle('scheduled-tasks:run-now', async (_event, id: string) => {
  const tasks = getStore().get('scheduledTasks') as ScheduledTask[] | undefined || [];
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error('任务不存在');
  taskQueue.push({ taskId: task.id, scheduledAt: Date.now(), trigger: 'manual' });
  broadcastTasksState();
  runNextPendingTask().catch((e) => console.error('[scheduler] run-now error', e));
  return true;
});

// app ready 时启动轮询（在 createWindow 后面会自动 ready，这里直接启动一次）
app.whenReady().then(() => {
  startTaskPolling();
}).catch(() => {});
