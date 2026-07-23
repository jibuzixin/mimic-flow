import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Mic, Send, Square, CheckCircle, XCircle } from 'lucide-react';
import { invoke } from '../lib/api';

export default function Executor() {
  const [input, setInput] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [listening, setListening] = useState(false);

  const appendLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleSend = async () => {
    if (!input.trim()) return;
    appendLog(`用户：${input}`);
    setRunning(true);
    try {
      const result = await invoke('ai:chat-step', input);
      appendLog(`AI：${JSON.stringify(result)}`);
    } catch (e) {
      appendLog(`错误：${e}`);
    }
    setRunning(false);
    setInput('');
  };

  const toggleListen = () => {
    setListening(!listening);
    appendLog(listening ? '语音识别已停止' : '语音识别已开启，请说话...');
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">你说我做</h1>
        <p className="text-muted-foreground">用自然语言让 AI 一步步执行操作，完成后确认是否保留为工作流。</p>
      </section>

      <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mic className="w-5 h-5 text-violet-500" />
            交互控制台
          </CardTitle>
          <CardDescription>输入指令或开启语音，每执行一步需确认结果。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例如：打开浏览器并搜索 mimic-flow"
              className="bg-white/60"
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
            <Button onClick={handleSend} disabled={running}>
              <Send className="w-4 h-4 mr-2" />
              发送
            </Button>
            <Button variant={listening ? 'destructive' : 'outline'} onClick={toggleListen}>
              {listening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
          </div>

          <div className="flex gap-2">
            <Badge variant="outline" className="gap-1">
              <CheckCircle className="w-3 h-3" /> 完成
            </Badge>
            <Badge variant="outline" className="gap-1">
              <XCircle className="w-3 h-3" /> 重做
            </Badge>
            <span className="text-xs text-muted-foreground ml-2">说“结束”或“停止”可结束会话。</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">执行日志</CardTitle>
          {running && <Progress value={45} className="mt-2" />}
        </CardHeader>
        <CardContent>
          <Textarea
            value={logs.join('\n')}
            readOnly
            className="bg-slate-50/60 font-mono text-sm min-h-[240px]"
          />
        </CardContent>
      </Card>
    </div>
  );
}
