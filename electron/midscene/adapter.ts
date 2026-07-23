import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import type { MidsceneSegmentTask, MidsceneSegmentResult, MidsceneRawLog } from '../../types/flow.js';
import { getLogger } from '../logger.js';

export class MidsceneAdapter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async runTask(task: MidsceneSegmentTask, signal: AbortSignal): Promise<MidsceneSegmentResult> {
    const log = getLogger();
    const rawLogs: MidsceneRawLog[] = [];
    const addLog = (type: MidsceneRawLog['type'], content: string) => {
      log.info(`[Midscene] ${type}: ${content}`);
      rawLogs.push({ type, content });
    };

    try {
      if (signal.aborted) {
        return this.makeResult(false, 'ABORTED', '任务已取消', rawLogs);
      }

      // 复用或启动浏览器
      if (!this.browser || !this.page || this.page.isClosed()) {
        addLog('info', '启动 Playwright Chromium 浏览器');
        this.browser = await chromium.launch({ headless: false });
        this.context = await this.browser.newContext({
          viewport: task.deviceConfig.viewport,
          userAgent: task.deviceConfig.userAgent,
        });
        this.page = await this.context.newPage();
      }

      const page = this.page;
      const agent = new PlaywrightAgent(page, {
        modelConfig: {
          MIDSCENE_MODEL_NAME: task.modelConfig.modelName,
          MIDSCENE_MODEL_BASE_URL: task.modelConfig.baseUrl,
          MIDSCENE_MODEL_API_KEY: task.modelConfig.apiKey,
        },
      });

      addLog('plan', `执行计划：${task.actions.map((a) => a.nodeType).join(' → ')}`);

      const extracted: Record<string, { nodeId: string; value: unknown }> = {};

      for (const action of task.actions) {
        if (signal.aborted) {
          return this.makeResult(false, 'ABORTED', '任务执行中被取消', rawLogs);
        }

        const params = action.params;
        addLog('action', `${action.nodeType}: ${JSON.stringify(params)}`);

        switch (action.nodeType) {
          case 'navigate': {
            const url = (params as { url: string }).url;
            await page.goto(url, { waitUntil: 'networkidle' });
            addLog('info', `页面导航完成：${url}`);
            break;
          }
          case 'aiTap': {
            const locate = (params as { locate: string }).locate;
            await agent.aiTap(locate);
            addLog('info', `点击完成：${locate}`);
            break;
          }
          case 'aiInput': {
            const { locate, text } = params as { locate: string; text: string };
            await agent.aiInput(locate, { value: text });
            addLog('info', `输入完成：${locate} → ${text}`);
            break;
          }
          case 'aiQuery': {
            const { dataDemand, schemaDesc } = params as { dataDemand: string; schemaDesc?: string };
            const result = await agent.aiQuery(dataDemand);
            extracted[action.nodeId] = { nodeId: action.nodeId, value: result };
            addLog('info', `提取完成：${dataDemand}${schemaDesc ? ` (${schemaDesc})` : ''}`);
            break;
          }
          case 'aiAssert': {
            const assertion = (params as { assertion: string }).assertion;
            await agent.aiAssert(assertion);
            addLog('info', `断言通过：${assertion}`);
            break;
          }
          case 'sleep': {
            const duration = (params as { duration: number }).duration ?? 1000;
            await page.waitForTimeout(duration);
            addLog('info', `等待 ${duration}ms`);
            break;
          }
          default:
            addLog('error', `不支持的节点类型：${action.nodeType}`);
            return this.makeResult(false, 'UNSUPPORTED_NODE', `不支持的节点类型：${action.nodeType}`, rawLogs);
        }
      }

      const screenshot = await page.screenshot({ type: 'png', fullPage: false }).catch((err) => {
        log.warn('截图失败', { error: err instanceof Error ? err.message : String(err) });
        return undefined;
      });

      return {
        success: true,
        extracted,
        screenshots: screenshot ? [screenshot.toString('base64')] : [],
        rawLogs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('MidsceneAdapter runTask error', { error: message });
      addLog('error', message);
      return this.makeResult(false, 'EXECUTION_ERROR', message, rawLogs);
    }
  }

  async close() {
    const log = getLogger();
    try {
      await this.page?.close();
      await this.context?.close();
      await this.browser?.close();
    } catch (error) {
      log.warn('关闭浏览器失败', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }

  private makeResult(
    success: boolean,
    code: string,
    message: string,
    rawLogs: MidsceneRawLog[]
  ): MidsceneSegmentResult {
    return {
      success,
      error: { code, message },
      extracted: {},
      screenshots: [],
      rawLogs,
    };
  }
}
