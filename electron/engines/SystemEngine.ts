import type {
  FlowEngine,
  EngineEvent,
  SegmentResult,
  FlowNode,
  EngineInitConfig,
} from '../../types/flow-v2.js';
import { getLogger } from '../logger.js';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getStore } from '../store.js';

export class SystemEngine implements FlowEngine {
  name = 'system';
  displayName = '系统操作引擎';
  supportedNodeTypes = ['system.*'];

  private initConfig: EngineInitConfig | null = null;
  private log = getLogger();
  private robot: any = null;
  private screenshot: any = null;
  private sharp: any = null;
  private cv: any = null;
  private cvReady: Promise<void> | null = null;
  private dpiScale: number = 1;
  private require: NodeRequire;

  constructor() {
    this.require = createRequire(import.meta.url);
  }

  async initialize(config: EngineInitConfig): Promise<void> {
    this.initConfig = config;
    this.log.info('[SystemEngine] Initializing system engine');

    try {
      this.robot = this.require('robotjs');
      this.log.info('[SystemEngine] robotjs loaded');
    } catch (e) {
      this.log.warn('[SystemEngine] robotjs not available', { error: (e as Error).message });
    }

    try {
      this.screenshot = this.require('screenshot-desktop');
      this.log.info('[SystemEngine] screenshot-desktop loaded');
    } catch (e) {
      this.log.warn('[SystemEngine] screenshot-desktop not available', { error: (e as Error).message });
    }

    try {
      this.sharp = this.require('sharp');
      this.log.info('[SystemEngine] sharp loaded');
    } catch (e) {
      this.log.warn('[SystemEngine] sharp not available', { error: (e as Error).message });
    }

    try {
      const opencv = this.require('opencv-wasm');
      this.cv = opencv.cv;
      this.cvReady = opencv.cvReady;
      await this.cvReady;
      this.log.info('[SystemEngine] opencv-wasm loaded');
    } catch (e) {
      this.log.warn('[SystemEngine] opencv-wasm not available', { error: (e as Error).message });
    }

    const storedDpi = getStore().get('systemDpiScale') as number | undefined;
    if (storedDpi !== undefined && storedDpi !== null) {
      this.dpiScale = storedDpi;
    } else {
      const platform = process.platform;
      if (platform === 'darwin') {
        this.dpiScale = 2.0;
      } else {
        this.dpiScale = 1.0;
      }
    }
    this.log.info('[SystemEngine] DPI scale', { scale: this.dpiScale });
  }

  async executeSegment(
    segment: FlowNode[],
    variablePool: Record<string, unknown>,
    signal: AbortSignal,
    onEvent: (event: EngineEvent) => void,
  ): Promise<SegmentResult> {
    const outputs: Record<string, unknown> = {};

    for (const node of segment) {
      if (signal.aborted) {
        return { success: false, outputs, aborted: true };
      }

      onEvent({ type: 'node:start', nodeId: node.id });

      try {
        const result = await this.executeNode(node, variablePool, signal, onEvent);
        outputs[node.id] = result;
        onEvent({ type: 'node:complete', nodeId: node.id, output: result });
      } catch (error) {
        const errorMsg = (error as Error).message;
        onEvent({ type: 'node:error', nodeId: node.id, error: errorMsg });
        return { success: false, outputs, error: errorMsg };
      }
    }

    return { success: true, outputs };
  }

  private async executeNode(
    node: FlowNode,
    variablePool: Record<string, unknown>,
    signal: AbortSignal,
    onEvent: (event: EngineEvent) => void,
  ): Promise<unknown> {
    const params = node.nodeParams as any;

    switch (node.nodeType) {
      case 'system.sleep':
        return this.executeSleep(params);
      case 'system.click':
      case 'system.doubleClick':
      case 'system.rightClick':
      case 'system.hover':
        return this.executeMouseAction(node.nodeType, params, variablePool);
      case 'system.input':
        return this.executeInput(params, variablePool);
      case 'system.keyboard':
        return this.executeKeyboard(params, variablePool);
      case 'system.scroll':
        return this.executeScroll(params, variablePool);
      case 'system.waitForImage':
        return this.executeWaitForImage(params, variablePool, signal, onEvent);
      default:
        throw new Error(`未知系统节点类型: ${node.nodeType}`);
    }
  }

  private executeSleep(params: any): Promise<boolean> {
    const duration = Number(params.duration || 1000);
    return new Promise((resolve) => {
      setTimeout(() => resolve(true), duration);
    });
  }

