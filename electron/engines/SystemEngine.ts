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
import { promisify } from 'util';
import { exec as execCP } from 'child_process';
import { getStore } from '../store.js';

const exec = promisify(execCP);

/**
 * CoreGraphics (Quartz) 合成带 modifier flags 的鼠标 click 工具 —— 解决 robotjs mouseToggle 不会继承当前 modifier 的问题。
 *
 * 编译：clang -o /tmp/mimicflow_modclick -framework CoreGraphics -framework CoreFoundation
 * 用法：/tmp/mimicflow_modclick <x_POINT> <y_POINT> <button:left/right/middle> <clicks:1/2> <flags_hex_0x>
 *   注意：x/y 传「点 (point, 逻辑坐标, 和 CGDisplayBounds 单位一致)」，C 代码内部会自动按主屏幕的 backingScaleFactor 转 pixel（像素），
 *        不需要调用方自己乘 dpiScale，避免 DPI 搞混导致坐标翻倍点到屏外。
 *   flags_hex: 0 表示无修饰符；按位或组合：
 *     kCGEventFlagMaskShift   = (1 << 17) = 0x00020000
 *     kCGEventFlagMaskControl = (1 << 18) = 0x00040000
 *     kCGEventFlagMaskAlternate = (1 << 19) = 0x00080000 (option)
 *     kCGEventFlagMaskCommand = (1 << 20) = 0x00100000
 *
 * macOS 自带 clang，无需任何额外依赖。
 */
const MODCLICK_SRC = `
#include <CoreGraphics/CoreGraphics.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

int main(int argc, char *argv[]) {
  if (argc != 6) {
    fprintf(stderr, "Usage: %s <x_POINT> <y_POINT> <left/right/middle> <clicks> <flags_hex_0x>\\n", argv[0]);
    return 1;
  }
  // x/y 先按「点」读，然后按主屏幕 backingScaleFactor 转 pixel
  CGFloat xPoint = (CGFloat)atof(argv[1]);
  CGFloat yPoint = (CGFloat)atof(argv[2]);
  const char *btn = argv[3];
  int clicks = atoi(argv[4]);
  uint64_t flags = (uint64_t)strtoull(argv[5], NULL, 16);

  // 自动读 macOS 主屏幕 backing scale factor：backingScaleFactor = pixel / point
  CGDirectDisplayID mainDisplay = kCGDirectMainDisplay;
  size_t pixelWide = CGDisplayPixelsWide(mainDisplay);
  CGRect bounds = CGDisplayBounds(mainDisplay);
  double scale = (bounds.size.width > 0) ? ((double)pixelWide / (double)bounds.size.width) : 1.0;
  if (scale < 1.0) scale = 1.0;

  CGFloat x = xPoint * scale;
  CGFloat y = yPoint * scale;
  fprintf(stderr, "[modclick] inputPoint={%.1f,%.1f} scale=%.2f → pixel={%.1f,%.1f} flags=0x%llx\\n",
    xPoint, yPoint, scale, x, y, flags);

  CGMouseButton mouseBtn = kCGMouseButtonLeft;
  CGEventType leftDown = kCGEventLeftMouseDown;
  CGEventType leftUp = kCGEventLeftMouseUp;
  if (strcmp(btn, "right") == 0) {
    mouseBtn = kCGMouseButtonRight;
    leftDown = kCGEventRightMouseDown;
    leftUp = kCGEventRightMouseUp;
  } else if (strcmp(btn, "middle") == 0) {
    mouseBtn = kCGMouseButtonCenter;
    leftDown = kCGEventOtherMouseDown;
    leftUp = kCGEventOtherMouseUp;
  }

  CGPoint point = CGPointMake(x, y);
  CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  if (!src) {
    fprintf(stderr, "CGEventSourceCreate failed\\n");
    return 2;
  }

  for (int i = 0; i < clicks; i++) {
    CGEventRef evDown = CGEventCreateMouseEvent(src, leftDown, point, mouseBtn);
    if (!evDown) { continue; }
    if (flags != 0) {
      CGEventSetFlags(evDown, (CGEventFlags)flags);
    }
    if (i > 0) {
      struct timespec ts = {0, 100 * 1000 * 1000 }; // 100ms
      nanosleep(&ts, NULL);
    }
    CGEventPost(kCGHIDEventTap, evDown);

    struct timespec ts1 = {0, 50 * 1000 * 1000}; // 50ms hold
    nanosleep(&ts1, NULL);

    CGEventRef evUp = CGEventCreateMouseEvent(src, leftUp, point, mouseBtn);
    if (evUp) {
      if (flags != 0) {
        CGEventSetFlags(evUp, (CGEventFlags)flags);
      }
      CGEventPost(kCGHIDEventTap, evUp);
      CFRelease(evUp);
    }
    CFRelease(evDown);
  }
  CFRelease(src);
  return 0;
}
`;
// modifier -> CGEventFlags bit
const CG_FLAG = {
  shift:   0x00020000,
  control: 0x00040000,
  alt:     0x00080000,
  command: 0x00100000,
} as const;

