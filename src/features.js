'use strict';
// 仅用于本地演示的密码校验器。生产环境必须由服务器验证密码和权限。
// 自定义密码只保存随机盐与 PBKDF2 校验结果，不保存明文，不写入成员公开资料或日志。
const PASSWORD_ITERATIONS = 150000;
function validatePassword(password, confirmation = password) {
  requirePermission(typeof password === 'string' && password.length >= 8 && password.length <= 64, '密码需要 8–64 个字符');
  requirePermission(/[A-Za-z]/.test(password) && /[0-9]/.test(password), '密码至少包含一个英文字母和一个数字');
  requirePermission(password === confirmation, '两次输入的密码不一致');
}
const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function hexToBytes(text) {
  requirePermission(typeof text === 'string' && /^(?:[a-f0-9]{2})+$/i.test(text), '账号密码记录无效，请联系管理员');
  return Uint8Array.from(text.match(/.{2}/g), (part) => parseInt(part, 16));
}
async function passwordDigest(password, salt, iterations) {
  requirePermission(globalThis.crypto?.subtle, '当前浏览器无法创建密码，请使用本地预览地址或 HTTPS 打开');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
async function makeCredential(password) {
  validatePassword(password);
  requirePermission(globalThis.crypto?.getRandomValues, '当前浏览器不支持密码初始化，请使用本地预览地址');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    algorithm: 'PBKDF2-SHA256',
    iterations: PASSWORD_ITERATIONS,
    salt: bytesToHex(salt),
    digest: await passwordDigest(password, salt, PASSWORD_ITERATIONS),
  };
}
async function verifyCredential(password, credential) {
  if (
    !credential ||
    credential.algorithm !== 'PBKDF2-SHA256' ||
    !Number.isInteger(credential.iterations) ||
    credential.iterations < 10000 ||
    credential.iterations > 1000000
  )
    return false;
  if (typeof password !== 'string' || password.length > 64) return false;
  const actual = await passwordDigest(password, hexToBytes(credential.salt), credential.iterations);
  if (typeof credential.digest !== 'string' || actual.length !== credential.digest.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ credential.digest.charCodeAt(i);
  return mismatch === 0;
}
function cleanMemberData(input, self = false) {
  const keys = self ? ['name', 'direction', 'contact'] : ['name', 'number', 'username', 'role', 'group', 'direction', 'contact'];
  return cleanFields(input, keys);
}
function validateMemberData(data, id = null, self = false) {
  requirePermission(data.name && data.name.length <= 30, '姓名不能为空，且不能超过 30 个字符');
  if (self) return;
  requirePermission(data.number && data.number.length <= 30 && data.group && data.group.length <= 40, '请填写有效的学号 / 工号和所属小组');
  requirePermission(/^[A-Za-z0-9_]{3,30}$/.test(data.username), '账号须为 3–30 位字母、数字或下划线');
  requirePermission(Object.hasOwn(ROLE, data.role), '请选择有效角色');
  requirePermission(me()?.role === 'teacher' || data.role === 'member', '负责人只能为普通成员创建或维护账号');
  requirePermission(!db.members.some((m) => m.id !== id && m.number === data.number), '该学号 / 工号已存在');
  requirePermission(
    !db.members.some((m) => m.id !== id && m.username.toLowerCase() === data.username.toLowerCase()),
    '该登录账号已存在，请换一个账号',
  );
}
async function createMemberAccount(input, password, confirmation = password) {
  requirePermission(can('manageMembers'));
  const data = cleanMemberData(input);
  validateMemberData(data);
  validatePassword(password, confirmation);
  const actorId = me().id;
  const credential = CONFIG.mode === 'mock' ? await makeCredential(password) : null;
  // 校验在异步密码派生后再做一次，防止同一标签页状态变化。
  requirePermission(me()?.id === actorId && can('manageMembers'), '当前身份已变化，请重新提交');
  validateMemberData(data);
  let created = null;
  await API.mutate('/members', { ...data, password }, () => {
    const now = new Date().toISOString();
    created = { ...data, id: uid('m'), active: true, baseStatus: '空闲', joined: now, updated: now, note: '' };
    db.members.push(created);
    db.credentials ??= {};
    db.credentials[created.id] = credential;
    audit(`创建成员账号 ${data.name}（${data.username}）`, created.id);
  });
  return created || db.members.find((m) => m.username === data.username);
}
function passwordFields() {
  return `<div class="form-grid">${field('初始密码 *', 'newPassword', '', 'password', 'minlength="8" maxlength="64" autocomplete="new-password" placeholder="8–64 位，至少包含字母和数字"')}${field('确认密码 *', 'confirmPassword', '', 'password', 'minlength="8" maxlength="64" autocomplete="new-password" placeholder="再次输入初始密码"')}</div><div class="password-help"><label class="check-label"><input type="checkbox" id="show-new-password">显示密码</label><span>请将账号与初始密码告知对应成员</span></div>`;
}
function showAccountCreated(created) {
  modal(
    '成员账号已创建',
    `<div class="account-success"><div class="success-mark">${icon('check')}</div><h2>${esc(created?.name || '新成员')}，欢迎加入实验室</h2><p>成员资料和登录账号已同时保存。</p></div><div class="account-result">${details(
      [
        ['登录账号', created?.username || '已创建'],
        ['角色', ROLE[created?.role] || '普通成员'],
        ['账号状态', '已启用'],
        ['登录密码', '使用刚刚设置的初始密码'],
      ],
    )}</div><p class="privacy-note">密码不会在成员列表、详情或操作记录中展示。${CONFIG.mode === 'mock' ? '当前为本地演示，新账号可以在此浏览器中退出后重新登录。' : ''}</p>`,
    '',
    null,
    btn('继续创建', 'member-new', 'primary'),
  );
}

function matches(...values) {
  return values.join(' ').toLowerCase().includes(search.toLowerCase());
}
function membersPage() {
  let list = db.members.filter(
    (m) =>
      matches(m.name, m.number, m.direction, m.group) &&
      (!filter || (filter === '已停用' ? !m.active : m.active && memberStatus(m) === filter)) &&
      (!groupFilter || m.role === groupFilter),
  );
  const p = paginate(list);
  return `${heading('成员管理', '了解每位伙伴的状态，让协作更高效。', btn(`${icon('refresh')} 更新我的状态`, 'status') + (can('manageMembers') ? btn(`${icon('plus')} 新增成员`, 'member-new', 'primary') : ''), 'MEMBERS / 实验室成员')}${memberStatusSummary()}<section class="panel">${toolbar('搜索姓名、学号、研究方向…', ['空闲', '忙碌', '请假', '离线', '已停用'], Object.entries(ROLE))}${dataTable(
    p,
    ['成员', '角色 / 小组', ...(can('manageMembers') ? ['登录账号'] : []), '研究方向', '当前状态', '操作'],
    (m) => [
      `<div class="row">${avatar(m)}<div>${stack(m.name, m.number)}</div></div>`,
      `<strong>${ROLE[m.role]}</strong><small>${esc(m.group)}</small>`,
      ...(can('manageMembers') ? [`<span class="mono">${esc(m.username)}</span><small>${m.active ? '已启用' : '已停用'}</small>`] : []),
      esc(m.direction),
      `${badge(m.active ? memberStatus(m) : '已停用')}<small>${esc(m.note || '—')}</small>`,
      `${recordButton('详情', 'member-detail', m.id)}${editableMember(m) ? recordButton('编辑', 'member-edit', m.id) : ''}`,
    ],
  )}</section><div class="notice">离线是模拟连接状态，不代表成员不在实验室。请假在审批通过后的有效时段内自动生效，结束后恢复原来的工作状态。</div>`;
}
function assetsPage() {
  const list = db.assets.filter(
    (a) =>
      matches(a.id, a.name, a.model, member(activeLoan(a.id)?.memberId)?.name || '') &&
      (!filter || assetStatus(a) === filter) &&
      (!groupFilter || a.category === groupFilter),
  );
  const p = paginate(list);
  const groups = Object.values(
    db.assets.reduce((out, a) => {
      out[a.model] ??= { name: a.name, model: a.model, total: 0, available: 0 };
      out[a.model].total++;
      if (assetStatus(a) === '空闲') out[a.model].available++;
      return out;
    }, Object.create(null)),
  )
    .filter((g) => g.total > 1)
    .slice(0, 4);
  return `${heading('模块管理', '每一件硬件都有专属编号，每一次使用都有迹可循。', btn(`${icon('swap')} 借用模块`, 'loan-new') + (can('manageAssets') ? btn(`${icon('plus')} 录入模块`, 'asset-new', 'primary') : ''), 'HARDWARE / 硬件资产')}<div class="model-summary">${groups.map((g) => `<div><span>${esc(g.name)}</span><b>${g.available} <small class="muted" style="font-size:11px;font-weight:400">/ ${g.total} 件可借用</small></b><div class="progress-track"><span style="width:${(g.available / g.total) * 100}%"></span></div></div>`).join('')}</div><section class="panel">${toolbar('搜索模块名称、型号、编号、使用者…', ['空闲', '使用中', '维修中', '已报废'], [...new Set([...CATEGORIES, ...db.assets.map((a) => a.category)])])}${dataTable(
    p,
    ['模块 / 型号', '资产编号', '分类 / 位置', '状态', '当前使用者', '操作'],
    (a) => {
      const l = activeLoan(a.id);
      return [
        `<div class="row">${assetIcon(a)}<div>${stack(a.name, a.model)}</div></div>`,
        [esc(a.id), ' class="mono"'],
        `${esc(a.category)}<small>${esc(a.location)}</small>`,
        badge(assetStatus(a)),
        l ? `${esc(member(l.memberId)?.name)}<small>${fmt(l.due)} 归还</small>` : '<span class="muted">—</span>',
        `${recordButton('详情', 'asset-detail', a.id)}${assetStatus(a) === '空闲' ? recordButton('借用', 'loan-new', a.id) : ''}${can('manageAssets') ? recordButton('编辑', 'asset-edit', a.id) : ''}`,
      ];
    },
  )}</section>`;
}
function loanActions(l, includeDetail = true) {
  let html = includeDetail ? recordButton('详情', 'loan-detail', l.id) : '';
  if (l.memberId === me().id) {
    if (l.status === '待审批') html += recordButton('撤销', 'loan-cancel', l.id);
    if (l.status === '使用中') html += recordButton('申请归还', 'loan-return', l.id);
  }
  if (canReview(l)) {
    if (l.status === '待审批') html += recordButton('审批', 'loan-review', l.id);
    if (l.status === '待发放') html += recordButton('确认发放', 'loan-issue', l.id);
    if (l.status === '待确认归还') html += recordButton('验收归还', 'loan-receive', l.id);
  }
  return html;
}
function loansPage() {
  const list = db.loans
    .filter(
      (l) =>
        (me().role !== 'member' || l.memberId === me().id) &&
        matches(l.id, member(l.memberId)?.name, l.project, ...l.assetIds.map((id) => asset(id)?.name)) &&
        (!filter || (filter === '逾期' ? overdue(l) : l.status === filter)),
    )
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  const p = paginate(list);
  return `${heading('借用与归还', '申请 → 审批 → 发放 → 归还验收，全流程清晰可追踪。', btn(`${icon('plus')} 发起借用`, 'loan-new', 'primary'), 'BORROWING / 借用记录')}${me().role === 'member' ? '<div class="notice">这里展示你的借用记录。模块审批通过后，需要由指导老师或负责人确认发放。</div>' : ''}<section class="panel">${toolbar('搜索借用单号、成员、模块、项目…', ['待审批', '待发放', '使用中', '待确认归还', '已归还', '已拒绝', '已撤销', '逾期'])}${dataTable(
    p,
    ['模块 / 借用单', '申请人', '关联项目', '预计归还', '状态', '操作'],
    (l) => [
      `<strong>${l.assetIds.map((id) => esc(asset(id)?.name)).join('<br>')}</strong><small class="mono">${esc(l.id)}</small>`,
      esc(member(l.memberId)?.name),
      esc(l.project || '未关联项目'),
      `${fmt(l.due, true)}${overdue(l) ? '<small style="color:#d28370">已超过预计归还时间</small>' : ''}`,
      `${badge(l.status)}${overdue(l) ? ' ' + badge('逾期') : ''}`,
      loanActions(l),
    ],
    ['暂无借用记录', '点击“发起借用”，选择所需模块。'],
  )}</section>`;
}
function leavesPage() {
  const list = db.leaves
    .filter((l) => (l.memberId === me().id || canReview(l)) && matches(l.id, member(l.memberId)?.name) && (!filter || l.status === filter))
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  const p = paginate(list);
  return `${heading('请假管理', '提前安排时间，让团队了解你的计划。', btn(`${icon('plus')} 申请请假`, 'leave-new', 'primary'), 'LEAVE / 请假记录')}<section class="panel">${toolbar('搜索申请人、申请编号…', ['待审批', '已通过', '已拒绝', '已撤销'])}${dataTable(
    p,
    ['申请人 / 编号', '请假时间', '请假原因', '状态', '审批人', '操作'],
    (l) => [
      `${stack(member(l.memberId)?.name, l.id)}`,
      `${fmt(l.start, true)}<small>至 ${fmt(l.end, true)}</small>`,
      [esc(l.reason), ' style="max-width:190px;overflow:hidden;text-overflow:ellipsis"'],
      `${badge(l.status)}${l.status === '已通过' && Date.parse(l.start) <= Date.now() && Date.parse(l.end) >= Date.now() ? '<small style="color:#d29740">当前生效中</small>' : ''}`,
      l.reviewer ? esc(member(l.reviewer)?.name) : '—',
      `${recordButton('详情', 'leave-detail', l.id)}${l.status === '待审批' && canReview(l) ? recordButton('审批', 'leave-review', l.id) : ''}${l.status === '待审批' && l.memberId === me().id ? recordButton('撤销', 'leave-cancel', l.id) : ''}`,
    ],
    ['暂无请假记录', '你的请假申请会显示在这里。'],
  )}</section><p class="privacy-note">请假原因和审批意见仅对本人及有审批权限的管理人员可见。成员列表只公开请假状态和生效时间。</p>`;
}
function logsPage() {
  const p = paginate(visibleLogs().filter((l) => matches(l.actor, l.text)));
  return `${heading('操作记录', '记录每一次变更，让实验室管理有据可查。', '', 'ACTIVITY / 实验室动态')}<section class="panel"><div class="toolbar"><div class="search-field">${icon('search')}<input id="search" aria-label="搜索" value="${esc(search)}" placeholder="搜索操作人、操作内容…"></div></div><div class="full-log">${p.rows.map((l) => `<div class="activity-item"><strong>${esc(l.actor)}</strong> · ${esc(l.text)}<small>${new Date(l.at).toLocaleString('zh-CN')}</small></div>`).join('') || empty('暂无操作记录')}</div>${p.footer}</section>`;
}
function profilePage() {
  const u = me();
  return `${heading('个人中心', '维护个人资料，更新你的工作状态。', '', 'PROFILE / 我的实验室')}<div class="grid-main"><section class="panel profile-panel"><div class="row">${avatar(u)}<div><h1 style="font-size:22px">${esc(u.name)}</h1><p class="muted" style="margin-top:8px">${ROLE[u.role]} · ${esc(u.group)}</p></div><div style="margin-left:auto">${badge(memberStatus(u))}</div></div>${details(
    [
      ['学号 / 工号', u.number],
      ['登录账号', u.username],
      ['研究方向', u.direction],
      ['联系方式', u.contact],
      ['加入日期', new Date(u.joined).toLocaleDateString('zh-CN')],
      ['状态备注', u.note || '暂无备注'],
    ],
  )}<div class="controls-wrap">${btn('编辑个人资料', 'profile-edit', 'primary')}${btn('更新工作状态', 'status')}${btn('申请请假', 'leave-new')}</div><p class="privacy-note">请假状态由有效审批记录决定；请假结束后会自动恢复你设置的工作状态。</p></section><section class="panel"><div class="panel-head"><h2>演示空间</h2>${icon('shield')}</div><div style="padding:0 22px 24px"><p class="muted small" style="line-height:1.9">当前模式：${CONFIG.mode === 'mock' ? '本地模拟数据' : '后端 API'}<br>${CONFIG.mode === 'mock' ? '未连接阿里云。数据仅保存在当前浏览器，同源标签页共享记录。' : '所有操作通过已配置的 API 请求服务器。'}</p>${
    CONFIG.mode === 'mock'
      ? `<div class="field" style="margin-top:22px"><label for="switch-account">切换测试身份</label><select id="switch-account">${options(
          db.members.filter((m) => m.active).map((m) => [m.id, `${m.name} · ${ROLE[m.role]} (${m.username})`]),
          u.id,
        )}</select></div><div style="margin-top:22px">${btn(`${icon('refresh')} 恢复演示数据`, 'reset', 'danger')}</div><p class="privacy-note">恢复操作会覆盖本浏览器里的演示修改。初始测试账号密码：Lab@123456。新账号使用创建时设置的密码。</p>`
      : ''
  }</div></section></div>`;
}

function memberDetail(id) {
  const m = member(id);
  requirePermission(m, '成员不存在');
  const l = db.leaves.find(
    (l) => l.memberId === id && l.status === '已通过' && Date.parse(l.start) <= Date.now() && Date.parse(l.end) >= Date.now(),
  );
  modal(
    '成员详情',
    `<div class="row">${avatar(m)}<div><h2>${esc(m.name)}</h2><p class="muted small" style="margin-top:6px">${ROLE[m.role]} · ${esc(m.group)}</p></div><span style="margin-left:auto">${badge(m.active ? memberStatus(m) : '已停用')}</span></div>${details([['学号 / 工号', m.number], ...(me().id === m.id || can('manageMembers') ? [['登录账号', m.username]] : []), ['研究方向', m.direction], ['加入日期', new Date(m.joined).toLocaleDateString('zh-CN')], ['状态备注', m.note || '暂无备注'], ...(me().id === m.id || can('manageMembers') ? [['联系方式', m.contact]] : []), ['最近更新', new Date(m.updated).toLocaleString('zh-CN')], ...(l ? [['请假时间', `${fmt(l.start, true)} — ${fmt(l.end, true)}`]] : [])])}`,
    '',
    null,
    editableMember(m) ? btn('编辑成员', 'member-edit', 'primary', `data-id="${m.id}"`) : '',
  );
}
function memberForm(id, self = false) {
  const m = id ? member(id) : null;
  if (self) requirePermission(m?.id === me().id);
  else requirePermission(m ? editableMember(m) : can('manageMembers'));
  const body = `<div class="form-section-heading"><span>01</span><h3>成员资料</h3></div><div class="form-grid">${field('姓名 *', 'name', m?.name || '', 30)}${!self ? field('学号 / 工号 *', 'number', m?.number || '', 30) : ''}${!self ? field('所属小组 *', 'group', m?.group || '', 40) : ''}${fields(m, { direction: ['研究方向', 80], contact: ['联系方式', 80] })}</div>${!self ? `<div class="form-section-heading"><span>02</span><h3>登录账号</h3></div><div class="form-grid">${field('登录账号 *', 'username', m?.username || '', 'text', 'pattern="[A-Za-z0-9_]{3,30}" maxlength="30" autocomplete="off" placeholder="3–30 位字母、数字或下划线"')}${selectField('角色', 'role', can('assignRoles') ? Object.entries(ROLE) : [['member', '普通成员']], m?.role || 'member')}</div>${!m ? passwordFields() : '<p class="privacy-note">编辑资料不会修改现有登录密码。</p>'}${me().role === 'manager' ? '<p class="privacy-note">负责人可创建和维护普通成员账号；角色调整由指导老师管理。</p>' : ''}` : ''}`;
  modal(
    self ? '编辑个人资料' : m ? '编辑成员' : '新增成员与账号',
    body,
    m ? '保存修改' : '创建成员账号',
    async (f) => {
      if (!m) {
        const created = await createMemberAccount(Object.fromEntries(f), f.get('newPassword'), f.get('confirmPassword'));
        render();
        showAccountCreated(created);
        return;
      }
      const data = cleanMemberData(Object.fromEntries(f), self);
      validateMemberData(data, id, self);
      if (!self && m.id === me().id) requirePermission(data.role === m.role, '不能修改自己的角色');
      await save(
        self ? '/members/me/update' : `/members/${id}/update`,
        data,
        () => {
          Object.assign(m, data, { updated: new Date().toISOString() });
          audit(`更新成员 ${data.name}`, id);
        },
        '成员资料已保存',
      );
    },
    m && !self && m.id !== me().id
      ? btn(m.active ? '停用成员' : '启用成员', 'member-toggle', m.active ? 'danger' : '', `data-id="${m.id}"`)
      : '',
  );
}

function statusForm() {
  const u = me();
  modal(
    '更新工作状态',
    `${memberStatus(u) === '请假' ? '<div class="notice warning">你当前处于已批准的请假时段，以下状态将在请假结束后显示。</div>' : ''}<div class="form-grid">${selectField('工作状态', 'status', ['空闲', '忙碌'], ['空闲', '忙碌'].includes(u.baseStatus) ? u.baseStatus : '空闲')}${area('状态备注', 'note', u.note, 'maxlength="60" placeholder="例如：调试智能小车，下午可协作"')}</div>`,
    '更新状态',
    (f) =>
      save(
        '/members/me/status',
        Object.fromEntries(f),
        () => {
          requirePermission(['空闲', '忙碌'].includes(f.get('status')));
          u.baseStatus = f.get('status');
          u.note = f.get('note').trim();
          u.updated = new Date().toISOString();
          audit(`更新工作状态为${u.baseStatus}`);
        },
        '状态已更新',
      ),
  );
}
function assetDetail(id) {
  const a = asset(id);
  requirePermission(a, '模块不存在');
  const l = activeLoan(id);
  const history = db.loans
    .filter((x) => x.assetIds.includes(id) && ['使用中', '已归还', '待确认归还'].includes(x.status))
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  const repairs = db.maintenance.filter((x) => x.assetId === id);
  modal(
    '模块详情',
    `<div class="row">${assetIcon(a)}<div><h2>${esc(a.name)}</h2><p class="mono muted" style="margin-top:5px">${esc(a.id)}</p></div><span style="margin-left:auto">${badge(assetStatus(a))}</span></div>${details(
      [
        ['型号', a.model],
        ['分类', a.category],
        ['厂商', a.vendor || '—'],
        ['关键规格', a.spec || '—'],
        ['存放位置', a.location],
        ['入库日期', new Date(a.created).toLocaleDateString('zh-CN')],
        ['当前使用者', l ? member(l.memberId)?.name : '无人使用'],
        ['预计归还', l ? fmt(l.due, true) : '—'],
        ['备注', a.note || '暂无备注'],
      ],
    )}${a.datasheet && isHttpURL(a.datasheet) ? `<p style="margin-bottom:20px"><a href="${esc(a.datasheet)}" target="_blank" rel="noopener noreferrer">查看数据手册 ↗</a></p>` : ''}<h3 style="margin:18px 0 12px">借用记录</h3>${history.map((x) => `<div class="todo"><div><strong>${esc(member(x.memberId)?.name)} · ${esc(x.project)}</strong><small>${fmt(x.issued, true)} 借出 ${x.returned ? ' · ' + fmt(x.returned, true) + ' 归还' : ''}</small></div><span style="margin-left:auto">${badge(x.status)}</span></div>`).join('') || '<p class="muted small">暂无借用历史</p>'}<h3 style="margin:20px 0 12px">维修记录</h3>${repairs.map((r) => `<div class="todo"><div><strong>${esc(r.description)}</strong><small>${fmt(r.created, true)} · ${esc(member(r.actor)?.name || '管理员')}</small></div>${badge(r.status)}</div>`).join('') || '<p class="muted small">暂无维修记录</p>'}`,
    '',
    null,
    (assetStatus(a) === '空闲' ? btn('申请借用', 'loan-new', 'primary', `data-id="${esc(id)}"`) : '') +
      (can('manageAssets') ? btn('编辑', 'asset-edit', '', `data-id="${esc(id)}"`) : ''),
  );
}
function assetForm(id) {
  requirePermission(can('manageAssets'));
  const a = id ? asset(id) : null;
  modal(
    a ? '编辑模块' : '录入模块',
    `<div class="form-grid">${field('资产编号 *', 'id', a?.id || `EM-${String(db.assets.length + 1).padStart(3, '0')}`, 'text', `required pattern="[A-Za-z0-9_-]{2,40}" title="2–40 位字母、数字、横线或下划线" ${a ? 'readonly' : ''}`)}${fields(a, { name: ['模块名称 *', 60], model: ['型号 *', 70] })}${field('分类 *', 'category', a?.category || '开发板', 'text', 'list="categories" maxlength="30"')}<datalist id="categories">${CATEGORIES.map((c) => `<option value="${c}">`).join('')}</datalist>${fields(a, { vendor: ['厂商', 60], location: ['存放位置 *', 60], spec: ['关键规格', 100], datasheet: ['数据手册链接', 'url', 'placeholder="https://…"'] })}${area('备注', 'note', a?.note || '', 300)}</div>${a ? '<p class="privacy-note">使用状态由借用流程自动管理。报废前必须完成归还，历史记录会保留。</p>' : ''}`,
    '保存模块',
    async (f) => {
      const data = cleanFields(Object.fromEntries(f));
      requirePermission(data.name && data.model && data.location && data.category, '请填写必填字段');
      requirePermission(!data.datasheet || isHttpURL(data.datasheet), '数据手册只支持 http 或 https 链接');
      requirePermission(a || !asset(data.id), '资产编号已存在');
      await save(
        a ? `/assets/${a.id}/update` : '/assets',
        data,
        () => {
          if (a) Object.assign(a, data, { id: a.id });
          else db.assets.push({ ...data, status: '空闲', created: new Date().toISOString() });
          audit(`${a ? '更新' : '录入'}模块 ${data.name} (${data.id})`);
        },
        '模块资料已保存',
      );
    },
    a && assetStatus(a) !== '使用中' && assetStatus(a) !== '已报废'
      ? `${a.status === '维修中' ? btn('维修完成', 'asset-repaired', '', `data-id="${a.id}"`) : btn('登记维修', 'asset-repair', '', `data-id="${a.id}"`)}${btn('报废', 'asset-retire', 'danger', `data-id="${a.id}"`)}`
      : '',
  );
}
function loanForm(preselected = '') {
  const available = db.assets.filter((a) => assetStatus(a) === '空闲');
  modal(
    '申请借用模块',
    `<div class="notice">选择具体资产提交申请；审批通过并发放后，模块才会变为“使用中”。</div><div class="field" style="margin-bottom:18px"><label>选择模块 * · ${available.length} 件可借用</label><div class="asset-picker">${available.map((a) => `<label class="asset-option"><input type="checkbox" name="assetIds" value="${a.id}" ${a.id === preselected ? 'checked' : ''}><span>${esc(a.name)}<small>${esc(a.id)} · ${esc(a.model)}</small></span></label>`).join('') || empty('暂无可用模块', '请等待现有模块归还。')}</div></div><div class="form-grid">${field('关联项目', 'project', '', 'text', 'maxlength="60" placeholder="例如：智能巡检小车"')}${field('预计归还时间 *', 'due', inputDate(date(7, 18)), 'datetime-local', '')}${area('借用用途 *', 'purpose', '', 'maxlength="300" placeholder="请说明你计划如何使用这些模块"')}</div>`,
    '提交申请',
    async (f) => {
      const ids = f.getAll('assetIds'),
        due = new Date(f.get('due')).toISOString();
      requirePermission(ids.length, '请至少选择一件模块');
      requirePermission(Date.parse(due) > Date.now(), '预计归还时间必须晚于当前时间');
      requirePermission(f.get('purpose').trim(), '请填写借用用途');
      requirePermission(
        ids.every((id) => asset(id) && assetStatus(asset(id)) === '空闲'),
        '所选模块已被使用，请重新选择',
      );
      requirePermission(
        !db.loans.some(
          (l) => l.memberId === me().id && ['待审批', '待发放'].includes(l.status) && l.assetIds.some((id) => ids.includes(id)),
        ),
        '你已申请过其中的模块，请先处理或撤销已有申请',
      );
      const data = { assetIds: ids, due, project: f.get('project').trim(), purpose: f.get('purpose').trim() };
      await save(
        '/loans',
        data,
        () => {
          db.loans.push({ ...data, id: uid('BR'), memberId: me().id, status: '待审批', created: new Date().toISOString() });
          audit(`申请借用 ${ids.map((id) => asset(id).name).join('、')}`);
        },
        '借用申请已提交，等待审批',
      );
    },
  );
}
function loanDetail(id) {
  const l = getLoan(id);
  modal(
    '借用记录',
    `${badge(l.status)} ${overdue(l) ? badge('逾期') : ''}${details([
      ['借用单号', l.id],
      ['申请人', member(l.memberId)?.name],
      ['模块', l.assetIds.map((id) => `${asset(id)?.name} (${id})`).join('、')],
      ['关联项目', l.project || '—'],
      ['用途', l.purpose],
      ['申请时间', fmt(l.created, true)],
      ['预计归还', fmt(l.due, true)],
      ['审批人', member(l.reviewer)?.name || '—'],
      ['审批意见', l.opinion || '—'],
      ['审批时间', fmt(l.reviewed, true)],
      ['发放时间', fmt(l.issued, true)],
      ['发放人', member(l.issuer)?.name || '—'],
      ['归还申请', fmt(l.returnRequested, true)],
      ['验收时间', fmt(l.returned, true)],
      ['验收人', member(l.receiver)?.name || '—'],
      ['验收备注', l.returnNote || '—'],
    ])}`,
    '',
    null,
    loanActions(l, false),
  );
}
// 状态迁移仅允许从合法前置状态执行；正式后端需在事务中再次校验资产占用。
function transitionLoan(id, operation, data = {}) {
  const l = getLoan(id),
    now = new Date().toISOString();
  if (operation === 'cancel') {
    requirePermission(l.memberId === me().id);
    ensureState(l, ['待审批']);
    l.status = '已撤销';
  } else if (operation === 'review') {
    reviewRequest(l, data, '待发放', l.due, '预计归还时间已过，请拒绝后重新申请');
  } else if (operation === 'issue') {
    requirePermission(canReview(l));
    ensureState(l, ['待发放']);
    requirePermission(Date.parse(l.due) > Date.now(), '预计归还时间已过，无法发放');
    requirePermission(
      l.assetIds.every((id) => asset(id) && assetStatus(asset(id)) === '空闲'),
      '模块已被借出、维修或报废，无法重复发放',
    );
    l.status = '使用中';
    l.issued = now;
    l.issuer = me().id;
  } else if (operation === 'request-return') {
    requirePermission(l.memberId === me().id);
    ensureState(l, ['使用中']);
    l.status = '待确认归还';
    l.returnRequested = now;
  } else if (operation === 'receive') {
    requirePermission(canReview(l));
    ensureState(l, ['待确认归还']);
    requirePermission(Array.isArray(data.damagedIds) && data.damagedIds.every((id) => l.assetIds.includes(id)));
    l.status = '已归还';
    l.returned = now;
    l.receiver = me().id;
    l.returnNote = data.note;
    for (const id of l.assetIds) {
      const a = asset(id),
        broken = data.damagedIds.includes(id);
      a.status = broken ? '维修中' : '空闲';
      if (broken) {
        db.maintenance.push({
          id: uid('MT'),
          assetId: id,
          description: data.note || '归还验收发现损坏',
          created: now,
          actor: me().id,
          status: '维修中',
        });
      }
    }
  } else throw new Error('无效操作');
  audit(
    `${{ cancel: '撤销借用申请', review: data.decision === 'approve' ? '批准借用申请' : '拒绝借用申请', issue: '确认发放模块', 'request-return': '申请归还模块', receive: '验收归还模块' }[operation]} · ${l.assetIds.map((id) => asset(id)?.name).join('、')}`,
    l.memberId,
  );
}
function reviewForm(kind, id) {
  const l = kind === 'loan' ? getLoan(id) : getLeave(id);
  requirePermission(canReview(l));
  ensureState(l, ['待审批']);
  modal(
    kind === 'loan' ? '审批借用申请' : '审批请假申请',
    `${details([
      ['申请人', member(l.memberId)?.name],
      [
        kind === 'loan' ? '模块' : '请假时间',
        kind === 'loan' ? l.assetIds.map((id) => asset(id)?.name).join('、') : `${fmt(l.start, true)} — ${fmt(l.end, true)}`,
      ],
      [kind === 'loan' ? '用途' : '原因', kind === 'loan' ? l.purpose : l.reason],
    ])}<div class="form-grid">${selectField('审批结果', 'decision', [
      ['approve', '通过申请'],
      ['reject', '拒绝申请'],
    ])}${area('审批意见', 'opinion', '', 'maxlength="200" placeholder="拒绝申请时请填写原因"')}</div>`,
    '确认审批',
    (f) => {
      const data = Object.fromEntries(f);
      requirePermission(data.decision !== 'reject' || data.opinion.trim(), '拒绝申请时请填写审批意见');
      return save(
        `/${kind === 'loan' ? 'loans' : 'leaves'}/${id}/review`,
        data,
        () => (kind === 'loan' ? transitionLoan(id, 'review', data) : transitionLeave(id, 'review', data)),
        '审批已完成',
      );
    },
  );
}
function returnForm(id) {
  const l = getLoan(id);
  requirePermission(canReview(l));
  ensureState(l, ['待确认归还']);
  modal(
    '验收归还模块',
    `<div class="notice">确认收到全部实物后再提交。勾选损坏的模块，将自动转入维修中；未勾选的模块恢复空闲。</div><div class="field"><label>损坏模块（完好无需勾选）</label><div class="asset-picker">${l.assetIds.map((id) => `<label class="asset-option"><input type="checkbox" name="damagedIds" value="${id}"><span>${esc(asset(id).name)}<small>${esc(id)}</small></span></label>`).join('')}</div></div><div style="margin-top:18px">${area('验收备注', 'note', '', 'maxlength="200" placeholder="存在损坏时请描述问题"')}</div>`,
    '确认已收到实物',
    (f) => {
      const data = { damagedIds: f.getAll('damagedIds'), note: f.get('note').trim() };
      requirePermission(!data.damagedIds.length || data.note, '请填写损坏情况');
      return save(`/loans/${id}/receive`, data, () => transitionLoan(id, 'receive', data), '归还已确认，库存已同步更新');
    },
  );
}
function leaveForm() {
  modal(
    '申请请假',
    `<div class="form-grid">${field('开始时间 *', 'start', inputDate(date(1, 9)), 'datetime-local', '')}${field('结束时间 *', 'end', inputDate(date(1, 18)), 'datetime-local', '')}${area('请假原因 *', 'reason', '', 'maxlength="300" placeholder="请简要填写原因，仅本人及审批人可见"')}</div><p class="privacy-note">审批通过后，在请假时段内自动显示为“请假”。公开列表不会显示你的请假原因。</p>`,
    '提交请假申请',
    (f) => {
      const data = {
        start: new Date(f.get('start')).toISOString(),
        end: new Date(f.get('end')).toISOString(),
        reason: f.get('reason').trim(),
      };
      requirePermission(data.reason, '请填写请假原因');
      requirePermission(Date.parse(data.end) > Date.parse(data.start), '结束时间必须晚于开始时间');
      requirePermission(Date.parse(data.end) > Date.now(), '请假结束时间必须晚于当前时间');
      requirePermission(
        !db.leaves.some(
          (l) =>
            l.memberId === me().id &&
            ['待审批', '已通过'].includes(l.status) &&
            Date.parse(l.start) < Date.parse(data.end) &&
            Date.parse(l.end) > Date.parse(data.start),
        ),
        '该时段已有待审批或已通过的请假申请',
      );
      return save(
        '/leaves',
        data,
        () => {
          db.leaves.push({ ...data, id: uid('LV'), memberId: me().id, status: '待审批', created: new Date().toISOString() });
          audit('提交请假申请');
          db.logs.at(-1).private = true;
        },
        '请假申请已提交',
      );
    },
  );
}
function transitionLeave(id, operation, data = {}) {
  const l = getLeave(id);
  ensureState(l, ['待审批']);
  if (operation === 'cancel') {
    requirePermission(l.memberId === me().id);
    l.status = '已撤销';
  } else if (operation === 'review') {
    reviewRequest(l, data, '已通过', l.end, '请假时间已结束，无法通过');
  } else throw new Error('无效操作');
  audit(`${operation === 'cancel' ? '撤销' : '审批'}请假申请 · ${member(l.memberId).name}`, l.memberId);
  db.logs.at(-1).private = true;
}
function leaveDetail(id) {
  const l = getLeave(id);
  modal(
    '请假详情',
    `${badge(l.status)}${details([
      ['申请人', member(l.memberId)?.name],
      ['申请时间', fmt(l.created, true)],
      ['开始时间', fmt(l.start, true)],
      ['结束时间', fmt(l.end, true)],
      ['原因', l.reason],
      ['审批人', member(l.reviewer)?.name || '—'],
      ['审批意见', l.opinion || '—'],
      ['审批时间', fmt(l.reviewed, true)],
    ])}`,
  );
}
// 简单的“按钮 → 表单”映射集中维护，业务状态迁移仍由各自处理函数校验。
const FORM_ACTIONS = {
  'member-detail': memberDetail,
  'member-new': () => memberForm(),
  'member-edit': memberForm,
  'profile-edit': () => memberForm(me().id, true),
  status: statusForm,
  'asset-detail': assetDetail,
  'asset-new': () => assetForm(),
  'asset-edit': assetForm,
  'loan-new': loanForm,
  'loan-detail': loanDetail,
  'loan-review': (id) => reviewForm('loan', id),
  'loan-receive': returnForm,
  'leave-new': leaveForm,
  'leave-review': (id) => reviewForm('leave', id),
  'leave-detail': leaveDetail,
  'competition-new': () => competitionForm(),
  'competition-edit': competitionForm,
  'competition-detail': competitionDetail,
};
async function handleAction(type, b) {
  const id = b.dataset.id;
  if (Object.hasOwn(FORM_ACTIONS, type)) return FORM_ACTIONS[type](id);
  if (type.startsWith('competition-')) return competitionAction(type, b);
  if (type === 'modal-close') {
    document.querySelector('#modal').close();
    return;
  }
  if (type === 'reload') {
    await init();
    return;
  }
  if (type === 'page') {
    page = Number(b.dataset.value);
    render();
    return;
  }
  if (type === 'clear-filter') {
    search = '';
    filter = '';
    groupFilter = '';
    page = 1;
    render();
    return;
  }
  if (type === 'member-quick-filter') {
    filter = b.dataset.value;
    page = 1;
    render();
    return;
  }
  if (type === 'notifications') {
    const todos = todoItems();
    modal(
      '待办提醒',
      todos
        .map(
          (t) =>
            `<div class="todo"><span class="todo-icon ${t.orange ? 'orange' : ''}">${icon(t.icon)}</span><div>${stack(t.title, t.description)}</div><button class="text-btn" data-action="todo-nav" data-view="${t.view}" style="margin-left:auto">查看</button></div>`,
        )
        .join('') || empty('所有待办已处理', '继续你的实验吧。'),
    );
    return;
  }
  if (type === 'todo-nav') {
    document.querySelector('#modal').close();
    go(b.dataset.view);
    return;
  }
  if (['loan-cancel', 'loan-issue', 'loan-return', 'leave-cancel'].includes(type)) return confirmRequest(type, id);
  if (type === 'member-toggle') {
    const m = member(id);
    requirePermission(editableMember(m) && m.id !== me().id);
    if (m.active)
      requirePermission(
        !db.loans.some((l) => l.memberId === id && ['使用中', '待确认归还', '待发放', '待审批'].includes(l.status)) &&
          !db.leaves.some((l) => l.memberId === id && (l.status === '待审批' || (l.status === '已通过' && Date.parse(l.end) > Date.now()))),
        '请先处理该成员的未完成借用与请假记录',
      );
    return confirmation(
      m.active ? '停用成员' : '启用成员',
      m.active ? '停用后该账号无法登录，成员历史记录会保留。' : '启用后该成员可以重新登录演示空间。',
      `/members/${id}/active`,
      { active: !m.active },
      () => {
        m.active = !m.active;
        audit(`${m.active ? '启用' : '停用'}成员 ${m.name}`, id);
      },
    );
  }
  if (['asset-repair', 'asset-repaired', 'asset-retire'].includes(type)) {
    requirePermission(can('manageAssets'));
    const a = asset(id);
    requirePermission(a && assetStatus(a) !== '使用中' && assetStatus(a) !== '已报废', '请先完成归还，报废资产不能重新操作');
    if (type === 'asset-repair') {
      requirePermission(a.status === '空闲');
      modal(
        '登记维修',
        `${details([
          ['模块', a.name],
          ['编号', a.id],
        ])}${area('故障说明 *', 'description', '', 200)}`,
        '送入维修',
        (f) => {
          const description = f.get('description').trim();
          requirePermission(description, '请填写故障说明');
          return save(
            `/assets/${id}/maintenance`,
            { description },
            () => {
              requirePermission(assetStatus(a) === '空闲', '资产已不可用');
              a.status = '维修中';
              db.maintenance.push({
                id: uid('MT'),
                assetId: id,
                description,
                created: new Date().toISOString(),
                actor: me().id,
                status: '维修中',
              });
              audit(`登记维修 ${a.name}`);
            },
            '维修记录已保存',
          );
        },
      );
      return;
    }
    const repairDone = type === 'asset-repaired';
    requirePermission(!repairDone || a.status === '维修中');
    return confirmation(
      repairDone ? '确认维修完成' : '报废模块',
      repairDone ? '确认模块功能正常并恢复可借用？' : '报废后将无法借用；资产和全部历史记录将永久保留。',
      `/assets/${id}/${repairDone ? 'repair-complete' : 'retire'}`,
      {},
      () => {
        requirePermission(assetStatus(a) !== '使用中');
        a.status = repairDone ? '空闲' : '已报废';
        db.maintenance
          .filter((r) => r.assetId === id && r.status === '维修中')
          .forEach((r) => {
            r.status = repairDone ? '已完成' : '已报废';
            r.completed = new Date().toISOString();
            r.completer = me().id;
          });
        audit(`${repairDone ? '完成维修' : '报废模块'} ${a.name}`);
      },
    );
  }
  if (type === 'reset') {
    requirePermission(CONFIG.mode === 'mock');
    modal(
      '恢复演示数据',
      '<p style="font-size:13px;line-height:1.9">这会覆盖当前浏览器中的演示修改，恢复初始成员、模块和借用记录，并退出登录。</p>',
      '确认恢复',
      async () => {
        localStorage.setItem(DB_KEY, JSON.stringify(seed()));
        sessionStorage.removeItem(SESSION_KEY);
        sessionId = null;
        await API.load();
        document.querySelector('#modal').close();
        render();
        toast('已恢复初始演示数据');
      },
    );
    return;
  }
  throw new Error('暂不支持此操作');
}
// 中文搜索与手机导航见 ux.js。
document.addEventListener('change', async (e) => {
  if (['filter', 'group-filter'].includes(e.target.id)) {
    if (e.target.id === 'filter') filter = e.target.value;
    else groupFilter = e.target.value;
    page = 1;
    render();
  }
  if (e.target.id === 'switch-account') {
    try {
      requirePermission(CONFIG.mode === 'mock');
      requirePermission(member(e.target.value)?.active);
      sessionId = e.target.value;
      sessionStorage.setItem(SESSION_KEY, sessionId);
      go('dashboard');
      toast('已切换测试身份');
    } catch (err) {
      toast(err.message, true);
    }
  }
});
// 同源标签页同步演示数据。不能替代后端数据库事务或服务端权限检查。
async function syncOtherTab(e) {
  if (e.key !== DB_KEY || CONFIG.mode !== 'mock') return;
  try {
    await API.load();
    const dialog = document.querySelector('#modal');
    if (dialog.open) {
      let notice = dialog.querySelector('[data-sync-notice]');
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'notice';
        notice.dataset.syncNotice = '';
        notice.setAttribute('role', 'status');
        dialog.querySelector('.modal-body').append(notice);
      }
      notice.textContent = '其他标签页的数据已同步，当前填写内容已保留。若其他人修改了同一条记录，请核对后再保存。';
    }
    render();
    if (!dialog.open) toast('已同步其他标签页的数据');
  } catch (err) {
    toast(err.message, true);
  }
}
window.addEventListener('storage', syncOtherTab);
let lastStatusSignature = '';
setInterval(() => {
  if (!me() || document.querySelector('#modal').open || document.activeElement?.matches('input,select,textarea')) return;
  const signature =
    db.members.map((m) => memberStatus(m)).join('|') +
    db.loans.map((l) => overdue(l)).join('|') +
    db.competitions.map((c) => competitionStatus(c)).join('|');
  if (signature !== lastStatusSignature) {
    lastStatusSignature = signature;
    render();
  }
}, 30000);
// 支持 WebMCP 的浏览器可读取当前可见库存；不支持时不影响页面功能。
if (document.modelContext?.registerTool) {
  Promise.resolve(
    document.modelContext.registerTool({
      name: 'list_available_lab_assets',
      title: '查看可借用模块',
      description: '读取当前实验室可借用模块，可按名称、型号或资产编号筛选。需要先登录。',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        requirePermission(me(), '请先登录');
        requirePermission(
          input &&
            typeof input === 'object' &&
            Object.keys(input).every((k) => k === 'query') &&
            (input.query === undefined || typeof input.query === 'string'),
          'query 必须是字符串',
        );
        const q = (input.query || '').toLowerCase();
        return {
          assets: db.assets
            .filter((a) => assetStatus(a) === '空闲' && `${a.name} ${a.model} ${a.id}`.toLowerCase().includes(q))
            .map(({ id, name, model, location }) => ({ id, name, model, location })),
        };
      },
    }),
  ).catch(() => {});
}