  private async executeMouseAction(
    nodeType: string,
    params: any,
    variablePool: Record<string, unknown>,
  ): Promise<{ x: number; y: number }> {
    this.ensureRobot();

    const locateMode = params.locateMode || 'coordinate';
    let targetX = 0;
    let targetY = 0;

    if (locateMode === 'coordinate') {
      targetX = Number(this.resolveValue(params.x, variablePool) || 0);
      targetY = Number(this.resolveValue(params.y, variablePool) || 0);
    } else if (locateMode === 'image') {
      const result = await this.locateImage(params, variablePool);
      if (!result) {
        const onError = params.onError || 'stop';
        if (onError === 'continue') {
          return { x: -1, y: -1 };
        }
        throw new Error('图片匹配失败，未找到目标位置');
      }
      targetX = result.x;
      targetY = result.y;
    } else {
      throw new Error(`未知定位方式: ${locateMode}`);
    }

    const moveDuration = Number(params.moveDuration || 200);
    this.robot.moveMouse(targetX, targetY);
    await this.sleep(moveDuration);

    if (nodeType === 'system.hover') {
      return { x: targetX, y: targetY };
    }

    const button = nodeType === 'system.rightClick' ? 'right' : 'left';
    const clicks = nodeType === 'system.doubleClick' ? 2 : 1;
    const interval = Number(params.clickInterval || 200);

    for (let i = 0; i < clicks; i++) {
      this.robot.mouseClick(button);
      if (i < clicks - 1) {
        await this.sleep(interval);
      }
    }

    return { x: targetX, y: targetY };
  }

  private async executeInput(
    params: any,
    variablePool: Record<string, unknown>,
  ): Promise<boolean> {
    this.ensureRobot();

    const needLocate = params.needLocate === true;

    if (needLocate) {
      const locateMode = params.locateMode || 'coordinate';
      let targetX = 0;
      let targetY = 0;

      if (locateMode === 'coordinate') {
        targetX = Number(this.resolveValue(params.x, variablePool) || 0);
        targetY = Number(this.resolveValue(params.y, variablePool) || 0);
      } else if (locateMode === 'image') {
        const result = await this.locateImage(params, variablePool);
        if (!result) {
          const onError = params.onError || 'stop';
          if (onError === 'continue') {
            return false;
          }
          throw new Error('图片匹配失败，未找到输入框位置');
        }
        targetX = result.x;
        targetY = result.y;
      }

      const moveDuration = Number(params.moveDuration || 200);
      this.robot.moveMouse(targetX, targetY);
      await this.sleep(moveDuration);
      this.robot.mouseClick('left');
      await this.sleep(200);
    }

    const text = String(this.resolveValue(params.value, variablePool) || '');
    if (text) {
      this.robot.typeString(text);
    }

    return true;
  }

  private async executeKeyboard(
    params: any,
    variablePool: Record<string, unknown>,
  ): Promise<boolean> {
    this.ensureRobot();

    const keyGroups = Array.isArray(params.keyGroups) ? params.keyGroups : [];
    const groupInterval = Number(params.groupInterval || 300);

    for (let i = 0; i < keyGroups.length; i++) {
      const group = keyGroups[i];
      const keys = Array.isArray(group.keys) ? group.keys : [];

      if (keys.length === 0) continue;

      if (keys.length === 1) {
        const keyName = this.normalizeKeyName(keys[0]);
        this.robot.keyTap(keyName);
      } else {
        const modifierKeys = keys.slice(0, -1).map((k: string) => this.normalizeKeyName(k));
        const mainKey = this.normalizeKeyName(keys[keys.length - 1]);
        this.robot.keyTap(mainKey, modifierKeys);
      }

      if (i < keyGroups.length - 1) {
        await this.sleep(groupInterval);
      }
    }

    return true;
  }

  private async executeScroll(
    params: any,
    variablePool: Record<string, unknown>,
  ): Promise<boolean> {
    this.ensureRobot();

    const needLocate = params.needLocate === true;

    if (needLocate) {
      const locateMode = params.locateMode || 'coordinate';
      let targetX = 0;
      let targetY = 0;

      if (locateMode === 'coordinate') {
        targetX = Number(this.resolveValue(params.x, variablePool) || 0);
        targetY = Number(this.resolveValue(params.y, variablePool) || 0);
      } else if (locateMode === 'image') {
        const result = await this.locateImage(params, variablePool);
        if (!result) {
          const onError = params.onError || 'stop';
          if (onError === 'continue') {
            return false;
          }
          throw new Error('图片匹配失败，未找到滚动位置');
        }
        targetX = result.x;
        targetY = result.y;
      }

      const moveDuration = Number(params.moveDuration || 200);
      this.robot.moveMouse(targetX, targetY);
      await this.sleep(moveDuration);
    }

    const direction = params.direction || 'down';
    const amount = Number(params.amount || 3);

    let scrollX = 0;
    let scrollY = 0;

    switch (direction) {
      case 'up':
        scrollY = amount;
        break;
      case 'down':
        scrollY = -amount;
        break;
      case 'left':
        scrollX = -amount;
        break;
      case 'right':
        scrollX = amount;
        break;
    }

    this.robot.scrollMouse(scrollX, scrollY);

    return true;
  }

