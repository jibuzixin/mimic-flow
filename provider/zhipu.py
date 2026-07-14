"""
智谱（ZhipuAI）大模型提供商适配器

支持 GLM-5V-Turbo 等视觉模型，可传入：
- 本地图片路径
- 内存二进制数据 (bytes)
- Base64 编码字符串
与文本提示词一起发送，获取模型回复。
"""

import base64
import logging
import mimetypes
import os
import time
from pathlib import Path
from typing import Any, Optional

import httpx

from memory import BaseSessionMemory, JsonSessionMemory
from provider.batch_video_analyzer import BatchVideoAnalyzer

logger = logging.getLogger(__name__)

# 默认模型
DEFAULT_VISION_MODEL = "glm-4.6v-flash"
# 默认文本模型
DEFAULT_TEXT_MODEL = "glm-4.5-flash"
# 默认 max_tokens（各模型上限不同，这里取保守值）
DEFAULT_TEXT_MAX_TOKENS = 10240
DEFAULT_VISION_MAX_TOKENS = 10240
# API 基础地址
BASE_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"


class ZhipuAI:
    """智谱 AI 客户端，支持视觉和文本对话。"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = BASE_URL,
        timeout: int = 120,
        http_client: Optional[httpx.Client] = None,
        memory: Optional[BaseSessionMemory] = None,
    ):
        """
        Args:
            api_key: 智谱 API Key，默认从环境变量 ZHIPUAI_API_KEY 读取
            base_url: API 地址
            timeout: 请求超时时间（秒）
            http_client: 可传入自定义 httpx.Client，用于连接池复用等
            memory: 会话记忆管理器。
                    - 为 None 时，`chat(prompt, session_id=...)` 会按需懒加载默认的
                      `JsonSessionMemory`（JSON 文件 + 内存）；
                    - 想换后端时直接传入自定义的 `BaseSessionMemory` 子类即可。
        """
        self.api_key = api_key or os.environ.get("ZHIPUAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "ZHIPUAI_API_KEY 未设置，请传入 api_key 或设置环境变量 ZHIPUAI_API_KEY"
            )
        self.base_url = base_url
        self.timeout = timeout
        self._http_client = http_client
        self.memory = memory

    # ----------------------------------------------------------------
    # 公开方法
    # ----------------------------------------------------------------

    def chat(
        self,
        prompt: str,
        session_id: Optional[str] = None,
        model: str = DEFAULT_TEXT_MODEL,
        system_prompt: Optional[str] = None,
        temperature: float = 1.0,
        max_tokens: Optional[int] = None,
        stream: bool = False,
    ) -> str:
        """纯文本对话。

        - ``session_id=None``（默认）：单轮对话，不保留历史。
        - ``session_id`` 给定：自动维护该会话的历史；首次调用且未传 memory 时，
          会懒加载默认的 ``JsonSessionMemory``（JSON 文件 + 内存 FIFO 淘汰）。
          持久化需显式调用 ``save_session(session_id)``。

        Args:
            prompt: 用户输入文本
            session_id: 会话标识；为 None 时走单轮模式
            model: 模型名称
            system_prompt: 系统提示词（多轮模式下，仅在该 session 还没有 system 消息时注入）
            temperature: 采样温度 [0, 1]
            max_tokens: 最大输出 token 数，默认 None 时各方法使用模型对应的保守默认值
            stream: 是否流式输出（暂未实现流式解析）

        Returns:
            模型回复文本
        """
        if not prompt:
            raise ValueError("prompt 不能为空")

        # 1) 组装 messages
        if session_id is None:
            # 单轮：临时组装，不写入任何 memory
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            history_len = 0
        else:
            # 多轮：经由 memory 取历史 + 写回本轮
            memory = self._ensure_memory()
            messages = memory.get_messages(session_id)

            if system_prompt and not any(m.get("role") == "system" for m in messages):
                sys_msg = {"role": "system", "content": system_prompt}
                memory.add_message(session_id, sys_msg)
                messages.append(sys_msg)

            user_msg = {"role": "user", "content": prompt}
            memory.add_message(session_id, user_msg)
            messages.append(user_msg)
            history_len = len(messages) - 1  # 不含本轮 user

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens or DEFAULT_TEXT_MAX_TOKENS,
            "stream": stream,
        }

        logger.info(
            "📝 [Zhipu] chat | sid=%s | model=%s | history=%d | prompt_len=%d",
            session_id or "-", model, history_len, len(prompt),
        )

        data = self._request(payload)
        text = self._extract_text(data)

        # 2) 多轮模式下回写 assistant 回复
        if session_id is not None:
            memory.add_message(session_id, {"role": "assistant", "content": text})

        logger.info("✅ [Zhipu] chat done | sid=%s | tokens=%s",
                    session_id or "-", data.get("usage", {}))
        return text

    def chat_with_image(
        self,
        prompt: str,
        image: str | bytes,
        model: str = DEFAULT_VISION_MODEL,
        system_prompt: Optional[str] = None,
        temperature: float = 0.8,
        max_tokens: Optional[int] = None,
    ) -> str:
        """发送图片 + 文本提示词，进行多模态对话。

        Args:
            prompt: 文本提示词
            image: 图片输入，支持三种形式：
                - 本地文件路径 (str, 如 "/path/to/img.png")
                - 内存二进制数据 (bytes)
                - Base64 编码字符串 (str, 以 "data:image/" 开头则为完整 URI，否则会被自动包装)
            model: 视觉模型名称，默认 glm-5v-turbo
            system_prompt: 系统提示词
            temperature: 采样温度 [0, 1]
            max_tokens: 最大输出 token 数

        Returns:
            模型回复文本
        """
        logger.info("🖼️ [Zhipu] chat_with_image | model=%s | prompt_len=%d", model, len(prompt))

        image_url = self._resolve_image(image)

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        messages.append({
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_url}},
                {"type": "text", "text": prompt},
            ],
        })

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens or DEFAULT_VISION_MAX_TOKENS,
            "stream": False,
        }

        data = self._request(payload)
        text = self._extract_text(data)
        logger.info("✅ [Zhipu] chat_with_image done | tokens=%s", data.get("usage", {}))
        return text

    def chat_with_video(
        self,
        prompt: str,
        video_path: str,
        model: str = DEFAULT_VISION_MODEL,
        system_prompt: Optional[str] = None,
        temperature: float = 0.8,
        max_tokens: Optional[int] = None,
        audio_model: Optional[Any] = None,
        use_parallel: bool = False,
        max_concurrency: int = 3,
        batch_max_frames: int = 15,
        retry_times: int = 3,
        segment_duration: int = 60,
        min_segment_duration: int = 20,
    ) -> dict:
        """按抽帧批次分析本地视频。

        Args:
            prompt: 用户给多模态模型的分析需求。
            video_path: 本地视频文件路径。
            model: 多模态模型名。
            system_prompt: 可选系统提示词，会注入到每个批次请求。
            temperature: 多模态模型采样温度。
            max_tokens: 单次多模态请求的最大输出 token。
            audio_model: 可选音频转文本回调，签名应为 ``Callable[[str], Any]``。
            use_parallel: 是否并行请求多个批次；单批次时该参数无效果。
            max_concurrency: 并行模式下最多同时请求的批次数。
            batch_max_frames: 单次多模态请求最多发送多少张图片；当候选帧总数超过该值时，会继续切成多个带重叠的请求批次，而不是把整段视频压到这个总数以内。
            retry_times: 单个批次的失败重试次数上限；当前实现对 length/异常最多尝试 2 次。
            segment_duration: 智能抽帧扫描阶段使用的时间桶上限，影响多久重置一次抽帧节奏，不直接决定最终请求批次时长。
            min_segment_duration: 智能抽帧扫描阶段的最小时间桶，避免过短时间桶导致抽帧节奏过碎。

        Returns:
            包含 summary、batch_results、metadata 的结果字典。
        """
        started_at = time.perf_counter()
        logger.info(
            "🎬 [Zhipu] chat_with_video | video=%s | parallel=%s | batch_max_frames=%s | retry_times=%s",
            video_path,
            use_parallel,
            batch_max_frames,
            retry_times,
        )

        if not callable(audio_model) and audio_model is not None:
            raise TypeError("audio_model 必须是可调用对象或 None")

        def multimodal_model(*, prompt: str, image_paths: list[str], batch_index: int, total_batches: int, **_: Any) -> str:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})

            content = [
                {"type": "image_url", "image_url": {"url": self._resolve_image(image_path)}}
                for image_path in image_paths
            ]
            content.append({"type": "text", "text": prompt})
            messages.append({"role": "user", "content": content})

            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens or DEFAULT_VISION_MAX_TOKENS,
                "stream": False,
                "thinking": {"type": "disabled"},
            }

            logger.info(
                "🧠 [Zhipu] batch %s/%s request | images=%s | prompt_len=%s",
                batch_index,
                total_batches,
                len(image_paths),
                len(prompt),
            )
            request_started_at = time.perf_counter()
            data = self._request(payload)
            elapsed = time.perf_counter() - request_started_at
            finish_reason = self._extract_finish_reason(data)
            logger.info(
                "🧠 [Zhipu] batch %s/%s response | finish_reason=%s | elapsed=%.2fs | usage=%s",
                batch_index,
                total_batches,
                finish_reason,
                elapsed,
                data.get("usage", {}),
            )
            if finish_reason == "length":
                logger.warning("🧠 [Zhipu] batch %s/%s reached length limit", batch_index, total_batches)
            return self._extract_text(data)

        analyzer = BatchVideoAnalyzer(
            multimodal_model=multimodal_model,
            audio_model=audio_model,
            segment_duration=segment_duration,
            min_segment_duration=min_segment_duration,
        )
        result = analyzer.analyze(
            video_path=video_path,
            prompt=prompt,
            use_parallel=use_parallel,
            max_concurrency=max_concurrency,
            batch_max_frames=batch_max_frames,
            retry_times=retry_times,
        )
        logger.info(
            "🎬 [Zhipu] chat_with_video done | batches=%s | audio_used=%s | elapsed=%.2fs",
            result["metadata"]["total_batches"],
            result["metadata"]["audio_used"],
            time.perf_counter() - started_at,
        )
        return result

    # ----------------------------------------------------------------
    # 会话管理（最小化 API）
    # ----------------------------------------------------------------

    def _ensure_memory(self) -> BaseSessionMemory:
        """懒加载默认的 JSON + 内存 memory。"""
        if self.memory is None:
            self.memory = JsonSessionMemory()
        return self.memory

    def save_session(self, session_id: str, path: Optional[str] = None) -> str:
        """将指定 session 持久化到磁盘，返回写入路径。"""
        return self._ensure_memory().save(session_id, path)

    def load_session(self, session_id: str, path: Optional[str] = None) -> bool:
        """从磁盘恢复指定 session 的历史到内存。"""
        return self._ensure_memory().load(session_id, path)

    def clear_session(self, session_id: Optional[str] = None) -> None:
        """清除指定 session（或全部 session）的历史。"""
        self._ensure_memory().clear(session_id)

    # ----------------------------------------------------------------
    # 内部方法
    # ----------------------------------------------------------------

    def _resolve_image(self, image: str | bytes) -> str:
        """将各种形式的图片输入统一转为 Base64 Data URI 字符串。"""
        if isinstance(image, bytes):
            logger.debug("  ↳ image type: bytes (%d bytes)", len(image))
            return self._bytes_to_data_uri(image)

        # str 类型：可能是本地路径 或 已经是 base64 / data URI
        if image.startswith("data:image/"):
            logger.debug("  ↳ image type: data URI (len=%d)", len(image))
            return image  # 已经是完整 data URI

        if _is_likely_base64(image):
            logger.debug("  ↳ image type: base64 string (len=%d)", len(image))
            # 尝试推测格式，默认 png
            mime = "image/png"
            # 前几个字节特征判断
            stripped = image.strip()
            if stripped.startswith("/9j/"):
                mime = "image/jpeg"
            elif stripped.startswith("iVBOR"):
                mime = "image/png"
            elif stripped.startswith("UklGR"):
                mime = "image/webp"
            return f"data:{mime};base64,{stripped}"

        # 当作本地文件路径处理
        path = Path(image)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image}")

        logger.debug("  ↳ image type: local file (%s)", path)
        raw = path.read_bytes()
        return self._bytes_to_data_uri(raw, path.suffix)

    def _bytes_to_data_uri(self, data: bytes, suffix: str = "") -> str:
        """将 bytes 转为 Base64 Data URI。"""
        b64 = base64.b64encode(data).decode("ascii")
        mime = mimetypes.guess_type(f"x{suffix}")[0] if suffix else None
        if not mime:
            mime = "image/png"
        return f"data:{mime};base64,{b64}"

    def _request(self, payload: dict) -> dict:
        """发送 HTTP POST 请求到智谱 API。"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        client = self._http_client or httpx.Client(timeout=self.timeout)
        # 如果是外部传入的 client，不在这里关闭
        own_client = self._http_client is None

        try:
            logger.debug("🔗 [Zhipu] POST %s", self.base_url)
            logger.debug("  ↳ payload keys: %s | model=%s | max_tokens=%s",
                         list(payload.keys()), payload.get("model"), payload.get("max_tokens"))
            logger.debug("  ↳ messages[0] content keys: %s",
                         [c.get("type") for c in payload["messages"][0].get("content", [])]
                         if isinstance(payload["messages"][0].get("content"), list) else "text")
            resp = client.post(self.base_url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error("❌ [Zhipu] HTTP error: %s %s", e.response.status_code, e.response.text)
            raise
        except httpx.RequestError as e:
            logger.error("❌ [Zhipu] Request failed: %s", e)
            raise
        finally:
            if own_client:
                client.close()

    @staticmethod
    def _extract_finish_reason(data: dict) -> str:
        try:
            return data["choices"][0].get("finish_reason", "unknown")
        except (KeyError, IndexError, AttributeError):
            return "unknown"

    @staticmethod
    def _extract_text(data: dict) -> str:
        """从 API 响应中提取回复文本。"""
        try:
            print(f"大模型原始响应：{data}")
            choice = data["choices"][0]
            msg = choice["message"]
            content = msg.get("content")
            if content is None:
                return ""
            if isinstance(content, list):
                # 部分多模态回复可能是 list 格式
                parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                return "".join(parts)
            return content
        except (KeyError, IndexError) as e:
            logger.error("❌ [Zhipu] 解析响应失败: %s | raw=%s", e, data)
            raise ValueError(f"无法解析智谱 API 响应: {e}") from e


# ----------------------------------------------------------------
# 辅助函数
# ----------------------------------------------------------------

def _is_likely_base64(s: str) -> bool:
    """粗略判断字符串是否可能是 Base64 编码。"""
    s = s.strip()
    # Base64 通常长度较长且仅含特定字符
    if len(s) < 20:
        return False
    import re
    return bool(re.fullmatch(r"[A-Za-z0-9+/=]+", s))