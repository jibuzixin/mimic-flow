"""
run.py - 主程序：教学视频 → 操作步骤 → 自动化执行

工作流程：
  1. 输入教学视频（生产模式）或预存步骤（测试模式）
  2. 调用视频处理接口（provider/glm_video_demo.py）
  3. 生成初步操作步骤
  4. （TODO）调用 LLM 总结去重
  5. 转化为结构化步骤数组
  6. 外层循环：遍历每一个步骤
  7. 内层循环：每一个步骤内循环，直到 Condition 条件达成
     a. 截屏
     b. 组合当前步骤提示词 + 截图，发给多模态模型
     c. 解析模型返回的 Action，生成 pyautogui 代码并执行
     d. 再截屏 + 询问"Condition 条件达到了吗"
     e. 满足则退出内循环；否则继续
  8. 进入下一步骤

测试模式：使用 prompts/results_test_prompt.py 中预存的 T1/T2 步骤，
         从"转化为结构化数据"开始，跳过视频处理阶段。
"""

import argparse
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

import pyautogui
import pyperclip  # noqa: F401  # 给 pyautogui_code 的 exec 使用
from dotenv import load_dotenv
from PIL import Image

# 项目内部模块
from lib.ui_tars.action_parser import (
    parse_action_to_structure_output,
    parsing_response_to_pyautogui_code,
)
from mac_parse_demo import capture_mac_screen, draw_action_box_on_image
from prompts.summary import STEP_SUMMARIZE_PROMPT
from provider import ZhipuAI
from prompts.planner import PLANNER_PROMPT
from prompts.results_test_prompt import T1, T2


