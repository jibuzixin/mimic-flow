# 调度层 ↔ UI层 完整技术实现方案 & IPC通信协议

## 前置基础约束

### 技术底座

Electron 架构

- **渲染进程（UI层）**：React + ReactFlow，画布编辑器，只负责展示、编辑、触发指令，**无任何执行逻辑**
- **主进程（调度层）**：Node.js 环境，承载：流程调度Runtime、MidsceneAdapter、视频解析模块、本地文件服务
- 通信通道：Electron IPC（`ipcRenderer.invoke` 同步请求 / `ipcRenderer.send` + `mainWindow.webContents.send` 事件推送）

### 核心设计原则

1. **职责强隔离**
 UI层：生产者，只产出标准 `FlowSchema`，不理解调度执行细节；
 调度层：消费者，只接收结构化Flow数据，不感知画布渲染逻辑。
2. **通信标准化**：所有消息统一外层包装，统一异常格式、统一追踪ID。
3. **两类通信模型分离**
   - 请求-应答模型：UI主动发起操作（打开文件、运行流程、停止流程、校验流程）
   - 单向事件推送模型：调度层主动推送实时执行状态（不等待UI回复）
4. **完全解耦**
 UI层不知道调度层内部分片、变量池、Midscene调用逻辑；调度层不知道ReactFlow画布结构。
5. **可观测性**：每条请求携带 `requestId`；每条运行实例携带唯一 `runInstanceId`。

---

# 一、通用消息基础结构（强制统一，所有IPC消息外层包装）

```
/**
 * IPC通用外层信封，所有消息统一套这一层
 */
interface IpcEnvelope<T> {
  // 事件/请求名称
  channel: string;
  // 请求唯一ID，用于匹配请求与响应；事件推送可空
  requestId?: string;
  // 消息业务载荷
  payload: T;
  // 时间戳 ms
  timestamp: number;
}

/**
 * 请求类统一返回格式（invoke 同步调用返回）
 */
interface IpcResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
```

> 
> 规范：
> 
> 
> 1. UI调用 `ipcRenderer.invoke(channel, envelope)`
> 2. 主进程统一中间件解析 envelope，捕获全局异常，包装为 `IpcResponse` 返回
> 3. 调度层主动推送状态使用 `webContents.send(channel, envelope)`，不需要response

---

# 二、请求-应答通道清单【UI → 调度层/主进程服务】

采用 `invoke` 模式，等待处理结果。

## 1. flow:validate 流程预校验

用途：画布点击预校验，检测FlowSchema参数合法性、循环配置、变量引用、节点参数。

```
// 请求 payload
{
  flow: FlowSchema
}
// 返回 payload
{
  valid: boolean;
  errors: Array<{
    nodeId?: string;
    message: string;
  }>
}
```

## 2. flow:run 启动一条流程执行

```
// 请求 payload
{
  flow: FlowSchema
}
// 返回 payload
{
  runInstanceId: string; // 运行实例唯一标识
}
```

业务规则：

- 调度层收到后创建独立运行上下文、初始化变量池、启动调度主循环
- MVP限制：同时只允许存在**一个活跃runInstanceId**，重复启动直接返回错误

## 3. flow:stop 终止正在执行的流程

```
// 请求 payload
{
  runInstanceId: string;
}
// 返回 payload
{
  stopped: boolean;
}
```

业务规则：调度层查询实例，触发AbortController终止执行，立刻停止向Midscene下发任务。

## 4. video:parse-flow 视频解析生成Flow（输入预处理模块，不属于调度Runtime）

```
// 请求 payload
{
  videoLocalPath: string;
}
// 返回 payload
{
  flow: FlowSchema; // 线性节点流程，无if/loop控制节点
}
```

链路：UI上传视频→本地存储路径传入 → 切片→调用多模态解析模型 → 返回标准Flow，前端渲染画布。

## 5. file:save-flow 保存 .flow.json 文件

```
// 请求 payload
{
  filePath: string;
  flowWrapper: FlowFileWrapper; // 带外层包装结构
}
// 返回 payload
{
  ok: boolean;
}
```

## 6. file:open-flow 读取 .flow.json 文件

```
// 请求 payload
{
  filePath: string;
}
// 返回 payload
{
  flowWrapper: FlowFileWrapper;
}
```

## 7. config:get / config:set 软件全局配置（双模型配置、全局运行参数）

> 
> 全局配置存在本地，不属于单个Flow

