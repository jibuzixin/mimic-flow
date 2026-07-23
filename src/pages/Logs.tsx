import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';

import { invoke } from '../lib/api';
import { cn } from '../lib/utils';
import { Terminal, RotateCcw, FileText, Clock, Search, Download, Trash2, AlertCircle } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

interface LogFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

interface ReadResult {
  entries: LogEntry[];
  total: number;
}

interface IpcResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

const PAGE_SIZE = 300;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

export default function Logs() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [result, setResult] = useState<ReadResult>({ entries: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | LogEntry['level']>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadFiles = async () => {
    const res = await invoke<IpcResponse<LogFile[]>>('logs:list-files');
    if (res.success && res.data) {
      setFiles(res.data);
      if (!selectedFile && res.data.length > 0) {
        setSelectedFile(res.data[0].path);
      }
    }
  };

  const loadLogs = async (targetOffset = 0) => {
    const file = selectedFile || files[0]?.path;
    if (!file) return;
    setLoading(true);
    const res = await invoke<IpcResponse<ReadResult>>('logs:read-file', file, PAGE_SIZE, targetOffset);
    if (res.success && res.data) {
      setResult(res.data);
      setOffset(targetOffset);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadFiles();
  }, []);

  useEffect(() => {
    loadLogs(0);
  }, [selectedFile]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      loadFiles();
      loadLogs(0);
    }, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, selectedFile]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [result.entries]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return result.entries.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
      if (!q) return true;
      const text = `${entry.message} ${JSON.stringify(entry.meta ?? {})}`.toLowerCase();
      return text.includes(q);
    });
  }, [result.entries, search, levelFilter]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(filteredEntries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col min-h-[calc(100vh-2rem-4rem)]">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Terminal className="w-6 h-6 text-violet-500" />
            日志中心
          </h1>
          <p className="text-sm text-muted-foreground">查看、搜索和导出应用运行日志</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-2">
            <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="auto-refresh" className="text-sm text-muted-foreground">自动刷新</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => { loadFiles(); loadLogs(0); }}>
            <RotateCcw className="w-4 h-4 mr-1.5" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1.5" />
            导出
          </Button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        <Card className="w-64 shrink-0 border-0 shadow-soft bg-white/70 backdrop-blur-sm flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-500" />
              日志文件
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-2">
            {files.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">暂无日志文件</div>
            ) : (
              files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file.path)}
                  className={cn(
                    'w-full text-left rounded-xl border p-3 transition-all hover:shadow-soft',
                    selectedFile === file.path
                      ? 'bg-violet-50 border-violet-200 ring-1 ring-violet-200'
                      : 'bg-white/50 border-transparent hover:bg-white/80'
                  )}
                >
                  <p className="text-xs font-medium truncate">{file.name}</p>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
                    <span>{formatBytes(file.size)}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(new Date(file.mtime).toISOString())}</span>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="flex-1 border-0 shadow-soft bg-white/70 backdrop-blur-sm flex flex-col min-w-0">
          <CardHeader className="pb-3 border-b border-border/30">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 flex-1">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <Input
                  placeholder="搜索日志内容、消息或元数据..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-white/60 h-9 text-sm"
                />
              </div>
              <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as typeof levelFilter)}>
                <SelectTrigger className="w-32 bg-white/60 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部级别</SelectItem>
                  <SelectItem value="debug">Debug</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <CardDescription className="text-xs pt-2">
              共 {result.total} 条日志，当前显示 {filteredEntries.length} 条
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <div className="h-full overflow-y-auto p-4">
              {filteredEntries.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-2">
                  <AlertCircle className="w-8 h-8 opacity-40" />
                  <p className="text-sm">暂无匹配日志</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredEntries.map((entry, idx) => (
                    <div
                      key={`${entry.timestamp}-${idx}`}
                      className={cn(
                        'rounded-xl border p-3 text-xs font-mono',
                        entry.level === 'error' && 'bg-rose-50 border-rose-100 text-rose-800',
                        entry.level === 'warn' && 'bg-amber-50 border-amber-100 text-amber-800',
                        entry.level === 'info' && 'bg-slate-50 border-slate-100 text-slate-700',
                        entry.level === 'debug' && 'bg-violet-50/50 border-violet-100 text-violet-700'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] h-5 px-1.5',
                            entry.level === 'error' && 'border-rose-200 bg-rose-100 text-rose-700',
                            entry.level === 'warn' && 'border-amber-200 bg-amber-100 text-amber-700',
                            entry.level === 'info' && 'border-slate-200 bg-slate-100 text-slate-700',
                            entry.level === 'debug' && 'border-violet-200 bg-violet-100 text-violet-700'
                          )}
                        >
                          {entry.level.toUpperCase()}
                        </Badge>
                        <span className="opacity-60">{new Date(entry.timestamp).toLocaleString('zh-CN', { hour12: false })}</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words">{entry.message}</div>
                      {entry.meta && Object.keys(entry.meta).length > 0 && (
                        <pre className="mt-2 p-2 rounded-lg bg-white/60 overflow-x-auto text-[11px]">
                          {JSON.stringify(entry.meta, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
