'use strict';
const pages = {
  dashboard,
  competitions: competitionsPage,
  members: membersPage,
  assets: assetsPage,
  loans: loansPage,
  leaves: leavesPage,
  logs: logsPage,
  profile: profilePage,
};
function go(next) {
  if (!NAV.some((n) => n[0] === next)) return;
  view = next;
  history.replaceState(null, '', '#' + next);
  search = '';
  filter = '';
  groupFilter = '';
  page = 1;
  render();
  window.scrollTo(0, 0);
}
function loginPage() {
  return `<div class="login"><section class="login-art"><div class="brand"><div class="brandmark">${icon('chip')}</div><div><strong>芯栈 <span style="font-weight:400">Lab</span></strong><small>EMBEDDED SYSTEMS LAB</small></div></div><div class="login-copy"><div class="eyebrow">让每一次探索，有序发生</div><h1>专注创造，<br>让实验室井然有序。</h1><p>连接实验室的每一位成员、每一件设备。<br>从灵感到实践，让协作更进一步。</p></div><div class="circuit"><div class="chip">${icon('chip')}</div><div class="floating-tag one"><span class="dot"></span> &nbsp;成员协同 · 实时状态</div><div class="floating-tag two">${icon('box')} &nbsp;硬件资产 · 有迹可循</div></div><div class="login-art-footer">芯栈 LAB &nbsp; / &nbsp; 嵌入式实验室管理系统</div></section><section class="login-form-wrap"><form class="login-form" id="login-form"><div class="eyebrow">WELCOME BACK</div><h1>欢迎回到实验室</h1><p>登录你的账号，开始今天的探索。</p><div class="field"><label for="username">账号</label><input id="username" name="username" autocomplete="username" placeholder="请输入账号" required value="${CONFIG.mode === 'mock' ? 'teacher' : ''}"></div><div class="field"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required value="${CONFIG.mode === 'mock' ? 'Lab@123456' : ''}"></div><div class="row between small muted" style="margin-bottom:20px"><span>${icon('shield')} &nbsp;实验室统一工作台</span><span>${CONFIG.mode === 'mock' ? '本地演示版' : '云端登录'}</span></div><button class="btn primary" type="submit">登录工作台 ${icon('arrow')}</button><div class="form-error" id="login-error" role="alert"></div>${CONFIG.mode === 'mock' ? `<div class="test-accounts"><p>选择测试身份，自动填入账号</p><div class="account-buttons"><button type="button" data-action="fill-account" data-value="teacher">指导老师</button><button type="button" data-action="fill-account" data-value="manager">负责人</button><button type="button" data-action="fill-account" data-value="member">普通成员</button></div><small>初始测试账号密码：<span class="mono">Lab@123456</span></small></div><p class="login-caption">当前为前端演示，数据仅保存在此浏览器。<br>新成员请使用管理员创建的账号和密码。<br>阿里云后端尚未连接。</p>` : ''}</form></section></div>`;
}
function shell() {
  const u = me(),
    pending = pendingCount();
  return `<div class="overlay" data-action="close-menu"></div><aside class="sidebar" id="main-sidebar"><div class="brand"><div class="brandmark">${icon('chip')}</div><div><strong>芯栈 <span style="font-weight:400">Lab</span></strong><small>实验室管理系统</small></div></div><div class="nav-label">WORKSPACE · 工作空间</div><nav class="nav" aria-label="主导航">${NAV.map(([id, ico, title]) => `<button class="${view === id ? 'active' : ''}" data-action="nav" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${icon(ico)}<span>${title}</span>${id === 'loans' && pending ? `<span class="count">${pending}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="lab-card"><div class="row" style="gap:8px;color:#596e91">${icon('chip')}<strong>嵌入式创新实验室</strong></div><p>让设备物尽其用，让协作有迹可循。</p><div class="row" style="margin-top:12px;font-size:10px;color:#7c9b90"><span class="dot"></span>${CONFIG.mode === 'mock' ? '本地演示空间' : '云端工作空间'}</div></div><div class="sidebar-footer"><span>芯栈 Lab © 2026</span><span>v1.0</span></div></div></aside><main class="main"><header class="topbar"><div class="row"><button class="icon-btn mobile-menu" data-action="menu" aria-label="打开导航" aria-controls="main-sidebar" aria-expanded="false">${icon('menu')}</button><div class="breadcrumb"><span class="home-label">实验室管理</span><span class="home-label">/</span><span>${NAV.find((n) => n[0] === view)?.[2]}</span></div></div><div class="top-actions"><span class="mode"><span class="dot"></span>${CONFIG.mode === 'mock' ? '本地演示 · 数据已保存于浏览器' : 'API 模式'}</span><button class="icon-btn" data-action="notifications" aria-label="查看待办通知">${icon('bell')}${pending ? '<i class="notification-dot"></i>' : ''}</button><span class="divider"></span><button class="row" data-action="nav" data-view="profile" style="gap:10px" aria-label="打开个人中心">${avatar(u)}<span class="profile-name">${esc(u.name)}<small>${ROLE[u.role]}</small></span>${icon('down')}</button><button class="icon-btn" data-action="logout" aria-label="退出登录" title="退出登录">${icon('logout')}</button></div></header><div class="content" id="content">${renderView()}</div></main>`;
}
function dashboard() {
  const people = db.members.filter((m) => m.active),
    assets = countStatuses(db.assets, assetStatus),
    members = countStatuses(people, memberStatus);
  const available = assets['空闲'] || 0,
    using = assets['使用中'] || 0,
    repair = assets['维修中'] || 0,
    retired = assets['已报废'] || 0,
    total = db.assets.length;
  const free = members['空闲'] || 0,
    busy = members['忙碌'] || 0,
    leave = members['请假'] || 0,
    offline = members['离线'] || 0,
    late = db.loans.filter(overdue).length;
  const usage = Math.round(percentage(using, total - retired)),
    todos = todoItems();
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const active = db.loans.filter(isActiveLoan);
  return `${heading(`你好，${esc(me().name)} <span style="font-size:22px">☀️</span>`, `今天是 ${today}，一起让实验室高效运转。`, btn(`${icon('calendar')} 申请请假`, 'leave-new') + btn(`${icon('plus')} 借用模块`, 'loan-new', 'primary'), 'LAB OVERVIEW / 实验室概览')}<div class="stats">${statsCard('实验室成员', people.length, '人', 'users', '', `<span class="mini-tag">${free} 人空闲</span><span>${busy} 忙碌 · ${leave} 请假 · ${offline} 离线</span>`)}${statsCard('硬件模块', total, '件', 'chip', 'purple', `<span>${new Set(db.assets.map((a) => a.category)).size} 个分类</span><span>·</span><span>${new Set(db.assets.map((a) => a.model)).size} 种型号</span>`)}${statsCard('可用模块', available, '件', 'box', 'green', `<span class="mini-tag">随时可借用</span><span>${using} 件使用中</span>`)}${statsCard('待处理事项', can('approve') ? pendingCount() : db.loans.filter((l) => l.memberId === me().id && l.status === '待审批').length, '项', 'clock', 'orange', `<span style="color:${late ? '#cf8a43' : '#8992a4'}">${late} 笔借用已逾期</span><span>·</span><span>${repair} 件维修中</span>`)}</div><div class="grid-main"><div><section class="panel"><div class="panel-head"><h2>成员状态 <span>${people.length} 位成员</span></h2><div class="legend"><span><i style="background:#26a078"></i>空闲</span><span><i style="background:#547ce2"></i>忙碌</span><span><i style="background:#d29740"></i>请假</span></div></div><div class="member-grid">${people.slice(0, 6).map(memberCard).join('')}</div><div class="panel-foot"><span><span class="dot" style="width:4px;height:4px"></span> &nbsp;状态根据当前记录计算 · 在线情况为模拟</span><button class="text-btn" data-action="nav" data-view="members">查看全部成员 ${icon('arrow')}</button></div></section><section class="panel"><div class="panel-head"><div><h2>正在使用的模块</h2><p>追踪设备去向，让每一件硬件都有记录</p></div><button class="text-btn" data-action="nav" data-view="loans">全部记录 ${icon('chevron')}</button></div><div class="table-wrap"><table><thead><tr><th>模块 / 型号</th><th>使用者</th><th>预计归还</th><th>状态</th></tr></thead><tbody>${active
    .flatMap((l) =>
      l.assetIds.map((id) => {
        const a = asset(id);
        return `<tr><td><button class="row" style="text-align:left;padding:0" data-action="asset-detail" data-id="${a.id}">${assetIcon(a)}<span><strong>${esc(a.name)}</strong><small class="mono">${esc(a.id)}</small></span></button></td><td>${esc(member(l.memberId)?.name)}</td><td style="color:${overdue(l) ? '#d28370' : 'inherit'}">${fmt(l.due)}</td><td>${badge(overdue(l) ? '逾期' : l.status)}</td></tr>`;
      }),
    )
    .slice(0, 5)
    .join(
      '',
    )}</tbody></table>${!active.length ? empty('暂无借出模块', '当前所有可用设备均已归还。') : ''}</div></section></div><div class="grid-side"><section class="panel"><div class="panel-head"><h2>模块使用概况</h2><span class="small muted">共 ${total} 件</span></div><div class="utilization"><div class="donut" style="background:conic-gradient(#6487ec 0 ${percentage(using, total)}%,#69bba3 ${percentage(using, total)}% ${percentage(using + available, total)}%,#e8bf79 ${percentage(using + available, total)}% ${percentage(using + available + repair, total)}%,#e7ebf3 0)"><div class="donut-label"><strong>${usage}<span style="display:inline;font-size:17px;color:#324057">%</span></strong><span>在册资产使用率</span></div></div><div class="chart-legend">${[
    ['使用中', using, '#6487ec'],
    ['空闲', available, '#69bba3'],
    ['维修中', repair, '#e8bf79'],
    ['已报废', retired, '#dfe5ef'],
  ]
    .map(([s, n, c]) => `<div><i style="background:${c}"></i>${s}<b>${n}</b></div>`)
    .join(
      '',
    )}</div></div><div class="usage-bottom"><span>设备可借用率（含全部资产）</span><strong>${Math.round(percentage(available, total))}% 可借用 ${icon('check')}</strong></div></section><section class="panel"><div class="panel-head"><h2>${can('approve') ? '待办提醒' : '我的提醒'} <span>${todos.length}</span></h2><button class="text-btn" data-action="notifications">查看全部</button></div><div class="todo-list">${
    todos
      .slice(0, 3)
      .map(
        (t) =>
          `<div class="todo"><span class="todo-icon ${t.orange ? 'orange' : ''}">${icon(t.icon)}</span><div>${stack(t.title, t.description)}</div><button class="arrow" data-action="nav" data-view="${t.view}" aria-label="查看${esc(t.title)}">${icon('chevron')}</button></div>`,
      )
      .join('') || empty('暂无待办', '可以专注于你的实验了。')
  }</div></section><section class="panel"><div class="panel-head"><h2>最近动态</h2><span class="small muted">实验室足迹</span></div><div class="activity">${
    visibleLogs()
      .slice(0, 3)
      .map((l) => `<div class="activity-item">${esc(l.actor)} · ${esc(l.text)}<small>${fmt(l.at, true)}</small></div>`)
      .join('') || '<span class="small muted">暂无动态</span>'
  }</div></section></div></div>${competitionOverview()}<footer class="page-footer"><span>© 2026 芯栈 Lab · 嵌入式创新实验室</span><span><span class="dot"></span>本地演示数据 &nbsp; / &nbsp; 最后刷新 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></footer>`;
}
function renderView() {
  return Object.hasOwn(pages, view) ? pages[view]() : empty('页面不存在', '请从导航选择页面。');
}
function render() {
  const root = document.querySelector('#app');
  root.innerHTML = me() ? shell() : loginPage();
  syncNavigationAccessibility();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  try {
    await action(b.dataset.action, b);
  } catch (err) {
    toast(err.message, true);
  }
});
document.addEventListener('submit', async (e) => {
  const login = e.target.id === 'login-form';
  if (!login && (e.target.id !== 'modal-form' || !modalSubmit)) return;
  e.preventDefault();
  const button = e.target.querySelector('button[type=submit]'),
    label = button.innerHTML;
  button.disabled = true;
  button.textContent = login ? '正在登录…' : '正在保存…';
  try {
    const form = new FormData(e.target);
    if (login) {
      await API.login(form.get('username').trim(), form.get('password'));
      go('dashboard');
    } else await modalSubmit(form);
  } catch (err) {
    document.querySelector(login ? '#login-error' : '#modal-error').textContent = err.message;
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
});
async function action(type, b) {
  if (type === 'fill-account') {
    document.querySelector('#username').value = b.dataset.value;
    document.querySelector('#password').value = 'Lab@123456';
    return;
  }
  if (type === 'nav') {
    go(b.dataset.view);
    return;
  }
  if (type === 'logout') {
    await API.logout();
    render();
    return;
  }
  if (type === 'menu') {
    setMobileMenu(true);
    return;
  }
  if (type === 'close-menu') {
    setMobileMenu(false);
    return;
  }
  return handleAction(type, b);
}
async function init() {
  try {
    await API.load();
    const route = location.hash.slice(1);
    if (NAV.some((n) => n[0] === route)) view = route;
    render();
  } catch (e) {
    document.querySelector('#app').innerHTML =
      `<div class="loading"><h2>暂时无法读取数据</h2><p style="margin:15px">${esc(e.message)}</p>${btn('重试', 'reload')}${CONFIG.mode === 'mock' ? btn('恢复演示数据', 'reset') : ''}</div>`;
  }
}
window.addEventListener('hashchange', () => {
  const route = location.hash.slice(1);
  if (NAV.some((n) => n[0] === route)) go(route);
});

document.addEventListener('DOMContentLoaded', init, { once: true });
