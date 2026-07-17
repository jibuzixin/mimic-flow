"""
会话记忆管理模块。

提供可插拔的会话历史存储能力，供 provider 等上层模块使用。
- `SessionManager`：独立会话管理器，JSONL 持久化、FIFO 上下文压缩，与模型对象解耦。
- `BaseSessionMemory`：旧版抽象基类（保留兼容）。
- `JsonSessionMemory`：旧版 JSON 实现（保留兼容）。
"""

from .base import BaseSessionMemory, Message
from .json_memory import JsonSessionMemory
from .session import SessionManager

__all__ = ["BaseSessionMemory", "Message", "JsonSessionMemory", "SessionManager"]
