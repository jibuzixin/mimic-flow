"""
OpenAI API 兼容客户端

支持任何兼容 OpenAI Chat Completions / Audio Transcriptions 格式的 API 服务端点，
如 OpenAI、Azure OpenAI、vLLM、Ollama（通过 openai 兼容层）、
DeepSeek、MoonShot、StepFun 等。

会话管理与模型对象解耦：:

    from memory.session import SessionManager
    from provider.openai_compat import OpenAICompatible

    # 1️⃣ 先创建会话管理器（设置持久化和压缩策略）
    session_manager = SessionManager(storage_dir="./sessions")

    # 2️⃣ 传入模型对象（不传 session_manager 则每次都是单轮对话）
    llm = OpenAICompatible(
        base_url="https://api.openai.com/v1",
        api_key="sk-...",
        model_id="gpt-4o",
        session_manager=session_manager,  # 可选，不传不做会话管理
    )

    # 3️⃣ 多轮对话时传 session_id，其余用法不变
    reply = llm.chat("你好", session_id="s1")      # 第一轮
    reply = llm.chat("继续", session_id="s1")       # 第二轮，自动携带历史
    reply = llm.chat("单轮")                         # 不传 session_id：单轮
"""

import base64
import logging
import mimetypes
import time
from pathlib import Path
from typing import Any, Optional

import httpx

from memory.session import SessionManager

logger = logging.getLogger(__name__)

# 默认值
DEFAULT_MAX_INPUT = 4096
DEFAULT_MAX_OUTPUT = 4096
DEFAULT_RETRY_TIMES = 3
DEFAULT_TIMEOUT = 120


