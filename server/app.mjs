import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { HttpError, check, mutate, workspaceFor, validatePassword } from './domain.mjs';
import { openStore, hashPassword, verifyPassword, tokenHash } from './store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const staticPaths = new Set(['/index.html', '/src/core.js', '/src/ui.js', '/src/features.js', '/src/competitions.js', '/src/app.js', '/src/styles.css']);
const writes = /^\/(?:members|assets|loans|leaves|competitions)(?:\/[A-Za-z0-9_-]+\/(?:update|status|active|maintenance|repair-complete|retire|review|issue|cancel|request-return|receive|archive))?$/;
const cookieName = 'lab_session';
const sessionLifetime = 12 * 60 * 60 * 1000;
const dummyHash = hashPassword(randomBytes(32).toString('hex'));
async function body(req) {
  check(req.headers['content-type']?.split(';')[0].trim() === 'application/json', '请求必须使用 JSON', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; check(size <= 64 * 1024, '请求内容过大', 413); chunks.push(chunk); }
  let value;
  try { value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw new HttpError(400, 'JSON 格式无效'); }
  check(value && typeof value === 'object' && !Array.isArray(value), '请求必须是 JSON 对象');
  return value;
}
function token(req) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || ''; }
export function createApp({ store = openStore(), publicOrigin = process.env.PUBLIC_ORIGIN || '', production = process.env.NODE_ENV === 'production', basePath = process.env.APP_BASE_PATH || '/' } = {}) {
  if (production) check(publicOrigin.startsWith('https://') && new URL(publicOrigin).origin === publicOrigin, '生产环境必须配置 HTTPS 的 PUBLIC_ORIGIN');
  check(/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath), 'APP_BASE_PATH 格式无效');
  const secure = publicOrigin.startsWith('https://');
  const sessionCookie = value => `${cookieName}=${value}; Path=${basePath}; HttpOnly; SameSite=Strict; Max-Age=${value ? sessionLifetime / 1000 : 0}${secure ? '; Secure' : ''}`;
  const authenticate = (req, db) => {
    const row = store.sql.prepare('SELECT member_id FROM sessions WHERE token_hash=? AND expires>?').get(tokenHash(token(req)), Date.now());
    const user = row && db.members.find(m => m.id === row.member_id && m.active);
    check(user, '登录已过期，请重新登录', 401); return user;
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const parsed = new URL(req.url, 'http://localhost'), path = parsed.pathname;
      if (!path.startsWith('/api/')) {
        check(['GET', 'HEAD'].includes(req.method), '请求方法不支持', 405);
        if (path === '/src/seed.js') {
          // 正式站点不分发演示账号及示例业务数据。
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(req.method === 'HEAD' ? '' : "'use strict';"); return;
        }
        const assetPath = path === '/' ? '/index.html' : path;
        check(staticPaths.has(assetPath), '文件不存在', 404);
        const bytes = await readFile(root + assetPath.slice(1));
        res.writeHead(200, { 'Content-Type': assetPath.endsWith('.css') ? 'text/css; charset=utf-8' : assetPath.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      const route = path.slice(4);
      if (route === '/health' && req.method === 'GET') { store.sql.prepare('SELECT 1').get(); send(200, { data: { ok: true } }); return; }
      check(['GET', 'POST'].includes(req.method), '请求方法不支持', 405);
      let data;
      if (req.method === 'POST') {
        check(req.headers['x-lab-request'] === '1', '请求校验失败，请刷新页面', 403);
        const expected = publicOrigin || `http://${req.headers.host}`;
        if (!publicOrigin) check(/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host || ''), '请配置 PUBLIC_ORIGIN 后访问服务器', 403);
        check(!req.headers.origin || req.headers.origin === expected, '不允许跨站写入', 403);
        check(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), '不允许跨站写入', 403);
        data = await body(req);
      }
      if (route === '/auth/login' && req.method === 'POST') {
        check(typeof data.username === 'string' && data.username.length <= 30 && typeof data.password === 'string' && data.password.length <= 64, '账号或密码格式无效');
        // 不信任 X-Forwarded-For；反向代理部署仍有按账号和服务端来源的限流。
        const keys = [`user:${data.username.toLowerCase()}`, `ip:${req.socket.remoteAddress}`];
        store.sql.prepare('DELETE FROM login_attempts WHERE expires<=?').run(Date.now());
        for (const key of keys) {
          const row = store.sql.prepare('SELECT count FROM login_attempts WHERE key=?').get(key);
          if (row?.count >= (key.startsWith('user:') ? 10 : 60)) { res.setHeader('Retry-After', '900'); throw new HttpError(429, '登录尝试过多，请 15 分钟后再试'); }
        }
        const db = store.read(), user = db.members.find(m => m.username === data.username && m.active);
        const credential = user && store.sql.prepare('SELECT password_hash FROM credentials WHERE member_id=?').get(user.id);
        const valid = verifyPassword(data.password, credential?.password_hash || dummyHash);
        if (!user || !credential || !valid) {
          for (const key of keys) store.sql.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, Date.now() + 900000);
          throw new HttpError(401, '账号或密码不正确，或账号已停用');
        }
        store.sql.prepare('DELETE FROM login_attempts WHERE key=?').run(keys[0]);
        const secret = randomBytes(32).toString('hex');
        store.transaction(() => {
          store.sql.prepare('DELETE FROM sessions WHERE expires<=? OR token_hash=?').run(Date.now(), tokenHash(token(req)));
          store.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(secret), user.id, Date.now() + sessionLifetime);
        });
        res.setHeader('Set-Cookie', sessionCookie(secret)); send(200, { data: { id: user.id } }); return;
      }
      if (route === '/auth/logout' && req.method === 'POST') {
        store.sql.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token(req)));
        res.setHeader('Set-Cookie', sessionCookie('')); send(200, { data: { ok: true } }); return;
      }
      if (req.method === 'GET') {
        const db = store.read(), user = authenticate(req, db);
        if (route === '/auth/me') send(200, { data: { id: user.id } });
        else if (route === '/workspace') send(200, { data: workspaceFor(db, user) });
        else throw new HttpError(404, '接口不存在');
        return;
      }
      // 先鉴权再进行昂贵的密码派生。写入时重新从数据库读取并检查权限。
      authenticate(req, store.read());
      let passwordHash;
      if (route === '/members' || route === '/auth/password') {
        validatePassword(data.password);
        if (route === '/members') check(['teacher', 'manager'].includes(authenticate(req, store.read()).role), '没有创建账号权限', 403);
        passwordHash = hashPassword(data.password);
      }
      const result = store.transaction(() => {
        const db = store.read(), user = authenticate(req, db);
        if (route === '/auth/password') {
          check(typeof data.currentPassword === 'string' && data.currentPassword.length <= 64, '请填写当前密码');
          const credential = store.sql.prepare('SELECT password_hash FROM credentials WHERE member_id=?').get(user.id);
          check(verifyPassword(data.currentPassword, credential.password_hash), '当前密码不正确', 400);
          store.setPassword(user.id, passwordHash); store.revoke(user.id); return { ok: true };
        }
        check(writes.test(route), '接口不存在', 404);
        const { response, revokeId } = mutate(db, user, route, data);
        if (route === '/members') store.setPassword(response.id, passwordHash);
        if (revokeId) store.revoke(revokeId);
        store.write(db); return response;
      });
      if (route === '/auth/password') res.setHeader('Set-Cookie', sessionCookie(''));
      send(200, { data: result });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error('服务处理失败', error.code || error.name);
      if (!res.headersSent) send(status, { message: status === 500 ? '服务器暂时无法完成操作，请稍后重试' : error.message });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, store };
}
