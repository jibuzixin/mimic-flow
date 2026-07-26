import initSqlJs, { Database } from 'sql.js';
import { app } from 'electron';
import { join, basename, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type {
  ExecutionRecord,
  ExecutionDetail,
  ExecutionListQuery,
  ExecutionListResult,
  LogEntry,
  DashboardStats,
} from '../../types/execution.js';

const DEFAULT_LOG_DIR = 'executions';
const DB_FILENAME = 'executions.db';

class ExecutionRecordService {
  private db: Database | null = null;
  private baseDir: string = '';
  private dbPath: string = '';

  async init(customDir?: string) {
    let baseDir = customDir;
    if (!baseDir) {
      const userDataDir = join(app.getPath('userData'), DEFAULT_LOG_DIR);
      try {
        if (!existsSync(userDataDir)) {
          mkdirSync(userDataDir, { recursive: true });
        }
        const testFile = join(userDataDir, '.write_test');
        writeFileSync(testFile, 'test');
        unlinkSync(testFile);
        baseDir = userDataDir;
      } catch (e: any) {
        console.log('[ExecutionRecordService] userData dir not writable:', e?.message);
        baseDir = join(process.cwd(), '.data', DEFAULT_LOG_DIR);
      }
    }
    this.baseDir = baseDir;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }

    this.dbPath = join(this.baseDir, DB_FILENAME);
    console.log('[ExecutionRecordService] dbPath:', this.dbPath);
    
    let wasmPath = join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
    if (!existsSync(wasmPath)) {
      wasmPath = join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/sql.js/dist/sql-wasm.wasm');
    }
    console.log('[ExecutionRecordService] wasmPath:', wasmPath);
    
    const SQL = await initSqlJs({
      locateFile: (file: string) => {
        if (file === 'sql-wasm.wasm') {
          return wasmPath;
        }
        return file;
      },
    });
    
    console.log('[ExecutionRecordService] sql.js initialized');
    
    if (existsSync(this.dbPath)) {
      console.log('[ExecutionRecordService] loading existing db');
      const fileBuffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      console.log('[ExecutionRecordService] creating new db');
      this.db = new SQL.Database();
    }
    
    console.log('[ExecutionRecordService] creating tables');
    this.createTables();
    console.log('[ExecutionRecordService] saving db');
    this.saveDb();
    console.log('[ExecutionRecordService] init complete');
    
    this.migrateOldStructureIfNeeded();
  }
  
  private migrateOldStructureIfNeeded() {
    if (!this.db) return;
    
    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM executions');
      stmt.bind([]);
      let total = 0;
      if (stmt.step()) {
        const row = stmt.getAsObject() as any;
        total = row?.count || 0;
      }
      stmt.free();
      
      if (total === 0) return;
      
      const checkStmt = this.db.prepare('SELECT directory FROM executions LIMIT 1');
      checkStmt.bind([]);
      let sampleDir = '';
      if (checkStmt.step()) {
        const row = checkStmt.getAsObject() as any;
        sampleDir = row?.directory || '';
      }
      checkStmt.free();
      
      const parts = sampleDir.split('/');
      if (parts.length >= 3) return;
      
      console.log('[ExecutionRecordService] Migrating old directory structure...');
      this.migrateOldStructure();
    } catch (e) {
      console.error('[ExecutionRecordService] Migration check failed:', e);
    }
  }
  
  private migrateOldStructure() {
    if (!this.db) return;
    
    try {
      const allStmt = this.db.prepare('SELECT * FROM executions ORDER BY start_time ASC');
      allStmt.bind([]);
      
      const allRecords: any[] = [];
      while (allStmt.step()) {
        allRecords.push(allStmt.getAsObject());
      }
      allStmt.free();
      
      let migrated = 0;
      for (const row of allRecords) {
        try {
          const oldRelativeDir = row.directory;
          const oldFullDir = join(this.baseDir, oldRelativeDir);
          
          if (!existsSync(oldFullDir)) continue;
          
          const startTime = row.start_time;
          const workflowName = row.workflow_name;
          const dateStr = new Date(startTime).toISOString().slice(0, 10);
          const timeStr = new Date(startTime).toISOString().replace(/[:T]/g, '-').slice(11, 19);
          const safeName = workflowName.replace(/[<>:"/\\|?*\s]/g, '_').slice(0, 50);
          
          const oldDirParts = oldRelativeDir.split('/');
          const oldDirName = oldDirParts[oldDirParts.length - 1];
          const idMatch = oldDirName.match(/_([a-f0-9]{8})$/);
          const shortId = idMatch ? idMatch[1] : uuidv4().slice(0, 8);
          
          const newDirName = `${timeStr}_${shortId}`;
          const newRelativeDir = join(dateStr, safeName, newDirName);
          const newFullDir = join(this.baseDir, newRelativeDir);
          
          if (oldFullDir === newFullDir) continue;
          
          if (existsSync(newFullDir)) continue;
          
          mkdirSync(dirname(newFullDir), { recursive: true });
          
          const oldMidsceneDir = join(oldFullDir, 'midscene-report');
          const newEngineDir = join(newFullDir, 'engine');
          
          const entries = readdirSync(oldFullDir);
          for (const entry of entries) {
            const srcPath = join(oldFullDir, entry);
            const destPath = join(newFullDir, entry);
            const stat = statSync(srcPath);
            
            if (entry === 'midscene-report') {
              const newMidsceneDir = join(newEngineDir, 'midscene');
              this.copyDir(srcPath, newMidsceneDir);
            } else if (stat.isDirectory()) {
              this.copyDir(srcPath, destPath);
            } else {
              copyFileSync(srcPath, destPath);
            }
          }
          
          const metaRecord: ExecutionRecord = {
            id: row.id,
            workflowId: row.workflow_id,
            workflowName: row.workflow_name,
            status: row.status,
            startTime: row.start_time,
            endTime: row.end_time,
            duration: row.duration,
            directory: newRelativeDir,
            nodeTotal: row.node_total || 0,
            nodeSuccess: row.node_success || 0,
            nodeFailed: row.node_failed || 0,
            tokenInput: row.token_input || 0,
            tokenOutput: row.token_output || 0,
            tokenTotal: row.token_total || 0,
            cost: row.cost || 0,
            hasMidsceneReport: row.has_midscene_report === 1,
          };
          
          const metaPath = join(newFullDir, 'meta.json');
          writeFileSync(metaPath, JSON.stringify(metaRecord, null, 2), 'utf-8');
          
          this.db.run(
            'UPDATE executions SET directory = ? WHERE id = ?',
            [newRelativeDir, row.id],
          );
          
          this.removeDir(oldFullDir);
          migrated++;
        } catch (e) {
          console.error('[ExecutionRecordService] Failed to migrate record:', row?.id, e);
        }
      }
      
      this.saveDb();
      this.cleanupEmptyOldDirs();
      console.log(`[ExecutionRecordService] Migrated ${migrated} records to new structure`);
    } catch (e) {
      console.error('[ExecutionRecordService] Migration failed:', e);
    }
  }
  
  private cleanupEmptyOldDirs() {
    try {
      if (!existsSync(this.baseDir)) return;
      const dateDirs = readdirSync(this.baseDir).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f));
      for (const dateDir of dateDirs) {
        const datePath = join(this.baseDir, dateDir);
        const stat = statSync(datePath);
        if (!stat.isDirectory()) continue;
        
        const entries = readdirSync(datePath);
        for (const entry of entries) {
          const entryPath = join(datePath, entry);
          const entryStat = statSync(entryPath);
          if (!entryStat.isDirectory()) continue;
          
          const subEntries = readdirSync(entryPath);
          if (subEntries.length === 0) {
            rmdirSync(entryPath);
          }
        }
        
        const remaining = readdirSync(datePath);
        if (remaining.length === 0) {
          rmdirSync(datePath);
        }
      }
    } catch (e) {
      console.warn('[ExecutionRecordService] Cleanup empty dirs failed:', e);
    }
  }

  private saveDb() {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  private createTables() {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        directory TEXT NOT NULL,
        node_total INTEGER DEFAULT 0,
        node_success INTEGER DEFAULT 0,
        node_failed INTEGER DEFAULT 0,
        token_input INTEGER DEFAULT 0,
        token_output INTEGER DEFAULT 0,
        token_total INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        has_midscene_report INTEGER DEFAULT 0
      );
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_executions_start_time ON executions(start_time)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions(workflow_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status)`);
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  async setBaseDir(dir: string) {
    if (this.db) {
      this.saveDb();
      this.db.close();
      this.db = null;
    }
    this.baseDir = dir;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
    await this.init(dir);
  }

  createExecutionDir(workflowName: string, startTime: number): string {
    const dateStr = new Date(startTime).toISOString().slice(0, 10);
    const timeStr = new Date(startTime).toISOString().replace(/[:T]/g, '-').slice(11, 19);
    const safeName = workflowName.replace(/[<>:"/\\|?*\s]/g, '_').slice(0, 50);
    const dirName = `${timeStr}_${uuidv4().slice(0, 8)}`;
    const fullPath = join(this.baseDir, dateStr, safeName, dirName);
    mkdirSync(fullPath, { recursive: true });
    return fullPath;
  }

  saveExecution(
    record: Partial<ExecutionRecord> & { workflowId: string; workflowName: string; status: ExecutionRecord['status']; startTime: number; endTime: number; duration: number },
    logs: LogEntry[],
    midsceneReportDir?: string,
  ): ExecutionRecord {
    if (!this.db) throw new Error('Database not initialized');

    const id = record.id || uuidv4();
    const startTime = record.startTime || Date.now();
    let directory = record.directory;

    if (!directory) {
      directory = this.createExecutionDir(record.workflowName, startTime);
    }

    const logsPath = join(directory, 'logs.jsonl');
    const logLines = logs.map((l) => JSON.stringify(l)).join('\n');
    writeFileSync(logsPath, logLines);

    let hasMidsceneReport = false;
    if (midsceneReportDir && existsSync(midsceneReportDir)) {
      const targetDir = join(directory, 'engine', 'midscene');
      const stat = statSync(midsceneReportDir);
      if (stat.isDirectory()) {
        this.copyDir(midsceneReportDir, targetDir);
      } else {
        const sourceDir = dirname(midsceneReportDir);
        this.copyDir(sourceDir, targetDir);
      }
      hasMidsceneReport = true;
    }

    const executionRecord: ExecutionRecord = {
      id,
      workflowId: record.workflowId,
      workflowName: record.workflowName,
      status: record.status,
      startTime,
      endTime: record.endTime || Date.now(),
      duration: record.duration,
      directory: directory.replace(this.baseDir + '/', ''),
      nodeTotal: record.nodeTotal || 0,
      nodeSuccess: record.nodeSuccess || 0,
      nodeFailed: record.nodeFailed || 0,
      tokenInput: record.tokenInput || 0,
      tokenOutput: record.tokenOutput || 0,
      tokenTotal: record.tokenTotal || 0,
      cost: record.cost || 0,
      hasMidsceneReport,
    };

    const metaPath = join(directory, 'meta.json');
    writeFileSync(metaPath, JSON.stringify(executionRecord, null, 2), 'utf-8');

    this.db.run(
      `INSERT OR REPLACE INTO executions (
        id, workflow_id, workflow_name, status, start_time, end_time, duration,
        directory, node_total, node_success, node_failed,
        token_input, token_output, token_total, cost, has_midscene_report
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        executionRecord.id,
        executionRecord.workflowId,
        executionRecord.workflowName,
        executionRecord.status,
        executionRecord.startTime,
        executionRecord.endTime,
        executionRecord.duration,
        executionRecord.directory,
        executionRecord.nodeTotal,
        executionRecord.nodeSuccess,
        executionRecord.nodeFailed,
        executionRecord.tokenInput,
        executionRecord.tokenOutput,
        executionRecord.tokenTotal,
        executionRecord.cost,
        executionRecord.hasMidsceneReport ? 1 : 0,
      ],
    );

    this.saveDb();
    return executionRecord;
  }

  private copyDir(src: string, dest: string) {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
    }
    const entries = readdirSync(src);
    for (const entry of entries) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      const stat = statSync(srcPath);
      if (stat.isDirectory()) {
        this.copyDir(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }

  getExecution(id: string): ExecutionDetail | null {
    if (!this.db) return null;

    const stmt = this.db.prepare('SELECT * FROM executions WHERE id = ?');
    stmt.bind([id]);
    let row: any = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    
    if (!row || Object.keys(row).length === 0) return null;

    const record = this.rowToRecord(row);
    const fullDir = join(this.baseDir, record.directory);
    const logsPath = join(fullDir, 'logs.jsonl');

    let logs: LogEntry[] = [];
    if (existsSync(logsPath)) {
      const content = readFileSync(logsPath, 'utf-8');
      logs = content
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l) as LogEntry;
          } catch {
            return null;
          }
        })
        .filter((l): l is LogEntry => l !== null);
    }

    const midsceneReportDir = join(fullDir, 'engine', 'midscene');
    let midsceneReportPath: string | undefined;
    let midsceneReportUrl: string | undefined;
    const hasMidsceneReport = existsSync(midsceneReportDir) && readdirSync(midsceneReportDir).some((f) => f.endsWith('.html'));
    if (hasMidsceneReport) {
      const files = readdirSync(midsceneReportDir);
      let htmlFile: string | undefined = files.find((f) => f === 'workflow-report.html');
      if (!htmlFile) {
        htmlFile = files.find((f) => f.endsWith('.html'));
      }
      if (htmlFile) {
        midsceneReportPath = join(midsceneReportDir, htmlFile);
        const relativePath = join(record.directory, 'engine', 'midscene', htmlFile);
        midsceneReportUrl = `midscene-report://local/${relativePath.split(sep).map(encodeURIComponent).join('/')}`;
      }
    }

    return {
      ...record,
      hasMidsceneReport,
      logs,
      midsceneReportPath,
      midsceneReportUrl,
    };
  }

  listExecutions(query: ExecutionListQuery = {}): ExecutionListResult {
    if (!this.db) return { items: [], total: 0, page: 1, pageSize: 20 };

    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const conditions: string[] = [];
    const params: any[] = [];

    if (query.workflowId) {
      conditions.push('workflow_id = ?');
      params.push(query.workflowId);
    }
    if (query.status) {
      conditions.push('status = ?');
      params.push(query.status);
    }
    if (query.startDate) {
      conditions.push('start_time >= ?');
      params.push(query.startDate);
    }
    if (query.endDate) {
      conditions.push('start_time <= ?');
      params.push(query.endDate);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM executions ${whereClause}`);
    countStmt.bind(params);
    let total = 0;
    if (countStmt.step()) {
      const countRow = countStmt.getAsObject() as any;
      total = countRow?.count || 0;
    }
    countStmt.free();

    const stmt = this.db.prepare(
      `SELECT * FROM executions ${whereClause} ORDER BY start_time DESC LIMIT ? OFFSET ?`,
    );
    stmt.bind([...params, pageSize, (page - 1) * pageSize]);
    
    const items: ExecutionRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      items.push(this.rowToRecord(row));
    }
    stmt.free();

    return { items, total, page, pageSize };
  }

  private rowToRecord(row: any): ExecutionRecord {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      status: row.status as ExecutionRecord['status'],
      startTime: row.start_time,
      endTime: row.end_time,
      duration: row.duration,
      directory: row.directory,
      nodeTotal: row.node_total,
      nodeSuccess: row.node_success,
      nodeFailed: row.node_failed,
      tokenInput: row.token_input,
      tokenOutput: row.token_output,
      tokenTotal: row.token_total,
      cost: row.cost,
      hasMidsceneReport: row.has_midscene_report === 1,
    };
  }

  deleteExecution(id: string): boolean {
    if (!this.db) return false;

    const stmt = this.db.prepare('SELECT directory FROM executions WHERE id = ?');
    stmt.bind([id]);
    let row: any = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    
    if (!row || Object.keys(row).length === 0) return false;

    const fullDir = join(this.baseDir, row.directory);
    this.removeDir(fullDir);

    this.db.run('DELETE FROM executions WHERE id = ?', [id]);
    this.saveDb();
    return true;
  }

  private removeDir(dir: string) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        this.removeDir(fullPath);
      } else {
        unlinkSync(fullPath);
      }
    }
    rmdirSync(dir);
  }

  clearOldExecutions(days: number): number {
    if (!this.db) return 0;

    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
    
    const stmt = this.db.prepare('SELECT directory FROM executions WHERE start_time < ?');
    stmt.bind([cutoffTime]);
    
    const dirs: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      dirs.push(row.directory);
    }
    stmt.free();

    for (const dir of dirs) {
      const fullDir = join(this.baseDir, dir);
      this.removeDir(fullDir);
    }

    const delStmt = this.db.prepare('DELETE FROM executions WHERE start_time < ?');
    delStmt.bind([cutoffTime]);
    delStmt.step();
    delStmt.free();
    
    const countStmt = this.db.prepare('SELECT changes() as count');
    countStmt.bind([]);
    let count = 0;
    if (countStmt.step()) {
      const countRow = countStmt.getAsObject() as any;
      count = countRow?.count || 0;
    }
    countStmt.free();

    this.saveDb();
    return count;
  }

  getDashboardStats(): DashboardStats {
    if (!this.db) {
      return {
        totalExecutions: 0,
        successCount: 0,
        failedCount: 0,
        successRate: 0,
        totalTokenInput: 0,
        totalTokenOutput: 0,
        totalToken: 0,
        totalCost: 0,
        workflowCount: 0,
        recentExecutions: [],
        executionTrend: [],
      };
    }

    const totalStmt = this.db.prepare(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(token_input) as token_input,
        SUM(token_output) as token_output,
        SUM(token_total) as token_total,
        SUM(cost) as total_cost,
        COUNT(DISTINCT workflow_id) as workflow_count
      FROM executions`,
    );
    totalStmt.bind([]);
    let totalRow: any = null;
    if (totalStmt.step()) {
      totalRow = totalStmt.getAsObject();
    }
    totalStmt.free();

    const recentExecutions = this.listExecutions({ page: 1, pageSize: 10 }).items;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const trendStmt = this.db.prepare(
      `SELECT 
        DATE(start_time/1000, 'unixepoch', 'localtime') as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM executions 
      WHERE start_time >= ?
      GROUP BY DATE(start_time/1000, 'unixepoch', 'localtime')
      ORDER BY date ASC`,
    );
    trendStmt.bind([sevenDaysAgo]);
    
    const executionTrend: Array<{ date: string; total: number; success: number; failed: number }> = [];
    while (trendStmt.step()) {
      const row = trendStmt.getAsObject() as any;
      executionTrend.push({
        date: row.date,
        total: row.total || 0,
        success: row.success || 0,
        failed: row.failed || 0,
      });
    }
    trendStmt.free();

    const total = totalRow?.total || 0;
    const successCount = totalRow?.success_count || 0;

    return {
      totalExecutions: total,
      successCount,
      failedCount: totalRow?.failed_count || 0,
      successRate: total > 0 ? Math.round((successCount / total) * 100) / 100 : 0,
      totalTokenInput: totalRow?.token_input || 0,
      totalTokenOutput: totalRow?.token_output || 0,
      totalToken: totalRow?.token_total || 0,
      totalCost: totalRow?.total_cost || 0,
      workflowCount: totalRow?.workflow_count || 0,
      recentExecutions,
      executionTrend,
    };
  }

  getMidsceneReportPath(id: string): string | null {
    const detail = this.getExecution(id);
    if (!detail) return null;
    return detail.midsceneReportPath || null;
  }

  close() {
    if (this.db) {
      this.saveDb();
      this.db.close();
      this.db = null;
    }
  }
}

let service: ExecutionRecordService | null = null;

export function getExecutionRecordService(): ExecutionRecordService {
  if (!service) {
    service = new ExecutionRecordService();
  }
  return service;
}
