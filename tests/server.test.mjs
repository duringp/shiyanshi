import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';

const password = 'Test-Strong-2026';
const date = days => new Date(Date.now() + days * 86400000).toISOString();
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lab-test-'));
  let store = openStore(join(dir, 'lab.sqlite'));
  store.initialize({ username: 'teacher', name: '测试老师', password });
  let server, base;
  async function start() { ({ server } = createApp({ store })); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; }
  async function stop() { await new Promise(resolve => server.close(resolve)); store.close(); }
  await start();
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      async request(path, data, extra = {}) {
        const response = await fetch(`${base}${path.startsWith('/api') ? path : '/api' + path}`, {
          method: data === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Lab-Request': '1', Cookie: cookie, ...extra },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const body = await response.json();
        return { status: response.status, data: body.data, message: body.message, headers: response.headers };
      },
      async login(username, value = password) { return this.request('/auth/login', { username, password: value }); },
      async get() { const r = await this.request('/workspace'); assert.equal(r.status, 200); return r.data; },
      async post(path, data = {}) { const r = await this.request(path, data); assert.equal(r.status, 200, r.message); return r.data; },
    };
  }
  const teacher = client(); assert.equal((await teacher.login('teacher')).status, 200);
  async function account(username, role = 'member') {
    const result = await teacher.post('/members', { name: username, username, number: username, group: '测试组', role, contact: `${username}@private.test`, password });
    const session = client(); assert.equal((await session.login(username)).status, 200); return { ...session, id: result.id };
  }
  return { dir, teacher, client, account, get store() { return store; }, get base() { return base; },
    async restart() { await stop(); store = openStore(join(dir, 'lab.sqlite')); await start(); } };
}
const assetData = id => ({ id, name: '开发板', model: 'STM32', category: '开发板', location: 'A01' });

test('真实认证、持久化会话、重启恢复账号及业务数据', async t => {
  const f = await fixture(t), student = await f.account('student');
  assert.equal((await f.client().request('/workspace')).status, 401);
  assert.equal((await f.client().login('student', 'wrong')).status, 401);
  const login = await student.login('student');
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  await student.post('/members/me/status', { status: '忙碌', note: '服务重启后保留' });
  await f.restart();
  assert.equal((await student.get()).members.find(m => m.id === student.id).note, '服务重启后保留');
  assert.equal((await f.client().login('student')).status, 200);
  assert.throws(() => f.store.initialize({ username: 'other', name: '老师', password }), /拒绝覆盖/);
  await student.post('/auth/logout');
  assert.equal((await student.request('/workspace')).status, 401);
});

test('服务端拒绝角色伪造、越权创建、自降角色及自身停用', async t => {
  const f = await fixture(t), member = await f.account('student'), manager = await f.account('manager', 'manager');
  assert.equal((await member.request('/members', { name: 'hack', username: 'hack', role: 'teacher', password })).status, 403);
  assert.equal((await member.request('/assets', assetData('EM-01'))).status, 403);
  assert.equal((await manager.request('/members', { name: 'hack', number: 'hack', group: 'g', username: 'hack', role: 'teacher', password })).status, 403);
  await member.post('/members/me/update', { name: '新名字', role: 'teacher', active: false, username: 'changed' });
  const saved = (await member.get()).members.find(m => m.id === member.id);
  assert.equal(saved.role, 'member'); assert.equal(saved.username, 'student'); assert.equal(saved.active, true);
  const teacher = (await f.teacher.get()).members.find(m => m.username === 'teacher');
  assert.equal((await f.teacher.request(`/members/${teacher.id}/active`, { active: false })).status, 403);
  assert.equal((await f.teacher.request(`/members/${teacher.id}/update`, { ...teacher, role: 'member' })).status, 403);
  assert.equal((await manager.request(`/members/${teacher.id}/update`, teacher)).status, 403);
});