```
// GlobalAppConfig 结构
interface GlobalAppConfig {
  // Midscene运行视觉模型全局默认配置（新建流程默认继承）
  defaultMidsceneModel: ModelConfig;
  // 视频解析专用多模态模型配置
  videoParseModel: ModelConfig;
  globalRuntimeOption: {
    defaultTimeout: number;
    defaultRetry: number;
  }
}
```

---

# 三、调度层主动推送事件【调度层 → UI 单向推送】

channel统一前缀 `runtime:event`，无需回复，前端持续监听。
所有事件携带 `runInstanceId`，多实例场景前端可隔离渲染。

## 1. runtime:event:node-start

节点开始执行

```
payload: {
  runInstanceId: string;
  nodeId: string;
}
```

## 2. runtime:event:node-success

节点执行成功

```
payload: {
  runInstanceId: string;
  nodeId: string;
  screenshots: string[]; // 本地图片路径
  logs: Array<{
    type: "plan" | "action" | "assert" | "info";
    content: string;
  }>;
  extractedData?: Record<string, any>; // aiQuery产出数据
}
```

## 3. runtime:event:node-fail

节点执行失败

```
payload: {
  runInstanceId: string;
  nodeId: string;
  errorMessage: string;
  screenshots: string[];
  logs: LogItem[];
}
```

## 4. runtime:event:flow-finish

整条流程执行结束（成功 / 主动停止 / 异常终止）

```
payload: {
  runInstanceId: string;
  success: boolean;
  reason: "complete" | "stopped" | "error";
  reportFilePath?: string; // 本地HTML报告路径
}
```

> 
> 重要MVP限制：
> Midscene是分段批量执行，事件**按分片批量回调**；不是单动作实时推送。
> 一段分片内多个节点执行完毕，批量推送多个node事件。

---

# 四、分层代码架构方案（可直接落地目录结构思路）

## 渲染进程（UI层）模块

```
src/renderer
├── service
│   ├── ipcClient.ts        // IPC统一封装，封装所有通道调用
│   ├── flowGraphConverter.ts // graph <=> FlowSchema 双向转换
├── canvas                   // ReactFlow画布组件
├── panels
│   ├── NodePropertyPanel    // 节点配置表单
│   ├── LogPanel             // 实时日志面板
│   ├── GlobalConfigPanel    // 全局模型配置
```

### ipcClient.ts 示例封装思路

统一封装所有请求，自动包裹 IpcEnvelope，统一捕获错误，避免到处裸写ipc调用。

```
// 伪代码示例
export function invoke<T>(channel: string, payload: unknown): Promise<IpcResponse<T>> {
  const envelope: IpcEnvelope<unknown> = {
    channel,
    requestId: uuidv4(),
    payload,
    timestamp: Date.now()
  }
  return ipcRenderer.invoke(channel, envelope)
}

// 使用方式
const res = await invoke<{runInstanceId:string}>("flow:run", { flow });
```

## 主进程（主进程服务分层）

```
src/main
├── ipc
│   ├── ipcRouter.ts        // IPC路由中心，统一接收渲染进程消息，分发到对应服务
│   ├── ipcMiddleware.ts    // 统一信封解析、异常捕获、日志打印
├── services
│   ├── FlowRuntimeService  // 调度运行时核心管理，管理所有run实例
│   ├── MidsceneAdapter     // Midscene适配层
│   ├── VideoParseService   // 视频解析服务
│   ├── FileService         // .flow.json 文件读写
│   ├── ConfigService       // 全局配置持久化
├── runtime
│   ├── FlowInstance.ts     // 单条流程运行实例（调度核心循环）
│   ├── SegmentBuilder.ts   // 分片逻辑：连续节点收集
│   ├── VariableResolver.ts // 变量插值解析
```

### IPC路由中心职责

1. 解析收到的 `IpcEnvelope`
2. 根据 channel 分发到对应Service函数
3. 所有异常统一捕获，组装成标准化 `IpcResponse` 返回渲染进程
4. 打印通信日志，方便调试

## 调度层内部：FlowInstance（单流程运行实例）

一条 `runInstanceId` 对应一个独立 `FlowInstance` 对象，内部包含：

- 原始FlowSchema副本
- 变量池（运行时状态）
- 当前执行节点指针
- AbortController（支持停止）
- 事件发射器：执行状态通过事件发射器向外广播，由IPC层转发给UI

