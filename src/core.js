'use strict';
// 配置、公共工具与数据操作
const CONFIG = { mode: 'mock', API_BASE_URL: 'https://your-api.example.com/api', timeout: 10000 };
const DB_KEY = 'xinzhan.lab.demo.v1',
  SESSION_KEY = 'xinzhan.lab.session.v1';
const ROLE = { teacher: '指导老师', manager: '负责人', member: '普通成员' };
const MANAGEMENT_PERMISSIONS = ['manageCompetitions', 'manageAssets', 'manageMembers', 'approve'];
const PAGE_SIZE = 8;
const NAV = [
  ['dashboard', 'grid', '工作台'],
  ['members', 'users', '成员管理'],
  ['leaves', 'calendar', '请假管理'],
  ['assets', 'chip', '模块管理'],
  ['loans', 'swap', '借用与归还'],
  ['competitions', 'trophy', '比赛管理'],
  ['logs', 'history', '操作记录'],
  ['profile', 'user', '个人中心'],
];
const CATEGORIES = ['开发板', '单板计算机', '传感器', '通信模块', '执行器', '调试工具', '其他'];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = (days = 0, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const fmt = (v, time = false) =>
  v
    ? new Date(v).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
      })
    : '—';
const inputDate = (v) => {
  const d = new Date(v);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function requirePermission(test, message = '当前身份没有此操作权限') {
  if (!test) throw new Error(message);
}
function ensureState(record, states) {
  requirePermission(states.includes(record.status), '记录状态已改变，请刷新后重试');
}

function percentage(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}
function countStatuses(items, status) {
  const counts = Object.create(null);
  for (const item of items) {
    const key = status(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
function cleanFields(input, keys = Object.keys(input)) {
  return Object.fromEntries(keys.map((key) => [key, String(input[key] ?? '').trim()]));
}
function isHttpURL(value) {
  return /^https?:\/\//i.test(value);
}

let db,
  sessionId = null,
  view = 'dashboard',
  search = '',
  filter = '',
  groupFilter = '',
  page = 1;
const API = {
  async request(path, options = {}) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), CONFIG.timeout);
    try {
      const r = await fetch(CONFIG.API_BASE_URL + path, {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        signal: controller.signal,
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        const err = new Error(data?.message || `请求失败（${r.status}）`);
        err.status = r.status;
        throw err;
      }
      if (data === null) throw new Error('接口未返回有效 JSON 数据');
      return data.data ?? data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('请求超时，请检查服务器连接');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },
  async load() {
    if (CONFIG.mode === 'api') {
      let current;
      try {
        current = await this.request('/auth/me');
      } catch (e) {
        if (e.status === 401) {
          sessionId = null;
          db = null;
          return;
        }
        throw e;
      }
      applySnapshot(await this.request('/workspace'));
      sessionId = current.id;
      return;
    }
    const raw = localStorage.getItem(DB_KEY),
      snapshot = raw ? JSON.parse(raw) : seed();
    validateSnapshot(snapshot);
    const migrated = !Array.isArray(snapshot.competitions);
    if (migrated) snapshot.competitions = seedCompetitions();
    if (!raw || migrated) localStorage.setItem(DB_KEY, JSON.stringify(snapshot));
    applySnapshot(snapshot);
    sessionId = sessionStorage.getItem(SESSION_KEY);
  },
  async login(username, password) {
    if (CONFIG.mode === 'api') {
      const result = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      sessionId = result.id;
      await this.load();
      return;
    }
    const m = db.members.find((x) => x.username === username && x.active);
    const credential = m && db.credentials?.[m.id];
    const valid = !!m && (credential ? await verifyCredential(password, credential) : password === 'Lab@123456');
    if (!valid) throw new Error('账号或密码不正确，或账号已停用');
    sessionStorage.setItem(SESSION_KEY, m.id);
    sessionId = m.id;
  },
  async mutate(path, payload, localAction) {
    if (CONFIG.mode === 'api') {
      await this.request(path, { method: 'POST', body: JSON.stringify(payload) });
      await this.load();
      return;
    }
    const backup = JSON.stringify(db);
    try {
      localAction();
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch (e) {
      applySnapshot(JSON.parse(backup));
      throw e;
    }
  },
  async logout() {
    if (CONFIG.mode === 'api') await this.request('/auth/logout', { method: 'POST' });
    sessionStorage.removeItem(SESSION_KEY);
    sessionId = null;
  },
};
function me() {
  return db?.members.find((m) => m.id === sessionId && m.active);
}
function can(permission) {
  const role = me()?.role;
  return permission === 'assignRoles'
    ? role === 'teacher'
    : MANAGEMENT_PERMISSIONS.includes(permission) && ['teacher', 'manager'].includes(role);
}
function member(id) {
  return db.members.find((x) => x.id === id);
}
function asset(id) {
  return db.assets.find((x) => x.id === id);
}
function activeLoan(id) {
  return db.loans.find((l) => isActiveLoan(l) && l.assetIds.includes(id));
}
function assetStatus(a) {
  return activeLoan(a.id) ? '使用中' : a.status;
}
function memberStatus(m) {
  return db.leaves.some(
    (l) => l.memberId === m.id && l.status === '已通过' && Date.parse(l.start) <= Date.now() && Date.parse(l.end) >= Date.now(),
  )
    ? '请假'
    : m.baseStatus;
}
function overdue(l) {
  return isActiveLoan(l) && Date.parse(l.due) < Date.now();
}
function audit(text, memberId = me().id) {
  db.logs.push({ id: uid('LOG'), actor: me().name, text, memberId, at: new Date().toISOString() });
}
function pendingCount() {
  return db.loans.filter((l) => needsLoanReview(l)).length + db.leaves.filter((l) => l.status === '待审批' && canReview(l)).length;
}
function canReview(r) {
  const user = me(),
    owner = member(r.memberId);
  return !!user && can('approve') && user.id !== r.memberId && (user.role === 'teacher' || owner?.role === 'member');
}
function visibleLogs() {
  return db.logs
    .filter((l) => me().role !== 'member' || l.memberId === me().id || !l.private)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
function todoItems() {
  const tasks = [];
  for (const l of db.loans) {
    if (needsLoanReview(l))
      tasks.push({
        title: `${member(l.memberId)?.name} · ${l.status === '待审批' ? '模块借用申请' : l.status}`,
        description: l.assetIds.map((id) => asset(id)?.name).join('、'),
        icon: 'swap',
        view: 'loans',
      });
    if (overdue(l) && (can('approve') || l.memberId === me().id))
      tasks.push({
        title: '模块借用已逾期',
        description: `${member(l.memberId)?.name} · ${fmt(l.due)} 应归还`,
        icon: 'clock',
        view: 'loans',
        orange: true,
      });
  }
  for (const l of db.leaves)
    if (l.status === '待审批' && canReview(l))
      tasks.push({
        title: `${member(l.memberId)?.name} · 请假申请`,
        description: `${fmt(l.start)} — ${fmt(l.end)}`,
        icon: 'calendar',
        view: 'leaves',
        orange: true,
      });
  return tasks;
}
function editableMember(m) {
  return !!m && (me().role === 'teacher' || (me().role === 'manager' && m.role === 'member'));
}
function getLoan(id) {
  const l = db.loans.find((x) => x.id === id);
  requirePermission(l, '借用记录不存在');
  requirePermission(me().role !== 'member' || l.memberId === me().id);
  return l;
}
function getLeave(id) {
  const l = db.leaves.find((x) => x.id === id);
  requirePermission(l, '请假记录不存在');
  requirePermission(l.memberId === me().id || canReview(l));
  return l;
}

// 所有加载、同步和失败回滚使用同一入口，保持编辑回调引用的记录对象有效。
const RECORD_COLLECTIONS = ['members', 'assets', 'loans', 'leaves', 'maintenance', 'logs', 'competitions'];
function validateSnapshot(snapshot) {
  requirePermission(
    snapshot?.version === 1 && RECORD_COLLECTIONS.filter((key) => key !== 'competitions').every((key) => Array.isArray(snapshot[key])),
    '演示数据格式无效，请恢复演示数据',
  );
}
function applySnapshot(snapshot) {
  validateSnapshot(snapshot);
  requirePermission(Array.isArray(snapshot.competitions), '比赛数据格式无效');
  const next = { ...snapshot };
  for (const key of RECORD_COLLECTIONS) {
    const existing = new Map((db?.[key] || []).map((record) => [record.id, record]));
    next[key] = snapshot[key].map((record) => {
      const current = existing.get(record.id);
      if (!current) return record;
      for (const field of Object.keys(current)) if (!Object.hasOwn(record, field)) delete current[field];
      return Object.assign(current, record);
    });
  }
  db = next;
}
function isActiveLoan(loan) {
  return ['使用中', '待确认归还'].includes(loan.status);
}
function needsLoanReview(loan) {
  return canReview(loan) && ['待审批', '待发放', '待确认归还'].includes(loan.status);
}
function reviewRequest(record, data, approvedStatus, expires, message) {
  requirePermission(canReview(record));
  ensureState(record, ['待审批']);
  requirePermission(['approve', 'reject'].includes(data.decision));
  requirePermission(data.decision !== 'approve' || Date.parse(expires) > Date.now(), message);
  Object.assign(record, {
    status: data.decision === 'approve' ? approvedStatus : '已拒绝',
    reviewer: me().id,
    opinion: data.opinion,
    reviewed: new Date().toISOString(),
  });
}
