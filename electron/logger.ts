import { app } from 'electron';
import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

const MAX_MEMORY_LOGS = 2000;

class Logger {
  private logDir: string;
  private logFile: string;
  private debugMode: boolean = true;
  private memoryLogs: LogEntry[] = [];

  constructor() {
    try {
      this.logDir = join(app.getPath('userData'), 'logs');
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }
      this.logFile = join(this.logDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
    } catch {
      this.logDir = '/tmp/mimic-flow-logs';
      this.logFile = join(this.logDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
      try {
        if (!existsSync(this.logDir)) {
          mkdirSync(this.logDir, { recursive: true });
        }
      } catch {
        // 忽略
      }
    }
    this.write('info', 'Logger initialized', { logDir: this.logDir });
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    const timestamp = new Date().toISOString();
    const entry: LogEntry = {
      timestamp,
      level,
      message,
      ...(meta ? { meta } : {}),
    };
    const line = JSON.stringify(entry) + '\n';

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    try {
      appendFileSync(this.logFile, line);
    } catch {
      // 日志文件写入失败时不影响主流程
    }

    this.memoryLogs.push(entry);
    if (this.memoryLogs.length > MAX_MEMORY_LOGS) {
      this.memoryLogs = this.memoryLogs.slice(-MAX_MEMORY_LOGS);
    }
  }

  debug(message: string, meta?: Record<string, unknown>) {
    if (this.debugMode) {
      this.write('debug', message, meta);
    }
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.write('error', message, meta);
  }

  setDebugMode(enabled: boolean) {
    this.debugMode = enabled;
  }

  getMemoryLogs(): LogEntry[] {
    return [...this.memoryLogs];
  }

  getLogDir(): string {
    return this.logDir;
  }

  listLogFiles(): Array<{ name: string; path: string; size: number; mtime: number }> {
    if (!existsSync(this.logDir)) return [];
    return readdirSync(this.logDir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => {
        const fullPath = join(this.logDir, name);
        const stats = statSync(fullPath);
        return { name, path: fullPath, size: stats.size, mtime: stats.mtime.getTime() };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  readLogFile(filePath: string, limit = 500, offset = 0): { entries: LogEntry[]; total: number } {
    if (!existsSync(filePath)) return { entries: [], total: 0 };
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    const total = lines.length;
    const entries: LogEntry[] = [];
    const start = Math.max(0, total - offset - limit);
    const end = Math.max(0, total - offset);
    for (let i = start; i < end; i++) {
      try {
        entries.push(JSON.parse(lines[i]) as LogEntry);
      } catch {
        // skip malformed lines
      }
    }
    return { entries, total };
  }
}

let logger: Logger | null = null;

export function getLogger(): Logger {
  if (!logger) {
    logger = new Logger();
  }
  return logger;
}
