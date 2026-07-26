declare module 'better-sqlite3' {
  class Database {
    constructor(path: string, options?: any);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(sql: string): void;
    close(): void;
  }

  interface Statement {
    run(...params: any[]): { changes: number; lastInsertRowid: number };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }

  export = Database;
}
