'use strict';
const PATHS = {
  trophy: 'M8 3h8v7a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  chip: 'M5 5h14v14H5zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M8 14h2M14 14h2M8 18h2',
  swap: 'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  history: 'M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2',
  user: 'M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  clock: 'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  logout: 'M9 4H4v16h5M9 12h12m-4-4 4 4-4 4',
  menu: 'M3 6h18M3 12h18M3 18h18',
  box: 'm3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10M7 4l10 6',
  tool: 'm14 6 4 4M14 6a6 6 0 0 0-7 7l-5 5 4 4 5-5a6 6 0 0 0 7-7M14 6l4-4 4 4-4 4',
  wifi: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01',
  file: 'M14 2H4v20h16V8l-6-6Zm0 0v6h6M8 13h8M8 17h6',
  refresh: 'M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6',
  shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6',
};
function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name] || PATHS.chip}"/></svg>`;
}
function badge(s) {
  const colors = {
    报名中: 'green',
    进行中: 'blue',
    准备中: 'orange',
    未开放: 'purple',
    空闲: 'green',
    使用中: 'blue',
    忙碌: 'blue',
    请假: 'orange',
    离线: '',
    维修中: 'orange',
    已报废: '',
    待审批: 'orange',
    已通过: 'green',
    待发放: 'purple',
    待确认归还: 'purple',
    已归还: 'green',
    已拒绝: 'red',
    已撤销: '',
    逾期: 'red',
    已完成: 'green',
    已停用: '',
  };
  return `<span class="badge ${colors[s] || ''}">${esc(s)}</span>`;
}
function avatar(m) {
  return `<span class="avatar a${Math.max(0, db.members.indexOf(m)) % 5}">${esc(m?.name?.slice(-2) || '未知')}</span>`;
}
function assetIcon(a) {
  return `<span class="hardware-icon ${a.category === '通信模块' ? 'comm' : a.category === '传感器' ? 'sensor' : ''}">${icon(a.category === '通信模块' ? 'wifi' : a.category === '调试工具' ? 'tool' : 'chip')}</span>`;
}
function btn(text, action, cls = '', extra = '') {
  return `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${text}</button>`;
}
function empty(title = '暂无记录', description = '调整筛选条件，或新增一条记录。') {
  return `<div class="empty">${icon('box')}<strong>${title}</strong>${description}</div>`;
}
function toast(message, error = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.textContent = message;
  document.querySelector('#toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}
function heading(title, subtitle, buttons = '', eyebrow = '') {
  return `<div class="page-heading"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1><p>${subtitle}</p></div><div class="controls-wrap">${buttons}</div></div>`;
}
function statsCard(title, value, unit, ico, color, foot) {
  return `<div class="stat"><div class="stat-top"><span>${title}</span><span class="stat-icon ${color}">${icon(ico)}</span></div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-foot">${foot}</div></div>`;
}
function options(values, selected = '', all = '') {
  return (
    (all ? `<option value="">${all}</option>` : '') +
    values
      .map((x) => {
        const [value, label] = Array.isArray(x) ? x : [x, x];
        return `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`;
      })
      .join('')
  );
}
function toolbar(placeholder, statuses, groups = []) {
  return `<div class="toolbar"><div class="search-field">${icon('search')}<input aria-label="搜索" id="search" placeholder="${placeholder}" value="${esc(search)}"></div><select aria-label="状态筛选" id="filter">${options(statuses, filter, '全部状态')}</select>${groups.length ? `<select aria-label="分类筛选" id="group-filter">${options(groups, groupFilter, '全部分类')}</select>` : ''}<button class="text-btn" data-action="clear-filter">重置筛选</button></div>`;
}
function paginate(items) {
  const count = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  page = Math.min(page, count);
  return {
    rows: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    footer: `<div class="pagination"><span>共 ${items.length} 条记录 · 第 ${page} / ${count} 页</span><div class="row" style="gap:6px">${btn('上一页', 'page', 'small', `data-value="${page - 1}" ${page === 1 ? 'disabled' : ''}`)}<button class="current" disabled>${page}</button>${btn('下一页', 'page', 'small', `data-value="${page + 1}" ${page === count ? 'disabled' : ''}`)}</div></div>`,
  };
}
function details(entries) {
  return `<dl class="detail-grid">${entries.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v ?? '—')}</dd></div>`).join('')}</dl>`;
}
function field(label, name, value = '', type = 'text', extra = '') {
  if (typeof type === 'number') {
    extra = type;
    type = 'text';
  }
  return control(label, name, `<input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${fieldAttrs(label, extra)}>`);
}
function selectField(label, name, values, selected = '') {
  return control(label, name, `<select id="f-${name}" name="${name}">${options(values, selected)}</select>`);
}
function area(label, name, value = '', extra = '') {
  return control(label, name, `<textarea id="f-${name}" name="${name}" ${fieldAttrs(label, extra)}>${esc(value)}</textarea>`, true);
}
let modalSubmit = null;
function modal(title, body, submit = '', callback = null, footer = '') {
  const d = document.querySelector('#modal');
  if (d.open) d.close();
  modalSubmit = callback;
  d.innerHTML = `<div class="modal-header"><h2 id="modal-title">${title}</h2><button type="button" class="icon-btn" data-action="modal-close" aria-label="关闭弹窗">${icon('close')}</button></div><form id="modal-form"><div class="modal-body">${body}<div class="form-error" id="modal-error" role="alert"></div></div><div class="modal-footer">${footer}${btn(submit ? '取消' : '关闭', 'modal-close')}${submit ? `<button type="submit" class="btn primary">${submit}</button>` : ''}</div></form>`;
  d.showModal();
}
async function save(path, payload, callback, message = '已保存') {
  await API.mutate(path, payload, callback);
  document.querySelector('#modal').close();
  render();
  toast(message);
}
function confirmation(title, description, path, payload, callback, label = '确认') {
  modal(title, `<p style="line-height:1.9;font-size:13px">${esc(description)}</p>`, label, () => save(path, payload, callback, '操作成功'));
}
function memberCard(m) {
  return `<button class="member-card" data-action="member-detail" data-id="${m.id}"><div class="row" style="gap:9px">${avatar(m)}<div><strong>${esc(m.name)}</strong><small>${ROLE[m.role]}</small></div></div><div class="member-card-bottom">${badge(memberStatus(m))}<span>${esc(m.group)}</span></div></button>`;
}

function recordButton(label, action, id) {
  return `<button class="text-btn" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
}
function dataTable(p, columns, row, emptyText = []) {
  return `<div class="table-wrap"><table><thead><tr>${columns.map((label) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${p.rows
    .map(
      (item) =>
        `<tr>${row(item)
          .map((cell) => (Array.isArray(cell) ? `<td${cell[1]}>${cell[0]}</td>` : `<td>${cell}</td>`))
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>${p.rows.length ? '' : empty(...emptyText)}</div>${p.footer}`;
}

function control(label, name, input, full = false) {
  return `<div class="field${full ? ' full' : ''}"><label for="f-${name}">${label}</label>${input}</div>`;
}
function fieldAttrs(label, extra) {
  const attrs = typeof extra === 'number' ? `maxlength="${extra}"` : extra;
  return (label.endsWith('*') && !/\brequired\b/.test(attrs) ? 'required ' : '') + attrs;
}

function stack(title, subtitle) {
  return `<strong>${esc(title)}</strong><small>${esc(subtitle)}</small>`;
}

// 中文输入法合成期间不重绘输入框；确认输入后再刷新结果。
let searchComposing = false,
  searchTimer = null;
function applySearch(input) {
  if (!input || input.id !== 'search') return;
  search = input.value;
  const position = input.selectionStart;
  page = 1;
  const content = document.querySelector('#content');
  if (!content) return;
  content.innerHTML = renderView();
  const replacement = document.querySelector('#search');
  if (replacement) {
    replacement.focus();
    replacement.setSelectionRange(position, position);
  }
}
document.addEventListener('compositionstart', (e) => {
  if (e.target.id === 'search') {
    searchComposing = true;
    clearTimeout(searchTimer);
  }
});
document.addEventListener('compositionend', (e) => {
  if (e.target.id === 'search') {
    searchComposing = false;
    clearTimeout(searchTimer);
    applySearch(e.target);
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'search' || e.isComposing || searchComposing) return;
  clearTimeout(searchTimer);
  const input = e.target;
  searchTimer = setTimeout(() => {
    if (input.isConnected) applySearch(input);
  }, 180);
});
function syncNavigationAccessibility() {
  const aside = document.querySelector('.sidebar');
  if (!aside) return;
  const mobile = window.matchMedia('(max-width:700px)').matches,
    open = aside.classList.contains('open');
  aside.inert = mobile && !open;
  const trigger = document.querySelector('[data-action="menu"]');
  if (trigger) trigger.setAttribute('aria-expanded', String(open));
  if (!mobile) {
    aside.classList.remove('open');
    document.querySelector('.overlay')?.classList.remove('open');
  }
}
function setMobileMenu(open) {
  document.querySelector('.sidebar')?.classList.toggle('open', open);
  document.querySelector('.overlay')?.classList.toggle('open', open);
  syncNavigationAccessibility();
  if (open) document.querySelector('.nav button.active')?.focus();
  else document.querySelector('[data-action="menu"]')?.focus();
}
window.addEventListener('resize', syncNavigationAccessibility);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.querySelector('.sidebar.open')) setMobileMenu(false);
});
document.addEventListener('change', (e) => {
  if (e.target.id !== 'show-new-password') return;
  for (const name of ['newPassword', 'confirmPassword']) {
    const input = document.querySelector(`[name="${name}"]`);
    if (input) input.type = e.target.checked ? 'text' : 'password';
  }
});
function memberStatusSummary() {
  const active = db.members.filter((m) => m.active),
    counts = countStatuses(active, memberStatus);
  return `<div class="member-status-summary">${[
    ['', '全部成员', db.members.length, 'users'],
    ['空闲', '当前空闲', counts['空闲'] || 0, 'check'],
    ['忙碌', '正在忙碌', counts['忙碌'] || 0, 'chip'],
    ['请假', '请假中', counts['请假'] || 0, 'calendar'],
  ]
    .map(
      ([value, label, count, ico]) =>
        `<button class="member-status-tile ${filter === value ? 'selected' : ''}" data-action="member-quick-filter" data-value="${value}" aria-pressed="${filter === value}"><span class="stat-icon ${value === '空闲' ? 'green' : value === '请假' ? 'orange' : ''}">${icon(ico)}</span><span><small>${label}</small><b>${count}<i>人</i></b></span>${icon('chevron')}</button>`,
    )
    .join('')}</div>`;
}

// 一组同源字段只声明名称与约束，取值、必填和 HTML 转义共用 field。
function fields(record, spec) {
  return Object.entries(spec)
    .map(([name, [label, ...attrs]]) => field(label, name, record?.[name] || '', ...attrs))
    .join('');
}
