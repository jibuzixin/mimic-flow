import React, { useState, useEffect, useRef } from 'react';
import {
  MousePointer2, Hand, CircleDot, Circle, MousePointerClick, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Keyboard, Play, Square, Move, Clock, Wrench,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type TestLog = { time: string; type: 'ok' | 'err' | 'info' | 'warn'; text: string };

const invoke = (channel: string, ...args: unknown[]) => (window as any).mimic.invoke(channel, ...args);

function logLine(type: TestLog['type'], text: string): TestLog {
  const d = new Date();
  const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  return { time, type, text };
}

function isOk(res: any): boolean {
  if (res === true) return true;
  if (res && typeof res === 'object' && 'ok' in res) return !!res.ok;
  return false;
}
function getErr(res: any): string {
  if (res && typeof res === 'object' && 'error' in res && res.error) return String(res.error);
  if (res === false) return '返回 false';
  if (res && typeof res === 'object' && 'ok' in res && !res.ok) return '未指明的错误';
  return '';
}

export default function SystemDevTester() {
  // ======= 鼠标区域 =======
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [toX, setToX] = useState(500);
  const [toY, setToY] = useState(400);
  const [moveDuration, setMoveDuration] = useState(1000);
  const [moveMode, setMoveMode] = useState<'ease' | 'linear' | 'teleport'>('ease');
  const [mouseButton, setMouseButton] = useState<'left' | 'right' | 'middle'>('left');
  const [scrollAmount, setScrollAmount] = useState(3);

  // ======= 键盘区域 =======
  const [keyText, setKeyText] = useState('shift,a');

  // ======= 拖拽场景一键测试 =======
  const [dragFrom, setDragFrom] = useState({ x: 300, y: 300 });
  const [dragTo, setDragTo] = useState({ x: 700, y: 500 });
  const [dragDuration, setDragDuration] = useState(1500);

  // ======= 防递归点击倒计时 =======
  const [countdown, setCountdown] = useState<number | null>(null);
  const cancelRef = useRef(false);

  // ======= 日志 =======
  const [logs, setLogs] = useState<TestLog[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const addLog = (entry: TestLog) => setLogs((prev) => [...prev.slice(-199), entry]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  // 实时刷新鼠标位置
  useEffect(() => {
    let alive = true;
    const loop = async () => {
      while (alive) {
        try {
          const pos = await invoke('system:dev-get-mouse-pos');
          if (pos) setMousePos(pos);
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 120));
      }
    };
    loop();
    return () => { alive = false; };
  }, []);

  // 倒计时处理
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); return; }
    const t = setTimeout(() => {
      if (!cancelRef.current) {
        setCountdown((c) => (c === null ? null : c - 0.1));
      }
    }, 100);
    return () => clearTimeout(t);
  }, [countdown]);

  /**
   * 运行一个带倒计时的危险动作（click/double/按下/抬起）
   * 点下后 2.5 秒再执行，给用户把鼠标从按钮上移开的时间
   * 否则 click 会点到当前按钮自己 → 再触发 onClick → 无限递归
   */
  const runDangerous = async (name: string, fn: () => Promise<unknown>) => {
    cancelRef.current = false;
    setCountdown(2.5);
    addLog(logLine('warn', `⏳ ${name} 会在 2.5 秒后执行 — 请立刻把鼠标从按钮上移开！`));
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (cancelRef.current) { resolve(); return; }
        if (Date.now() - start >= 2500) { resolve(); return; }
        setTimeout(tick, 50);
      };
      setTimeout(tick, 50);
    });
    if (cancelRef.current) {
      addLog(logLine('info', `✕ ${name} 已取消`));
      setCountdown(null);
      return;
    }
    setCountdown(null);
    await run(name, fn);
  };

  const run = async (name: string, fn: () => Promise<unknown>) => {
    addLog(logLine('info', `▶ ${name}`));
    try {
      const res = await fn();
      const err = getErr(res);
      if (err) {
        addLog(logLine('err', `✘ ${name} — 失败：${err}`));
      } else {
        const extra =
          res && typeof res === 'object' && 'keys' in res && Array.isArray((res as any).keys)
            ? ` → 按键 [${(res as any).keys.join(', ')}]`
            : res && typeof res === 'object' && JSON.stringify(res) !== '{}' && JSON.stringify(res) !== '{"ok":true}'
              ? ` ${JSON.stringify(res)}`
              : '';
        addLog(logLine('ok', `✔ ${name} — 成功${extra}`));
      }
      return isOk(res);
    } catch (e: any) {
      addLog(logLine('err', `✘ ${name} — 异常：${e?.message ?? String(e)}`));
      return false;
    }
  };

  const parseKeys = (s: string): string[] => s.split(/[,，\s+]+/).map((k) => k.trim()).filter(Boolean);

  // ========== 一键场景测试 ==========
  const testDragDrop = async () => {
    addLog(logLine('info', '========== 场景：拖拽测试 =========='));
    addLog(logLine('info', `从 (${dragFrom.x}, ${dragFrom.y}) 平滑移动到 (${dragTo.x}, ${dragTo.y})，按住 ${mouseButton} 键不放拖动 ${dragDuration}ms (${moveMode})`));

    await run(`1. 平滑移动到起点 (${dragFrom.x}, ${dragFrom.y})`, async () =>
      invoke('system:dev-smooth-move-mouse', { x: dragFrom.x, y: dragFrom.y, duration: 600, mode: moveMode === 'teleport' ? 'ease' : moveMode })
    );
    // 按下和移动之间 100ms 间隔保证应用接收到按下事件
    await new Promise((r) => setTimeout(r, 100));
    if (!await run(`2. 按下 ${mouseButton} 不抬起`, () => invoke('system:dev-mouse-down', mouseButton))) return;

    await new Promise((r) => setTimeout(r, 80));
    await run(`3. 按住移动到终点 (${dragTo.x}, ${dragTo.y})，用时 ${dragDuration}ms (${moveMode})`, async () =>
      invoke('system:dev-smooth-move-mouse', {
        x: dragTo.x, y: dragTo.y,
        duration: moveMode === 'teleport' ? 0 : dragDuration,
        mode: moveMode === 'teleport' ? 'ease' : moveMode,
      })
    );
    await new Promise((r) => setTimeout(r, 80));
    if (!await run(`4. 抬起 ${mouseButton} 键`, () => invoke('system:dev-mouse-up', mouseButton))) return;
    addLog(logLine('ok', '✔ 拖拽场景完成'));
  };

  const testShiftClick = async () => {
    addLog(logLine('info', '========== 场景：Shift + 连点 3 次（多选模拟）=========='));
    addLog(logLine('warn', '2.5 秒后开始，请立刻把鼠标移到目标文件上方！'));
    cancelRef.current = false;
    setCountdown(2.5);
    await new Promise((r) => setTimeout(r, 2500));
    setCountdown(null);

    const keys = ['shift'];
    if (!await run('1. 按下 Shift', () => invoke('system:dev-key-down', keys))) return;
    for (let i = 0; i < 3; i++) {
      await run(`2.${i + 1} Shift+左键单击`, async () => {
        await invoke('system:dev-mouse-click', 'left');
        await new Promise((r) => setTimeout(r, 350));
        return { ok: true };
      });
    }
    if (!await run('3. 抬起 Shift', () => invoke('system:dev-key-up', keys))) return;
    addLog(logLine('ok', '✔ Shift+多击场景完成'));
  };

  const testLongPressKey = async () => {
    const keys = parseKeys(keyText);
    if (keys.length === 0) {
      addLog(logLine('err', '请先填写按键'));
      return;
    }
    addLog(logLine('info', `========== 场景：长按 2 秒 ${keys.join(' + ')} ==========`));
    if (!await run(`1. 按下 ${keys.join(' + ')}`, () => invoke('system:dev-key-down', keys))) return;
    addLog(logLine('info', '2. 保持 2 秒…（切到记事本/输入框观察持续输入效果）'));
    await new Promise((r) => setTimeout(r, 2000));
    if (!await run(`3. 抬起 ${keys.join(' + ')} (逆序)`, () => invoke('system:dev-key-up', keys))) return;
    addLog(logLine('ok', '✔ 长按场景完成'));
  };

  const DANGER_TIP = '点击后 2.5 秒才执行，请把鼠标移开按钮，否则点击会递归按到自己';

  return (
    <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto">
      {/* 倒计时横幅 */}
      {countdown !== null && countdown > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] animate-pulse
          px-6 py-3 rounded-2xl shadow-2xl bg-gradient-to-r from-rose-500 to-orange-500 text-white font-bold text-lg flex items-center gap-3">
          <Clock className="w-6 h-6" />
          {countdown.toFixed(1)}s 后执行危险动作 — 请把鼠标从按钮上移开！
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/20 ml-3"
            onClick={() => { cancelRef.current = true; setCountdown(null); }}>
            取消
          </Button>
        </div>
      )}

      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shadow-lg">
          <Wrench className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">系统底层功能测试台</h1>
          <p className="text-xs text-gray-500 mt-0.5">开发者模式专用 — 单击/双击/按下类按钮点完请立刻移开鼠标</p>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* 鼠标基本操作 */}
        <section className="rounded-2xl border border-violet-100 bg-white/80 shadow-soft p-5 space-y-4">
          <h2 className="text-sm font-bold text-violet-700 flex items-center gap-2">
            <MousePointer2 className="w-4 h-4" /> 鼠标操作
          </h2>

          <div className="rounded-xl bg-violet-50/60 p-3 flex items-center justify-between">
            <span className="text-xs text-violet-700 font-medium">实时鼠标位置</span>
            <span className="font-mono text-sm text-violet-900">
              {mousePos ? `(${mousePos.x}, ${mousePos.y})` : '读取中…'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 items-center">
            <label className="text-xs text-gray-600">按键</label>
            <div className="col-span-2 grid grid-cols-3 gap-1">
              {(['left', 'middle', 'right'] as const).map((b) => (
                <button key={b} onClick={() => setMouseButton(b)}
                  className={`text-xs py-1.5 rounded-lg transition ${mouseButton === b ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  {b === 'left' ? '左' : b === 'middle' ? '中' : '右'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" title={DANGER_TIP}
              onClick={() => runDangerous(`单击 ${mouseButton}`, () => invoke('system:dev-mouse-click', mouseButton))}>
              <MousePointerClick className="w-4 h-4 mr-1" />单击
            </Button>
            <Button variant="outline" size="sm" title={DANGER_TIP}
              onClick={() => runDangerous('双击 left', async () => {
                await invoke('system:dev-mouse-click', 'left');
                await new Promise((r) => setTimeout(r, 150));
                await invoke('system:dev-mouse-click', 'left');
                return { ok: true };
              })}>
              <MousePointerClick className="w-4 h-4 mr-1" />双击
            </Button>
            <Button variant="outline" size="sm" className="text-emerald-700 border-emerald-200 bg-emerald-50" title={DANGER_TIP}
              onClick={() => runDangerous(`按下 ${mouseButton} 不抬起`, () => invoke('system:dev-mouse-down', mouseButton))}>
              <CircleDot className="w-4 h-4 mr-1" />按下
            </Button>
            <Button variant="outline" size="sm" className="text-rose-700 border-rose-200 bg-rose-50" title={DANGER_TIP}
              onClick={() => runDangerous(`抬起 ${mouseButton}`, () => invoke('system:dev-mouse-up', mouseButton))}>
              <Circle className="w-4 h-4 mr-1" />抬起
            </Button>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
              <Move className="w-3.5 h-3.5" /> 移动到 (x, y)
            </h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[11px] text-gray-500">X</label>
                <Input type="number" value={toX} onChange={(e) => setToX(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500">Y</label>
                <Input type="number" value={toY} onChange={(e) => setToY(Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[11px] text-gray-500">时长(ms)</label>
                <Input type="number" value={moveDuration} onChange={(e) => setMoveDuration(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500">模式</label>
                <select className="w-full h-9 px-2 rounded-md border border-input text-sm"
                  value={moveMode} onChange={(e) => setMoveMode(e.target.value as any)}>
                  <option value="ease">平滑 ease（推荐）</option>
                  <option value="linear">匀速 linear</option>
                  <option value="teleport">0ms 瞬移</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run(`瞬移 (${toX}, ${toY})`, () => invoke('system:move-mouse', toX, toY))}>
                瞬移
              </Button>
              <Button size="sm" variant="secondary" onClick={() => run(
                `平滑移动 (${moveMode}) ${moveMode === 'teleport' ? 0 : moveDuration}ms 到 (${toX}, ${toY})`,
                () => invoke('system:dev-smooth-move-mouse', {
                  x: toX, y: toY,
                  duration: moveMode === 'teleport' ? 0 : moveDuration,
                  mode: moveMode === 'teleport' ? 'ease' : moveMode,
                })
              )}>
                <Clock className="w-4 h-4 mr-1" /> 平滑移动
              </Button>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-600 mb-2">滚轮</h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[11px] text-gray-500">幅度</label>
                <Input type="number" value={scrollAmount} onChange={(e) => setScrollAmount(Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button onClick={() => run('滚轮上 ' + scrollAmount, () => invoke('system:dev-mouse-scroll', 'up', scrollAmount))}
                className="py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button onClick={() => run('滚轮下 ' + scrollAmount, () => invoke('system:dev-mouse-scroll', 'down', scrollAmount))}
                className="py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button onClick={() => run('滚轮左 ' + scrollAmount, () => invoke('system:dev-mouse-scroll', 'left', scrollAmount))}
                className="py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center"><ArrowLeft className="w-3.5 h-3.5" /></button>
              <button onClick={() => run('滚轮右 ' + scrollAmount, () => invoke('system:dev-mouse-scroll', 'right', scrollAmount))}
                className="py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center"><ArrowRight className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </section>

        {/* 键盘操作 + 组合场景 */}
        <section className="rounded-2xl border border-sky-100 bg-white/80 shadow-soft p-5 space-y-5">
          <h2 className="text-sm font-bold text-sky-700 flex items-center gap-2">
            <Keyboard className="w-4 h-4" /> 键盘操作
          </h2>

          <div>
            <label className="text-xs text-gray-600">按键（多个用逗号分隔，如 shift,a 或 command,c）</label>
            <Input value={keyText} onChange={(e) => setKeyText(e.target.value)} className="mt-1 font-mono" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" variant="outline" onClick={() => {
              const k = parseKeys(keyText);
              if (!k.length) return;
              run(`Tap ${k.join('+')}`, () => invoke('system:dev-key-tap', k));
            }}>
              <Play className="w-4 h-4 mr-1" /> Tap
            </Button>
            <Button size="sm" className="text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100" variant="outline" onClick={() => {
              const k = parseKeys(keyText);
              if (!k.length) return;
              run(`按下 ${k.join('+')} 不抬起`, () => invoke('system:dev-key-down', k));
            }}>
              <CircleDot className="w-4 h-4 mr-1" /> 按下
            </Button>
            <Button size="sm" className="text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100" variant="outline" onClick={() => {
              const k = parseKeys(keyText);
              if (!k.length) return;
              run(`抬起 ${k.join('+')} (逆序)`, () => invoke('system:dev-key-up', k));
            }}>
              <Circle className="w-4 h-4 mr-1" /> 抬起
            </Button>
          </div>

          <div className="pt-4 border-t border-gray-100 space-y-3">
            <h3 className="text-xs font-semibold text-gray-600">场景一键测试</h3>

            <div className="rounded-xl bg-emerald-50 p-3 space-y-2">
              <div className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                <Hand className="w-3.5 h-3.5" /> 场景 A：拖拽
                <span className="ml-auto opacity-80">按下→移动→抬起</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[10px] text-gray-500">起点 (x, y)</label>
                  <div className="flex gap-1">
                    <Input type="number" size={1} value={dragFrom.x} onChange={(e) => setDragFrom({ ...dragFrom, x: Number(e.target.value) })} />
                    <Input type="number" value={dragFrom.y} onChange={(e) => setDragFrom({ ...dragFrom, y: Number(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">终点 (x, y)</label>
                  <div className="flex gap-1">
                    <Input type="number" value={dragTo.x} onChange={(e) => setDragTo({ ...dragTo, x: Number(e.target.value) })} />
                    <Input type="number" value={dragTo.y} onChange={(e) => setDragTo({ ...dragTo, y: Number(e.target.value) })} />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500">拖动时长 ms</label>
                <Input type="number" value={dragDuration} onChange={(e) => setDragDuration(Number(e.target.value))} />
              </div>
              <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={testDragDrop}>
                ▶ 运行 拖拽 场景（会自动先移动到起点）
              </Button>
            </div>

            <div className="rounded-xl bg-amber-50 p-3 space-y-2">
              <div className="text-[11px] text-amber-700 font-medium flex items-center gap-1">
                <Keyboard className="w-3.5 h-3.5" /> 场景 B：Shift + 连点（多选模拟）
              </div>
              <p className="text-[11px] text-amber-700/80 leading-relaxed">
                点击后 2.5 秒倒计时 — 先把鼠标移到要多选的第 1 个文件/图标位置上方，保持不动，等待开始
              </p>
              <Button size="sm" variant="outline" className="w-full border-amber-300 text-amber-800 hover:bg-amber-100" onClick={testShiftClick}>
                ▶ 运行 Shift+多击 场景
              </Button>
            </div>

            <div className="rounded-xl bg-fuchsia-50 p-3 space-y-2">
              <div className="text-[11px] text-fuchsia-700 font-medium flex items-center gap-1">
                <Square className="w-3.5 h-3.5" /> 场景 C：长按按键 2 秒
                <span className="ml-auto opacity-80">例：a / shift / cmd+v</span>
              </div>
              <Button size="sm" variant="outline" className="w-full border-fuchsia-300 text-fuchsia-800 hover:bg-fuchsia-100" onClick={testLongPressKey}>
                ▶ 运行 长按按键 场景
              </Button>
            </div>
          </div>
        </section>

        {/* 日志 */}
        <section className="rounded-2xl border border-slate-200 bg-white/90 shadow-soft p-5 flex flex-col min-h-[500px]">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
            执行日志
            <span className="ml-auto text-[11px] text-slate-500 font-normal">最新 {logs.length} 条</span>
          </h2>
          <div ref={logRef}
            className="flex-1 rounded-xl bg-slate-900 text-slate-100 p-3 font-mono text-[11px] leading-relaxed space-y-1 overflow-y-auto">
            {logs.length === 0 && (
              <div className="text-slate-500 italic">点击左侧按钮开始测试，日志将实时显示在这里…</div>
            )}
            {logs.map((l, i) => (
              <div key={i} className={
                l.type === 'ok' ? 'text-emerald-300' :
                  l.type === 'err' ? 'text-rose-300' :
                    l.type === 'warn' ? 'text-amber-300' : 'text-sky-300'
              }>
                <span className="text-slate-500">[{l.time}]</span> {l.text}
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLogs([])}>清空日志</Button>
            <Button variant="outline" size="sm" onClick={() => addLog(logLine('info', '分隔线 =================================================='))}>加分隔线</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
