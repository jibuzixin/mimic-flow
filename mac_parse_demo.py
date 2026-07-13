from lib.ui_tars.action_parser import parse_action_to_structure_output, parsing_response_to_pyautogui_code
from PIL import Image, ImageDraw
import pyautogui

def capture_mac_screen(save_temp_path: str = "tmp_screen.png") -> tuple[Image.Image, int, int]:
    """Mac 截屏，返回图片 + 图片物理像素宽高"""
    screen_img = pyautogui.screenshot()
    screen_img = screen_img.convert("RGB")
    w_phys, h_phys = screen_img.size
    screen_img.save(save_temp_path)
    print(f"屏幕截图已保存至: {save_temp_path}，图片物理分辨率 W={w_phys}, H={h_phys}")
    return screen_img, w_phys, h_phys

def draw_action_box_on_image(img: Image.Image, parsed_action, w_phys: int, h_phys: int, save_path=None):
    """画图：使用图片物理像素，红点和截图匹配"""
    draw = ImageDraw.Draw(img)
    radius = 6
    line_width = 2
    color_point = "red"
    color_box = "blue"

    for act in parsed_action:
        inputs = act["action_inputs"]
        for box_key in ["start_box", "end_box"]:
            if box_key not in inputs:
                continue
            box_str = inputs[box_key]
            coords = eval(box_str)
            # 绘图用物理像素
            x1 = int(coords[0] * w_phys)
            y1 = int(coords[1] * h_phys)
            x2 = int(coords[2] * w_phys)
            y2 = int(coords[3] * h_phys)

            if x1 == x2 and y1 == y2:
                draw.ellipse(
                    (x1 - radius, y1 - radius, x1 + radius, y1 + radius),
                    fill=color_point, outline=color_point
                )
            else:
                draw.rectangle((x1, y1, x2, y2), outline=color_box, width=line_width)

    if save_path:
        img.save(save_path)
    return img

def save_pyautogui_script(code_str: str, out_file: str = "auto_action.py"):
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(code_str)
    print(f"\n✅ 自动化脚本已自动生成：{out_file}")

if __name__ == "__main__":
    response = "Thought: Click the button\nAction: click(point='<point>200 300</point>')"

    # 1. 截屏，拿到图片物理分辨率（只用于画图）
    temp_img_path = "tmp_screen.png"
    screen_image, phys_w, phys_h = capture_mac_screen(temp_img_path)

    # 2. 获取 macOS 逻辑屏幕尺寸（pyautogui 鼠标操作必须用这个）
    logic_w, logic_h = pyautogui.size()
    print(f"macOS 逻辑屏幕尺寸（鼠标坐标基准） W={logic_w}, H={logic_h}")

    # 3. 解析模型输出
    parsed_list = parse_action_to_structure_output(
        text=response,
        factor=1000,
        origin_resized_height=phys_h,
        origin_resized_width=phys_w,
        model_type="doubao"
    )
    print("===== 结构化解析结果 =====")
    for item in parsed_list:
        print(item)

    # 4. 生成鼠标脚本：传入逻辑尺寸，保证点击位置和红点一致
    py_exec_code = parsing_response_to_pyautogui_code(
        responses=parsed_list,
        image_height=logic_h,
        image_width=logic_w
    )
    print("\n===== PyAutoGUI 自动化执行代码 =====")
    print(py_exec_code)
    save_pyautogui_script(py_exec_code, "auto_action.py")

    # 5. 截图上画红点：传入物理尺寸，图片标记不变
    marked_save_path = "screen_with_mark.png"
    draw_action_box_on_image(
        img=screen_image,
        parsed_action=parsed_list,
        w_phys=phys_w,
        h_phys=phys_h,
        save_path=marked_save_path
    )
    print(f"\n带坐标标记截图已保存: {marked_save_path}")

    # 可选：直接执行点击
    exec(py_exec_code)