  private async executeWaitForImage(
    params: any,
    variablePool: Record<string, unknown>,
    signal: AbortSignal,
    onEvent: (event: EngineEvent) => void,
  ): Promise<boolean> {
    const timeout = Number(params.timeout || 30000);
    const checkInterval = Number(params.checkInterval || 500);
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (signal.aborted) {
        return false;
      }

      const result = await this.locateImage(params, variablePool);
      if (result) {
        onEvent({
          type: 'log',
          level: 'info',
          message: `✅ 图片匹配成功，位置: (${result.x}, ${result.y})`,
        });
        return true;
      }

      await this.sleep(checkInterval);
    }

    onEvent({
      type: 'log',
      level: 'warn',
      message: '⏱️ 图片匹配超时',
    });
    return false;
  }

  private async locateImage(
    params: any,
    variablePool: Record<string, unknown>,
  ): Promise<{ x: number; y: number } | null> {
    if (!this.cv || !this.sharp || !this.screenshot) {
      throw new Error('图片匹配功能不可用，请确保已安装 opencv-wasm、sharp 和 screenshot-desktop');
    }

    const imageData = this.resolveValue(params.templateImage, variablePool);
    if (!imageData) {
      throw new Error('缺少模板图片');
    }

    const confidence = Number(params.confidence || 0.9);

    let templateBuffer: Buffer;
    if (typeof imageData === 'string' && imageData.startsWith('data:image')) {
      const base64 = imageData.split(',')[1];
      templateBuffer = Buffer.from(base64, 'base64');
    } else if (typeof imageData === 'string' && fs.existsSync(imageData)) {
      templateBuffer = fs.readFileSync(imageData);
    } else {
      throw new Error('模板图片格式不正确');
    }

    const displayId = this.initConfig?.displayId;
    const screenOpts: any = {};
    if (displayId !== undefined && displayId !== null) {
      screenOpts.id = displayId;
    }

    const screenBuf: Buffer = await this.screenshot(screenOpts);

    const templateGray = await this.sharp(templateBuffer).grayscale().raw().toBuffer();
    const templateMeta = await this.sharp(templateBuffer).metadata();

    const screenGray = await this.sharp(screenBuf).grayscale().raw().toBuffer();
    const screenMeta = await this.sharp(screenBuf).metadata();

    const screenMat = new this.cv.Mat(screenMeta.height, screenMeta.width, this.cv.CV_8UC1);
    screenMat.data.set(new Uint8Array(screenGray));

    const templateMat = new this.cv.Mat(templateMeta.height, templateMeta.width, this.cv.CV_8UC1);
    templateMat.data.set(new Uint8Array(templateGray));

    const resultMat = new this.cv.Mat();
    this.cv.matchTemplate(screenMat, templateMat, resultMat, this.cv.TM_CCOEFF_NORMED);

    const minMax = this.cv.minMaxLoc(resultMat);
    const maxVal = minMax.maxVal;
    const maxLoc = minMax.maxLoc;

    let result: { x: number; y: number } | null = null;
    if (maxVal >= confidence) {
      const physX = maxLoc.x + templateMeta.width / 2;
      const physY = maxLoc.y + templateMeta.height / 2;
      result = {
        x: Math.round(physX / this.dpiScale),
        y: Math.round(physY / this.dpiScale),
      };
    }

    screenMat.delete();
    templateMat.delete();
    resultMat.delete();

    return result;
  }

  private resolveValue(value: unknown, variablePool: Record<string, unknown>): unknown {
    if (typeof value !== 'string') return value;
    if (!value.includes('{{')) return value;

    return value.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_, varName) => {
      const parts = varName.split('.');
      let current: any = variablePool;
      for (const part of parts) {
        if (current === undefined || current === null) return '';
        current = current[part];
      }
      return current !== undefined && current !== null ? String(current) : '';
    });
  }

  private normalizeKeyName(key: string): string {
    const keyMap: Record<string, string> = {
      'ctrl': 'control',
      'control': 'control',
      'alt': 'alt',
      'shift': 'shift',
      'meta': 'command',
      'command': 'command',
      'cmd': 'command',
      'enter': 'enter',
      'return': 'enter',
      'esc': 'escape',
      'escape': 'escape',
      'tab': 'tab',
      'space': 'space',
      ' ': 'space',
      'backspace': 'backspace',
      'delete': 'delete',
      'up': 'up',
      'down': 'down',
      'left': 'left',
      'right': 'right',
      'home': 'home',
      'end': 'end',
      'pageup': 'pageup',
      'pagedown': 'pagedown',
      'f1': 'f1',
      'f2': 'f2',
      'f3': 'f3',
      'f4': 'f4',
      'f5': 'f5',
      'f6': 'f6',
      'f7': 'f7',
      'f8': 'f8',
      'f9': 'f9',
      'f10': 'f10',
      'f11': 'f11',
      'f12': 'f12',
    };

    const lowerKey = key.toLowerCase().trim();
    return keyMap[lowerKey] || lowerKey;
  }

  private ensureRobot(): void {
    if (!this.robot) {
      throw new Error('robotjs 不可用，请确保已安装 robotjs');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async dispose(): Promise<void> {
    this.log.info('[SystemEngine] Disposing');
    this.robot = null;
    this.screenshot = null;
    this.sharp = null;
    this.cv = null;
  }
}
