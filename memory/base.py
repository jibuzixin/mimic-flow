"""
会话记忆管理抽象基类。

任何会话存储后端（JSON、Redis、SQLite …）只需继承本类并实现抽象方法，
即可被 provider 等上层模块以统一接口调用。
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

# 一条消息的最小结构：{"role": "user|assistant|system", "content": ...}
# 多模态场景下 content 可以是 list[dict]，例如智谱视觉模型格式
Message = Dict[str, Any]


class BaseSessionMemory(ABC):
    """会话记忆管理抽象基类。

    设计原则：
    - 历史先保存在内存中，避免每次请求都读写磁盘；
    - `save` / `load` 由上层按需调用，提供持久化能力；
    - 长度限制（token / 条数）由具体实现策略决定。
    """

    # ---------------- 会话读写 ----------------

    @abstractmethod
    def add_message(self, session_id: str, message: Message) -> None:
        """向指定会话追加一条消息；超出长度限制时按实现策略淘汰。"""

    @abstractmethod
    def get_messages(self, session_id: str) -> List[Message]:
        """获取指定会话的全部历史消息（拷贝，避免外部修改污染内部状态）。"""

    @abstractmethod
    def clear(self, session_id: Optional[str] = None) -> None:
        """清除会话记忆；session_id 为 None 时清除所有会话。"""

    # ---------------- 持久化 ----------------

    @abstractmethod
    def save(self, session_id: str, path: Optional[str] = None) -> str:
        """将会话历史写入持久化文件，返回实际写入的文件路径。"""

    @abstractmethod
    def load(self, session_id: str, path: Optional[str] = None) -> bool:
        """从持久化文件载入会话历史；文件不存在时返回 False。"""