test('账号唯一性、字段校验、停用与角色变更立即撤销会话', async t => {
  const f = await fixture(t), student = await f.account('student');
  assert.equal((await f.teacher.request('/members', { name: '重复', username: 'STUDENT', number: 'other', group: 'g', role: 'member', password })).status, 409);
  assert.equal((await student.request('/members/me/status', { status: '请假' })).status, 400);
  await f.teacher.post(`/members/${student.id}/active`, { active: false });
  assert.equal((await student.request('/workspace')).status, 401);
  await f.teacher.post(`/members/${student.id}/active`, { active: true });
  assert.equal((await student.request('/workspace')).status, 401);
  assert.equal((await student.login('student')).status, 200);
  const row = (await f.teacher.get()).members.find(m => m.id === student.id);
  await f.teacher.post(`/members/${student.id}/update`, { ...row, role: 'manager' });
  assert.equal((await student.request('/workspace')).status, 401);
});

test('两个请求并发发放同一模块只成功一次，归还验收原子更新维修和库存', async t => {
  const f = await fixture(t), a = await f.account('student_a'), b = await f.account('student_b');
  await f.teacher.post('/assets', assetData('EM-01'));
  await f.teacher.post('/assets', assetData('EM-02'));
  const first = await a.post('/loans', { assetIds: ['EM-01', 'EM-02'], purpose: '实验', due: date(2), memberId: b.id });
  const second = await b.post('/loans', { assetIds: ['EM-01'], purpose: '实验', due: date(2) });
  assert.equal((await a.request(`/loans/${first.id}/review`, { decision: 'approve' })).status, 403);
  for (const loan of [first, second]) await f.teacher.post(`/loans/${loan.id}/review`, { decision: 'approve' });
  const results = await Promise.all([first, second].map(loan => f.teacher.request(`/loans/${loan.id}/issue`, {})));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const db = await f.teacher.get(), issued = db.loans.find(l => l.status === '使用中'), owner = issued.memberId === a.id ? a : b;
  assert.equal(db.loans.find(l => l.id === first.id).memberId, a.id);
  assert.equal((await f.teacher.request(`/members/${owner.id}/active`, { active: false })).status, 409);
  assert.equal((await f.teacher.request('/assets/EM-01/maintenance', { description: '测试' })).status, 409);
  await owner.post(`/loans/${issued.id}/request-return`);
  assert.equal((await f.teacher.request(`/loans/${issued.id}/receive`, { damagedIds: ['INVALID'], note: '故障' })).status, 400);
  assert.equal((await f.teacher.get()).loans.find(l => l.id === issued.id).status, '待确认归还');
  await f.teacher.post(`/loans/${issued.id}/receive`, { damagedIds: ['EM-01'], note: '接口损坏' });
  assert.equal((await f.teacher.get()).assets.find(a => a.id === 'EM-01').status, '维修中');
  await f.teacher.post('/assets/EM-01/repair-complete');
  await f.teacher.post('/assets/EM-01/retire');
  assert.equal((await f.teacher.get()).assets.find(a => a.id === 'EM-01').status, '已报废');
});

test('请假重叠、审批权限和跨账号隐私裁剪', async t => {
  const f = await fixture(t), a = await f.account('student_a'), b = await f.account('student_b'), manager = await f.account('manager', 'manager');
  const leave = await a.post('/leaves', { start: date(-1), end: date(2), reason: '私人原因' });
  assert.equal((await a.request('/leaves', { start: date(1), end: date(3), reason: '重复' })).status, 409);
  assert.equal((await a.request(`/leaves/${leave.id}/review`, { decision: 'approve' })).status, 403);
  assert.equal((await b.get()).leaves.length, 0);
  await manager.post(`/leaves/${leave.id}/review`, { decision: 'approve', opinion: '私密意见' });
  const publicData = await b.get(), serialized = JSON.stringify(publicData);
  assert.equal(publicData.leaves[0].status, '已通过');
  assert.equal(publicData.leaves[0].reason, undefined);
  for (const secret of ['私人原因', '私密意见', 'student_a@private.test', 'password_hash', 'credentials']) assert.ok(!serialized.includes(secret));
  assert.equal(publicData.members.find(m => m.id === a.id).username, undefined);
  assert.equal(publicData.logs.some(l => l.private), false);
  assert.equal((await manager.get()).leaves[0].reason, '私人原因');
  const teacherLeave = await f.teacher.post('/leaves', { start: date(1), end: date(2), reason: '老师原因' });
  assert.equal((await manager.request(`/leaves/${teacherLeave.id}/review`, { decision: 'approve' })).status, 403);
  assert.equal(JSON.stringify(await manager.get()).includes('老师原因'), false);
  await f.teacher.post(`/leaves/${teacherLeave.id}/cancel`);
});