> 
> 调度层内部不直接操作IPC！
> FlowInstance 只触发内部事件；由上层 FlowRuntimeService 监听实例事件，再通过IPC推送到UI。
> **再次解耦：调度内核完全不依赖Electron IPC接口，未来可以剥离成纯Node服务。**

```
FlowInstance（调度核心）
    │ emit('nodeSuccess')
    ▼
FlowRuntimeService 监听实例事件
    ▼
ipcRouter → webContents.send 推送消息到渲染进程UI
```

---

# 五、数据流完整两条典型链路演示

## 链路1：画布运行流程

1. UI：ReactFlow图形 → `graphDataToFlowSchema()` → FlowSchema
2. UI调用 `invoke("flow:run", {flow})`
3. 主进程ipcRouter接收，转交 FlowRuntimeService
4. FlowRuntimeService 创建 FlowInstance，启动调度循环
5. FlowInstance 拓扑遍历、分片、变量插值 → 调用MidsceneAdapter
6. Adapter执行Midscene任务，拿到结果
7. FlowInstance 更新变量池，触发内部事件 `node-success`
8. FlowRuntimeService捕获事件，通过IPC推送 `runtime:event:node-success`
9. UI监听事件，画布高亮节点、刷新日志面板
10. 流程结束推送 `flow-finish`

## 链路2：视频导入生成画布

1. UI选择本地视频文件路径
2. UI调用 `invoke("video:parse-flow", {videoLocalPath})`
3. VideoParseService 切片、调用多模态模型 → 生成FlowSchema
4. IPC返回FlowSchema
5. UI执行 `flowSchemaToGraphData()` 渲染ReactFlow画布

---

# 六、MVP阶段工程限制 & 避坑规范

1. ❌ UI永远不要直接向Midscene发起任何调用；所有自动化执行请求必须走 `flow:run`
2. ❌ 调度层内部逻辑禁止直接引用React、画布相关类型；类型定义抽离成共享 `shared/types`
3. ✅ 所有TS接口（FlowSchema、IPC消息）抽离到独立 `shared` 目录，渲染进程 & 主进程共用一套类型
4. ✅ 所有IPC通道名称统一常量管理，禁止硬编码字符串
5. ✅ 停止流程依靠 `AbortController` 向下穿透到MidsceneAdapter，保证任务可中断
6. ✅ 运行时所有事件携带 `runInstanceId`，预留未来支持多实例并发（MVP先限制单实例）

---


# 全套产出合集：共享类型定义 + FlowInstance调度主循环伪代码 + 变量/表达式工具函数

> 
> 全部基于前面敲定架构、FlowJSON、IPC协议，可直接复制进项目 `shared/types.ts`、主进程runtime模块使用
> 分层：【共享类型】→【调度实例核心伪代码】→【变量插值+expr-eval工具函数】

## 一、shared/types.ts 完整共享类型（渲染进程 / 主进程共用）

