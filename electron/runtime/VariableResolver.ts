import { Parser } from 'expr-eval';
import type { FlowNode } from '../../types/flow.js';

const parser = new Parser();

function getPathValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let val: unknown = obj;
  for (const k of keys) {
    if (val && typeof val === 'object') {
      val = (val as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return val;
}

/**
 * 变量插值：递归遍历对象，替换 {{globalVars.xxx}} / {{outputs.xxx}} / {{xxx}}
 */
export function resolveVariableInterpolate<T>(obj: T, variablePool: Record<string, unknown>): T {
  if (typeof obj === 'string') {
    let result: string = obj;

    result = result.replace(/\\\{/g, '\u0000');
    result = result.replace(/\\\}/g, '\u0001');

    result = result.replace(/\{\{([\u4e00-\u9fa5\w.]+)\}\}/g, (_, path) => {
      const value = getPathValue(variablePool, path);
      return String(value ?? '');
    });

    result = result.replace(/\u0000/g, '{');
    result = result.replace(/\u0001/g, '}');

    return result as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveVariableInterpolate(item, variablePool)) as unknown as T;
  }

  if (obj && typeof obj === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = resolveVariableInterpolate(v, variablePool);
    }
    return res as T;
  }

  return obj;
}

/**
 * 条件表达式求值（expr-eval）
 * 变量访问统一前缀：globalVars.xxx / outputs.xxx
 */
export function evaluateExpression(exprStr: string, variablePool: Record<string, unknown>): boolean {
  try {
    const expr = parser.parse(exprStr);
    const result = expr.evaluate(variablePool as never);
    return Boolean(result);
  } catch (e) {
    console.warn('表达式解析失败', exprStr, e);
    return false;
  }
}

/**
 * 提取节点参数中所有引用的变量名（用于校验）
 */
export function extractReferencedVars(node: FlowNode): string[] {
  const vars = new Set<string>();
  const text = JSON.stringify(node.nodeParams) + JSON.stringify(node.nextNodes.map((n) => n.condition));
  const matches = text.match(/\{\{([\u4e00-\u9fa5\w.]+)\}\}/g) ?? [];
  for (const match of matches) {
    const path = match.slice(2, -2);
    const key = path.split('.')[0];
    if (key) vars.add(key);
  }
  return Array.from(vars);
}