function computeCGFlags(mods: string[]): number {
  let flags = 0;
  for (const m of mods) flags |= (CG_FLAG as Record<string, number>)[m] ?? 0;
  return flags;
}

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
  /** 跟踪当前按下的鼠标键 — 平滑移动时据此调用 dragMouse 而不是 moveMouse */
  private readonly pressedMouseButtons = new Set<string>();
  /** 跟踪当前按下的键盘修饰符 (command/shift/alt/control) — click 前会强制重按保证修饰生效 */
  private readonly pressedModifierKeys = new Set<string>();
  /** 运行时按下栈（segment 生命周期内）— keyUp/mouseUp autoSync 时自动从栈顶找最近一次按下的内容 */
  private readonly pressStack: Array<
    | { type: 'mouseDown'; button: string }
    | { type: 'keyDown'; keyGroups: { keys: string[] }[] }
  > = [];
  /** 缓存编译好的 modclick 可执行文件路径（只编译一次） */
  private modClickPath: string | null = null;
  private modClickPromise: Promise<string> | null = null;

  constructor() {
    this.require = createRequire(import.meta.url);
  }

  /**
   * 编译一次性的 modclick 辅助程序（Quartz/CoreGraphics 直接合成带 modifier flags 的 click），
   * 只编译一次，缓存到 os.tmpdir()/mimicflow_modclick_<hash>
   * ⚠️ 仅 macOS (darwin) 有用，Win/Linux 不需要 — 因为 Win32 SendInput / Linux X11 XTestFakeButtonEvent
   *    会自动从全局 modifier 状态表里把 flags 附加到 mouse event 上，直接通过 robotjs keyToggle + mouseToggle 就能生效。
   */
  private ensureModClickBinary(): Promise<string> {
    if (process.platform !== 'darwin') {
      return Promise.reject(new Error(`ensureModClickBinary() only supported on macOS, got ${process.platform}`));
    }
    const MODCLICK_VERSION = 2; // bump this whenever MODCLICK_SRC changes
    const dir = os.tmpdir();
    const hash = `${process.getuid?.() || 'user'}_${process.arch}_${process.platform}_v${MODCLICK_VERSION}`;
    const outPath = path.join(dir, `mimicflow_modclick_${hash}`);
    if (this.modClickPath === outPath) return Promise.resolve(outPath);
    try {
      fs.accessSync(outPath, fs.constants.X_OK);
      this.modClickPath = outPath;
      return Promise.resolve(outPath);
    } catch { /* need compile */ }

    if (this.modClickPromise) return this.modClickPromise;
    this.modClickPromise = (async () => {
      // 🔍 先判断系统有没有 clang / xcodebuild / xcode-select CLT，失败时向前端发专属提示
      const hasClang = await (async () => {
        try {
          await exec('command -v clang >/dev/null 2>&1');
          return true;
        } catch { return false; }
      })();
      if (!hasClang) {
        // 把"缺 CLT"这个信息通过两个渠道打出去：
        //   1) this.log.warn(data: { action: 'openCltInstaller' }) → 引擎日志，FlowRuntimeService 会封装成 RuntimeEvent.type='log' entry
        //   2) workflowStore 前端收到 entry.level==='warn' && entry.data?.action==='openCltInstaller' → 弹窗确认 → invoke('system:open-clt-installer')
        this.log.warn('[modclick] 未检测到 clang（Xcode Command Line Tools），修饰符+点击多选可能不稳定。', {
          action: 'openCltInstaller',
          why: 'clang 未安装 → mimicflow_modclick 无法编译；已自动 fallback 到 robotjs',
        });
      }

      const srcPath = path.join(dir, `mimicflow_modclick_${hash}.c`);
      fs.writeFileSync(srcPath, MODCLICK_SRC, 'utf8');
      const compileCmd = `clang -O2 -o ${JSON.stringify(outPath)} ${JSON.stringify(srcPath)} -framework CoreGraphics -framework CoreFoundation`;
      this.log.info(`[modclick] compiling (v${MODCLICK_VERSION}): ${compileCmd}`);
      try {
        const { stderr } = await exec(compileCmd, { timeout: 15000 });
        if (stderr) this.log.info(`[modclick] clang stderr: ${stderr}`);
        fs.accessSync(outPath, fs.constants.X_OK);
        this.modClickPath = outPath;
        this.log.info(`[modclick] compiled successfully → ${outPath}`);
        return outPath;
      } catch (e: any) {
        const err = (e as Error).message;
        this.log.error(`[modclick] compile FAILED: ${err}`, hasClang ? undefined : { action: 'openCltInstaller', why: '建议安装 Xcode Command Line Tools' });
        this.modClickPromise = null;
        throw new Error(`modclick 编译失败（需要 macOS 自带 clang）: ${err}`);
      }
    })();
    return this.modClickPromise;
  }

  /**
   * Linux: 如果系统里装了 xdotool（debian/ubuntu apt install xdotool / arch pacman -S xdotool），
   * 优先用 xdotool click --window ... 配合 key 命令合成带 modifier 的 click，比 robotjs 更稳。
   */
  private async hasXdotool(): Promise<boolean> {
    try {
      await exec('command -v xdotool >/dev/null 2>&1');
      return true;
    } catch {
      return false;
    }
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
    const globalConfig = getStore().get('globalRuntimeOption') as { systemNodePostDelay?: number };
    const defaultPostDelay = globalConfig?.systemNodePostDelay ?? 500;

    // segment 开始前：清理运行时按下栈 + OS 级残留的按键（上一次执行异常中断时）
    this.pressStack.length = 0;
    this.clearHeldInputState();

    const cleanup = () => {
      this.pressStack.length = 0;
      this.clearHeldInputState();
    };

    try {
      for (let i = 0; i < segment.length; i++) {
        const node = segment[i];
        if (signal.aborted) {
          cleanup();
          return { success: false, outputs, aborted: true };
        }

        onEvent({ type: 'node:start', nodeId: node.id });

        try {
          const result = await this.executeNode(node, variablePool, signal, onEvent, segment, i);
          outputs[node.id] = result;
          onEvent({ type: 'node:complete', nodeId: node.id, output: result });

          const params = node.nodeParams as any;
          const postDelay = typeof params?.postDelay === 'number' ? params.postDelay : defaultPostDelay;
          if (postDelay > 0 && i < segment.length - 1) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, postDelay);
              if (signal.aborted) {
                clearTimeout(timer);
                resolve();
              }
            });
          }
        } catch (error) {
          const errorMsg = (error as Error).message;
          onEvent({ type: 'node:error', nodeId: node.id, error: errorMsg });
          cleanup();
          return { success: false, outputs, error: errorMsg };
        }
      }

      cleanup();
      return { success: true, outputs };
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  /** segment 结束或异常中断时：OS 级把还按着的鼠标键 / 修饰符全部抬起，防止用户自己的输入被锁住 */
  private clearHeldInputState(): void {
    try {
      if (!this.robot) return;
      const heldButtons = Array.from(this.pressedMouseButtons);
      const heldModifiers = Array.from(this.pressedModifierKeys);
      if (heldButtons.length > 0 || heldModifiers.length > 0) {
        this.log.info('[KEY/MOUSE 🔧 清理残留] 本次 segment 结束/中断，抬起所有未释放的按键', {
          heldMouseButtons: heldButtons,
          heldModifierKeys: heldModifiers,
        });
      }
      for (const btn of heldButtons) {
        try { this.robot.mouseToggle('up', btn); } catch { /* noop */ }
      }
      this.pressedMouseButtons.clear();
      for (const m of heldModifiers) {
        try { this.robot.keyToggle(m, 'up'); } catch { /* noop */ }
      }
      this.pressedModifierKeys.clear();
    } catch { /* noop */ }
  }

  /** 向前 segment 里找最近一个匹配的按下节点作为兜底 */
  private findNearestPressNode(
    segment: FlowNode[],
    currentIndex: number,
    targetType: 'system.mouseDown' | 'system.keyDown',
  ): FlowNode | null {
    for (let j = currentIndex - 1; j >= 0; j--) {
      if (segment[j].nodeType === targetType) return segment[j];
    }
    return null;
  }

  private async executeNode(
    node: FlowNode,
    variablePool: Record<string, unknown>,
    signal: AbortSignal,
    onEvent: (event: EngineEvent) => void,
    segment: FlowNode[],
    currentIndex: number,
  ): Promise<unknown> {
    const params = node.nodeParams as any;
    const emitLog = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => {
      onEvent({ type: 'log', level, message, data });
    };

    switch (node.nodeType) {
      case 'system.sleep':
        return this.executeSleep(params);
      case 'system.click':
      case 'system.doubleClick':
      case 'system.rightClick':
      case 'system.hover':
        return this.executeMouseAction(node.nodeType, params, variablePool, emitLog);
      case 'system.mouseDown':
        return this.executeMouseDown(params, variablePool, emitLog);
      case 'system.mouseUp': {
        const resolved = this.resolveMouseUpParams(params, segment, currentIndex);
        return this.executeMouseUp(resolved, emitLog);
      }
      case 'system.input':
        return this.executeInput(params, variablePool, emitLog);
      case 'system.keyboard':
        return this.executeKeyboard(params, variablePool, emitLog);
      case 'system.keyDown':
        return this.executeKeyToggle(params, variablePool, 'down', emitLog);
      case 'system.keyUp': {
        const resolved = this.resolveKeyUpParams(params, segment, currentIndex);
        return this.executeKeyToggle(resolved, variablePool, 'up', emitLog);
      }
      case 'system.scroll':
        return this.executeScroll(params, variablePool, emitLog);
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
    emitLog?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void,
  ): Promise<{ x: number; y: number }> {
    this.ensureRobot();

    const log = (msg: string) => {
      this.log.info(msg);
      emitLog?.('info', msg);
    };

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

    const moveDuration = params.moveDuration === undefined || params.moveDuration === null ? 200 : Number(params.moveDuration);
    const moveMode = params.moveMode === 'linear' ? 'linear' : 'ease';
    await this.smoothMoveMouse(targetX, targetY, moveDuration, moveMode);

    if (nodeType === 'system.hover') {
      return { x: targetX, y: targetY };
    }

    const button = nodeType === 'system.rightClick' ? 'right' : 'left';
    const clicks = nodeType === 'system.doubleClick' ? 2 : 1;
    const interval = Number(params.clickInterval || 200);

    for (let i = 0; i < clicks; i++) {
      const mods = Array.from(this.pressedModifierKeys);

      if (mods.length > 0) {
        // —— 三平台分派 ——
        //   macOS (darwin)：CGEvent flags 缺失问题，走自建 CoreGraphics modclick 工具（flags 直接写进 CGEventSetFlags）
        //   Linux           ：X11/XTestFakeButtonEvent 正确读全局 modifier mask，若装了 xdotool 就优先用它（更稳），否则 robotjs
        //   Windows (win32)：SendInput 的 mouse event 会自动合并全局 VK_ 修饰键状态（应用通过 GetKeyState(VK_SHIFT) 读取），直接 robotjs + 重按修饰符 + 足够长 sleep
        const platform = process.platform as 'darwin' | 'linux' | 'win32' | string;
        log(`[CLICK 🖱️ 修饰符路径] pressedModifierKeys=[${mods.join(', ')}]，platform=${platform}`);

        // point → pixel/screen_coords：先读真实光标位置，避免 smoothMoveMouse 产生的浮点 / 累计误差
        const cur = this.robot.getMousePos();
        const cx = Number(cur.x) || targetX;
        const cy = Number(cur.y) || targetY;
        // ⚠️ 注意：现在 modclick 的 C 代码内部会自己按主屏幕 backingScaleFactor 把 POINT 转 PIXEL，
        //    所以我们传 cx/cy（robotjs getMousePos 原生返回的点坐标）即可，不要再乘 dpiScale 了！
        //    之前就是乘了两遍 scale，坐标翻倍，鼠标才会「跑到屏幕右下很远的地方」。
        const px = cx;
        const py = cy;
        const flags = computeCGFlags(mods);

        let dispatched = false;
        let dispatchError: string | null = null;

        try {
          if (platform === 'darwin') {
            log(`[CLICK 🖱️ darwin] 用 CoreGraphics(mimicflow_modclick) 合成带 flags=0x${flags.toString(16)}，modclick 内部会自己 POINT→PIXEL 换算`);
            const bin = await this.ensureModClickBinary();
            const cmd = [JSON.stringify(bin), String(Math.round(px)), String(Math.round(py)), button, '1', '0x' + flags.toString(16)].join(' ');
            log(`[CLICK 🖱️ darwin] $ ${cmd}  (robotjs raw getMousePos={${cx},${cy}}, dpiScale=${this.dpiScale}, **不再乘 dpiScale**)`);
            const { stderr } = await exec(cmd, { timeout: 8000 });
            if (stderr) log(`[CLICK 🖱️ darwin] modclick stderr: ${stderr}`); // C 代码里把 input→pixel 换算写到了 stderr，UI 能看到
            log(`[CLICK 🖱️ darwin] modclick 成功：click(${button}) at POINT={${Math.round(px)},${Math.round(py)}} flags=0x${flags.toString(16)}`);
            dispatched = true;
          } else if (platform === 'linux' && (await this.hasXdotool())) {
            // Linux + xdotool：xdotool 支持 --clearmodifiers / modifiers 合成，更稳
            // xdotool 里的 button 编号：1 左键、2 中、3 右
            const btnMap: Record<string, string> = { left: '1', middle: '2', right: '3' };
            const btn = btnMap[button] ?? '1';
            // xdotool 的修饰符名称：shift, ctrl, alt, super (command)
            const xmodMap: Record<string, string> = {
              shift: 'shift',
              control: 'ctrl',
              alt: 'alt',
              command: 'super',
            };
            const downCmds = mods.map((m) => `xdotool keydown ${xmodMap[m] ?? m}`).join(' && ');
            const clickCmd = `xdotool click ${btn}`;
            const upCmds = mods.slice().reverse().map((m) => `xdotool keyup ${xmodMap[m] ?? m}`).join(' && ');
            const cmd = `${downCmds} && sleep 0.05 && ${clickCmd} && sleep 0.05 && ${upCmds}`;
            log(`[CLICK 🖱️ linux] xdotool：$ ${cmd}`);
            const { stderr } = await exec(`bash -c ${JSON.stringify(cmd)}`, { timeout: 8000 });
            if (stderr) log(`[CLICK 🖱️ linux] xdotool stderr: ${stderr}`);
            log(`[CLICK 🖱️ linux] xdotool 成功：click(${btn}) modifiers=[${mods.join(', ')}]`);
            dispatched = true;
          }
        } catch (e: any) {
          dispatchError = (e as Error).message;
          log(`[CLICK 🖱️ platform=${platform} 专用路径失败：${dispatchError}，统一 fallback 到 robotjs]`);
        }

        // —— Win32 / Linux-xdotool-fallback / Darwin-modclick-fallback 统一走 robotjs ——
        if (!dispatched) {
          log(`[CLICK 🖱️ robotjs] platform=${platform}，重按修饰符 [${mods.join(', ')}] + sleep(80) → mouseToggle down/up`);
          // ① click 前再强制重按一次所有 modifier（keyToggle('down') 幂等）
          //   Win32：SendInput 把 VK_SHIFT 写入全局输入队列，之后 mouse event 的应用层 GetKeyState() 能读到按下
          //   Linux / X11：XTestFakeKeyEvent 同样更新 X server 的 modifier mask，XTestFakeButtonEvent 会携带正确 mask
          //   macOS：fallback 到这里效果不确定，但至少能点到目标坐标
          for (const m of mods) try { this.robot.keyToggle(m, 'down'); } catch { /* noop */ }
          await this.sleep(80); // 给系统级修饰键状态表足够时间刷新
          this.robot.mouseToggle('down', button);
          await this.sleep(80); // 给应用层足够窗口读取 "按住 modifier 期间点了鼠标" 的组合态
          this.robot.mouseToggle('up', button);
          log(`[CLICK 🖱️ robotjs] click(${button}) 完成`);
        }

      } else {
        log(`[CLICK 🖱️] 无修饰符，mouseToggle(down, ${button}) → sleep(50) → up`);
        this.robot.mouseToggle('down', button);
        await this.sleep(50);
        this.robot.mouseToggle('up', button);
      }

      if (i < clicks - 1) {
        await this.sleep(interval);
      }
    }

    return { x: targetX, y: targetY };
  }

  private async executeInput(
    params: any,
    variablePool: Record<string, unknown>,
    emitLog?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void,
  ): Promise<boolean> {
    this.ensureRobot();

    const log = (msg: string, meta?: Record<string, unknown>) => {
      this.log.info(msg, meta);
      emitLog?.('info', msg, meta);
    };

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
      } else {
        throw new Error(`未知定位方式: ${locateMode}`);
      }

      const moveDuration = params.moveDuration === undefined || params.moveDuration === null ? 200 : Number(params.moveDuration);
      const moveMode = params.moveMode === 'linear' ? 'linear' : 'ease';
      log(`[INPUT ⌨️ 定位] locateMode=${locateMode}，移动鼠标到 (${targetX},${targetY}) 并点击输入框`, { moveDuration, moveMode });
      await this.smoothMoveMouse(targetX, targetY, moveDuration, moveMode);
      this.robot.mouseClick('left');
      await this.sleep(200);
    }

    const text = String(this.resolveValue(params.value, variablePool) || '');
    if (text) {
      const preview = text.length > 200 ? text.slice(0, 200) + '…' : text;
      log(`[INPUT ⌨️ 输入] typeString ${text.length} chars：${JSON.stringify(preview)}`);
      this.robot.typeString(text);
    } else {
      log(`[INPUT ⌨️ 输入] 文本为空，跳过 typeString`);
    }

    return true;
  }

  private async executeKeyboard(
    params: any,
    variablePool: Record<string, unknown>,
    emitLog?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void,
  ): Promise<boolean> {
    this.ensureRobot();

    const log = (msg: string, meta?: Record<string, unknown>) => {
      this.log.info(msg, meta);
      emitLog?.('info', msg, meta);
    };

    const keyGroups = Array.isArray(params.keyGroups) ? params.keyGroups : [];
    const groupInterval = Number(params.groupInterval || 300);

    if (keyGroups.length === 0) {
      log(`[KEYBOARD ⌨️] keyGroups 为空，跳过`);
      return true;
    }
    log(`[KEYBOARD ⌨️ 开始] 共 ${keyGroups.length} 组按键，groupInterval=${groupInterval}ms`);

    for (let i = 0; i < keyGroups.length; i++) {
      const group = keyGroups[i];
      const keys = Array.isArray(group.keys) ? group.keys : [];

      if (keys.length === 0) {
        log(`[KEYBOARD ⌨️ 组 ${i + 1}/${keyGroups.length}] keys 为空，跳过`);
        continue;
      }

      const normalized = keys.map((k: string) => this.normalizeKeyName(k));

      if (normalized.length === 1) {
        const keyName = normalized[0];
        log(`[KEYBOARD ⌨️ 组 ${i + 1}/${keyGroups.length}] 单击 keyTap(${keyName})`);
        this.robot.keyTap(keyName);
      } else {
        const modifierKeys = normalized.slice(0, -1);
        const mainKey = normalized[normalized.length - 1];
        log(`[KEYBOARD ⌨️ 组 ${i + 1}/${keyGroups.length}] 快捷键 keyTap(${mainKey}, modifiers=[${modifierKeys.join(', ')}])`);
        this.robot.keyTap(mainKey, modifierKeys);
      }

      if (i < keyGroups.length - 1) {
        await this.sleep(groupInterval);
      }
    }
    log(`[KEYBOARD ⌨️ 结束] 全部 ${keyGroups.length} 组按键执行完成`);

    return true;
  }

  private async executeMouseDown(
    params: any,
    variablePool: Record<string, unknown>,
    emitLog?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void,
  ): Promise<{ x: number; y: number }> {
    this.ensureRobot();

    const log = (msg: string, meta?: Record<string, unknown>) => {
      this.log.info(msg, meta);
      emitLog?.('info', msg, meta);
    };

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
          log(`[MOUSEDOWN 🖱️ 按下] 图片匹配失败，onError=continue → 跳过`, { locateMode });
          return { x: -1, y: -1 };
        }
        throw new Error('图片匹配失败，未找到目标位置');
      }
      targetX = result.x;
      targetY = result.y;
    } else {
      throw new Error(`未知定位方式: ${locateMode}`);
    }

    const moveDuration = params.moveDuration === undefined || params.moveDuration === null ? 200 : Number(params.moveDuration);
    const moveMode = params.moveMode === 'linear' ? 'linear' : 'ease';
    const button = params.button || 'left';
    log(`[MOUSEDOWN 🖱️ 按下] locateMode=${locateMode}，移动到 (${targetX},${targetY})，mouseToggle(down, ${button})，moveDuration=${moveDuration}ms`, { moveMode });
    await this.smoothMoveMouse(targetX, targetY, moveDuration, moveMode);

    this.robot.mouseToggle('down', button);
    this.pressedMouseButtons.add(button);

    // macOS Finder 拖拽需要两个额外触发条件，否则按下→移动会被当成普通点击：
    //  1) 按下后保持 ~120ms 等待 Finder 进入 "准备拖动" 状态
    //  2) 先微小抖动 (±3px) 突破系统 drag-threshold 才会判定开始拖拽
    await this.sleep(120);
    const jitterPos = this.robot.getMousePos();
    const jx = Number(jitterPos.x) || 0;
    const jy = Number(jitterPos.y) || 0;
    this.robot.dragMouse(jx + 3, jy + 2);
    await this.sleep(20);
    this.robot.dragMouse(jx, jy);
    log(`[MOUSEDOWN 🖱️ 按下] ${button} 键保持按下，完成 Finder 抖动 (±3px) 激活拖拽判定`);

    // 入运行时按下栈：后面的 mouseUp autoSync=true 时会自动从栈顶取对应 button
    this.pressStack.push({ type: 'mouseDown', button });

    return { x: targetX, y: targetY };
  }

  private resolveMouseUpParams(
    params: any,
    segment: FlowNode[],
    currentIndex: number,
  ): { button: string } {
    const autoSync = params?.autoSync !== false; // 默认 true
    if (!autoSync) return { button: String(params?.button || 'left') };

    // 1. 先看按下栈顶有没有 mouseDown
    for (let j = this.pressStack.length - 1; j >= 0; j--) {
      const e = this.pressStack[j];
      if (e.type === 'mouseDown') {
        const entry = this.pressStack.splice(j, 1)[0] as Extract<typeof e, { type: 'mouseDown' }>;
        return { button: entry.button };
      }
    }
    // 2. 栈空兜底：向前 segment 找最近的 system.mouseDown
    const nearest = this.findNearestPressNode(segment, currentIndex, 'system.mouseDown');
    if (nearest) {
      const p = nearest.nodeParams as any;
      return { button: String(p?.button || 'left') };
    }
    // 3. 还找不到，就 left 兜底
    return { button: String(params?.button || 'left') };
  }

  private resolveKeyUpParams(
    params: any,
    segment: FlowNode[],
    currentIndex: number,
  ): { keyGroups: { keys: string[] }[] } {
    const autoSync = params?.autoSync !== false; // 默认 true
    const emptyKeyGroups: { keys: string[] }[] = [{ keys: [] }];
    if (!autoSync) return { keyGroups: Array.isArray(params?.keyGroups) ? params.keyGroups : emptyKeyGroups };

    // 1. 先看按下栈顶有没有 keyDown（最近一次按下的）
    for (let j = this.pressStack.length - 1; j >= 0; j--) {
      const e = this.pressStack[j];
      if (e.type === 'keyDown') {
        const entry = this.pressStack.splice(j, 1)[0] as Extract<typeof e, { type: 'keyDown' }>;
        return { keyGroups: entry.keyGroups };
      }
    }
    // 2. 栈空兜底：向前 segment 找最近的 system.keyDown
    const nearest = this.findNearestPressNode(segment, currentIndex, 'system.keyDown');
    if (nearest) {
      const p = nearest.nodeParams as any;
      return { keyGroups: Array.isArray(p?.keyGroups) ? p.keyGroups : emptyKeyGroups };
    }
    // 3. 兜底：用当前配置
    return { keyGroups: Array.isArray(params?.keyGroups) ? params.keyGroups : emptyKeyGroups };
  }

  private executeMouseUp(
    params: any,
    emitLog?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void,
  ): boolean {
    this.ensureRobot();

    const log = (msg: string, meta?: Record<string, unknown>) => {
      this.log.info(msg, meta);
      emitLog?.('info', msg, meta);
    };

    // 注意：robotjs 的 mouseToggle 签名是 mouseToggle(state, button)，state 在前 button 在后
    const button = params.button || 'left';
    log(`[MOUSEUP 🖱️ 抬起] mouseToggle(up, ${button})，当前 pressedMouseButtons=[${Array.from(this.pressedMouseButtons).join(', ')}]`);
    this.robot.mouseToggle('up', button);
    this.pressedMouseButtons.delete(button);
    return true;
  }

  private static readonly MODIFIER_KEYS = new Set([
    'control', 'shift', 'command', 'alt',
  ]);

  private async executeKeyToggle(
    params: any,
    variablePool: Record<string, unknown>,
    direction: 'down' | 'up',
    emitLog?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void,
  ): Promise<boolean> {
    this.ensureRobot();

    const log = (msg: string) => {
      this.log.info(msg);
      emitLog?.('info', msg);
    };

    const rawGroups = Array.isArray(params.keyGroups) ? params.keyGroups : [];
    const groupInterval = Number(params.groupInterval || 100);

    // ⬇️ 关键修复点 1：抬起 keyUp 时 —— 整体 groups 执行顺序要和按下逆序
    //     例：按下 group1(cmd) → group2(a)，抬起必须先抬 a 再抬 cmd
    const keyGroups = direction === 'down' ? rawGroups : rawGroups.slice().reverse();

    for (let i = 0; i < keyGroups.length; i++) {
      const group = keyGroups[i];
      const rawKeys: string[] = Array.isArray(group.keys) ? group.keys : [];
      const keys = rawKeys.map((k) => this.normalizeKeyName(k));

      if (keys.length === 0) continue;

      // 同组内的按键顺序：按下时正序，抬起时整体也要逆序
      // 例：[cmd, a] 按下顺序 cmd → a；抬起顺序 a → cmd
      const orderedKeys = direction === 'down' ? keys.slice() : keys.slice().reverse();

      const modifiers = orderedKeys.filter((k) => SystemEngine.MODIFIER_KEYS.has(k));
      const nonModifiers = orderedKeys.filter((k) => !SystemEngine.MODIFIER_KEYS.has(k));

      if (direction === 'down') {
        // 1) 修饰符依次按下 → 同步跟踪 pressedModifierKeys（给后面 click 用）
        for (const m of modifiers) {
          log(`[KEYDOWN ⬇️ 修饰符] ${m} 按下（保持按住，直到对应 keyUp）`);
          this.robot.keyToggle(m, 'down');
          this.pressedModifierKeys.add(m);
          await this.sleep(8);
        }
        // 2) non-modifier 键的处理：
        //    ⚠️ macOS 上 robotjs keyTap(k) 单参数内部是 CGEventCreateKeyboardEvent(NULL, ..., true)，
        //       eventSource=NULL 时不会继承 IOHID/IO 层面已经按住的 modifier 状态 → 我们的 cmd 真的按住了，
        //       但 'a' 的 keyDown event 的 flags 字段还是 0 → 系统当裸 'a' 字符输入，不会触发全选，
        //       只会在文本里打一个 a。这就是用户说的「cmd,a 和 cmd+a 实际操作不一样」的根因。
        //
        //    修复：按下每个 non-modifier 时，用 **2 参数版** keyTap(mainKey, currentModifiers)
        //       让 robotjs 自己把 modifier flags 写进 key event（✅ cmd+a 全选立即生效）。
        //       但是 keyTap 语义最后会「自动松开 modifier」，所以我们要再 keyToggle(modifier, down) 按一遍，
        //       抵消这个副作用，恢复「持续按住 modifier」的语义（✅ 后面的 click 依然能带 modifier）。
        if (nonModifiers.length > 0) {
          const held: string[] = Array.from(this.pressedModifierKeys);
          for (const k of nonModifiers) {
            if (held.length > 0) {
              log(`[KEYDOWN ⬇️ 字符] keyTap(${k}, modifiers=[${held.join(', ')}]) → 立即重按修饰符抵消 keyTap 自动释放副作用`);
              // 2 参数版本：keyTap 内部会把 modifier flags 正确附带到 key event → 全选/快捷键生效
              this.robot.keyTap(k, held);
              // 立即再按一遍 modifier，恢复「持续按住」
              for (const m of held) {
                try { this.robot.keyToggle(m, 'down'); } catch { /* noop */ }
              }
              await this.sleep(10);
            } else {
              log(`[KEYDOWN ⬇️ 字符] keyTap(${k})`);
              this.robot.keyTap(k);
            }
            await this.sleep(40);
          }
        }
      } else {
        // keyUp 方向：orderedKeys 已经是组内逆序了（见上文 keys.slice().reverse()）
        // 所以 nonModifiers / modifiers 的顺序已经是「最后按的先抬」
        log(`[KEYUP ⬆️ 本组抬键顺序] ${orderedKeys.join(' → ')}`);
        // 非修饰符兜底 keyToggle up（虽然 keyTap 过的普通键本来就没保持按住，但安全起见）
        for (const k of nonModifiers) {
          try { this.robot.keyToggle(k, 'up'); } catch { /* noop */ }
          await this.sleep(5);
        }
        // 修饰符逆序抬起
        for (const m of modifiers) {
          log(`[KEYUP ⬆️ 修饰符] ${m} 抬起`);
          this.robot.keyToggle(m, 'up');
          this.pressedModifierKeys.delete(m);
          await this.sleep(8);
        }
      }

      if (i < keyGroups.length - 1) {
        await this.sleep(groupInterval);
      }
    }

    // keyDown 执行完成后入按下栈（深拷贝一份，避免后面 params 被改）
    if (direction === 'down') {
      this.pressStack.push({
        type: 'keyDown',
        keyGroups: rawGroups.map((g: any) => ({ keys: Array.isArray(g?.keys) ? g.keys.slice() : [] })),
      });
    }

    return true;
  }

  private async executeScroll(
    params: any,
    variablePool: Record<string, unknown>,
    emitLog?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void,
  ): Promise<boolean> {
    this.ensureRobot();

    const log = (msg: string, meta?: Record<string, unknown>) => {
      this.log.info(msg, meta);
      emitLog?.('info', msg, meta);
    };

    const needLocate = params.needLocate === true;
    let targetX = 0;
    let targetY = 0;

    if (needLocate) {
      const locateMode = params.locateMode || 'coordinate';

      if (locateMode === 'coordinate') {
        targetX = Number(this.resolveValue(params.x, variablePool) || 0);
        targetY = Number(this.resolveValue(params.y, variablePool) || 0);
      } else if (locateMode === 'image') {
        const result = await this.locateImage(params, variablePool);
        if (!result) {
          const onError = params.onError || 'stop';
          if (onError === 'continue') {
            log(`[SCROLL 📜 滚动] 图片匹配失败，onError=continue → 跳过`, { locateMode });
            return false;
          }
          throw new Error('图片匹配失败，未找到滚动位置');
        }
        targetX = result.x;
        targetY = result.y;
      } else {
        throw new Error(`未知定位方式: ${locateMode}`);
      }

      const moveDuration = params.moveDuration === undefined || params.moveDuration === null ? 200 : Number(params.moveDuration);
      const moveMode = params.moveMode === 'linear' ? 'linear' : 'ease';
      log(`[SCROLL 📜 定位] locateMode=${locateMode}，移动鼠标到 (${targetX},${targetY})`, { moveDuration, moveMode });
      await this.smoothMoveMouse(targetX, targetY, moveDuration, moveMode);
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

    log(`[SCROLL 📜 滚动] direction=${direction}，amount=${amount}，scrollMouse(x=${scrollX}, y=${scrollY})`);
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

  /**
   * 平滑移动鼠标：在 duration 毫秒内，从当前位置插值移动到 (targetX, targetY)
   * - duration = 0：立即瞬移
   * - mode = 'ease'  默认，缓动（起步慢→加速→减速到位，自然）
   * - mode = 'linear' 匀速
   * - 如果当前有鼠标按键保持按下（pressedMouseButtons 非空）→ 使用 dragMouse（触发系统真正的拖拽事件）
   *   否则使用普通 moveMouse（只改变光标位置不产生 drag）
   */
  private async smoothMoveMouse(
    targetX: number,
    targetY: number,
    duration: number,
    mode: 'ease' | 'linear' = 'ease',
  ): Promise<void> {
    this.ensureRobot();

    const dur = Math.max(0, Number(duration));
    const isDrag = this.pressedMouseButtons.size > 0;
    const stepFn = (x: number, y: number) =>
      isDrag ? this.robot.dragMouse(x, y) : this.robot.moveMouse(x, y);

    if (Number.isNaN(dur) || dur <= 0) {
      stepFn(targetX, targetY);
      return;
    }

    const startPos = this.robot.getMousePos();
    const fromX = Number(startPos.x) || 0;
    const fromY = Number(startPos.y) || 0;

    const dx = targetX - fromX;
    const dy = targetY - fromY;

    // 如果距离为 0，就直接等待一段时间，保证和原来的行为兼容
    if (dx === 0 && dy === 0) {
      await this.sleep(dur);
      return;
    }

    // 每步间隔 8ms ≈ 120fps，足够流畅
    const stepInterval = 8;
    const totalSteps = Math.max(1, Math.round(dur / stepInterval));
    const actualInterval = dur / totalSteps;

    for (let i = 1; i <= totalSteps; i++) {
      const t = i / totalSteps;
      let easeT: number;
      if (mode === 'linear') {
        easeT = t;
      } else {
        // easeInOutQuad：起步慢→加速→减速到位
        easeT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      }
      const x = Math.round(fromX + dx * easeT);
      const y = Math.round(fromY + dy * easeT);
      stepFn(x, y);

      if (i < totalSteps) {
        await this.sleep(actualInterval);
      }
    }

    // 最后确保精准到达目标位置，消除累计舍入误差
    stepFn(targetX, targetY);
  }

  async dispose(): Promise<void> {
    this.log.info('[SystemEngine] Disposing');
    this.robot = null;
    this.screenshot = null;
    this.sharp = null;
    this.cv = null;
  }
}
