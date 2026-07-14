"""
会话记忆管理模块。

提供可插拔的会话历史存储能力，供 provider 等上层模块使用。
默认提供基于 JSON 文件 + FIFO 淘汰策略的实现；
如需替换为 Redis、SQLite 等，只需继承 `BaseSessionMemory` 并实现对应方法。
"""

from .base import BaseSessionMemory, Message
from .json_memory import JsonSessionMemory

__all__ = ["BaseSessionMemory", "Message", "JsonSessionMemory"]
