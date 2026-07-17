"""
会话管理器，与模型对象解耦，提供独立的会话历史管理能力。

设计原则：
- 不依赖任何模型 provider，可独立使用；
- 在模型对象初始化时传入，不传入则模型不做会话管理（每次单轮对话）；
- 持久化使用 JSONL 格式（每行一条 JSON 消息），支持高效追加写入；
- 上下文压缩默认使用 FIFO 策略（保留 system 消息）。
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

Message = Dict[str, Any]


class SessionManager:
    """会话管理器，负责会话历史的存储、持久化、上下文压缩。

    用法示例::

        from memory.session import SessionManager

        manager = SessionManager(storage_dir="./sessions")
        manager.add_message("s1", {"role": "user", "content": "你好"})
        history = manager.get_messages("s1")
        manager.save("s1")
        manager.compress("s1", max_context_length=8000)
    """

    def __init__(self, storage_dir: str = "./sessions"):
        """
        Args:
            storage_dir: 持久化文件存放目录。
        """
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        # 内存缓存：session_id -> list[Message]
        self._sessions: Dict[str, List[Message]] = {}

    # ----------------------------------------------------------------
    # 会话读写
    # ----------------------------------------------------------------

    def add_message(self, session_id: str, message: Message) -> None:
        """向指定会话追加一条消息。

        Args:
            session_id: 会话标识。
            message: 消息字典，格式为 ``{"role": "...", "content": "..."}``。
        """
        if not session_id:
            raise ValueError("session_id 不能为空")
        self._sessions.setdefault(session_id, []).append(message)
        logger.debug(
            "📝 [Session] add | sid=%s | role=%s | msgs=%d",
            session_id,
            message.get("role"),
            len(self._sessions[session_id]),
        )

    def get_messages(self, session_id: str) -> List[Message]:
        """获取指定会话的全部历史记录（深拷贝副本）。

        Args:
            session_id: 会话标识。

        Returns:
            历史消息列表（副本），会话不存在时返回空列表。
        """
        bucket = self._sessions.get(session_id)
        if not bucket:
            return []
        # 深拷贝，避免外部修改污染内部状态
        return [dict(m) for m in bucket]

    def clear(self, session_id: Optional[str] = None) -> None:
        """清理会话历史。

        Args:
            session_id: 指定会话 ID；为 None 时清除所有会话。
        """
        if session_id is None:
            self._sessions.clear()
            logger.info("🗑️ [Session] cleared all sessions")
        else:
            self._sessions.pop(session_id, None)
            logger.info("🗑️ [Session] cleared session=%s", session_id)

    # ----------------------------------------------------------------
    # 持久化（JSONL 格式）
    # ----------------------------------------------------------------

    def save(self, session_id: str, path: Optional[str] = None) -> str:
        """将会话历史持久化到 JSONL 文件。

        JSONL 格式：每行一条 JSON 消息，支持高效追加，也方便按行查看。

        Args:
            session_id: 会话 ID。
            path: 自定义文件路径，默认使用 ``storage_dir/{session_id}.jsonl``。

        Returns:
            实际写入的文件路径；会话不存在或为空时返回空字符串。
        """
        bucket = self._sessions.get(session_id)
        if not bucket:
            logger.warning("⚠️ [Session] save: 会话 %s 不存在或为空，跳过写入", session_id)
            return ""

        file_path = Path(path) if path else self.storage_dir / f"{session_id}.jsonl"
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with open(file_path, "w", encoding="utf-8") as f:
            for msg in bucket:
                f.write(json.dumps(msg, ensure_ascii=False) + "\n")

        logger.info(
            "💾 [Session] saved | sid=%s -> %s | msgs=%d",
            session_id,
            file_path,
            len(bucket),
        )
        return str(file_path)

    def load(self, session_id: str, path: Optional[str] = None) -> bool:
        """从 JSONL 文件加载会话历史到内存。

        Args:
            session_id: 会话 ID。
            path: 自定义文件路径，默认使用 ``storage_dir/{session_id}.jsonl``。

        Returns:
            文件是否存在且加载成功。
        """
        file_path = Path(path) if path else self.storage_dir / f"{session_id}.jsonl"
        if not file_path.exists():
            logger.info("ℹ️ [Session] load: 文件不存在 %s", file_path)
            return False

        messages: List[Message] = []
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    messages.append(json.loads(line))

        self._sessions[session_id] = messages
        logger.info(
            "📂 [Session] loaded | sid=%s <- %s | msgs=%d",
            session_id,
            file_path,
            len(messages),
        )
        return True

    # ----------------------------------------------------------------
    # 上下文压缩
    # ----------------------------------------------------------------

    def compress(self, session_id: str, max_context_length: int) -> int:
        """上下文压缩，按 FIFO 原则淘汰最旧的非 system 消息。

        当历史消息总 token 数超过 ``max_context_length`` 时，
        从最旧的消息开始淘汰（保留 system 消息），直到总 token 数回到限制以内。

        Args:
            session_id: 会话 ID。
            max_context_length: 上下文窗口长度上限（token 数）。

        Returns:
            被淘汰的消息数量。
        """
        bucket = self._sessions.get(session_id)
        if not bucket or max_context_length <= 0 or len(bucket) <= 1:
            return 0

        evicted = 0
        while self._total_tokens(bucket) > max_context_length and len(bucket) > 1:
            if not self._evict_oldest(bucket):
                break  # 已无可淘汰消息（全是 system），停止
            evicted += 1

        if evicted > 0:
            logger.info(
                "🗜️ [Session] compress | sid=%s | evicted=%d | remaining=%d | tokens=%d",
                session_id,
                evicted,
                len(bucket),
                self._total_tokens(bucket),
            )

        return evicted

    # ----------------------------------------------------------------
    # 内部辅助
    # ----------------------------------------------------------------

    @staticmethod
    def _estimate_tokens(message: Message, chars_per_token: float = 4.0) -> int:
        """粗略估算单条消息的 token 数。"""
        content = message.get("content", "")
        if isinstance(content, list):
            # 多模态场景：只统计 text 部分（图片由 API 自行处理）
            text_parts = [
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and item.get("type") == "text"
            ]
            content = "".join(text_parts)
        return max(1, int(len(str(content)) / chars_per_token))

    @staticmethod
    def _total_tokens(bucket: List[Message], chars_per_token: float = 4.0) -> int:
        return sum(
            SessionManager._estimate_tokens(m, chars_per_token) for m in bucket
        )

    @staticmethod
    def _evict_oldest(bucket: List[Message]) -> bool:
        """FIFO：移除最旧的非 system 消息。"""
        for i, msg in enumerate(bucket):
            if msg.get("role") != "system":
                del bucket[i]
                return True
        return False