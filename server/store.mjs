import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { emptyWorkspace, initialTeacher, check } from './domain.mjs';

export const tokenHash = value => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export function openStore(filename = process.env.DATABASE_PATH || 'data/lab.sqlite') {
  const path = resolve(filename);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sql = new DatabaseSync(path);
  chmodSync(path, 0o600);
  sql.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS credentials (member_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_member ON sessions(member_id);
    CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  const store = {
    sql, path,
    read() { const row = sql.prepare('SELECT body FROM workspace WHERE id=1').get(); return row ? JSON.parse(row.body) : emptyWorkspace(); },
    write(db) { sql.prepare('INSERT INTO workspace(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(db)); },
    transaction(fn) {
      sql.exec('BEGIN IMMEDIATE');
      try { const result = fn(); sql.exec('COMMIT'); return result; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
    setPassword(memberId, hash) { sql.prepare('INSERT INTO credentials VALUES(?,?) ON CONFLICT(member_id) DO UPDATE SET password_hash=excluded.password_hash').run(memberId, hash); },
    revoke(memberId) { sql.prepare('DELETE FROM sessions WHERE member_id=?').run(memberId); },
    initialize(options) {
      const teacher = initialTeacher(options), hash = hashPassword(options.password);
      return store.transaction(() => {
        const db = store.read(); check(db.members.length === 0, '数据库已经初始化，拒绝覆盖现有账号', 409);
        db.members.push(teacher); store.write(db); store.setPassword(teacher.id, hash); return teacher;
      });
    },
    async backup(destination) {
      mkdirSync(dirname(resolve(destination)), { recursive: true, mode: 0o700 });
      await backup(sql, destination);
      chmodSync(destination, 0o600);
      const copy = new DatabaseSync(destination);
      try {
        copy.exec('PRAGMA journal_mode=DELETE');
        check(Object.values(copy.prepare('PRAGMA integrity_check').get())[0] === 'ok', '备份完整性检查失败', 500);
      }
      finally { copy.close(); }
      return destination;
    },
    close() { sql.close(); },
  };
  return store;
}
