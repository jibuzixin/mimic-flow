import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Separator } from '../components/ui/separator';
import { Upload, MonitorPlay, Film, Wand2, Save, Loader2, Pause, Play, Square } from 'lucide-react';
import { invoke, onIpc } from '../lib/api';
import { useUsageStore } from '../stores/usageStore';
import { useAppStore } from '../stores/appStore';
import type { Workflow } from '../../types';

export default function Recorder() {
  const { refresh: refreshUsage } = useUsageStore();
  const { videoParseConcurrency } = useAppStore();
  const [videoPath, setVideoPath] = useState('');
  const [mode, setMode] = useState<'simple' | 'smart' | 'native'>('smart');
  const [fps, setFps] = useState([2]);
  const [maxFrames, setMaxFrames] = useState([30]);
  const [compress, setCompress] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<{ success: boolean; workflow?: Workflow; error?: string; rawResponse?: string; summarySkipped?: boolean; asrSkipped?: boolean } | null>(null);

  // 屏幕录制状态
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [recordedPath, setRecordedPath] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const unsubscribeSource = onIpc('recorder:source', async (payload: unknown) => {
      const { sourceId } = payload as { sourceId: string };
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // @ts-expect-error Electron 桌面源需要使用 chromeMediaSource 约束
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              minWidth: 1280,
              maxWidth: 1920,
              minHeight: 720,
              maxHeight: 1080,
            },
          },
        });
        streamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
            ? 'video/webm;codecs=vp8'
            : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          const result = (await invoke('recorder:save-blob', arrayBuffer, mimeType)) as {
            success: boolean;
            path?: string;
            error?: string;
          };
          if (result.success && result.path) {
            setRecordedPath(result.path);
            setVideoPath(result.path);
          } else {
            setRecordError(result.error || '保存录制失败');
          }
          setRecording(false);
          setPaused(false);
          cleanupStream();
        };
        recorder.onerror = (e) => {
          setRecordError(`录制出错: ${e}`);
          setRecording(false);
          cleanupStream();
        };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;
        setRecording(true);
        setRecordError(null);
        setRecordedPath(null);
        chunksRef.current = [];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRecordError(`无法开始录制: ${message}`);
        setRecording(false);
        cleanupStream();
      }
    });

    const unsubscribeStop = onIpc('recorder:stop', () => {
      mediaRecorderRef.current?.stop();
    });

    const unsubscribePause = onIpc('recorder:pause', () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.pause();
        setPaused(true);
      } else if (mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume();
        setPaused(false);
      }
    });

    return () => {
      unsubscribeSource();
      unsubscribeStop();
      unsubscribePause();
      cleanupStream();
    };
  }, []);

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }

  const handleStartRecording = async () => {
    setRecordError(null);
    const result = (await invoke('recorder:start')) as { success: boolean; error?: string };
    if (!result.success) {
      setRecordError(result.error || '启动录制失败');
    }
  };

  const handlePauseResume = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setPaused(true);
    } else if (mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setPaused(false);
    }
  };

  const handleStopRecording = async () => {
    await invoke('recorder:stop');
  };

  const handleSelectVideo = async () => {
    const path = await invoke<string | null>('dialog:select-video');
    if (path) setVideoPath(path);
  };

  const handleParse = async () => {
    if (!videoPath) return;
    setParsing(true);
    setParseResult(null);
    try {
      const result = await invoke('ai:parse-video', videoPath, {
        mode,
        compress,
        fps: fps[0],
        maxFrames: maxFrames[0],
        concurrency: videoParseConcurrency,
      });
      setParseResult(result as any);
      refreshUsage();
    } catch (e) {
      setParseResult({ success: false, error: String(e) });
    }
    setParsing(false);
  };

  const handleSaveWorkflow = async () => {
    if (!parseResult?.workflow) return;
    const workflow: Workflow = {
      id: crypto.randomUUID(),
      name: parseResult.workflow.name,
      description: parseResult.workflow.description,
      source: 'video',
      steps: (parseResult.workflow.steps as any[]).map((s, i) => ({
        id: crypto.randomUUID(),
        index: i + 1,
        operation: s.Operation || '',
        target: s.Target || '',
        orientation: s.Orientation || '',
        condition: s.Condition || '',
        think: s.Think || '',
        type: 'click',
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await invoke('workflow:save', workflow);
    alert('工作流已保存');
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">录制 / 解析</h1>
        <p className="text-muted-foreground">录制屏幕操作或上传视频，解析成可编排工作流。</p>
      </section>

      <Tabs defaultValue="record" className="w-full">
        <TabsList className="bg-white/70 backdrop-blur-sm shadow-soft">
          <TabsTrigger value="record" className="gap-2">
            <MonitorPlay className="w-4 h-4" />
            屏幕录制
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="w-4 h-4" />
            上传视频
          </TabsTrigger>
        </TabsList>

        <TabsContent value="record" className="mt-4">
          <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MonitorPlay className="w-5 h-5 text-violet-500" />
                屏幕录制
              </CardTitle>
              <CardDescription>
                默认全屏 1080P 录制。快捷键：Shift+V 开麦、Shift+A 暂停、Shift+S 停止。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleStartRecording} disabled={recording}>
                  <MonitorPlay className="w-4 h-4 mr-2" />
                  开始录制
                </Button>
                <Button variant="outline" onClick={handlePauseResume} disabled={!recording}>
                  {paused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                  {paused ? '继续' : '暂停'}
                </Button>
                <Button variant="destructive" onClick={handleStopRecording} disabled={!recording}>
                  <Square className="w-4 h-4 mr-2" />
                  停止并保存
                </Button>
                {recording && (
                  <span className="text-xs text-destructive font-medium animate-pulse">
                    正在录制{paused ? '（已暂停）' : ''}
                  </span>
                )}
              </div>
              {recordError && (
                <p className="text-sm text-destructive">{recordError}</p>
              )}
              {recordedPath && (
                <p className="text-sm text-emerald-600">
                  已保存：{recordedPath}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                提示：录制需要屏幕录制权限，首次使用请在系统设置中授权。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="mt-4 space-y-4">
          <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Film className="w-5 h-5 text-sky-500" />
                视频解析
              </CardTitle>
              <CardDescription>支持 mp4、mkv、mov 等格式。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex gap-3">
                <Input
                  value={videoPath}
                  readOnly
                  placeholder="选择视频文件..."
                  className="bg-white/60"
                />
                <Button variant="secondary" onClick={handleSelectVideo}>
                  <Upload className="w-4 h-4 mr-2" />
                  选择文件
                </Button>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-medium">解析模式</Label>
                <RadioGroup value={mode} onValueChange={(v: string) => setMode(v as 'simple' | 'smart' | 'native')} className="flex gap-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="simple" id="simple" />
                    <Label htmlFor="simple" className="font-normal">简单抽帧</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="smart" id="smart" />
                    <Label htmlFor="smart" className="font-normal">智能抽帧</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="native" id="native" />
                    <Label htmlFor="native" className="font-normal">模型原生视频</Label>
                  </div>
                </RadioGroup>
              </div>

              {mode !== 'native' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-sm font-medium">抽帧 FPS</Label>
                      <span className="text-xs text-muted-foreground">{fps[0]}</span>
                    </div>
                    <Slider value={fps} onValueChange={setFps} min={0.2} max={5} step={0.2} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-sm font-medium">最大帧数</Label>
                      <span className="text-xs text-muted-foreground">{maxFrames[0]}</span>
                    </div>
                    <Slider value={maxFrames} onValueChange={setMaxFrames} min={5} max={100} step={1} />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl bg-white/50 p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="compress" className="text-sm font-medium">压缩视频</Label>
                  <p className="text-xs text-muted-foreground">解析前压缩可节省 Token 与带宽。</p>
                </div>
                <Switch id="compress" checked={compress} onCheckedChange={setCompress} />
              </div>

              <Button onClick={handleParse} disabled={!videoPath || parsing} className="gap-2">
                {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                开始解析
              </Button>
            </CardContent>
          </Card>

          {parseResult && (
            <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wand2 className="w-5 h-5 text-violet-500" />
                  解析结果
                </CardTitle>
                <CardDescription>
                  {parseResult.success ? parseResult.workflow?.description : parseResult.error}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!parseResult.success ? (
                  <p className="text-sm text-destructive">{parseResult.error}</p>
                ) : (
                  <>
                    {parseResult.summarySkipped && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                        <p className="font-medium">未启用大语言模型汇总</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          由于多批次解析存在 2 帧重叠，当前结果可能包含重复步骤或断序的 Index，请手动去重、整理。
                        </p>
                      </div>
                    )}
                    <div className="space-y-2 max-h-[300px] overflow-auto rounded-xl bg-white/50 p-3">
                      {(parseResult.workflow?.steps as any[] ?? []).map((step, i) => (
                        <div key={i} className="text-sm border-b border-border/30 last:border-0 pb-2 last:pb-0">
                          <p className="font-medium">步骤 {step.Index || i + 1}: {step.Operation}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">目标：{step.Target} · 方位：{step.Orientation}</p>
                        </div>
                      ))}
                    </div>
                    <Separator />
                    <div className="flex gap-3">
                      <Button onClick={handleSaveWorkflow}>
                        <Save className="w-4 h-4 mr-2" />
                        保存为工作流
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