class OpenAICompatible:
    """兼容 OpenAI API 格式的通用客户端。

    支持文本对话、多模态图片对话、音频转文本三大功能。

    会话管理通过 ``session_manager`` 参数注入，不传则每次请求都是单轮对话。
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model_id: str,
        model_name: str = "",
        max_input: int = DEFAULT_MAX_INPUT,
        max_output: int = DEFAULT_MAX_OUTPUT,
        retry_times: int = DEFAULT_RETRY_TIMES,
        timeout: int = DEFAULT_TIMEOUT,
        http_client: Optional[httpx.Client] = None,
        session_manager: Optional[SessionManager] = None,
    ):
        """
        Args:
            base_url: API 端点地址。
                - 全路径：如 ``https://api.openai.com/v1/chat/completions``
                - 以 ``/v1`` 结尾：如 ``https://api.openai.com/v1``，自动拼接 ``/chat/completions``
            api_key: API 密钥。
            model_id: 模型标识符（API 请求中 ``model`` 字段的值）。
            model_name: 模型展示名（用户自定义，仅用于日志显示，不影响 API 调用）。
            max_input: 最大输入 token 数（用于日志标记，不强制截断）。
            max_output: 最大输出 token 数（作为 ``max_tokens`` 传给 API）。
            retry_times: 请求失败时的重试次数。
            timeout: 请求超时时间（秒）。
            http_client: 可传入自定义 ``httpx.Client``，用于连接池复用等。
            session_manager: 会话管理器。传入后支持多轮对话（通过 ``session_id`` 参数）；
                             不传则每次请求都是单轮对话，不保留历史。
        """
        if not api_key:
            raise ValueError("api_key 不能为空")
        if not model_id:
            raise ValueError("model_id 不能为空")

        self.api_key = api_key
        self.model_id = model_id
        self.model_name = model_name or model_id
        self.max_input = max_input
        self.max_output = max_output
        self.retry_times = retry_times
        self.timeout = timeout
        self._http_client = http_client
        self.session_manager = session_manager

        if session_manager is not None:
            logger.info(
                "🔗 [OpenAICompat] 已注入 SessionManager | storage_dir=%s",
                session_manager.storage_dir,
            )

        # --- 解析 base_url ---
        self.base_url = base_url.rstrip("/")
        if self.base_url.endswith("/v1"):
            self._chat_url = self.base_url + "/chat/completions"
            self._audio_url = self.base_url + "/audio/transcriptions"
        else:
            self._chat_url = self.base_url
            # 尝试从全路径推导 audio URL
            if "/chat/completions" in self.base_url:
                self._audio_url = self.base_url.replace(
                    "/chat/completions", "/audio/transcriptions"
                )
            else:
                self._audio_url = self.base_url.rstrip("/") + "/audio/transcriptions"

        logger.info(
            "🤖 [OpenAICompat] 初始化 | name=%s | model=%s | chat_url=%s | audio_url=%s",
            self.model_name,
            self.model_id,
            self._chat_url,
            self._audio_url,
        )

    # ----------------------------------------------------------------
    # 公开方法
    # ----------------------------------------------------------------

    def chat(
        self,
        prompt: str,
        session_id: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        extra_body: Optional[dict] = None,
    ) -> str:
        """纯文本对话。

        支持多轮对话（传入 ``session_id`` 且初始化时传入了 ``session_manager``）。
        不传 ``session_id`` 或初始化时未传入 ``session_manager`` 时均走单轮模式。

        Args:
            prompt: 用户输入文本。
            session_id: 会话标识。传入后自动维护该会话的历史记录。
            system_prompt: 系统提示词（多轮模式下，仅在该 session 还没有 system 消息时注入）。
            temperature: 采样温度 [0, 2]。
            max_tokens: 最大输出 token 数，默认使用初始化时的 ``max_output``。
            stream: 是否流式输出（暂未实现流式解析，设为 True 会返回原始流式文本）。
            extra_body: 额外请求体参数（如 ``top_p``、``frequency_penalty`` 等）。

        Returns:
            模型回复文本。
        """
        if not prompt:
            raise ValueError("prompt 不能为空")

        # 判断是否走多轮模式
        use_session = session_id is not None and self.session_manager is not None

        if use_session:
            sm = self.session_manager
            messages = sm.get_messages(session_id)

            # 首次注入 system_prompt
            if system_prompt and not any(m.get("role") == "system" for m in messages):
                sm.add_message(session_id, {"role": "system", "content": system_prompt})
                messages = sm.get_messages(session_id)

            # 追加本轮用户消息
            user_msg = {"role": "user", "content": prompt}
            sm.add_message(session_id, user_msg)
            messages.append(user_msg)

            logger.info(
                "💬 [OpenAICompat] chat | sid=%s | history=%d | prompt_len=%d",
                session_id,
                len(messages) - 1,
                len(prompt),
            )
        else:
            # 单轮：临时组装
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            logger.info(
                "💬 [OpenAICompat] chat | 单轮 | prompt_len=%d",
                len(prompt),
            )

        payload = self._build_payload(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=stream,
            extra=extra_body,
        )

        # 多轮模式下，发送前先压缩上下文（如果传入了 session_manager 且设置了 max_input）
        if use_session and self.max_input > 0:
            self.session_manager.compress(session_id, self.max_input)

        data = self._request_with_retry(self._chat_url, payload)
        text = self._extract_text(data)

        # 多轮模式下回写 assistant 回复
        if use_session:
            self.session_manager.add_message(session_id, {"role": "assistant", "content": text})

        usage = data.get("usage", {})
        logger.info(
            "✅ [OpenAICompat] chat done | name=%s | tokens=%s",
            self.model_name,
            usage,
        )
        return text

    def chat_with_image(
        self,
        prompt: str,
        image: str | bytes,
        session_id: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        detail: str = "auto",
        extra_body: Optional[dict] = None,
    ) -> str:
        """发送图片 + 文本提示词，进行多模态对话。

        支持多轮对话（传入 ``session_id`` 且初始化时传入了 ``session_manager``）。

        Args:
            prompt: 文本提示词。
            image: 图片输入，支持三种形式：
                - 本地文件路径 (str)
                - 内存二进制数据 (bytes)
                - Base64 编码字符串（以 ``data:image/`` 开头则为完整 Data URI）
            session_id: 会话标识。传入后自动维护该会话的历史记录。
            system_prompt: 系统提示词（多轮模式下，仅在该 session 还没有 system 消息时注入）。
            temperature: 采样温度 [0, 2]。
            max_tokens: 最大输出 token 数，默认使用初始化时的 ``max_output``。
            detail: 图片细节级别，``"auto"`` / ``"low"`` / ``"high"``。
            extra_body: 额外请求体参数。

        Returns:
            模型回复文本。
        """
        image_url_str = self._resolve_image(image)

        user_content: list[dict] = [
            {
                "type": "image_url",
                "image_url": {"url": image_url_str, "detail": detail},
            },
            {"type": "text", "text": prompt},
        ]

        # 判断是否走多轮模式
        use_session = session_id is not None and self.session_manager is not None

        if use_session:
            sm = self.session_manager
            messages = sm.get_messages(session_id)

            # 首次注入 system_prompt
            if system_prompt and not any(m.get("role") == "system" for m in messages):
                sm.add_message(session_id, {"role": "system", "content": system_prompt})
                messages = sm.get_messages(session_id)

            # 追加本轮用户消息
            user_msg = {"role": "user", "content": user_content}
            sm.add_message(session_id, user_msg)
            messages.append(user_msg)

            logger.info(
                "🖼️ [OpenAICompat] chat_with_image | sid=%s | history=%d | prompt_len=%d",
                session_id,
                len(messages) - 1,
                len(prompt),
            )
        else:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": user_content})

            logger.info(
                "🖼️ [OpenAICompat] chat_with_image | 单轮 | prompt_len=%d",
                len(prompt),
            )

        payload = self._build_payload(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=False,
            extra=extra_body,
        )

        # 多轮模式下，发送前先压缩上下文
        if use_session and self.max_input > 0:
            self.session_manager.compress(session_id, self.max_input)

        data = self._request_with_retry(self._chat_url, payload)
        text = self._extract_text(data)

        # 多轮模式下回写 assistant 回复
        if use_session:
            self.session_manager.add_message(session_id, {"role": "assistant", "content": text})

        usage = data.get("usage", {})
        logger.info(
            "✅ [OpenAICompat] chat_with_image done | name=%s | tokens=%s",
            self.model_name,
            usage,
        )
        return text

    def chat_with_audio(
        self,
        audio: str | bytes,
        prompt: Optional[str] = None,
        temperature: float = 0,
        language: Optional[str] = None,
        response_format: str = "text",
        extra_params: Optional[dict] = None,
    ) -> str:
        """音频转文本（Whisper 兼容接口）。

        Args:
            audio: 音频输入，支持：
                - 本地文件路径 (str, 如 ``/path/to/audio.mp3``)
                - 内存二进制数据 (bytes)
            prompt: 可选的提示词，用于指导转写风格或纠正特定词汇。
            temperature: 采样温度 [0, 1]。
            language: 音频语言代码（如 ``"zh"``、``"en"``），不传则自动检测。
            response_format: 返回格式，``"text"`` / ``"json"`` / ``"verbose_json"``。
            extra_params: 额外的表单参数。

        Returns:
            转写文本（``response_format="text"``）或完整 JSON 字符串（其他格式）。
        """
        logger.info(
            "🎤 [OpenAICompat] chat_with_audio | name=%s | model=%s | prompt=%s | lang=%s",
            self.model_name,
            self.model_id,
            prompt or "(无)",
            language or "(自动检测)",
        )

        # 准备文件
        if isinstance(audio, str):
            audio_path = Path(audio)
            if not audio_path.exists():
                raise FileNotFoundError(f"音频文件不存在: {audio}")
            filename = audio_path.name
            audio_data = audio_path.read_bytes()
        elif isinstance(audio, bytes):
            filename = "audio.wav"
            audio_data = audio
        else:
            raise TypeError(f"不支持的音频类型: {type(audio)}")

        # 猜测 MIME 类型
        mime_type = mimetypes.guess_type(filename)[0] or "audio/wav"

        # 构建 multipart 表单数据
        files: dict[str, tuple[str, bytes, str]] = {
            "file": (filename, audio_data, mime_type),
            "model": (None, self.model_id),
            "response_format": (None, response_format),
            "temperature": (None, str(temperature)),
        }
        if prompt:
            files["prompt"] = (None, prompt)
        if language:
            files["language"] = (None, language)
        if extra_params:
            for k, v in extra_params.items():
                files[k] = (None, str(v))

        # 音频转写不走 JSON payload，用 multipart
        data = self._request_with_retry(
            self._audio_url,
            payload=None,
            files=files,
        )

        if response_format == "text":
            text = data if isinstance(data, str) else str(data)
        else:
            text = str(data)

        logger.info(
            "✅ [OpenAICompat] chat_with_audio done | name=%s | text_len=%d",
            self.model_name,
            len(text),
        )
        return text

    # ----------------------------------------------------------------
    # 会话管理（透传，方便用户操作）
    # ----------------------------------------------------------------

    def save_session(self, session_id: str, path: Optional[str] = None) -> str:
        """持久化指定会话历史到 JSONL 文件。

        Args:
            session_id: 会话 ID。
            path: 自定义文件路径，默认使用 ``storage_dir/{session_id}.jsonl``。

        Returns:
            实际写入的文件路径；未传入 session_manager 或会话为空时返回空字符串。
        """
        if self.session_manager is None:
            logger.warning("⚠️ session_manager 未设置，无法保存会话")
            return ""
        return self.session_manager.save(session_id, path)

    def load_session(self, session_id: str, path: Optional[str] = None) -> bool:
        """从 JSONL 文件加载会话历史到内存。

        Args:
            session_id: 会话 ID。
            path: 自定义文件路径，默认使用 ``storage_dir/{session_id}.jsonl``。

        Returns:
            是否加载成功；未传入 session_manager 时返回 False。
        """
        if self.session_manager is None:
            logger.warning("⚠️ session_manager 未设置，无法加载会话")
            return False
        return self.session_manager.load(session_id, path)

    def clear_session(self, session_id: Optional[str] = None) -> None:
        """清除会话历史。

        Args:
            session_id: 指定会话 ID；为 None 时清除所有会话。
        """
        if self.session_manager is None:
            logger.warning("⚠️ session_manager 未设置，无法清除会话")
            return
        self.session_manager.clear(session_id)

    # ----------------------------------------------------------------
    # 内部工具
    # ----------------------------------------------------------------

    def _build_payload(
        self,
        messages: list[dict],
        temperature: float,
        max_tokens: Optional[int],
        stream: bool,
        extra: Optional[dict] = None,
    ) -> dict:
        """构建标准的 Chat Completions 请求体。"""
        payload: dict[str, Any] = {
            "model": self.model_id,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens or self.max_output,
            "stream": stream,
        }
        if extra:
            payload.update(extra)
        return payload

    def _resolve_image(self, image: str | bytes) -> str:
        """将各种形式的图片输入统一转为 Base64 Data URI 字符串。"""
        if isinstance(image, bytes):
            return self._bytes_to_data_uri(image)

        # str 类型：可能是本地路径 或 已经是 base64 / data URI
        if image.startswith("data:image/"):
            return image  # 已经是完整 data URI

        if _is_likely_base64(image):
            # 尝试推测格式，默认 png
            mime = "image/png"
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

        raw = path.read_bytes()
        return self._bytes_to_data_uri(raw, path.suffix)

    def _bytes_to_data_uri(self, data: bytes, suffix: str = "") -> str:
        """将 bytes 转为 Base64 Data URI。"""
        b64 = base64.b64encode(data).decode("ascii")
        mime = mimetypes.guess_type(f"x{suffix}")[0] if suffix else None
        if not mime:
            mime = "image/png"
        return f"data:{mime};base64,{b64}"

    def _request_with_retry(
        self,
        url: str,
        payload: Optional[dict],
        files: Optional[dict] = None,
    ) -> Any:
        """带重试的 HTTP 请求。

        对整个请求（包括建连、发送、超时）进行重试，指数退避。
        仅对 ``5xx`` / ``429`` / 网络错误重试，``4xx`` 直接抛出。
        """
        client = self._http_client or httpx.Client(timeout=self.timeout)
        own_client = self._http_client is None

        last_exception: Optional[Exception] = None
        max_attempts = self.retry_times + 1  # 首次 + retry_times 次重试

        for attempt in range(1, max_attempts + 1):
            try:
                logger.debug(
                    "🔗 [OpenAICompat] request | attempt=%s/%s | url=%s",
                    attempt,
                    max_attempts,
                    url,
                )

                if files is not None:
                    # multipart 请求（音频转写）
                    headers = {"Authorization": f"Bearer {self.api_key}"}
                    resp = client.post(url, files=files, headers=headers)
                else:
                    # JSON 请求
                    headers = {
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    }
                    resp = client.post(url, json=payload, headers=headers)

                # 4xx 客户端错误不重试（除了 429）
                if resp.status_code == 429:
                    if attempt < max_attempts:
                        wait = 2 ** attempt
                        logger.warning(
                            "⏳ [OpenAICompat] 429 限流 | attempt=%s/%s | 等待 %ss",
                            attempt,
                            max_attempts,
                            wait,
                        )
                        time.sleep(wait)
                        continue
                    resp.raise_for_status()

                resp.raise_for_status()

                # 如果是 multipart 请求（音频），响应可能是纯文本
                if files is not None:
                    content_type = resp.headers.get("content-type", "")
                    if "application/json" in content_type:
                        return resp.json()
                    else:
                        return resp.text

                return resp.json()

            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                # 4xx 不重试（除了 429 已在上面处理）
                if 400 <= status < 500 and status != 429:
                    logger.error(
                        "❌ [OpenAICompat] 客户端错误 | status=%s | body=%s",
                        status,
                        e.response.text,
                    )
                    raise

                last_exception = e
                if attempt < max_attempts:
                    wait = 2 ** attempt
                    logger.warning(
                        "⏳ [OpenAICompat] 服务端错误 | status=%s | attempt=%s/%s | 等待 %ss",
                        status,
                        attempt,
                        max_attempts,
                        wait,
                    )
                    time.sleep(wait)
                else:
                    logger.error(
                        "❌ [OpenAICompat] 重试耗尽 | status=%s | body=%s",
                        status,
                        e.response.text,
                    )
                    raise

            except httpx.RequestError as e:
                last_exception = e
                if attempt < max_attempts:
                    wait = 2 ** attempt
                    logger.warning(
                        "⏳ [OpenAICompat] 网络错误 | %s | attempt=%s/%s | 等待 %ss",
                        e,
                        attempt,
                        max_attempts,
                        wait,
                    )
                    time.sleep(wait)
                else:
                    logger.error(
                        "❌ [OpenAICompat] 重试耗尽 | 网络错误: %s",
                        e,
                    )
                    raise

        # 不应到达这里，但以防万一
        raise last_exception or RuntimeError("请求失败（未知原因）")

    @staticmethod
    def _extract_text(data: dict) -> str:
        """从 Chat Completions 响应中提取回复文本。"""
        try:
            choice = data["choices"][0]
            msg = choice["message"]
            content = msg.get("content")
            if content is None:
                return ""
            if isinstance(content, list):
                parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                return "".join(parts)
            return content
        except (KeyError, IndexError) as e:
            logger.error("❌ [OpenAICompat] 解析响应失败: %s | raw=%s", e, data)
            raise ValueError(f"无法解析 API 响应: {e}") from e


# ----------------------------------------------------------------
# 辅助函数
# ----------------------------------------------------------------

def _is_likely_base64(s: str) -> bool:
    """粗略判断字符串是否可能是 Base64 编码。"""
    s = s.strip()
    if len(s) < 20:
        return False
    import re
    return bool(re.fullmatch(r"[A-Za-z0-9+/=]+", s))