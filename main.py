"""
click - 大模型多提供商适配器，支持智谱 GLM、OpenAI 等
"""

import logging
import os
import sys

from dotenv import load_dotenv

from provider import ZhipuAI

# ── 彩色日志 ──────────────────────────────────────────────────
class _ColorFormatter(logging.Formatter):
    """整行按日志级别着色。"""

    _colors = {
        logging.DEBUG: "\033[38;5;81m",       # 淡蓝
        logging.INFO: "\033[38;5;83m",        # 绿色
        logging.WARNING: "\033[38;5;221m",    # 黄色
        logging.ERROR: "\033[38;5;203m",      # 红色
        logging.CRITICAL: "\033[48;5;196m\033[38;5;231m",  # 白字红底
    }
    _reset = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        code = self._colors.get(record.levelno, self._reset)
        msg = super().format(record)
        return f"{code}{msg}{self._reset}"


_handler = logging.StreamHandler(sys.stderr)
_handler.setFormatter(_ColorFormatter(
    "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
))
logging.basicConfig(level=logging.DEBUG, handlers=[_handler])
logging.getLogger("httpx").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


def main():
    """快速演示：纯文本对话 + 图片对话。"""
    load_dotenv()
    logger.info("🚀 Click 启动")

    try:
        client = ZhipuAI(api_key=os.getenv("ZHIPU_API_KEY"))
    except ValueError as e:
        logger.error("❌ %s", e)
        logger.error("💡 请设置环境变量: export ZHIPUAI_API_KEY='你的key'")
        sys.exit(1)

    # ── 纯文本对话 ──
    logger.info("=" * 50)
    logger.info("📝 纯文本对话")
    reply = client.chat("用 Python 写一个计算斐波那契数列第 n 项的函数", model="glm-4.5-flash")
    logger.info("🤖 回复:\n%s", reply)

    # ── 图片对话（如果有演示图片则执行） ──
    demo_image = "demo.png"
    if Path(demo_image).exists():
        logger.info("=" * 50)
        logger.info("🖼️ 图片对话")
        reply = client.chat_with_image("这张图里有什么？", demo_image, model="GLM-4.6V-FlashX")
        logger.info("🤖 回复:\n%s", reply)
    else:
        logger.info("📷 未找到 %s，跳过图片对话演示", demo_image)


if __name__ == "__main__":
    from pathlib import Path
    main()