```
import { v4 as uuidv4 } from "uuid";

// ===================== 基础常量 =====================
export const IPC_CHANNEL = {
  FLOW_VALIDATE: "flow:validate",
  FLOW_RUN: "flow:run",
  FLOW_STOP: "flow:stop",
  VIDEO_PARSE_FLOW: "video:parse-flow",
  FILE_SAVE_FLOW: "file:save-flow",
  FILE_OPEN_FLOW: "file:open-flow",
  CONFIG_GET: "config:get",
  CONFIG_SET: "config:set",

  RUNTIME_EVENT: "runtime:event",
} as const;

export type FlowNodeType =
  | "navigate"
  | "aiTap"
  | "aiInput"
  | "aiQuery"
  | "aiAssert"
  | "sleep"
  | "if"
  | "loop";

// ===================== IPC 通用信封 =====================
export interface IpcEnvelope<T> {
  channel: string;
  requestId?: string;
  payload: T;
  timestamp: number;
}

export interface IpcResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// ===================== 全局软件配置（存储本地，不属于Flow） =====================
export interface ModelConfig {
  modelName: string;
  apiKey: string;
  baseUrl: string;
  defaultDeepThink: boolean;
  cacheable: boolean;
  timeout: number;
  extraModelParams?: Record<string, any>;
}

export interface GlobalAppConfig {
  defaultMidsceneModel: ModelConfig;
  videoParseModel: ModelConfig;
  globalRuntimeOption: {
    defaultTimeout: number;
    defaultRetry: number;
  };
}

// ===================== Flow 标准定义 =====================
export interface FlowMeta {
  name: string;
  desc: string;
  tags: string[];
  triggerType: "manual";
  cronExpr?: string;
  globalTimeout: number;
  globalRetry: number;
  failStrategy: "terminate" | "skip";
  version: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DeviceConfig {
  type: "web" | "android" | "ios";
  url?: string;
  viewport: { width: number; height: number };
  userAgent?: string;
  cookiePath?: string;
  deviceConnectOpts?: Record<string, any>;
}

export interface AiGlobalConfig {
  modelName: string;
  apiKey: string;
  baseUrl: string;
  actionContext: string;
  defaultDeepThink: boolean;
  cacheable: boolean;
  timeout: number;
  extraModelParams?: Record<string, any>;
}

export interface GlobalVarItem {
  key: string;
  value: string | number | boolean;
  encrypt: boolean;
  comment?: string;
}

export interface NextNodeRoute {
  nodeId: string;
  condition?: string;
}

export interface FlowNode {
  nodeId: string;
  nodeType: FlowNodeType;
  nodeName: string;
  timeout: number;
  retryCount: number;
  failStrategy?: "terminate" | "skip";
  outputVar?: string;
  nodeParams: Record<string, any>;
  nextNodes: NextNodeRoute[];
  comment?: string;
  catchNodeId?: string;
  disabled?: boolean;
}

export interface FlowSchema {
  flowId: string;
  flowMeta: FlowMeta;
  deviceConfig: DeviceConfig;
  aiGlobalConfig: AiGlobalConfig;
  globalVars: GlobalVarItem[];
  nodeList: FlowNode[];
}

// .flow.json 文件外层包装
export interface FlowFileWrapper {
  schemaFormat: "midscene-desktop-flow";
  schemaVersion: "1.0.0";
  payload: FlowSchema;
}

// ===================== Midscene 适配器入参结构 =====================
export interface MidsceneSegmentTask {
  modelConfig: ModelConfig;
  actionContext: string;
  deviceConfig: DeviceConfig;
  actions: Array<{
    nodeId: string;
    nodeType: FlowNodeType;
    params: Record<string, any>;
  }>;
  variables: Record<string, any>;
}

export interface MidsceneSegmentResult {
  success: boolean;
  error?: { code: string; message: string };
  extracted: Record<string, { nodeId: string; value: any }>;
  screenshots: string[];
  rawLogs: Array<{
    type: "plan" | "action" | "assert" | "error" | "info";
    content: string;
  }>;
}

// ===================== 调度推送 runtime 事件载荷 =====================
export type RuntimeEventPayload =
  | {
      type: "node-start";
      runInstanceId: string;
      nodeId: string;
    }
  | {
      type: "node-success";
      runInstanceId: string;
      nodeId: string;
      screenshots: string[];
      logs: MidsceneSegmentResult["rawLogs"];
      extractedData?: Record<string, any>;
    }
  | {
      type: "node-fail";
      runInstanceId: string;
      nodeId: string;
      errorMessage: string;
      screenshots: string[];
      logs: MidsceneSegmentResult["rawLogs"];
    }
  | {
      type: "flow-finish";
      runInstanceId: string;
      success: boolean;
      reason: "complete" | "stopped" | "error";
      reportFilePath?: string;
    };
```

## 二、主进程调度核心：FlowInstance.ts（调度主循环完整伪代码）

