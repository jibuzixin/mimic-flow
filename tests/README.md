# 测试用例说明

## 测试环境准备

1. 确保项目已构建：`npm run build`
2. 启动应用：`npm run dev` 或 `npm run electron:dev`
3. 在设置页面配置一个可用的 Midscene 模型（capability=midscene），或在测试用例中使用 inline 配置
4. 打开 Flow Tester 页面

## 测试方法

1. 打开对应测试用例的 JSON 文件
2. 复制文件内容
3. 粘贴到 Flow Tester 页面的 "Flow JSON" 编辑框中
4. 如果使用 inline 配置，记得把 `apiKey` 替换为真实的 API Key
5. 点击「运行」按钮执行
6. 观察日志输出和节点状态，验证预期结果

## 测试用例列表

### 01 - 控制节点测试 (tests/01-control-nodes/)

| 测试用例 | 文件 | 预期结果 | 验证点 |
|---------|------|---------|-------|
| 变量赋值与日志打印 | 01-var-and-log.json | 工作流成功执行，所有日志正确打印 | control.var 赋值、increment、control.log 打印变量和插值消息 |
| 条件分支 | 02-if-branch.json | 第一个 if 走 true 分支（及格），第二个 if 走 false 分支（非优秀） | control.if 的 true/false 分支正确执行 |
| 循环 | 03-loop.json | for 循环执行 5 次，计数最终为 5 | control.loop 的 for 类型，loop.i 变量正确 |

### 02 - Midscene 引擎测试 (tests/02-midscene-engine/)

| 测试用例 | 文件 | 预期结果 | 验证点 |
|---------|------|---------|-------|
| 基础操作 | 01-basic-actions.json | 打开记事本，输入文字，再删除 | midscene.act、midscene.sleep 节点正常工作 |
| 查询与变量传递 | 02-query-outputVar.json | 打开B站，获取视频标题，打印出查询结果 | midscene.query 的 outputVar 正确赋值，control.log 能打印变量 |

### 03 - 错误处理测试 (tests/03-error-handling/)

| 测试用例 | 文件 | 预期结果 | 验证点 |
|---------|------|---------|-------|
| 重试与失败继续 | 01-retry-and-continue.json | 失败节点重试后仍然失败，但继续执行后续节点 | retry 重试机制、onError: continue 策略 |
| 停止功能 | 02-stop-function.json | 点击停止后，工作流立即停止，不会执行后续节点 | 停止按钮功能、AbortController 中断 |

### 04 - 综合场景测试 (tests/04-integration/)

| 测试用例 | 文件 | 预期结果 | 验证点 |
|---------|------|---------|-------|
| B站视频查询与统计 | 01-bilibili-query.json | 完整流程：打开浏览器→访问B站→查询→打印→条件判断 | 多种节点组合、变量传递、控制流 |

## 关键验证点

### 1. Segment 合并执行
- 连续的 Midscene 节点应该合并为一个 segment 执行
- 日志中应该看到"执行 N 个连续节点"，N > 1
- 不应该出现"5个→4个→3个..."递减的重复执行 pattern

### 2. 变量传递
- midscene.query 的 `outputVar` 应该正确赋值到变量池
- control.log 的 `{{globalVars.xxx}}` 插值应该正确替换
- control.var 的 increment/append 等模式应该正确工作

### 3. 控制流
- control.if 的 true/false 分支正确
- control.loop 的循环次数正确
- 控制节点和引擎节点混合时流程正确

### 4. 错误处理
- 失败节点有重试日志
- onError: continue 时后续节点继续执行
- onError: stop 时工作流停止

### 5. 停止功能
- 执行过程中点击停止，工作流立即停止
- 状态变为 stopped
- 正在执行的 Midscene 操作被中断

## Bug 修复记录

### 2026-07-22 修复

1. **control.log 未被识别为控制节点**
   - 文件：electron/runtime-v2/FlowScheduler.ts
   - 问题：CONTROL_NODE_TYPES 数组缺少 'control.log'
   - 影响：打印节点被当作引擎节点处理，无法执行

2. **midscene.query 输出未正确映射**
   - 文件：electron/engines/yamlGenerator.ts
   - 问题：aiQuery 的 name 使用了 outputVar 而不是 node.id，导致 result[node.id] 取不到值
   - 影响：outputVar 永远是 undefined，打印不出查询结果

3. **MidsceneEngine outputs 为空**
   - 文件：electron/engines/MidsceneEngine.ts
   - 问题：outputs 对象没有被填充，只通过 onEvent 发送了事件
   - 影响：调度层无法从 result.outputs 中获取节点输出

4. **失败节点判断逻辑错误**
   - 文件：electron/runtime-v2/FlowScheduler.ts
   - 问题：用 !result.outputs[n.id] 判断失败，会把假值（0、''、false）和 undefined 都误判为失败
   - 修复：失败时第一个节点标记为 failed，其余标记为 skipped

5. **循环结束后循环体多执行一次**
   - 文件：electron/runtime-v2/FlowScheduler.ts
   - 问题：executeLoopNode 内部已执行循环体，但外层 executeNode 又调用 executeNextNodes(loopNode)，导致循环体多执行一次
   - 修复：循环体入口通过 nodeParams.bodyNodeId 指定，loop 节点的 nextNodes 作为循环结束后的后继节点

6. **control.if/loop 流程控制节点重复执行后继**
   - 文件：electron/runtime-v2/FlowScheduler.ts
   - 问题：所有控制节点执行完后都会调用 executeNextNodes，但 if/loop 内部已处理流程跳转
   - 修复：executeControlNode 返回 boolean，表示是否需要继续执行后继节点
