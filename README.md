# Click

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

大模型多提供商适配器，支持智谱 GLM、OpenAI 等模型。

## 快速开始

### 1. 安装依赖

```bash
uv sync
```

### 2. 设置 API Key

```bash
export ZHIPUAI_API_KEY="你的智谱 API Key"
```

### 3. 运行演示

```bash
uv run python main.py
```

## 使用方法

### 初始化客户端

```python
from provider import ZhipuAI

# 方式一：从环境变量读取（推荐）
client = ZhipuAI()

# 方式二：显式传入
client = ZhipuAI(api_key="your-api-key")

# 方式三：自定义超时和 HTTP 客户端
import httpx
client = ZhipuAI(timeout=60, http_client=httpx.Client())

# 方式四：注入自定义会话记忆后端（可选）
from memory import JsonSessionMemory
client = ZhipuAI(memory=JsonSessionMemory(max_tokens=8000, storage_dir="./sessions"))
```

### 纯文本对话

```python
reply = client.chat("写一个 Python 斐波那契函数")
print(reply)
```

支持自定义模型、系统提示词等参数：

```python
reply = client.chat(
    prompt="解释什么是递归",
    model="glm-5.2",
    system_prompt="你是一个专业的编程助手",
    temperature=0.3,
    max_tokens=2048,
)
```

### 多轮对话（基于 `session_id`）

只要给 `chat` 传入 `session_id`，就会自动维护该会话的历史；不传则是单轮。

```python
# 第一轮：传入 session_id，自动开启多轮
client.chat("我叫小李", session_id="u1")

# 第二轮：相同 session_id，会带上历史
reply = client.chat("我叫什么名字？", session_id="u1")
print(reply)  # 模型能记住上文
```

行为约定：

- `session_id=None`（默认）→ 单轮，不写入任何历史。
- 传入 `session_id` 但没有显式传 `memory` → 首次调用懒加载默认的 `JsonSessionMemory`
  （JSON 文件 + 内存 + FIFO 淘汰）。
- 想换后端（Redis / SQLite …）只需传入自定义的 `BaseSessionMemory` 子类，provider 代码无需改动。

### 会话持久化

历史先放在内存里，需要落盘时显式调用 `save_session` / `load_session`：

```python
# 落盘：保存指定 session 到 JSON（默认 ./sessions/<session_id>.json）
path = client.save_session("u1")
print(path)  # sessions/u1.json

# 自定义路径
client.save_session("u1", path="/tmp/u1.json")

# 重新加载
client.load_session("u1")
client.chat("继续", session_id="u1")  # 历史已恢复

# 清理
client.clear_session("u1")    # 清理指定 session
client.clear_session()        # 清理全部
```

`JsonSessionMemory` 的淘汰策略：超过 `max_tokens` 时按 **FIFO** 淘汰最旧消息，
但 `system` 消息始终保留，避免丢失系统提示。

### 图片对话（多模态）

支持三种图片输入方式：

#### ❶ 本地文件路径

```python
reply = client.chat_with_image(
    prompt="这张图里是什么？",
    image="/path/to/photo.jpg",
)
```

#### ❷ 内存二进制数据

```python
with open("photo.jpg", "rb") as f:
    image_bytes = f.read()
    reply = client.chat_with_image("这张图里是什么？", image_bytes)
```

#### ❸ Base64 编码字符串

```python
b64_str = "iVBORw0KGgoAAAANSUhEUgAAAAE..."
reply = client.chat_with_image("这张图里是什么？", b64_str)
```

#### 完整参数示例

```python
reply = client.chat_with_image(
    prompt="详细描述这张图片的内容",
    image="demo.png",
    model="glm-5v-turbo",
    system_prompt="你是一个图像分析专家",
    temperature=0.5,
    max_tokens=8192,
)
```

## API 参考

### `ZhipuAI(api_key, base_url, timeout, http_client, memory)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `api_key` | `str` | 环境变量 `ZHIPUAI_API_KEY` | API 密钥 |
| `base_url` | `str` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | API 地址 |
| `timeout` | `int` | `120` | 请求超时时间（秒） |
| `http_client` | `httpx.Client` | `None` | 自定义 HTTP 客户端（用于连接池复用） |
| `memory` | `BaseSessionMemory` | `None` | 会话记忆后端。`None` 时多轮模式按需懒加载 `JsonSessionMemory` |

### `chat(prompt, session_id, model, system_prompt, temperature, max_tokens, stream)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | `str` | — | 用户输入文本 |
| `session_id` | `str` | `None` | 会话标识。`None` → 单轮；给定 → 自动维护该会话历史 |
| `model` | `str` | `glm-4.5-flash` | 模型名称 |
| `system_prompt` | `str` | `None` | 系统提示词（多轮模式下，仅在该 session 还没有 system 消息时注入） |
| `temperature` | `float` | `1.0` | 采样温度 [0, 1] |
| `max_tokens` | `int` | `4096` | 最大输出 token 数 |
| `stream` | `bool` | `False` | 是否流式输出 |

### `chat_with_image(prompt, image, model, system_prompt, temperature, max_tokens)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | `str` | — | 文本提示词 |
| `image` | `str` / `bytes` | — | 图片输入（路径 / 二进制 / Base64） |
| `model` | `str` | `glm-4.6v-flash` | 视觉模型名称 |
| `system_prompt` | `str` | `None` | 系统提示词 |
| `temperature` | `float` | `0.8` | 采样温度 [0, 1] |
| `max_tokens` | `int` | `1024` | 最大输出 token 数 |

### `save_session(session_id, path=None)`

将指定 session 的历史持久化到 JSON 文件；返回写入的文件路径。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `session_id` | `str` | — | 会话标识 |
| `path` | `str` | `None` | 自定义文件路径；默认 `<memory.storage_dir>/<session_id>.json` |

### `load_session(session_id, path=None)`

从 JSON 文件恢复指定 session 的历史到内存；文件不存在返回 `False`。

### `clear_session(session_id=None)`

清除指定 session 的历史；`session_id=None` 时清除全部。

## memory 模块（可扩展）

`memory/` 目录提供与 provider 解耦的会话记忆抽象：

```
memory/
├── __init__.py        # 导出 BaseSessionMemory / JsonSessionMemory
├── base.py            # 抽象基类
└── json_memory.py     # JSON 文件 + 内存 + FIFO 淘汰（默认实现）
```

继承 `BaseSessionMemory` 并实现 `add_message / get_messages / clear / save / load`，
即可替换为 Redis / SQLite / 数据库等任意后端，provider 代码无需改动。

```python
from memory import BaseSessionMemory

class RedisSessionMemory(BaseSessionMemory):
    def add_message(self, session_id, message): ...
    def get_messages(self, session_id): ...
    def clear(self, session_id=None): ...
    def save(self, session_id, path=None): ...
    def load(self, session_id, path=None): ...

client = ZhipuAI(memory=RedisSessionMemory(...))
```

# 手动解析模型输出内容

将模型输出内容粘贴到 mac_parse_demo.py 文件内，即可观察到后续执行操作。
```python
response = """Thought: 地址栏内容已被全选，现在直接输入bilibili.com，按下回车键即可跳转至 B 站网站。
Action: type (content='bilibili.com\n')"""
```