function confirmRequest(type, id) {
  const leave = type === 'leave-cancel',
    record = leave ? getLeave(id) : getLoan(id);
  const operation = type === 'loan-return' ? 'request-return' : type.split('-')[1];
  requirePermission(operation === 'issue' ? canReview(record) : record.memberId === me().id);
  ensureState(record, [{ cancel: '待审批', issue: '待发放', 'request-return': '使用中' }[operation]]);
  const prompts = {
    cancel: [
      leave ? '撤销请假申请' : '撤销借用申请',
      leave ? '确认撤销这条待审批的请假申请？' : '撤销后可以重新提交借用申请。',
      '确认撤销',
    ],
    'request-return': ['申请归还', '提交后请将实物交给指导老师或负责人验收。验收完成前，模块仍会保留你的使用记录。', '提交归还申请'],
    issue: [
      '确认发放模块',
      operation === 'issue'
        ? `请确认已将 ${record.assetIds.map((id) => asset(id).name).join('、')} 交给 ${member(record.memberId).name}。发放后资产将变为使用中。`
        : '',
      '确认已发放',
    ],
  };
  const [title, description, label] = prompts[operation];
  return confirmation(
    title,
    description,
    `/${leave ? 'leaves' : 'loans'}/${id}/${operation}`,
    {},
    () => (leave ? transitionLeave : transitionLoan)(id, operation),
    label,
  );
}
