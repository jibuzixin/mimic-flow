const robot = require("robotjs");
const screenshot = require("screenshot-desktop");
const sharp = require("sharp");
const path = require("path");
const { cv, cvReady } = require("opencv-wasm");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取系统DPI缩放比例（统一处理 物理像素 ↔ 逻辑坐标）
 * @returns {number} scale
 */
function getScreenScaleFactor() {
  const platform = process.platform;
  // darwin = mac
  if (platform === "darwin") {
    // Mac Retina 默认2倍，绝大多数MacBook适用
    return 2.0;
  } else if (platform === "win32") {
    // Windows：如果你系统100%缩放填1，125%填1.25，150%填1.5
    // 注意：win下自动获取DPI比较复杂，成品软件建议做成配置项
    return 1.0;
  } else {
    // linux 一般1
    return 1.0;
  }
}

/**
 * 对标 pyautogui.locateCenterOnScreen
 * @param {string} templatePath 模板图片路径
 * @param {number} confidence 置信度 0~1
 * @param {number|null} displayId 指定显示器ID，null=主屏
 * @returns {{x:number,y:number}|null} 【逻辑坐标】直接给robotjs使用
 */
async function locateCenterOnScreen(templatePath, confidence = 0.7, displayId = null) {
  await cvReady;
  const scale = getScreenScaleFactor();

  // 读取模板
  const templateBuf = await sharp(templatePath).grayscale().raw().toBuffer();
  const templateMeta = await sharp(templatePath).metadata();

  // 截图：支持指定显示器
  const screenOpts = {};
  if (displayId !== null) {
    screenOpts.id = displayId;
  }
  const screenBuf = await screenshot(screenOpts);

  const screenProcessed = await sharp(screenBuf)
    .grayscale()
    .raw()
    .toBuffer();
  const screenMeta = await sharp(screenBuf).metadata();

  // OpenCV WASM 匹配
  const screenMat = new cv.Mat(screenMeta.height, screenMeta.width, cv.CV_8UC1);
  screenMat.data.set(new Uint8Array(screenProcessed));

  const templateMat = new cv.Mat(templateMeta.height, templateMeta.width, cv.CV_8UC1);
  templateMat.data.set(new Uint8Array(templateBuf));

  const resultMat = new cv.Mat();
  cv.matchTemplate(screenMat, templateMat, resultMat, cv.TM_CCOEFF_NORMED);

  const minMax = cv.minMaxLoc(resultMat);
  const maxVal = minMax.maxVal;
  const maxLoc = minMax.maxLoc;

  console.log(`匹配相似度: ${maxVal.toFixed(3)} 阈值:${confidence}`);

  let result = null;
  if (maxVal >= confidence) {
    // maxLoc = 物理像素位置
    const physX = maxLoc.x + templateMeta.width / 2;
    const physY = maxLoc.y + templateMeta.height / 2;
    // 转为逻辑坐标
    const logicX = physX / scale;
    const logicY = physY / scale;
    result = {
      x: Math.round(logicX),
      y: Math.round(logicY)
    };
  }

  // 释放WASM内存，防止内存泄漏（Electron长期运行至关重要！）
  screenMat.delete();
  templateMat.delete();
  resultMat.delete();
  return result;
}

/**
 * 查找图像并点击
 * @param {string} imgPath
 * @param {number} confidence
 * @param {number} clickTimes
 * @param {number} interval 点击间隔 ms
 * @param {number} moveDuration 移动耗时 ms
 * @param {"left"|"right"} btn
 * @param {number|null} displayId 显示器ID
 * @returns {boolean}
 */
async function findAndClick(
  imgPath,
  confidence = 0.7,
  clickTimes = 1,
  interval = 200,
  moveDuration = 300,
  btn = "left",
  displayId = null
) {
  const pos = await locateCenterOnScreen(imgPath, confidence, displayId);
  if (!pos) {
    console.log("❌ 未匹配到图像");
    return false;
  }
  console.log(`✅ 目标逻辑坐标 x:${pos.x}, y:${pos.y}`);

  robot.moveMouse(pos.x, pos.y);
  await sleep(moveDuration);

  const curMouse = robot.getMousePos();
  console.log(`鼠标当前位置：`, curMouse);

  const clickBtn = btn === "right" ? "right" : "left";
  for (let i = 0; i < clickTimes; i++) {
    robot.mouseClick(clickBtn);
    console.log(`执行第${i + 1}次${clickBtn}点击`);
    if (i !== clickTimes - 1) await sleep(interval);
  }
  return true;
}

/**
 * 循环等待出现再点击（复刻你Python逻辑）
 */
async function waitFindAndClick(
  imgPath,
  maxRetry = 20,
  waitMs = 600,
  confidence = 0.7,
  displayId = null
) {
  for (let i = 0; i < maxRetry; i++) {
    const ok = await findAndClick(imgPath, confidence, 1, 200, 300, "left", displayId);
    if (ok) return true;
    console.log(`第${i + 1}次检索失败，等待${waitMs}ms`);
    await sleep(waitMs);
  }
  console.log("达到最大重试次数，终止");
  return false;
}

/**
 * 获取所有显示器列表（用于多屏切换）
 */
async function getDisplays() {
  return await screenshot.listDisplays();
}

// ===================== Demo入口 =====================
(async function main() {
  const targetImg = path.join(__dirname, "lalala.png");
  console.log("模板图片路径：", targetImg);

  // 获取屏幕列表示例
  const displays = await getDisplays();
  console.log("显示器列表", displays);
//   指定副屏查找 
//   await waitFindAndClick(targetImg,20,600,0.7, displays[0].id)

  await waitFindAndClick(targetImg, 20, 600, 0.7);
})();