# ────────────────────────────────────────────────────────────
#  彩色日志
# ────────────────────────────────────────────────────────────
class _ColorFormatter(logging.Formatter):
    """整行按日志级别着色。"""

    _colors = {
        logging.DEBUG: "\033[38;5;81m",
        logging.INFO: "\033[38;5;83m",
        logging.WARNING: "\033[38;5;221m",
        logging.ERROR: "\033[38;5;203m",
        logging.CRITICAL: "\033[48;5;196m\033[38;5;231m",
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
logging.basicConfig(level=logging.INFO, handlers=[_handler])
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("run")


# ────────────────────────────────────────────────────────────
#  配置
# ────────────────────────────────────────────────────────────
VISION_MODEL = "GLM-4.6V"  # 多模态模型
SCREENSHOT_DIR = Path("./screenshots")
SCREENSHOT_DIR.mkdir(exist_ok=True)
MAX_SUB_ITERATIONS = 20   # 每个步骤内循环最大次数
ACTION_PAUSE = 0.25        # 操作后等待 UI 响应的秒数
COUNTDOWN_SECONDS = 3     # 开始执行前的倒计时


# ────────────────────────────────────────────────────────────
#  1. 步骤解析
# ────────────────────────────────────────────────────────────
_SC = r"[\u003B\uFF1B]"  # ; 或 ；

# 步骤起始标记：遇到 "- Index: N" 就视为新一步开始
_STEP_MARKER_RE = re.compile(r"-\s*Index:\s*\d+")

# 6 个核心字段名（大小写不敏感，按字段名边界切分）
_FIELD_NAMES = ["Operation", "Target", "Orientation", "Condition", "Think"]
_FIELD_PATTERN = re.compile(
    r"\b(Operation|Target|Orientation|Condition|Think)\s*:\s*",
    re.IGNORECASE,
)


def _clean_field(value: str) -> str:
    """清理字段值：去掉首尾空白 + 去掉末尾中英文标点 (;；.。,，)。"""
    return value.strip().rstrip(";；.。,，").strip()


def _parse_one_step(chunk: str) -> Optional[dict]:
    """解析单步。任一字段缺失时填空串，字段顺序乱/大小写不敏感也兼容。"""
    # 1. 提取 Index
    m_idx = re.match(r"-\s*Index:\s*(\d+)", chunk)
    if not m_idx:
        return None
    idx = int(m_idx.group(1))

    # 2. 默认所有字段为空
    values: dict[str, str] = {n: "" for n in _FIELD_NAMES}

    # 3. 扫描每个字段名出现的位置，按出现顺序提取值
    matches = list(_FIELD_PATTERN.finditer(chunk, pos=m_idx.end()))
    for j, m in enumerate(matches):
        raw_name = m.group(1)
        # 统一成 "Operation" 形式（兼容 "operation"/"OPERATION"）
        name = raw_name[:1].upper() + raw_name[1:].lower()
        if name not in values:
            continue
        value_start = m.end()
        # 字段值 = 字段名后到下一个字段名之前
        value_end = matches[j + 1].start() if j + 1 < len(matches) else len(chunk)
        values[name] = _clean_field(chunk[value_start:value_end])

    return {
        "index": idx,
        "operation": values["Operation"],
        "target": values["Target"],
        "orientation": values["Orientation"],
        "condition": values["Condition"],
        "think": values["Think"],
    }


def parse_steps(text: str) -> list[dict]:
    """解析步骤文本，按字段名切分，鲁棒处理各种异常输入。

    解析策略：
      1. 用 "- Index: N" 作为步骤起点（marker）
      2. 起点到下一个 marker 之间的所有文本属于同一步
      3. 在每个 chunk 内按字段名（Operation/Target/...）逐个扫描
      4. 任一字段缺失时填 ''（不再丢步）

    支持：
      - 中英文分号 (; 和 ；)
      - 一行一步 / 一步跨多行 / 一行多步
      - 字段缺失（只解析出有的字段，缺失填空）
      - 字段值包含 ; ； 字符（不会误切）
      - 字段顺序乱（按出现顺序提取）
      - 字段名大小写不敏感

    注意：保留原始 Index 编号，不做重新编号。Index 错乱（分段处理后汇总）
    由 summarize_steps 调用 LLM 统一处理。

    返回：[
        {"index": 1, "operation": ..., "target": ..., "orientation": ...,
         "condition": ..., "think": ...}, ...
    ]
    """
    markers = list(_STEP_MARKER_RE.finditer(text))
    if not markers:
        return []

    steps: list[dict] = []
    for i, m in enumerate(markers):
        start = m.start()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(text)
        chunk = text[start:end]
        step = _parse_one_step(chunk)
        if step is None:
            logger.warning("⚠️ 无法解析步骤 chunk: %s", chunk[:120])
            continue
        steps.append(step)

    return steps


# ────────────────────────────────────────────────────────────
#  1.5 LLM 汇总：把分段处理后的步骤重新编号、去重
# ────────────────────────────────────────────────────────────
SUMMARIZE_PROMPT = """你是操作步骤整理助手，专门处理"分段处理后汇总"的步骤数据。

【背景】
我会给你一组从教学视频中分段提取后汇总的操作步骤。因为每一段视频是独立处理的，
所以原始数据中 Index 字段经常从 1 重新开始，导致汇总后出现重复的 Index，

【你的任务】
2. 重新编号：Index 从 1 开始依次递增，无断序、无重复
3. 去重：去除完全重复的步骤（Operation + Target 完全一致）
4. 合并：对时间上连续、语义上属于同一步的操作可适当合并（除非原本就分开）
5. 保留每个步骤的全部 6 个核心字段：Index / Operation / Target / Orientation / Condition / Think
6. 严格遵循输出格式（每行一步，行内用半角分号 ; 分隔字段，行尾以 ; 结束）

【输出格式（严格遵守）】
- Index: 1; Operation: ...; Target: ...; Orientation: ...; Condition: ...; Think: ...;
- Index: 2; Operation: ...; Target: ...; Orientation: ...; Condition: ...; Think: ...;

【输入步骤】
{steps_text}

请直接输出整理后的步骤列表，不要加任何说明文字。"""


def _steps_to_text(steps: list[dict]) -> str:
    """把步骤列表拼成 LLM 友好的文本（保留原始 Index）。

    缺失字段填空串，避免 KeyError（与 parse_steps 容错行为对齐）。
    """
    lines = []
    for s in steps:
        lines.append(
            f"- Index: {s.get('index', '?')}; "
            f"Operation: {s.get('operation', '')}; "
            f"Target: {s.get('target', '')}; "
            f"Orientation: {s.get('orientation', '')}; "
            f"Condition: {s.get('condition', '')}; "
            f"Think: {s.get('think', '')};"
        )
    return "\n".join(lines)


def summarize_steps(client: ZhipuAI, steps: list[dict]) -> list[dict]:
    """调用 LLM 对分段提取的步骤进行汇总：重新编号 + 去重 + 排序。

    - 输入：可能含 Index 重复、跨段重复、顺序错乱的步骤列表
    - 输出：Index 从 1 严格递增的步骤列表
    - 失败时回退到原 steps（不重新编号，由调用方决定如何处理）
    """
    if len(steps) <= 1:
        # 1 步以内无需汇总
        # 1 步以内无需汇总
        return steps

    # 2 步以上才需要汇总
    # 修复summarize_steps函数中的KeyError风险，使用get()方法确保容错一致性
    steps = [
            {
                "index": s.get("index", "?"),
                "operation": s.get("operation", ""),
                "target": s.get("target", ""),
                "orientation": s.get("orientation", ""),
                "condition": s.get("condition", ""),
                "think": s.get("think", ""),
            }
            for s in steps
        ]

    steps_text = _steps_to_text(steps)
    prompt = STEP_SUMMARIZE_PROMPT.format(steps_text=steps_text)
    logger.info("📝 调用 LLM 汇总 %d 个原始步骤（Index 可能错乱）...", len(steps))

    try:
        # response = client.chat(
        #     prompt=prompt,
        #     model="glm-4.5-flash",
        #     temperature=0.2,
        # )
        response = """LM 汇总回复:
- Index: 1; - Operation: 点击屏幕底部任务栏中的Google Chrome图标，启动浏览器; - Target: Google Chrome应用图标（位于屏幕底部任务栏，呈圆形，包含红、黄、绿、蓝四色）; - Orientation: 屏幕底部任务栏; - Condition: Google Chrome浏览器窗口成功打开并显示新标签页; - Think: 根据用户指令"打开谷歌浏览器"，需启动浏览器，屏幕底部任务栏中存在Google Chrome图标，点击该图标可启动浏览器;
- Index: 2; - Operation: 在浏览器地址栏中输入网址"bilibili.com"; - Target: 浏览器地址栏（位于浏览器窗口顶部，显示为可输入文本的白色输入框，当前显示"G"字样）; - Orientation: 浏览器窗口顶部; - Condition: 地址栏中成功输入"bilibili.com"文本; - Think: 根据用户指令"在地址栏上输入bilibili.com"，需在地址栏中输入指定网址，地址栏是浏览器中用于输入网址的输入框，当前已显示且可交互;
- Index: 3; - Operation: 按下回车键，提交地址栏中的网址请求; - Target: 浏览器地址栏（已输入"bilibili.com"文本的输入框）; - Orientation: 浏览器窗口顶部; - Condition: 浏览器开始加载bilibili网站页面; - Think: 输入网址后需提交请求以访问网站，回车键是常用的提交操作，地址栏中已输入目标网址，按下回车键可触发页面加载;
- Index: 4; - Operation: 点击页面右上角的登录头像按钮; - Target: 登录头像按钮（位于bilibili页面右上角，显示为圆形头像图标，旁边有"登录"文字）; - Orientation: 页面右上角; - Condition: 登录弹窗成功弹出; - Think: 根据用户指令"点击这个登录的头像"，需点击登录入口，页面右上角的登录头像按钮是登录功能的入口，点击后可弹出登录界面;
- Index: 5; - Operation: 点击登录弹窗中的"账号"输入框; - Target: 账号输入框（位于登录弹窗中，显示为"请输入账号"的文本输入框）; - Orientation: 登录弹窗中部; - Condition: 账号输入框获得焦点，光标定位在输入框内; - Think: 根据用户指令"输入账号"，需先激活账号输入框，登录弹窗中的"账号"输入框是用于输入账号的元素，点击后可进入输入状态;
- Index: 6; - Operation: 点击登录弹窗右上角的关闭按钮，关闭登录弹窗; - Target: 登录弹窗右上角的"×"关闭按钮，白色背景、黑色"×"符号; - Orientation: 右上; - Condition: 登录弹窗消失，页面恢复至bilibili首页主界面状态; - Think: 根据视频画面，登录弹窗右上角有明显的"×"关闭按钮，点击后弹窗消失，符合用户"点击关闭"的操作描述;"""
    except Exception as e:
        logger.error("❌ LLM 汇总失败: %s | 回退到原步骤", e)
        return steps

    # 更新字段访问，使用动态字段名
        return [
            {
                "index": i + 1,
                "operation": s["operation"],
                "target": s["target"],
                "orientation": s["orientation"],
                "condition": s["condition"],
                "think": s["think"],
            }
            for i, s in enumerate(steps)
        ]

    logger.info("💬 LLM 汇总回复:\n%s", response.strip())

    summarized = parse_steps(response)
    if not summarized:
        logger.warning("⚠️ LLM 汇总结果无法解析，回退到原步骤")
        return [
            {
                "index": i + 1,
                "operation": s["operation"],
                "target": s["target"],
                "orientation": s["orientation"],
                "condition": s["condition"],
                "think": s["think"],
            }
            for i, s in enumerate(steps)
        ]

    logger.info(
        "📋 汇总前 %d 步 → 汇总后 %d 步（去重/合并）",
        len(steps), len(summarized),
    )
    return summarized


# ────────────────────────────────────────────────────────────
#  2. 截屏
# ────────────────────────────────────────────────────────────
def take_screenshot(name: str) -> tuple[Image.Image, int, int, int, int]:
    """截屏，返回 (图片, 物理宽, 物理高, 逻辑宽, 逻辑高)。"""
    path = SCREENSHOT_DIR / f"{name}.png"
    img, phys_w, phys_h = capture_mac_screen(str(path))
    logic_w, logic_h = pyautogui.size()
    return img, phys_w, phys_h, logic_w, logic_h


# ────────────────────────────────────────────────────────────
#  3. 提示词构建
# ────────────────────────────────────────────────────────────
def build_action_prompt(step: dict, language: str="中文") -> str:
    """构建"下一步要做什么 Action"的提示词。"""
    return f"""You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
```
Thought: ...
Action: ...
```

## Action Space

click(point='<point>x1 y1</point>')
left_double(point='<point>x1 y1</point>')
right_single(point='<point>x1 y1</point>')
drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')
hotkey(key='ctrl c') # Split keys with a space and use lowercase. Also, do not use more than 3 keys in one hotkey action.
type(content='xxx') # Use escape characters \\', \\\", and \\n in content part to ensure we can parse the content in normal python string format. If you want to submit your input, use \\n at the end of content. 
scroll(point='<point>x1 y1</point>', direction='down or up or right or left') # Show more information on the `direction` side.
wait() #Sleep for 5s and take a screenshot to check for any changes.
finished(content='xxx') # Use escape characters \\', \\", and \\n in content part to ensure we can parse the content in normal python string format.


## Note
- Use {language} in `Thought` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in `Thought` part.

## User Instruction
- 操作（Operation）: {step['operation']}
- 目标对象（Target）: {step['target']}
- 大致位置（Orientation）: {step['orientation']}

【重要提示】
- 只有当你确认"完成条件"已经满足，才用 finished；否则用具体 Action 继续执行。
"""


def build_check_prompt(step: dict) -> str:
    """构建"当前 Condition 条件是否已满足"的提示词。"""
    return f"""You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

【当前要完成的步骤】
- 操作（Operation）: {step['operation']}
- 目标对象（Target）: {step['target']}
- 大致位置（Orientation）: {step['orientation']}
- 【完成条件 Condition】: {step['condition']}

【注意事项】
- 对于一些不明显的效果或者动态的 UI 反馈效果不明显，一张图片看出不动态效果，默认上述操作均正常执行
- 对于有明显变化的，如：网页变动、窗口提醒、弹窗和关键按钮位置需要判断是否完成

【输出格式（必须严格遵守，不要输出任何其它内容）】
- 如果完成条件已满足，请只回复：DONE
- 如果完成条件未满足，请只回复：NOT_DONE，然后用一句话简短说明还差什么
"""


# ────────────────────────────────────────────────────────────
#  4. 执行 Action
# ────────────────────────────────────────────────────────────
def execute_action(
    response: str,
    phys_w: int,
    phys_h: int,
    logic_w: int,
    logic_h: int,
    step_index: int,
    iter_index: int,
) -> Optional[str]:
    """解析多模态模型输出，并执行 pyautogui 代码。

    Returns:
        None  - 正常执行
        "FINISHED" - 模型认为步骤已完成
        "PARSE_ERROR" - 模型输出无法解析
    """
    try:
        parsed = parse_action_to_structure_output(
            text=response,
            factor=1000,
            origin_resized_height=phys_h,
            origin_resized_width=phys_w,
            model_type="doubao",
        )
    except Exception as e:
        logger.error("❌ 解析模型输出失败: %s | response=%s", e, response[:200])
        return "PARSE_ERROR"

    if not parsed:
        return "PARSE_ERROR"

    # 模型认为已完成
    if any(a.get("action_type") == "finished" for a in parsed):
        return "FINISHED"

    # 生成 pyautogui 代码
    try:
        code = parsing_response_to_pyautogui_code(
            responses=parsed,
            image_height=logic_h,
            image_width=logic_w,
        )
    except Exception as e:
        logger.error("❌ 生成 pyautogui 代码失败: %s", e)
        return "PARSE_ERROR"

    logger.info("🖱️ 生成的 pyautogui 代码:\n%s", code)

    # 执行
    try:
        exec(code, {"pyautogui": pyautogui, "time": time, "pyperclip": pyperclip})
    except pyautogui.FailSafeException:
        logger.error("🛑 触发 pyautogui FAILSAFE（鼠标被移到屏幕左上角），中止执行")
        raise
    except Exception as e:
        logger.error("❌ 执行 pyautogui 代码失败: %s", e)
        return "PARSE_ERROR"

    return None


# ────────────────────────────────────────────────────────────
#  5. 条件检查
# ────────────────────────────────────────────────────────────
def check_condition(client: ZhipuAI, step: dict, image_path: str) -> bool:
    """询问多模态模型：当前 Condition 是否满足。"""
    prompt = build_check_prompt(step)
    try:
        response = client.chat_with_image(
            prompt=prompt,
            image=image_path,
            model=VISION_MODEL,
            temperature=0.2,
        )
    except Exception as e:
        logger.error("❌ 条件检查请求失败: %s", e)
        return False

    text = response.strip()
    logger.info("🔍 条件检查回复: %s", text[:200])

    # 兼容模型可能附带 Thought 行的情形
    first_line = text.splitlines()[0].strip().upper() if text else ""
    if first_line.startswith("DONE"):
        return True
    return False


# ────────────────────────────────────────────────────────────
#  6. 执行单个步骤（内循环：截屏→询问→执行→再询问，直到条件满足）
# ────────────────────────────────────────────────────────────
def execute_step(client: ZhipuAI, step: dict) -> bool:
    """执行单个步骤。多轮会话模式：截屏→问模型→执行→再截屏→问模型（带历史）→...直到 finished。

    Returns:
        True  - 步骤完成（模型输出 finished）
        False - 达到最大内循环次数仍未完成
    """
    logger.info("=" * 60)
    logger.info("▶️  步骤 %d  开始", step.get("index", "?"))
    logger.info("    操作  : %s", step.get("operation", ""))
    logger.info("    目标  : %s", step.get("target", ""))
    logger.info("    位置  : %s", step.get("orientation", ""))
    logger.info("    条件  : %s", step.get("condition", ""))

    session_id = f"step_{step.get('index', '?')}"
    # 清理旧会话历史，确保每次步骤从干净状态开始
    client.clear_session(session_id)
    parse_error_hint: Optional[str] = None

    for it in range(1, MAX_SUB_ITERATIONS + 1):
        logger.info("-" * 50)
        logger.info("🔁 步骤 %d  内循环 %d / %d", step.get("index", "?"), it, MAX_SUB_ITERATIONS)

        # ── a. 截屏
        shot_name = f"step{step.get('index', '?'):02d}_iter{it:02d}"
        img, phys_w, phys_h, logic_w, logic_h = take_screenshot(shot_name)
        shot_path = SCREENSHOT_DIR / f"{shot_name}.png"

        # ── b. 构造提示词 & 发送给模型
        if it == 1:
            prompt = build_action_prompt(step)
        elif parse_error_hint:
            prompt = parse_error_hint
            parse_error_hint = None  # 只发一次
        else:
            prompt = "这是执行上一步操作后的新截图，请判断是否已完成目标。"

        try:
            response = client.chat_with_image(
                prompt=prompt,
                image=str(shot_path),
                model=VISION_MODEL,
                temperature=0.2,
                session_id=session_id,
            )
        except Exception as e:
            logger.error("❌ 调用多模态模型失败: %s", e)
            time.sleep(2)
            continue

        logger.info("💬 模型动作回复:\n%s", response.strip()[:400])

        # ── c. 解析 + 执行
        result = execute_action(
            response, phys_w, phys_h, logic_w, logic_h,
            step_index=step.get("index", "?"), iter_index=it,
        )

        # 画一张带坐标标记的截图，方便调试
        try:
            parsed = parse_action_to_structure_output(
                text=response,
                factor=1000,
                origin_resized_height=phys_h,
                origin_resized_width=phys_w,
                model_type="doubao",
            )
            mark_path = SCREENSHOT_DIR / f"step{step.get('index', '?'):02d}_iter{it:02d}_mark.png"
            draw_action_box_on_image(
                img=img, parsed_action=parsed,
                w_phys=phys_w, h_phys=phys_h, save_path=str(mark_path),
            )
        except Exception:
            pass

        # ── d. 检查完成状态
        if result == "FINISHED":
            logger.info("✅ 模型声明完成 (finished)，步骤 %d 结束", step.get("index", "?"))
            return True

        if result == "PARSE_ERROR":
            logger.info("⏳ 步骤 %d 解析错误，继续内循环", step.get("index", "?"))
            time.sleep(ACTION_PAUSE)
            parse_error_hint = "你的上一个回复格式无法解析，请重新输出合规的 Action（函数调用格式）。"
            continue

        # 等待 UI 响应
        time.sleep(ACTION_PAUSE)

    logger.warning("⚠️ 步骤 %d 达到最大内循环次数 %d，强制结束", step.get("index", "?"), MAX_SUB_ITERATIONS)
    return False


def execute_step_with_clear_session(client: ZhipuAI, step: dict) -> bool:
    """带 session 清理的 execute_step 封装，每次调用前清理旧会话历史。"""
    session_id = f"step_{step.get('index', '?')}"
    client.clear_session(session_id)
    return execute_step(client, step)


# ────────────────────────────────────────────────────────────
#  7. 视频 → 步骤（生产模式，预留）
# ────────────────────────────────────────────────────────────
def video_to_steps(client: ZhipuAI, video_path: str) -> list[dict]:
    """调用 provider.glm_video_demo 同款接口，生成原始操作步骤。"""
    logger.info("🎬 开始分析视频: %s", video_path)
    result = client.chat_with_video(
        prompt=PLANNER_PROMPT,
        video_path=video_path,
        model=VISION_MODEL,
        audio_model=None,
        use_parallel=False,
        batch_max_frames=10,
        retry_times=3,
    )
    raw_text = "\n".join(b["response"] for b in result["batch_results"])
    steps = parse_steps(raw_text)
    logger.info("📋 从视频中解析到 %d 个原始步骤", len(steps))
    return steps


# ────────────────────────────────────────────────────────────
#  8. 模式入口
# ────────────────────────────────────────────────────────────
def _print_steps(steps: list[dict]) -> None:
    logger.info("📋 解析到 %d 个步骤:", len(steps))
    for s in steps:
        logger.info(
            "  [%d] %s | 条件: %s",
            s.get("index", "?"), s.get("operation", "")[:50], s.get("condition", "")[:50],
        )


def build_full_task_prompt(steps: list[dict], language: str = "中文") -> str:
    """构建完整任务提示词：将所有步骤一次性展示给模型，由其自主判断进度。"""
    steps_text = "\n".join(
        f"  {s.get('index', '?')}. {s.get('operation', '')} —— {s.get('target', '')} （{s.get('orientation', '')}）"
        f"\n     完成条件: {s.get('condition', '')}"
        for s in steps
    )
    return f"""You are a GUI agent. You are given a full task plan with multiple steps. You need to execute them one by one autonomously.
You will see a screenshot after each action you take. Use the screenshot history to track your progress.

## Full Task Plan

{steps_text}

## Output Format
```
Thought: <describe what you see, which step you're on, and what to do next>
Action: <the action to take>
```

## Action Space

click(point='<point>x1 y1</point>')
left_double(point='<point>x1 y1</point>')
right_single(point='<point>x1 y1</point>')
drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')
hotkey(key='ctrl c') # Split keys with a space and use lowercase. Also, do not use more than 3 keys in one hotkey action.
type(content='xxx') # Use escape characters \\', \\\", and \\n in content part to ensure we can parse the content in normal python string format. If you want to submit your input, use \\n at the end of content.
scroll(point='<point>x1 y1</point>', direction='down or up or right or left') # Show more information on the `direction` side.
wait() #Sleep for 5s and take a screenshot to check for any changes.
finished(content='全部步骤已完成') # Call this ONLY when ALL steps in the task plan are done.

## Note
- Use {language} in `Thought` part.
- Track your progress through the steps. When you finish a step, move to the next one.
- Only call finished() when ALL steps are complete.
- If an action doesn't seem to work, try a different approach.
"""


def execute_full_task(client: ZhipuAI, steps: list[dict]) -> bool:
    """自主执行完整任务：模型看到全部步骤，自行判断进度和下一步操作。

    Args:
        client: LLM 客户端
        steps: 汇总后的步骤列表

    Returns:
        True  - 全部完成
        False - 达到最大循环次数未完成
    """
    session_id = "full_task"
    client.clear_session(session_id)

    prompt = build_full_task_prompt(steps)
    parse_error_hint: Optional[str] = None

    for it in range(1, MAX_SUB_ITERATIONS * len(steps) + 1):
        logger.info("-" * 50)
        logger.info("🔁 自主执行  内循环 %d", it)

        # 截屏
        shot_name = f"fulltask_iter{it:02d}"
        img, phys_w, phys_h, logic_w, logic_h = take_screenshot(shot_name)
        shot_path = SCREENSHOT_DIR / f"{shot_name}.png"

        # 构造提示词
        if it == 1:
            current_prompt = prompt
        elif parse_error_hint:
            current_prompt = parse_error_hint
            parse_error_hint = None
        else:
            current_prompt = "这是执行上一步操作后的新截图，请继续执行下一个未完成的步骤，或调用 finished() 宣告全部完成。"

        try:
            response = client.chat_with_image(
                prompt=current_prompt,
                image=str(shot_path),
                model=VISION_MODEL,
                temperature=0.2,
                session_id=session_id,
            )
        except Exception as e:
            logger.error("❌ 调用多模态模型失败: %s", e)
            time.sleep(2)
            continue

        logger.info("💬 模型动作回复:\n%s", response.strip()[:400])

        # 解析 + 执行
        result = execute_action(
            response, phys_w, phys_h, logic_w, logic_h,
            step_index=0, iter_index=it,
        )

        # 画标记截图
        try:
            parsed = parse_action_to_structure_output(
                text=response,
                factor=1000,
                origin_resized_height=phys_h,
                origin_resized_width=phys_w,
                model_type="doubao",
            )
            mark_path = SCREENSHOT_DIR / f"fulltask_iter{it:02d}_mark.png"
            draw_action_box_on_image(
                img=img, parsed_action=parsed,
                w_phys=phys_w, h_phys=phys_h, save_path=str(mark_path),
            )
        except Exception:
            pass

        if result == "FINISHED":
            logger.info("✅ 模型宣告全部步骤完成！")
            return True

        if result == "PARSE_ERROR":
            logger.info("⏳ 解析错误，继续重试")
            time.sleep(ACTION_PAUSE)
            parse_error_hint = "你的上一个回复格式无法解析，请重新输出合规的 Action（函数调用格式）。"
            continue

        time.sleep(ACTION_PAUSE)

    logger.warning("⚠️ 自主执行达到最大循环次数 %d，强制结束", MAX_SUB_ITERATIONS * len(steps))
    return False


def run_autonomous_mode(client: ZhipuAI, sample: str = "T2") -> None:
    """自主模式：将所有步骤一次性展示给模型，由其自行判断进度和完成。

    不再拆成独立的 execute_step 依次执行，而是把完整任务计划放在初始提示词里，
    由模型自己决定什么时候完成一个步骤、什么时候推进到下一步。
    """
    logger.info("=" * 60)
    logger.info("🤖 自主模式 | 预存数据: %s", sample)
    raw = T1 if sample == "T1" else T2
    steps = parse_steps(raw)
    logger.info("📋 原始步骤 %d 步:", len(steps))
    _print_steps(steps)

    steps = summarize_steps(client, steps)
    logger.info("📋 汇总后步骤 %d 步:", len(steps))
    _print_steps(steps)

    execute_full_task(client, steps)
    logger.info("🎉 自主模式执行结束")


def run_test_mode(client: ZhipuAI, sample: str = "T2") -> None:
    """测试模式：使用 prompts/results_test_prompt.py 中预存的步骤。

    预存数据 T1/T2 是"分段处理后汇总"的产物，Index 会有重复（例如 T2 末尾的 Index: 1），
    所以也会走一遍 LLM 汇总（summarize_steps）流程。
    """
    logger.info("=" * 60)
    logger.info("🧪 测试模式 | 预存数据: %s", sample)
    raw = T1 if sample == "T1" else T2
    steps = parse_steps(raw)
    logger.info("📋 原始步骤 %d 步（Index 可能重复/错乱）:", len(steps))
    _print_steps(steps)

    # ── 走 LLM 汇总：重新编号 + 去重 + 排序 ──
    steps = summarize_steps(client, steps)
    logger.info("📋 汇总后步骤 %d 步:", len(steps))
    _print_steps(steps)

    for step in steps:
        execute_step(client, step)
    logger.info("🎉 测试模式执行结束")


def run_production_mode(client: ZhipuAI, video_path: str) -> None:
    """生产模式：教学视频 → 步骤 → 自动化执行。"""
    logger.info("=" * 60)
    logger.info("🎬 生产模式 | 视频路径: %s", video_path)
    steps = video_to_steps(client, video_path)
    steps = summarize_steps(client, steps)
    _print_steps(steps)

    for step in steps:
        execute_step(client, step)
    logger.info("🎉 生产模式执行结束")


# ────────────────────────────────────────────────────────────
#  9. 主入口
# ────────────────────────────────────────────────────────────
def main() -> None:
    load_dotenv()
    logger.info("🚀 run.py 启动")

    parser = argparse.ArgumentParser(
        description="教学视频 → 操作步骤 → 自动化执行（参考 mac_parse_demo.py / provider/glm_video_demo.py）"
    )
    parser.add_argument(
        "--mode",
        choices=["test", "production", "autonomous"],
        default="test",
        help="运行模式：test=使用预存步骤；production=使用视频文件；autonomous=自主模式，模型自行判断进度",
    )
    parser.add_argument(
        "--sample",
        choices=["T1", "T2"],
        default="T2",
        help="测试模式下要使用的预存数据 (默认 T2)",
    )
    parser.add_argument(
        "--video",
        type=str,
        default=None,
        help="生产模式下的教学视频路径",
    )
    args = parser.parse_args()

    # pyautogui 安全设置
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.3

    # 初始化 LLM 客户端
    api_key = os.getenv("ZHIPUAI_API_KEY") or os.getenv("ZHIPU_API_KEY")
    if not api_key:
        logger.error("❌ 请设置环境变量 ZHIPUAI_API_KEY")
        sys.exit(1)
    client = ZhipuAI(api_key=api_key)
    logger.info("✅ 智谱 LLM 客户端初始化完成 (vision model=%s)", VISION_MODEL)

    try:
        if args.mode == "test":
            run_test_mode(client, args.sample)
        elif args.mode == "autonomous":
            run_autonomous_mode(client, args.sample)
        else:
            if not args.video:
                logger.error("❌ 生产模式需要 --video 参数")
                sys.exit(1)
            run_production_mode(client, args.video)
    except pyautogui.FailSafeException:
        logger.error("🛑 用户触发 FAILSAFE，已中止运行")
        sys.exit(2)
    except KeyboardInterrupt:
        logger.warning("⏹️ 用户中断 (Ctrl+C)")
        sys.exit(0)


if __name__ == "__main__":
    main()