test('普通成员只能看到他人当前占用关系，不能看到用途及历史', async t => {
  const f = await fixture(t), a = await f.account('student_a'), b = await f.account('student_b');
  await f.teacher.post('/assets', assetData('EM-01'));
  const loan = await a.post('/loans', { assetIds: ['EM-01'], purpose: '私密用途', project: '内部项目', due: date(2) });
  assert.equal((await b.get()).loans.length, 0);
  await f.teacher.post(`/loans/${loan.id}/review`, { decision: 'approve', opinion: '内部审批' });
  await f.teacher.post(`/loans/${loan.id}/issue`);
  const view = await b.get(); assert.equal(view.loans.length, 1); assert.equal(view.loans[0].purpose, undefined);
  await a.post(`/loans/${loan.id}/request-return`);
  await f.teacher.post(`/loans/${loan.id}/receive`, { damagedIds: [], note: '内部备注' });
  assert.equal((await b.get()).loans.length, 0);
});

test('比赛完整创建更新归档与无效请求回滚', async t => {
  const f = await fixture(t), student = await f.account('student');
  const data = { name: '测试赛', organizer: '实验室', level: '校级', location: 'A301', ownerId: student.id, requirements: '测试规则', registrationStart: date(1), registrationEnd: date(2), start: date(3), end: date(4), stages: [{ title: '比赛', at: date(3) }] };
  assert.equal((await student.request('/competitions', data)).status, 403);
  const c = await f.teacher.post('/competitions', data);
  assert.equal((await f.teacher.request(`/competitions/${c.id}/update`, { ...data, end: date(1) })).status, 400);
  await f.teacher.post(`/competitions/${c.id}/update`, { ...data, name: '已更新' });
  await f.teacher.post(`/competitions/${c.id}/archive`, { archived: true });
  assert.equal((await f.teacher.get()).competitions[0].name, '已更新');
  assert.equal((await f.teacher.get()).competitions[0].archived, true);
  await f.teacher.post(`/competitions/${c.id}/archive`, { archived: false });
});

test('跨站写入、源文件和数据库泄露防护及修改密码撤销全部会话', async t => {
  const f = await fixture(t), student = await f.account('student'), other = f.client();
  await other.login('student');
  assert.equal((await student.request('/members/me/status', { status: '忙碌' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await student.request('/members/me/status', { status: '忙碌' }, { 'X-Lab-Request': '' })).status, 403);
  for (const path of ['/data/lab.sqlite', '/.env', '/server/store.mjs', '/测试账号.txt', '/.git/config', '/API.md']) assert.equal((await fetch(f.base + path)).status, 404);
  assert.ok(!(await (await fetch(f.base + '/src/seed.js')).text()).includes('memberData'));
  assert.equal((await student.request('/members/me/status/extra', {})).status, 404);
  assert.equal((await student.request('/auth/password', { currentPassword: 'wrong', password: 'Updated-2026' })).status, 400);
  await student.post('/auth/password', { currentPassword: password, password: 'Updated-2026' });
  assert.equal((await other.request('/workspace')).status, 401);
  assert.equal((await student.login('student')).status, 401);
  assert.equal((await student.login('student', 'Updated-2026')).status, 200);
});

test('SQLite 备份可独立恢复，账号密码不以明文落盘', async t => {
  const f = await fixture(t); await f.account('student');
  const path = join(f.dir, 'backup.sqlite'); await f.store.backup(path);
  const copy = openStore(path);
  try { assert.equal(copy.read().members.length, 2); assert.ok(copy.sql.prepare('SELECT password_hash FROM credentials').all().every(r => !r.password_hash.includes(password))); }
  finally { copy.close(); }
  assert.ok(!(await readFile(path)).includes(Buffer.from(password)));
});

test('错误密码登录限流且重启后不能绕过', async t => {
  const f = await fixture(t), client = f.client();
  for (let i = 0; i < 10; i++) assert.equal((await client.login('missing', 'wrong')).status, 401);
  await f.restart();
  assert.equal((await client.login('missing', 'wrong')).status, 429);
});
