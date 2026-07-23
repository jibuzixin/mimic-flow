import type { FlowNode } from '../../types/flow-v2.js';

const PARSER_UNAVAILABLE = 'expr-eval is not available in this context';

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

function interpolateString(str: string, pool: Record<string, unknown>): string {
  return str.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    const value = getPathValue(pool, path);
    return String(value ?? '');
  });
}

function interpolateParams(params: Record<string, unknown>, pool: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = interpolateString(value, pool);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string'
          ? interpolateString(item, pool)
          : typeof item === 'object' && item !== null
          ? interpolateParams(item as Record<string, unknown>, pool)
          : item
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = interpolateParams(value as Record<string, unknown>, pool);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function yamlEscape(str: string): string {
  if (/[:#\{\}\[\],&*?!|>'"`]/.test(str) || /^\s|\s$/.test(str)) {
    return JSON.stringify(str);
  }
  return str;
}

function buildTaskFlow(node: FlowNode, params: Record<string, unknown>): string[] {
  const lines: string[] = [];

  switch (node.nodeType) {
    case 'midscene.act': {
      const prompt = String(params.prompt ?? '');
      lines.push(`      - aiAct: ${yamlEscape(prompt)}`);
      if (params.deepThink !== undefined) lines.push(`        deepThink: ${params.deepThink}`);
      if (params.deepLocate !== undefined) lines.push(`        deepLocate: ${params.deepLocate}`);
      if (params.cacheable !== undefined) lines.push(`        cacheable: ${params.cacheable}`);
      break;
    }

    case 'midscene.tap': {
      const target = String(params.target ?? '');
      lines.push(`      - aiTap: ${yamlEscape(target)}`);
      if (params.deepLocate !== undefined) lines.push(`        deepLocate: ${params.deepLocate}`);
      break;
    }

    case 'midscene.doubleClick': {
      const target = String(params.target ?? '');
      lines.push(`      - aiAct: ${yamlEscape('双击 ' + target)}`);
      break;
    }

    case 'midscene.rightClick': {
      const target = String(params.target ?? '');
      lines.push(`      - aiAct: ${yamlEscape('右键点击 ' + target)}`);
      break;
    }

    case 'midscene.hover': {
      const target = String(params.target ?? '');
      lines.push(`      - aiHover: ${yamlEscape(target)}`);
      if (params.deepLocate !== undefined) lines.push(`        deepLocate: ${params.deepLocate}`);
      break;
    }

    case 'midscene.input': {
      const target = String(params.target ?? '');
      const value = String(params.value ?? '');
      lines.push(`      - aiInput: ${yamlEscape(target)}`);
      lines.push(`        value: ${yamlEscape(value)}`);
      if (params.deepLocate !== undefined) lines.push(`        deepLocate: ${params.deepLocate}`);
      if (params.mode) lines.push(`        mode: ${params.mode}`);
      break;
    }

    case 'midscene.clearInput': {
      const target = String(params.target ?? '');
      lines.push(`      - aiClearInput: ${yamlEscape(target)}`);
      break;
    }

    case 'midscene.keyboardPress': {
      const target = params.target ? String(params.target) : '';
      const keyName = String(params.keyName ?? '');
      if (target) {
        lines.push(`      - aiKeyboardPress: ${yamlEscape(target)}`);
        lines.push(`        keyName: ${yamlEscape(keyName)}`);
      } else {
        lines.push(`      - aiAct: ${yamlEscape('按 ' + keyName)}`);
      }
      break;
    }

    case 'midscene.scroll': {
      const target = params.target ? String(params.target) : '';
      if (target) {
        lines.push(`      - aiScroll: ${yamlEscape(target)}`);
      } else {
        lines.push(`      - aiScroll:`);
      }
      if (params.scrollType) lines.push(`        scrollType: ${params.scrollType}`);
      if (params.direction) lines.push(`        direction: ${params.direction}`);
      if (params.distance !== undefined) lines.push(`        distance: ${params.distance}`);
      break;
    }

    case 'midscene.query': {
      const prompt = String(params.prompt ?? '');
      const name = params.name || node.id;
      lines.push(`      - aiQuery: ${yamlEscape(prompt)}`);
      lines.push(`        name: ${yamlEscape(String(name))}`);
      break;
    }

    case 'midscene.assert': {
      const assertion = String(params.assertion ?? '');
      lines.push(`      - aiAssert: ${yamlEscape(assertion)}`);
      if (params.errorMessage) lines.push(`        errorMessage: ${yamlEscape(String(params.errorMessage))}`);
      if (params.name) lines.push(`        name: ${yamlEscape(String(params.name))}`);
      break;
    }

    case 'midscene.waitFor': {
      const condition = String(params.condition ?? '');
      lines.push(`      - aiWaitFor: ${yamlEscape(condition)}`);
      if (params.timeout !== undefined) lines.push(`        timeout: ${params.timeout}`);
      break;
    }

    case 'midscene.sleep': {
      const duration = params.duration ?? params.ms ?? 1000;
      lines.push(`      - sleep: ${duration}`);
      break;
    }

    default:
      throw new Error(`Unsupported midscene node type: ${node.nodeType}`);
  }

  return lines;
}

export function generateMidsceneYaml(
  nodes: FlowNode[],
  variablePool: Record<string, unknown>,
  options?: { displayId?: string },
): string {
  const tasks: string[] = [];

  for (const node of nodes) {
    const params = interpolateParams(node.nodeParams ?? {}, variablePool);
    const taskName = node.nodeName || node.id;
    const flowLines = buildTaskFlow(node, params);

    tasks.push(`  - name: ${yamlEscape(taskName)}`);
    tasks.push(`    flow:`);
    tasks.push(...flowLines);
  }

  let yaml = 'computer:\n';
  if (options?.displayId) {
    yaml += `  displayId: ${options.displayId}\n`;
  }
  yaml += '\n';
  yaml += 'tasks:\n';
  yaml += tasks.join('\n') + '\n';

  return yaml;
}

export { interpolateParams, interpolateString, PARSER_UNAVAILABLE };
