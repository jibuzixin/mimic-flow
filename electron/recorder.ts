import { BrowserWindow, desktopCapturer, ipcMain, app } from 'electron';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { getStore } from './store.js';
import { getLogger } from './logger.js';

let isRecording = false;

export function registerRecorderIpc() {
  ipcMain.handle('recorder:start', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: '窗口未找到' };
    }

    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (sources.length === 0) {
        return { success: false, error: '未找到屏幕源' };
      }

      const source = sources[0];
      win.webContents.send('recorder:source', { sourceId: source.id });
      isRecording = true;
      getLogger().info('Recording source selected', { sourceId: source.id, name: source.name });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger().error('Failed to start recording', { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle('recorder:stop', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: '窗口未找到' };
    }

    win.webContents.send('recorder:stop');
    getLogger().info('Recording stop requested');
    return { success: true };
  });

  ipcMain.handle('recorder:save-blob', async (_event, arrayBuffer: ArrayBuffer, mimeType: string) => {
    try {
      const saveDir = (getStore().get('videoSavePath') as string) || app.getPath('videos');
      mkdirSync(saveDir, { recursive: true });

      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const filename = `recording_${Date.now()}.${ext}`;
      const filePath = join(saveDir, filename);
      writeFileSync(filePath, Buffer.from(arrayBuffer));

      isRecording = false;
      getLogger().info('Recording saved', { filePath, mimeType });
      return { success: true, path: filePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger().error('Failed to save recording', { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle('recorder:pause', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: '窗口未找到' };
    }

    win.webContents.send('recorder:pause');
    return { success: true };
  });

  ipcMain.handle('recorder:resume', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: '窗口未找到' };
    }

    win.webContents.send('recorder:resume');
    return { success: true };
  });
}

export function getRecordingState() {
  return isRecording;
}