```
import { EventEmitter } from "events";
import { AbortController } from "node:util";
import { FlowSchema, FlowNode, MidsceneSegmentTask } from "../shared/types";
import { MidsceneAdapter } from "./MidsceneAdapter";
import { buildContinuousSegment } from "./SegmentBuilder";
import { resolveVariableInterpolate, evaluateExpression } from "./runtimeUtils";

export class FlowInstance extends EventEmitter {
  public readonly runInstanceId: string;
  public readonly flowSchema: FlowSchema;
  public abortController: AbortController;
  public isRunning = false;

  // 运行时变量池 key -> value
  private variablePool: Record<string, any> = {};
  // 拓扑索引 nodeId -> node
  private nodeMap = new Map<string, FlowNode>();
  // 当前执行指针
  private currentNodeId: string | null = null;

  constructor(flowSchema: FlowSchema) {
    super();
    this.runInstanceId = uuidv4();
    this.flowSchema = flowSchema;
    this.abortController = new AbortController();

    // 构建节点索引
    flowSchema.nodeList.forEach((n) => this.nodeMap.set(n.nodeId, n));
    // 初始化变量池
    flowSchema.globalVars.forEach((v) => {
      this.variablePool[v.key] = v.value;
    });

    // 寻找起始节点：没有前驱节点的节点作为入口（简易规则，MVP够用）
    this.currentNodeId = this.findStartNodeId();
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.mainLoop();
    } catch (err) {
      this.emitFlowFinish(false, "error");
    } finally {
      this.isRunning = false;
    }
  }

  public stop() {
    this.abortController.abort();
  }

  private findStartNodeId(): string | null {
    const allTargetIds = new Set<string>();
    this.flowSchema.nodeList.forEach((node) => {
      node.nextNodes.forEach((r) => allTargetIds.add(r.nodeId));
    });
    const startNodes = this.flowSchema.nodeList.filter(
      (n) => !allTargetIds.has(n.nodeId)
    );
    return startNodes[0]?.nodeId ?? null;
  }

  private async mainLoop() {
    while (this.currentNodeId && !this.abortController.signal.aborted) {
      const node = this.nodeMap.get(this.currentNodeId);
      if (!node) break;

      // ========== 分支1：流程控制节点 if / loop（本地计算，不调用Midscene） ==========
      if (node.nodeType === "if") {
        const expr = node.nodeParams.expr as string;
        const pass = evaluateExpression(expr, this.variablePool);
        // 筛选符合条件的下一跳
        const nextRoute = node.nextNodes.find((route) => {
          if (!route.condition) return pass;
          return evaluateExpression(route.condition, this.variablePool);
        });
        this.currentNodeId = nextRoute?.nodeId ?? null;
        continue;
      }

      if (node.nodeType === "loop") {
        const expr = node.nodeParams.expr as string;
        const maxIter = node.nodeParams.maxIteration as number;
        // 简易循环实现：你可以扩展迭代计数器
        const pass = evaluateExpression(expr, this.variablePool);
        if (!pass) {
          this.currentNodeId = null;
          continue;
        }
        // 循环跳回起点，业务自行维护循环变量
        const nextRoute = node.nextNodes[0];
        this.currentNodeId = nextRoute?.nodeId ?? null;
        continue;
      }

      // ========== 分支2：原子操作节点：收集连续分片 ==========
      const segmentNodes = buildContinuousSegment(node, this.nodeMap);

      // 对分片内所有节点参数执行变量插值渲染 {{globalVars.xxx}}
      const resolvedActions = segmentNodes.map((n) => ({
        nodeId: n.nodeId,
        nodeType: n.nodeType,
        params: resolveVariableInterpolate(n.nodeParams, this.variablePool),
      }));

      // 组装任务下发适配器
      const task: MidsceneSegmentTask = {
        modelConfig: this.flowSchema.aiGlobalConfig,
        actionContext: this.flowSchema.aiGlobalConfig.actionContext,
        deviceConfig: this.flowSchema.deviceConfig,
        actions: resolvedActions,
        variables: { ...this.variablePool },
      };

      this.emit("runtime-event", {
        type: "node-start",
        runInstanceId: this.runInstanceId,
        nodeId: node.nodeId,
      });

      const result = await MidsceneAdapter.run(task, this.abortController.signal);

      // 处理执行结果，回填变量池（aiQuery）
      for (const [varKey, item] of Object.entries(result.extracted)) {
        this.variablePool[varKey] = item.value;
      }

      if (result.success) {
        this.emit("runtime-event", {
          type: "node-success",
          runInstanceId: this.runInstanceId,
          nodeId: node.nodeId,
          screenshots: result.screenshots,
          logs: result.rawLogs,
          extractedData: result.extracted,
        });
        // 取本条节点无条件后继，进入下一轮循环
        const nextRoute = node.nextNodes.find((r) => !r.condition);
        this.currentNodeId = nextRoute?.nodeId ?? null;
      } else {
        // 失败处理：重试 / 终止 / 跳过
        const strategy = node.failStrategy ?? this.flowSchema.flowMeta.failStrategy;
        if (strategy === "terminate") {
          this.emit("runtime-event", {
            type: "node-fail",
            runInstanceId: this.runInstanceId,
            nodeId: node.nodeId,
            errorMessage: result.error?.message ?? "未知错误",
            screenshots: result.screenshots,
            logs: result.rawLogs,
          });
          this.emitFlowFinish(false, "error");
          break;
        } else {
          // skip，直接向下跳转
          this.emit("runtime-event", {
            type: "node-fail",
            runInstanceId: this.runInstanceId,
            nodeId: node.nodeId,
            errorMessage: result.error?.message ?? "未知错误",
            screenshots: result.screenshots,
            logs: result.rawLogs,
          });
          const nextRoute = node.nextNodes.find((r) => !r.condition);
          this.currentNodeId = nextRoute?.nodeId ?? null;
        }
      }
    }

    if (!this.abortController.signal.aborted) {
      this.emitFlowFinish(true, "complete");
    } else {
      this.emitFlowFinish(false, "stopped");
    }
  }

  private emitFlowFinish(success: boolean, reason: "complete" | "stopped" | "error") {
    this.emit("runtime-event", {
      type: "flow-finish",
      runInstanceId: this.runInstanceId,
      success,
      reason,
    });
  }
}
```

