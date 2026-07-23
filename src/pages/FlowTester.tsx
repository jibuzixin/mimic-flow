import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, Square, PlayCircle, FileJson, Terminal, Settings, AlertCircle, CheckCircle2, Clock, XCircle, Zap } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
  nodeId?: string;
}

interface NodeState {
  nodeId: string;
  status: NodeStatus;
  retryCount: number;
  startTime?: number;
  endTime?: number;
  error?: string;
  output?: unknown;
}

interface FlowNode {
  id: string;
  nodeType: string;
  nodeName?: string;
  nodeParams?: Record<string, unknown>;
  nextNodes?: Array<{ nodeId: string; condition?: string }>;
}

interface FlowSchema {
  version: string;
  flowMeta: { name: string; desc?: string };
  globalVars?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  modelConfig?: Record<string, unknown>;
  target?: { type: string; displayId?: string };
  nodes: FlowNode[];
}

const DEFAULT_FLOW: FlowSchema = {
  version: '2.0',
  flowMeta: {
    name: 'B站视频标题查询',
    desc: '打开Chrome访问bilibili并获取首页视频标题',
  },
  globalVars: {},
  runtime: {
    defaultTimeout: 180000,
    defaultRetry: 1,
    onError: 'stop',
  },
  modelConfig: {
    midscene: {
      inline: {
        modelId: 'doubao-seed-2-0-lite-260428',
        apiKey: 'YOUR_API_KEY_HERE',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        modelFamily: 'doubao-seed',
        timeout: 180000,
        retryCount: 1,
        reasoningEnabled: false,
        preferredLanguage: 'zh',
      },
    },
  },
  target: {
    type: 'computer',
  },
  nodes: [
    {
      id: 'node-1',
      nodeType: 'midscene.act',
      nodeName: '打开 Chrome 浏览器',
      nodeParams: {
        prompt: '按 Cmd+Space 打开 Spotlight，输入 Chrome 并按回车打开谷歌浏览器',
      },
      nextNodes: [{ nodeId: 'node-2' }],
    },
    {
      id: 'node-2',
      nodeType: 'midscene.sleep',
      nodeName: '等待浏览器启动',
      nodeParams: {
        duration: 2000,
      },
      nextNodes: [{ nodeId: 'node-3' }],
    },
    {
      id: 'node-3',
      nodeType: 'midscene.act',
      nodeName: '访问 Bilibili',
      nodeParams: {
        prompt: '点击地址栏，输入 bilibili.com 并按回车访问',
      },
      nextNodes: [{ nodeId: 'node-4' }],
    },
    {
      id: 'node-4',
      nodeType: 'midscene.sleep',
      nodeName: '等待页面加载',
      nodeParams: {
        duration: 3000,
      },
      nextNodes: [{ nodeId: 'node-5' }],
    },
    {
      id: 'node-5',
      nodeType: 'midscene.query',
      nodeName: '获取视频标题',
      nodeParams: {
        prompt: '页面上展示的视频标题有哪些？列出前5个视频的标题',
        outputVar: 'videoTitles',
      },
      nextNodes: [{ nodeId: 'node-6' }],
    },
    {
      id: 'node-6',
      nodeType: 'control.log',
      nodeName: '打印视频标题',
      nodeParams: {
        var: 'videoTitles',
      },
      nextNodes: [],
    },
  ],
};

