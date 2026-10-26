import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function check(value, message, status = 400) {
  if (!value) throw new HttpError(status, message);
}
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${randomUUID()}`;
const roles = ['teacher', 'manager', 'member'];
const activeLoan = loan => ['使用中', '待确认归还'].includes(loan.status);
const pick = (record, fields) => Object.fromEntries(fields.map(key => [key, record[key]]));
function text(data, key, max, required = false) {
  const value = data[key] ?? '';
  check(typeof value === 'string', `${key} 必须是文本`);
  const clean = value.trim();
  check(clean.length <= max && (!required || clean.length), `${key} 不能为空或超过 ${max} 字符`);
  return clean;
}
function fields(data, spec) {
  return Object.fromEntries(Object.entries(spec).map(([key, limit]) => [key, text(data, key, Math.abs(limit), limit > 0)]));
}
function date(data, key) {
  const value = text(data, key, 40, true);
  check(/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), `${key} 必须是带时区的有效时间`);
  return new Date(value).toISOString();
}
function bool(data, key) { check(typeof data[key] === 'boolean', `${key} 必须为布尔值`); return data[key]; }
function ids(data, key, required = false) {
  const values = data[key];
  check(Array.isArray(values) && values.length <= 200 && (!required || values.length) && values.every(v => typeof v === 'string') && new Set(values).size === values.length, `${key} 必须是不重复的编号数组`);
  return values;
}
function url(data, key) {
  const value = text(data, key, 2048);
  if (value) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new HttpError(400, `${key} 链接无效`); }
    check(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password, `${key} 仅支持 HTTP/HTTPS 链接`);
  }
  return value;
}
export function validatePassword(value) {
  check(typeof value === 'string' && value.length >= 8 && value.length <= 64 && /[a-z]/i.test(value) && /\d/.test(value), '密码须为 8–64 位，至少包含字母和数字');
}
export function emptyWorkspace() {
  return { version: 1, revision: 0, members: [], assets: [], loans: [], leaves: [], maintenance: [], logs: [], competitions: [] };
}
export function initialTeacher({ username, name, number = 'ADMIN001', password }) {
  validatePassword(password);
  check(/^[A-Za-z0-9_]{3,30}$/.test(username), '初始化账号格式无效');
  check(typeof name === 'string' && name.trim().length && name.length <= 30, '初始化老师姓名无效');
  return { id: id('m'), name: name.trim(), username, number, role: 'teacher', group: '导师组', direction: '', contact: '', active: true, baseStatus: '空闲', note: '', joined: now(), updated: now() };
}
const canReview = (db, user, record) => user.id !== record.memberId && (user.role === 'teacher' || (user.role === 'manager' && db.members.find(m => m.id === record.memberId)?.role === 'member'));

// 裁剪发生在服务器，客户端永远不会收到其他成员的私密字段。
export function workspaceFor(db, user) {
  const result = structuredClone(db);
  result.members = result.members.map(m => {
    if (m.id !== user.id && !(user.role === 'teacher' || (user.role === 'manager' && m.role === 'member'))) {
      delete m.username; delete m.contact;
    }
    return m;
  });
  result.loans = result.loans.filter(l => user.role !== 'member' || l.memberId === user.id || activeLoan(l)).map(l =>
    user.role !== 'member' || l.memberId === user.id ? l : pick(l, ['id', 'memberId', 'assetIds', 'status', 'due', 'created', 'issued']));
  result.leaves = result.leaves.filter(l => l.memberId === user.id || canReview(db, user, l) || (l.status === '已通过' && Date.parse(l.end) > Date.now())).map(l =>
    l.memberId === user.id || canReview(db, user, l) ? l : pick(l, ['id', 'memberId', 'start', 'end', 'status']));
  result.logs = result.logs.filter(l => !l.private || l.memberId === user.id || canReview(db, user, l));
  return result;
}

// 调用方必须在 BEGIN IMMEDIATE 事务内读取、执行并保存；所有写入只取白名单字段。
export function mutate(db, user, path, data) {
  const [collection, recordId, operation] = path.split('/').filter(Boolean);
  const manager = () => check(['teacher', 'manager'].includes(user.role), '没有管理权限', 403);
  const find = (key, target) => { const record = db[key].find(r => r.id === target); check(record, '记录不存在', 404); return record; };
  const state = (record, values) => check(values.includes(record.status), '记录状态已改变，请刷新后重试', 409);
  const review = record => check(canReview(db, user, record), '不能审批本人或此角色的申请', 403);
  const own = record => check(record.memberId === user.id, '只能操作本人的申请', 403);
  const log = (message, memberId = user.id, privateLog = false) => db.logs.push({ id: id('LOG'), actor: user.name, actorId: user.id, text: message, memberId, private: privateLog, at: now() });
  const free = assetId => { const a = find('assets', assetId); return a.status === '空闲' && !db.loans.some(l => activeLoan(l) && l.assetIds.includes(assetId)); };
  const repair = (assetId, description) => db.maintenance.push({ id: id('MT'), assetId, description, status: '维修中', actor: user.id, created: now() });
  const editable = m => { manager(); check(user.role === 'teacher' || m.role === 'member', '负责人只能管理普通成员', 403); };
  const decision = () => {
    check(['approve', 'reject'].includes(data.decision), '审批结果无效');
    const opinion = text(data, 'opinion', 200, data.decision === 'reject');
    return { opinion, reviewer: user.id, reviewed: now() };
  };
  let response = { ok: true };
  let revokeId;
  if (collection === 'members') {
    if (recordId === 'me' && operation === 'status') {
      check(['空闲', '忙碌'].includes(data.status), '工作状态无效');
      Object.assign(user, { baseStatus: data.status, note: text(data, 'note', 60), updated: now() });
      log(`更新工作状态为${data.status}`);
    } else if (recordId === 'me' && operation === 'update') {
      Object.assign(user, fields(data, { name: 30, direction: -80, contact: -80 }), { updated: now() });
      log('更新个人资料');
    } else if (!recordId || operation === 'update') {
      manager();
      const m = recordId ? find('members', recordId) : null;
      if (m) editable(m);
      const value = fields(data, { name: 30, number: 30, username: 30, role: 10, group: 40, direction: -80, contact: -80 });
      check(/^[A-Za-z0-9_]{3,30}$/.test(value.username) && roles.includes(value.role), '账号或角色无效');
      check(user.role === 'teacher' || value.role === 'member', '负责人不能设置管理角色', 403);
      check(!m || m.id !== user.id || value.role === m.role, '不能修改自己的角色', 403);
      check(!db.members.some(x => x.id !== recordId && (x.number === value.number || x.username.toLowerCase() === value.username.toLowerCase())), '账号或学号 / 工号已存在', 409);
      if (m) {
        if (m.role !== value.role || m.username !== value.username) revokeId = m.id;
        Object.assign(m, value, { updated: now() });
      } else {
        validatePassword(data.password);
        const created = { ...value, id: id('m'), active: true, baseStatus: '空闲', note: '', joined: now(), updated: now() };
        db.members.push(created); response = { id: created.id };
      }
      log(`${m ? '更新' : '创建'}成员账号 ${value.name}`, m?.id || response.id);
    } else if (operation === 'active') {
      const m = find('members', recordId); editable(m);
      check(m.id !== user.id, '不能停用自己', 403);
      const active = bool(data, 'active');
      if (!active) check(!db.loans.some(l => l.memberId === m.id && ['待审批', '待发放', '使用中', '待确认归还'].includes(l.status)) && !db.leaves.some(l => l.memberId === m.id && (l.status === '待审批' || (l.status === '已通过' && Date.parse(l.end) > Date.now()))), '请先处理成员未完成的借用与请假', 409);
      m.active = active; m.updated = now(); revokeId = m.id;
      log(`${active ? '启用' : '停用'}成员 ${m.name}`, m.id);
    } else throw new HttpError(404, '接口不存在');
  } else if (collection === 'assets') {
    manager();
    if (!recordId || operation === 'update') {
      const value = fields(data, { id: 40, name: 60, model: 70, category: 30, location: 60, vendor: -60, spec: -100, note: -300 });
      value.datasheet = url(data, 'datasheet');
      check(/^[A-Za-z0-9_-]{2,40}$/.test(value.id), '资产编号无效');
      if (recordId) { check(value.id === recordId, '资产编号不能修改'); Object.assign(find('assets', recordId), value); }
      else { check(!db.assets.some(a => a.id === value.id), '资产编号已存在', 409); db.assets.push({ ...value, status: '空闲', created: now() }); response = { id: value.id }; }
      log(`${recordId ? '更新' : '录入'}模块 ${value.name}`);
    } else {
      const a = find('assets', recordId);
      check(!db.loans.some(l => activeLoan(l) && l.assetIds.includes(a.id)), '请先完成归还', 409);
      if (operation === 'maintenance') { state(a, ['空闲']); const description = text(data, 'description', 200, true); a.status = '维修中'; repair(a.id, description); }
      else if (['repair-complete', 'retire'].includes(operation)) {
        state(a, operation === 'repair-complete' ? ['维修中'] : ['空闲', '维修中']);
        a.status = operation === 'repair-complete' ? '空闲' : '已报废';
        db.maintenance.filter(r => r.assetId === a.id && r.status === '维修中').forEach(r => Object.assign(r, { status: operation === 'retire' ? '已报废' : '已完成', completed: now(), completer: user.id }));
      } else throw new HttpError(404, '接口不存在');
      log(`更新模块 ${a.name} 为${a.status}`);
    }
  } else if (collection === 'loans') {
    if (!recordId) {
      const assetIds = ids(data, 'assetIds', true), due = date(data, 'due');
      check(Date.parse(due) > Date.now(), '归还时间必须晚于当前时间');
      check(assetIds.every(free), '部分模块当前不可借用', 409);
      check(!db.loans.some(l => l.memberId === user.id && ['待审批', '待发放'].includes(l.status) && l.assetIds.some(a => assetIds.includes(a))), '已经提交过这些模块的申请', 409);
      const l = { id: id('BR'), memberId: user.id, assetIds, due, ...fields(data, { purpose: 300, project: -60 }), status: '待审批', created: now() };
      db.loans.push(l); response = { id: l.id }; log('提交借用申请');
    } else {
      const l = find('loans', recordId);
      if (operation === 'cancel') { own(l); state(l, ['待审批']); l.status = '已撤销'; }
      else if (operation === 'request-return') { own(l); state(l, ['使用中']); l.status = '待确认归还'; l.returnRequested = now(); }
      else if (operation === 'review') {
        review(l); state(l, ['待审批']); const value = decision();
        check(data.decision !== 'approve' || Date.parse(l.due) > Date.now(), '申请已过期', 409);
        Object.assign(l, value, { status: data.decision === 'approve' ? '待发放' : '已拒绝' });
      } else if (operation === 'issue') {
        review(l); state(l, ['待发放']); check(Date.parse(l.due) > Date.now(), '申请已过期', 409);
        check(l.assetIds.every(free), '模块已被占用，无法重复发放', 409);
        Object.assign(l, { status: '使用中', issued: now(), issuer: user.id });
      } else if (operation === 'receive') {
        review(l); state(l, ['待确认归还']); const damagedIds = ids(data, 'damagedIds'), note = text(data, 'note', 200, damagedIds.length > 0);
        check(damagedIds.every(a => l.assetIds.includes(a)), '损坏编号不属于这笔借用');
        l.assetIds.forEach(assetId => { const a = find('assets', assetId); a.status = damagedIds.includes(assetId) ? '维修中' : '空闲'; if (damagedIds.includes(assetId)) repair(assetId, note); });
        Object.assign(l, { status: '已归还', returned: now(), receiver: user.id, returnNote: note });
      } else throw new HttpError(404, '接口不存在');
      log(`借用记录更新为${l.status}`, l.memberId);
    }
  } else if (collection === 'leaves') {
    if (!recordId) {
      const start = date(data, 'start'), end = date(data, 'end'), reason = text(data, 'reason', 300, true);
      check(Date.parse(start) < Date.parse(end) && Date.parse(end) > Date.now(), '请假时间范围无效');
      check(!db.leaves.some(l => l.memberId === user.id && ['待审批', '已通过'].includes(l.status) && Date.parse(l.start) < Date.parse(end) && Date.parse(l.end) > Date.parse(start)), '已有重叠的请假申请', 409);
      const l = { id: id('LV'), memberId: user.id, start, end, reason, status: '待审批', created: now() }; db.leaves.push(l); response = { id: l.id }; log('提交请假申请', user.id, true);
    } else {
      const l = find('leaves', recordId);
      if (operation === 'cancel') { own(l); state(l, ['待审批']); l.status = '已撤销'; }
      else if (operation === 'review') {
        review(l); state(l, ['待审批']); const value = decision(); check(data.decision !== 'approve' || Date.parse(l.end) > Date.now(), '请假申请已过期', 409);
        Object.assign(l, value, { status: data.decision === 'approve' ? '已通过' : '已拒绝' });
      } else throw new HttpError(404, '接口不存在');
      log(`请假记录更新为${l.status}`, l.memberId, true);
    }
  } else if (collection === 'competitions') {
    manager();
    if (!recordId || operation === 'update') {
      const c = recordId ? find('competitions', recordId) : null;
      const value = fields(data, { name: 80, organizer: 80, level: 10, category: -40, location: 100, ownerId: 100, teamSize: -60, summary: -400, requirements: 4000 });
      value.link = url(data, 'link');
      check(['实验室', '校级', '省级', '国家级', '国际级'].includes(value.level), '比赛级别无效');
      const owner = find('members', value.ownerId); check(owner.active || c?.ownerId === owner.id, '比赛负责人已停用');
      for (const key of ['registrationStart', 'registrationEnd', 'start', 'end']) value[key] = date(data, key);
      check(value.registrationStart < value.registrationEnd && value.registrationEnd <= value.start && value.start < value.end, '比赛日期顺序无效');
      check(Array.isArray(data.stages) && data.stages.length >= 1 && data.stages.length <= 20, '需要 1–20 个比赛节点');
      value.stages = data.stages.map(s => { check(s && typeof s === 'object' && !Array.isArray(s), '比赛节点无效'); return { ...fields(s, { title: 50, description: -200 }), at: date(s, 'at') }; }).sort((a, b) => a.at.localeCompare(b.at));
      if (c) Object.assign(c, value, { updated: now() });
      else { const created = { ...value, id: id('COMP'), archived: false, created: now() }; db.competitions.push(created); response = { id: created.id }; }
      log(`${c ? '更新' : '新增'}比赛 ${value.name}`);
    } else if (operation === 'archive') { const c = find('competitions', recordId); c.archived = bool(data, 'archived'); log(`${c.archived ? '归档' : '恢复'}比赛 ${c.name}`); }
    else throw new HttpError(404, '接口不存在');
  } else throw new HttpError(404, '接口不存在');
  check(db.members.some(m => m.active && m.role === 'teacher'), '必须保留至少一名启用的老师', 409);
  db.revision = (db.revision || 0) + 1;
  return { response, revokeId };
}
