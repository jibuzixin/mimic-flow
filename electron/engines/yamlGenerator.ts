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

function resolveVarPath(pool: Record<string, unknown>, path: string): unknown {
  const directValue = getPathValue(pool, path);
  if (directValue !== undefined) return directValue;
  
  const globalVars = pool.globalVars as Record<string, unknown> | undefined;
  if (globalVars) {
    const val = getPathValue(globalVars, path);
    if (val !== undefined) return val;
  }
  
  const outputs = pool.outputs as Record<string, unknown> | undefined;
  if (outputs) {
    const val = getPathValue(outputs, path);
    if (val !== undefined) return val;
  }
  
  return undefined;
}

function interpolateString(str: string, pool: Record<string, unknown>): string {
  let result = str;

  result = result.replace(/\\\{/g, '\u0000');
  result = result.replace(/\\\}/g, '\u0001');

  result = result.replace(/\{\{([\u4e00-\u9fa5\w.]+)\}\}/g, (_, path) => {
    const value = resolveVarPath(pool, path);
    return String(value ?? '');
  });

  result = result.replace(/\u0000/g, '{');
  result = result.replace(/\u0001/g, '}');

  return result;
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

function generateImagesYaml(images: unknown[], indent: string): string[] {
  const lines: string[] = [];
  const imgList = Array.isArray(images) ? images.filter(
    (img): img is { name?: string; url?: string } => 
      img && typeof img === 'object' && (img as any).url
  ) : [];
  
  if (imgList.length === 0) return lines;
  
  lines.push(`${indent}images:`);
  imgList.forEach((img) => {
    const name = img.name || '图片';
    const url = img.url || '';
    lines.push(`${indent}  - name: ${yamlEscape(name)}`);
    lines.push(`${indent}    url: ${yamlEscape(url)}`);
  });
  return lines;
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
      const hasImages = Array.isArray(params.images) && params.images.length > 0;
      
      if (hasImages) {
        lines.push(`      - aiTap:`);
        lines.push(`          locate:`);
        lines.push(`            prompt: ${yamlEscape(target)}`);
        const imgLines = generateImagesYaml(params.images as unknown[], '            ');
        lines.push(...imgLines);
        if (params.convertHttpImage2Base64 !== undefined) {
          lines.push(`            convertHttpImage2Base64: ${params.convertHttpImage2Base64}`);
        }
        if (params.deepLocate !== undefined) lines.push(`          deepLocate: ${params.deepLocate}`);
        if (params.cacheable !== undefined) lines.push(`          cacheable: ${params.cacheable}`);
      } else {
        lines.push(`      - aiTap: ${yamlEscape(target)}`);
        if (params.deepLocate !== undefined) lines.push(`        deepLocate: ${params.deepLocate}`);
        if (params.cacheable !== undefined) lines.push(`        cacheable: ${params.cacheable}`);
      }
      
      if (params.fileChooserAccept) {
        const paths = String(params.fileChooserAccept)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (paths.length === 1) {
          lines.push(`        fileChooserAccept: ${yamlEscape(paths[0])}`);
        } else if (paths.length > 1) {
          lines.push(`        fileChooserAccept:`);
          paths.forEach((p) => lines.push(`          - ${yamlEscape(p)}`));
        }
      }
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
      const hasImages = Array.isArray(params.images) && params.images.length > 0;
      
      if (hasImages) {
        lines.push(`      - aiHover:`);
        lines.push(`          locate:`);
        lines.push(`            prompt: ${yamlEscape(target)}`);
        const imgLines = generateImagesYaml(params.images as unknown[], '            ');
        lines.push(...imgLines);
        if (params.convertHttpImage2Base64 !== undefined) {
          lines.push(`            convertHttpImage2Base64: ${params.convertHttpImage2Base64}`);
        }
        if (params.deepLocate !== undefined) lines.push(`          deepLocate: ${params.deepLocate}`);
      } else {
        lines.push(`      - aiHover: ${yamlEscape(target)}`);
        if (params.deepLocate !== undefined) lines.push(`        deepLocate: ${params.deepLocate}`);
      }
      break;
    }

    case 'midscene.input': {
      const target = String(params.target ?? '');
      const value = String(params.value ?? '');
      const hasImages = Array.isArray(params.images) && params.images.length > 0;
      
      if (hasImages) {
        lines.push(`      - aiInput:`);
        lines.push(`          locate:`);
        lines.push(`            prompt: ${yamlEscape(target)}`);
        const imgLines = generateImagesYaml(params.images as unknown[], '            ');
        lines.push(...imgLines);
        if (params.convertHttpImage2Base64 !== undefined) {
          lines.push(`            convertHttpImage2Base64: ${params.convertHttpImage2Base64}`);
        }
        if (params.deepLocate !== undefined) lines.push(`          deepLocate: ${params.deepLocate}`);
      } else {
        lines.push(`      - aiInput: ${yamlEscape(target)}`);
        if (params.deepLocate !== undefined) lines.push(`        deepLocate: ${params.deepLocate}`);
      }
      lines.push(`        value: ${yamlEscape(value)}`);
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
      const hasImages = Array.isArray(params.images) && params.images.length > 0;
      
      if (hasImages) {
        lines.push(`      - aiQuery:`);
        lines.push(`          prompt: ${yamlEscape(prompt)}`);
        const imgLines = generateImagesYaml(params.images as unknown[], '        ');
        lines.push(...imgLines);
        if (params.convertHttpImage2Base64 !== undefined) {
          lines.push(`          convertHttpImage2Base64: ${params.convertHttpImage2Base64}`);
        }
        lines.push(`          name: ${yamlEscape(String(name))}`);
      } else {
        lines.push(`      - aiQuery: ${yamlEscape(prompt)}`);
        lines.push(`        name: ${yamlEscape(String(name))}`);
      }
      break;
    }

    case 'midscene.assert': {
      const prompt = String(params.prompt ?? '');
      const hasImages = Array.isArray(params.images) && params.images.length > 0;
      
      if (hasImages) {
        lines.push(`      - aiAssert:`);
        lines.push(`          prompt: ${yamlEscape(prompt)}`);
        const imgLines = generateImagesYaml(params.images as unknown[], '        ');
        lines.push(...imgLines);
        if (params.convertHttpImage2Base64 !== undefined) {
          lines.push(`          convertHttpImage2Base64: ${params.convertHttpImage2Base64}`);
        }
        if (params.errorMessage) lines.push(`          errorMessage: ${yamlEscape(String(params.errorMessage))}`);
        if (params.outputVar) lines.push(`          name: ${yamlEscape(String(params.outputVar))}`);
      } else {
        lines.push(`      - aiAssert: ${yamlEscape(prompt)}`);
        if (params.errorMessage) lines.push(`        errorMessage: ${yamlEscape(String(params.errorMessage))}`);
        if (params.outputVar) lines.push(`        name: ${yamlEscape(String(params.outputVar))}`);
      }
      break;
    }

    case 'midscene.boolean': {
      const prompt = String(params.prompt ?? '');
      const hasImages = Array.isArray(params.images) && params.images.length > 0;
      
      if (hasImages) {
        lines.push(`      - aiBoolean:`);
        lines.push(`          prompt: ${yamlEscape(prompt)}`);
        const imgLines = generateImagesYaml(params.images as unknown[], '        ');
        lines.push(...imgLines);
        if (params.convertHttpImage2Base64 !== undefined) {
          lines.push(`          convertHttpImage2Base64: ${params.convertHttpImage2Base64}`);
        }
        if (params.outputVar) lines.push(`          name: ${yamlEscape(String(params.outputVar))}`);
      } else {
        lines.push(`      - aiBoolean: ${yamlEscape(prompt)}`);
        if (params.outputVar) lines.push(`        name: ${yamlEscape(String(params.outputVar))}`);
      }
      break;
    }

    case 'midscene.waitFor': {
      const prompt = String(params.prompt ?? '');
      if (prompt) {
        lines.push(`      - aiWaitFor: ${yamlEscape(prompt)}`);
      } else {
        lines.push(`      - aiWaitFor: 等待页面稳定`);
      }
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
  let yaml = 'computer:\n';
  if (options?.displayId) {
    yaml += `  displayId: ${options.displayId}\n`;
  }
  yaml += '\n';
  yaml += 'tasks:\n';

  for (const node of nodes) {
    const params = interpolateParams(node.nodeParams ?? {}, variablePool);
    const nodeFlowLines = buildTaskFlow(node, params);
    
    yaml += `  - name: ${node.nodeName || node.nodeType}\n`;
    yaml += `    flow:\n`;
    yaml += nodeFlowLines.join('\n') + '\n';
  }

  return yaml;
}

export { interpolateParams, interpolateString, PARSER_UNAVAILABLE };
