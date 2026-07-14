"""
基于 JSON 文件的会话记忆管理实现。

特点：
- 历史保存在内存中（deque），请求时 O(1) 取出；
- 超过 token 限制时按 FIFO 策略淘汰最旧的历史消息（system 消息始终保留）；
- 持久化通过 `save` 触发，写入 `<storage_dir>/<session_id>.json`。
"""

import json
import logging
from collections import deque
from pathlib import Path
from typing import Deque, Dict, List, Optional

from .base import BaseSessionMemory, Message

logger = logging.getLogger(__name__)


class JsonSessionMemory(BaseSessionMemory):
    """JSON 文件 + 内存缓存 + FIFO 淘汰 的会话记忆实现。"""

    def __init__(
        self,
        max_tokens: int = 8000,
        storage_dir: str = "./sessions",
        chars_per_token: float = 4.0,
    ):
        """
        Args:
            max_tokens: 单个会话允许的最大 token 数；超出后按 FIFO 淘汰
            storage_dir: 持久化文件存放目录
            chars_per_token: token 估算系数（粗略按字符数 / chars_per_token 估算）
        """
        self.max_tokens = max(1, int(max_tokens))
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.chars_per_token = chars_per_token
        # 内存中的会话存储
        self._sessions: Dict[str, Deque[Message]] = {}

    # ----------------------------------------------------------------
    # 公共方法
    # ----------------------------------------------------------------

    def add_message(self, session_id: str, message: Message) -> None:
        """追加消息；超出 max_tokens 时按 FIFO 淘汰最旧消息（保留 system）。"""
        if not session_id:
            raise ValueError("session_id 不能为空")

        bucket = self._sessions.setdefault(session_id, deque())
        bucket.append(message)

        # 触发淘汰循环：每次淘汰一条，直至 token 数回到限制内
        while self._total_tokens(bucket) > self.max_tokens and len(bucket) > 1:
            if not self._evict_oldest(bucket):
                # 已无可淘汰消息（全是 system），停止避免死循环
                break

        logger.debug(
            "🧠 [Memory] add | sid=%s | role=%s | total_tokens=%d | msgs=%d",
            session_id, message.get("role"),
            self._total_tokens(bucket), len(bucket),
        )

    def get_messages(self, session_id: str) -> List[Message]:
        """返回会话历史副本，避免外部直接修改内部 deque。"""
        bucket = self._sessions.get(session_id)
        if not bucket:
            return []
        return [dict(m) for m in bucket]

    def clear(self, session_id: Optional[str] = None) -> None:
        if session_id is None:
            self._sessions.clear()
            logger.info("🧠 [Memory] cleared all sessions")
        else:
            self._sessions.pop(session_id, None)
            logger.info("🧠 [Memory] cleared session=%s", session_id)

    def save(self, session_id: str, path: Optional[str] = None) -> str:
        """将会话历史写入 JSON 文件，返回写入的文件路径。"""
        bucket = self._sessions.get(session_id)
        if not bucket:
            logger.warning("⚠️ [Memory] save: 会话 %s 不存在或为空，跳过写入", session_id)
            return ""

        file_path = Path(path) if path else self.storage_dir / f"{session_id}.json"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(list(bucket), f, ensure_ascii=False, indent=2)
        logger.info("💾 [Memory] saved | sid=%s -> %s | msgs=%d",
                    session_id, file_path, len(bucket))
        return str(file_path)

    def load(self, session_id: str, path: Optional[str] = None) -> bool:
        """从 JSON 文件载入会话历史；文件不存在返回 False。"""
        file_path = Path(path) if path else self.storage_dir / f"{session_id}.json"
        if not file_path.exists():
            logger.info("ℹ️ [Memory] load: 文件不存在 %s", file_path)
            return False

        with open(file_path, "r", encoding="utf-8") as f:
            messages = json.load(f)

        if not isinstance(messages, list):
            raise ValueError(f"会话文件格式错误，期望 list，实际 {type(messages)}")

        self._sessions[session_id] = deque(messages)
        logger.info("📂 [Memory] loaded | sid=%s <- %s | msgs=%d",
                    session_id, file_path, len(messages))
        return True

    # ----------------------------------------------------------------
    # 内部辅助
    # ----------------------------------------------------------------

    def _estimate_tokens(self, message: Message) -> int:
        """粗略估算单条消息的 token 数。"""
        content = message.get("content", "")
        if isinstance(content, list):
            # 多模态场景：只统计 text 部分（图片由 API 自行处理）
            text_parts = [
                item.get("text", "") for item in content
                if isinstance(item, dict) and item.get("type") == "text"
            ]
            content = "".join(text_parts)
        # 至少算 1 token
        return max(1, int(len(str(content)) / self.chars_per_token))

    def _total_tokens(self, bucket: Deque[Message]) -> int:
        return sum(self._estimate_tokens(m) for m in bucket)

    def _evict_oldest(self, bucket: Deque[Message]) -> bool:
        """FIFO：弹出最旧的非 system 消息；返回是否成功淘汰。"""
        for i, msg in enumerate(bucket):
            if msg.get("role") != "system":
                del bucket[i]
                return True
        return False
