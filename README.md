# Click

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

### `ZhipuAI(api_key, base_url, timeout, http_client)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `api_key` | `str` | 环境变量 `ZHIPUAI_API_KEY` | API 密钥 |
| `base_url` | `str` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | API 地址 |
| `timeout` | `int` | `120` | 请求超时时间（秒） |
| `http_client` | `httpx.Client` | `None` | 自定义 HTTP 客户端（用于连接池复用） |

### `chat(prompt, model, system_prompt, temperature, max_tokens, stream)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | `str` | — | 用户输入文本 |
| `model` | `str` | `glm-5.2` | 模型名称 |
| `system_prompt` | `str` | `None` | 系统提示词 |
| `temperature` | `float` | `1.0` | 采样温度 [0, 1] |
| `max_tokens` | `int` | `4096` | 最大输出 token 数 |
| `stream` | `bool` | `False` | 是否流式输出 |

### `chat_with_image(prompt, image, model, system_prompt, temperature, max_tokens)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt` | `str` | — | 文本提示词 |
| `image` | `str` / `bytes` | — | 图片输入（路径 / 二进制 / Base64） |
| `model` | `str` | `glm-5v-turbo` | 视觉模型名称 |
| `system_prompt` | `str` | `None` | 系统提示词 |
| `temperature` | `float` | `0.8` | 采样温度 [0, 1] |
| `max_tokens` | `int` | `4096` | 最大输出 token 数 |

## 日志

默认日志级别为 `DEBUG`，会输出到 stderr：

```
10:23:45 | INFO     | provider.zhipu | 🖼️ [Zhipu] chat_with_image | model=glm-5v-turbo | prompt_len=12
10:23:47 | INFO     | provider.zhipu | ✅ [Zhipu] chat_with_image done | tokens={'prompt_tokens': 1234, 'completion_tokens': 56}
```

## 支持模型

### 视觉模型

- `glm-5v-turbo`（默认）
- `glm-4.6v`
- `glm-4.6v-flash`
- `glm-4.6v-flashx`
- `glm-4v-flash`
- `glm-4.1v-thinking-flashx`
- `glm-4.1v-thinking-flash`

### 文本模型

- `glm-5.2`（默认）
- `glm-5.1`
- `glm-5-turbo`
- `glm-5`
- `glm-4.7`
- `glm-4.7-flash`
- `glm-4.6`
- `glm-4.5-air`
- `glm-4.5-flash`