export default function FlowTester() {
  const [flowJson, setFlowJson] = useState(JSON.stringify(DEFAULT_FLOW, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string>('idle');
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState('logs');
  const logEndRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  const appendLog = useCallback((entry: Omit<LogEntry, 'timestamp'> & { timestamp?: number }) => {
    const newEntry: LogEntry = {
      timestamp: entry.timestamp || Date.now(),
      level: entry.level,
      source: entry.source,
      message: entry.message,
      ...(entry.data ? { data: entry.data } : {}),
      ...(entry.nodeId ? { nodeId: entry.nodeId } : {}),
    };
    setLogs((prev) => [...prev, newEntry]);
  }, []);

  // 组件挂载时输出初始日志，验证日志系统工作（仅开发环境）
  useEffect(() => {
    if (!mountedRef.current && import.meta.env.DEV) {
      mountedRef.current = true;
      const hasMimic = typeof window !== 'undefined' && !!(window as any).mimic;
      appendLog({
        level: 'info',
        source: 'frontend',
        message: `Flow Tester 已加载，Electron环境: ${hasMimic ? '是' : '否（mock模式）'}`,
      });
      appendLog({
        level: 'info',
        source: 'frontend',
        message: hasMimic
          ? 'window.mimic 可用，IPC 通信正常'
          : 'window.mimic 不可用，请确认在 Electron 应用中运行',
      });
    }
  }, [appendLog]);

  // 监听 IPC 事件
  useEffect(() => {
    const win = window as any;
    if (!win.mimic) {
      if (import.meta.env.DEV) {
        appendLog({
          level: 'warn',
          source: 'frontend',
          message: '非 Electron 环境，跳过 IPC 事件监听',
        });
      }
      return;
    }

    appendLog({
      level: 'info',
      source: 'frontend',
      message: '正在监听 flow-v2:event 事件...',
    });

    const handler = (data: any) => {
      try {
        console.log('[FlowTester] IPC event:', data);
        const type = data?.type;

        switch (type) {
          case 'flow:start':
            setStatus('running');
            setIsRunning(true);
            appendLog({ level: 'info', source: 'scheduler', message: '▶ 工作流开始执行' });
            break;
          case 'flow:complete':
            setStatus(data.status);
            setIsRunning(false);
            appendLog({
              level: data.status === 'success' ? 'info' : 'error',
              source: 'scheduler',
              message: `■ 工作流执行结束 (${data.status})${data.error ? ': ' + data.error : ''}`,
              data: data.reportPath ? { reportPath: data.reportPath } : undefined,
            });
            break;
          case 'node:start':
            setNodeStates((prev) => ({
              ...prev,
              [data.nodeId]: {
                nodeId: data.nodeId,
                status: 'running',
                retryCount: prev[data.nodeId]?.retryCount || 0,
                startTime: Date.now(),
              },
            }));
            break;
          case 'node:complete':
            setNodeStates((prev) => ({
              ...prev,
              [data.nodeId]: {
                ...prev[data.nodeId],
                status: 'success',
                endTime: Date.now(),
                output: data.output,
              },
            }));
            appendLog({
              level: 'info',
              source: 'scheduler',
              message: `  ✓ 节点完成: ${data.nodeId}`,
              nodeId: data.nodeId,
            });
            break;
          case 'node:error':
            setNodeStates((prev) => ({
              ...prev,
              [data.nodeId]: {
                ...prev[data.nodeId],
                status: 'failed',
                endTime: Date.now(),
                error: data.error,
              },
            }));
            appendLog({
              level: 'error',
              source: 'scheduler',
              message: `  ✗ 节点失败: ${data.nodeId} - ${data.error}`,
              nodeId: data.nodeId,
            });
            break;
          case 'log':
            if (data.entry) {
              appendLog(data.entry as LogEntry);
            }
            break;
          default:
            appendLog({
              level: 'debug',
              source: 'ipc',
              message: `未知事件类型: ${type}`,
              data,
            });
        }
      } catch (e: any) {
        console.error('[FlowTester] Event handler error:', e);
        appendLog({
          level: 'error',
          source: 'frontend',
          message: `事件处理错误: ${e?.message || String(e)}`,
        });
      }
    };

    const unsub = win.mimic.on('flow-v2:event', handler);
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [appendLog]);

  // 自动滚动到日志底部
  useEffect(() => {
    if (logEndRef.current && activeTab === 'logs') {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  const validateJson = (text: string): FlowSchema | null => {
    try {
      const parsed = JSON.parse(text);
      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        throw new Error('缺少 nodes 数组');
      }
      setJsonError(null);
      return parsed as FlowSchema;
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const handleJsonChange = (value: string) => {
    setFlowJson(value);
    validateJson(value);
  };

  const handleRun = () => {
    try {
      const flow = validateJson(flowJson);
      if (!flow) {
        appendLog({ level: 'error', source: 'frontend', message: 'JSON 格式错误，无法运行' });
        return;
      }

      const win = window as any;
      const hasMimic = !!win.mimic;

      setLogs([]);
      setNodeStates({});
      setStatus('running');
      setIsRunning(true);
      setActiveTab('logs');

      appendLog({ level: 'info', source: 'frontend', message: `━━━ 开始运行: ${flow.flowMeta.name} ━━━` });
      appendLog({ level: 'info', source: 'frontend', message: `节点数量: ${flow.nodes.length}` });
      appendLog({ level: 'info', source: 'frontend', message: `环境: ${hasMimic ? 'Electron (真实IPC)' : '浏览器 (mock)'}` });

      if (!hasMimic) {
        appendLog({ level: 'warn', source: 'frontend', message: '非 Electron 环境，将仅模拟执行，不调用真实引擎' });
        // 模拟执行过程
        setTimeout(() => {
          appendLog({ level: 'info', source: 'mock', message: '▶ 模拟工作流开始' });
          flow.nodes.forEach((node, idx) => {
            setTimeout(() => {
              appendLog({ level: 'info', source: 'mock', message: `  → 执行节点 ${idx + 1}: ${node.nodeName || node.nodeType}` });
            }, 300 * (idx + 1));
          });
          setTimeout(() => {
            setStatus('success');
            setIsRunning(false);
            appendLog({ level: 'info', source: 'mock', message: '■ 模拟执行完成（真实执行请在 Electron 中运行）' });
          }, 300 * (flow.nodes.length + 1));
        }, 200);
        return;
      }

      appendLog({ level: 'info', source: 'frontend', message: '调用 flow-v2:run ...' });

      win.mimic.invoke('flow-v2:run', flow)
        .then((result: any) => {
          appendLog({
            level: 'info',
            source: 'frontend',
            message: `flow-v2:run 响应: ${JSON.stringify(result)}`,
          });
          if (result?.error) {
            appendLog({ level: 'error', source: 'frontend', message: `启动失败: ${result.error}` });
            setIsRunning(false);
            setStatus('failed');
          }
        })
        .catch((e: any) => {
          appendLog({
            level: 'error',
            source: 'frontend',
            message: `IPC 调用异常: ${e?.message || String(e)}`,
          });
          setIsRunning(false);
          setStatus('failed');
        });
    } catch (e: any) {
      console.error('[FlowTester] handleRun error:', e);
      appendLog({
        level: 'error',
        source: 'frontend',
        message: `运行异常: ${e?.message || String(e)}`,
      });
      setIsRunning(false);
      setStatus('failed');
    }
  };

  const handleStop = () => {
    try {
      const win = window as any;
      appendLog({ level: 'warn', source: 'frontend', message: '请求停止工作流...' });

      if (win.mimic) {
        win.mimic.invoke('flow-v2:stop')
          .then((result: any) => {
            appendLog({
              level: 'info',
              source: 'frontend',
              message: `停止响应: ${JSON.stringify(result)}`,
            });
          })
          .catch((e: any) => {
            appendLog({
              level: 'error',
              source: 'frontend',
              message: `停止失败: ${e?.message || String(e)}`,
            });
          });
      }
      setStatus('stopped');
      setIsRunning(false);
    } catch (e: any) {
      appendLog({
        level: 'error',
        source: 'frontend',
        message: `停止异常: ${e?.message || String(e)}`,
      });
    }
  };

  const handleTestLog = () => {
    appendLog({ level: 'info', source: 'test', message: '测试日志 - 确认日志系统正常工作' });
    appendLog({ level: 'warn', source: 'test', message: '这是一条警告日志' });
    appendLog({ level: 'error', source: 'test', message: '这是一条错误日志' });
    appendLog({ level: 'debug', source: 'test', message: '这是一条调试日志' });
  };

  const parsedFlow = useMemo(() => {
    try {
      return JSON.parse(flowJson) as FlowSchema;
    } catch {
      return null;
    }
  }, [flowJson]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  };

  const getStatusIcon = (nodeStatus?: string) => {
    switch (nodeStatus) {
      case 'running':
        return <PlayCircle className="w-4 h-4 text-sky-500 animate-pulse" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-rose-500" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6" />
            Flow Tester
            <Badge variant="outline" className="text-xs ml-2">v0.2</Badge>
          </h1>
          <p className="text-muted-foreground text-sm">v2 调度层测试工具 — 编辑 Flow JSON 并运行</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleTestLog} className="gap-2">
            <Zap className="w-4 h-4" />
            测试日志
          </Button>
          <Badge variant={isRunning ? 'default' : 'outline'} className="gap-1.5">
            {status === 'running' && <PlayCircle className="w-3 h-3 animate-pulse" />}
            {status === 'success' && <CheckCircle2 className="w-3 h-3" />}
            {status === 'failed' && <XCircle className="w-3 h-3" />}
            {status}
          </Badge>
          {!isRunning ? (
            <Button onClick={handleRun} disabled={!!jsonError} className="gap-2">
              <Play className="w-4 h-4" />
              运行
            </Button>
          ) : (
            <Button variant="destructive" onClick={handleStop} className="gap-2">
              <Square className="w-4 h-4" />
              停止
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="json" className="gap-2">
            <FileJson className="w-4 h-4" />
            Flow JSON
          </TabsTrigger>
          <TabsTrigger value="nodes" className="gap-2">
            <PlayCircle className="w-4 h-4" />
            节点状态
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <Terminal className="w-4 h-4" />
            日志输出 {logs.length > 0 && `(${logs.length})`}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 mt-4 overflow-hidden">
          <TabsContent value="json" className="h-full mt-0">
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">FlowSchema JSON</CardTitle>
                <CardDescription>
                  直接编辑 JSON 来测试工作流。支持的节点类型：midscene.*, control.*
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <div className="h-full flex flex-col gap-2">
                  {jsonError && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>JSON 格式错误：{jsonError}</span>
                    </div>
                  )}
                  <Textarea
                    value={flowJson}
                    onChange={(e) => handleJsonChange(e.target.value)}
                    className="flex-1 font-mono text-xs resize-none"
                    spellCheck={false}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="nodes" className="h-full mt-0">
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">节点执行状态</CardTitle>
                <CardDescription>
                  {parsedFlow?.nodes.length || 0} 个节点
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto">
                <div className="space-y-2">
                  {parsedFlow?.nodes.map((node, index) => {
                    const state = nodeStates[node.id];
                    return (
                      <div
                        key={node.id}
                        className={`
                          flex items-center gap-3 p-3 rounded-xl border transition-colors
                          ${state?.status === 'running' ? 'border-sky-200 bg-sky-50' : ''}
                          ${state?.status === 'success' ? 'border-emerald-200 bg-emerald-50' : ''}
                          ${state?.status === 'failed' ? 'border-rose-200 bg-rose-50' : ''}
                          ${!state || state.status === 'pending' ? 'border-border bg-white' : ''}
                        `}
                      >
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
                          {index + 1}
                        </div>
                        {getStatusIcon(state?.status)}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {node.nodeName || node.nodeType}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {node.nodeType}
                          </div>
                        </div>
                        {state?.endTime && state.startTime && (
                          <Badge variant="outline" className="shrink-0">
                            {((state.endTime - state.startTime) / 1000).toFixed(2)}s
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="h-full mt-0">
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">实时日志</CardTitle>
                <CardDescription>
                  {logs.length} 条日志 — 点击「测试日志」按钮验证日志系统是否正常
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto">
                <div className="font-mono text-xs space-y-0.5">
                  {logs.length === 0 && (
                    <div className="text-muted-foreground text-center py-8">
                      暂无日志，点击「运行」开始执行
                    </div>
                  )}
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={`
                        flex gap-2 py-0.5
                        ${log.level === 'error' ? 'text-rose-600' : ''}
                        ${log.level === 'warn' ? 'text-amber-600' : ''}
                        ${log.level === 'info' ? 'text-slate-700' : ''}
                        ${log.level === 'debug' ? 'text-slate-400' : ''}
                      `}
                    >
                      <span className="text-slate-400 shrink-0">
                        {formatTime(log.timestamp)}
                      </span>
                      <span className="text-slate-500 shrink-0 w-20 truncate">
                        [{log.source}]
                      </span>
                      <span className="break-all">{log.message}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
