import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function simplifyError(error: string): string {
  if (!error) return error;

  const rateLimitMatch = error.match(/429.*?(reached the set inference limit|model service has been paused|rate limit|限流|额度)/i);
  if (rateLimitMatch) {
    return '模型调用额度已用完，请在设置中调整模型或增加额度';
  }

  const authMatch = error.match(/(401|403|invalid.*api.*key|unauthorized|api.*key.*invalid)/i);
  if (authMatch) {
    return 'API Key 无效或已过期，请在设置中检查';
  }

  const networkMatch = error.match(/(network error|timeout|ECONNREFUSED|ENOTFOUND|无法连接|连接超时|网络错误)/i);
  if (networkMatch) {
    return '网络连接失败，请检查网络或模型地址配置';
  }

  const unsupportedModelMatch = error.match(/Unsupported midscene node type/i);
  if (unsupportedModelMatch) {
    return '节点类型不被支持，请检查节点配置';
  }

  const lines = error.split('\n');
  const firstLine = lines[0].trim();
  if (firstLine.length > 100) {
    return firstLine.slice(0, 100) + '...';
  }
  return firstLine;
}