## 三、配套工具 runtimeUtils.ts 【变量插值 + expr-eval表达式求值】

```
import { Parser } from "expr-eval";

const parser = new Parser();

/**
 * 变量插值：递归遍历对象，替换 {{globalVars.xxx}}
 */
export function resolveVariableInterpolate<T>(obj: T, vars: Record<string, any>): T {
  if (typeof obj === "string") {
    return obj.replace(/\{\{([\w\.]+)\}\}/g, (_, path) => {
      const keys = path.split(".");
      let val: any = vars;
      for (const k of keys) val = val?.[k];
      return val ?? "";
    }) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveVariableInterpolate(item, vars)) as unknown as T;
  }
  if (obj && typeof obj === "object") {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = resolveVariableInterpolate(v, vars);
    }
    return res as T;
  }
  return obj;
}

/**
 * 条件表达式求值，expr-eval
 * @param exprStr 表达式文本
 * @param variablePool 变量池
 */
export function evaluateExpression(exprStr: string, variablePool: Record<string, any>): boolean {
  try {
    const expr = parser.parse(exprStr);
    const result = expr.evaluate(variablePool);
    return Boolean(result);
  } catch (e) {
    console.warn("表达式解析失败", exprStr, e);
    return false;
  }
}
```

## 四、分片工具 SegmentBuilder.ts（收集连续线性节点，碰到控制节点截断）

```
import { FlowNode, FlowNodeType } from "../shared/types";

const CONTROL_NODE_TYPES: FlowNodeType[] = ["if", "loop"];

export function buildContinuousSegment(
  startNode: FlowNode,
  nodeMap: Map<string, FlowNode>
): FlowNode[] {
  const segment: FlowNode[] = [startNode];
  let cursor = startNode;

  while (true) {
    // 只取无条件单条后继
    const nextRoute = cursor.nextNodes.find((r) => !r.condition);
    if (!nextRoute) break;

    const nextNode = nodeMap.get(nextRoute.nodeId);
    if (!nextNode) break;

    // 遇到控制节点立刻截断，不再继续收集
    if (CONTROL_NODE_TYPES.includes(nextNode.nodeType)) {
      break;
    }

    segment.push(nextNode);
    cursor = nextNode;
  }

  return segment;
}
```

## 五、MidsceneAdapter 关键片段（任务文本组装策略，MVP自然语言模式）

```
import { MidsceneSegmentTask, MidsceneSegmentResult } from "../shared/types";

export class MidsceneAdapter {
  public static async run(
    task: MidsceneSegmentTask,
    signal: AbortSignal
  ): Promise<MidsceneSegmentResult> {
    // 1. 组装自然语言任务文本（MVP选定方案）
    const promptLines: string[] = [];
    for (const action of task.actions) {
      const { nodeType, params } = action;
      switch (nodeType) {
        case "navigate":
          promptLines.push(`访问网页：${params.url}`);
          break;
        case "aiTap":
          promptLines.push(`点击页面元素：${params.locate}`);
          break;
        case "aiInput":
          promptLines.push(`在【${params.locate}】输入文本：${params.text}`);
          break;
        case "aiQuery":
          promptLines.push(`提取页面信息，需求：${params.dataDemand}`);
          break;
        case "aiAssert":
          promptLines.push(`页面断言：${params.assertion}`);
          break;
        case "sleep":
          promptLines.push(`等待 ${params.duration} 毫秒`);
          break;
      }
    }
    const taskPrompt = promptLines.join("\n");

    // 2. 初始化 agent，调用 agent.ai(taskPrompt)
    // const agent = createMidsceneAgent(task);
    // const rawResult = await agent.ai(taskPrompt, { signal });

    // 3. 标准化结果返回
    const result: MidsceneSegmentResult = {
      success: true,
      extracted: {},
      screenshots: [],
      rawLogs: [],
    };

    return result;
  }
}
```
