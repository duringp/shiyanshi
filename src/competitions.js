'use strict';
function competitionStatus(c) {
  const now = Date.now();
  if (c.archived) return '已归档';
  if (now > Date.parse(c.end)) return '已结束';
  if (now >= Date.parse(c.start)) return '进行中';
  if (now >= Date.parse(c.registrationStart) && now <= Date.parse(c.registrationEnd)) return '报名中';
  if (now < Date.parse(c.registrationStart)) return '未开放';
  return '准备中';
}
function competitionBadge(c) {
  return badge(competitionStatus(c));
}
function fullDate(v) {
  return new Date(v).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
function competitionById(id) {
  const c = db.competitions.find((c) => c.id === id);
  requirePermission(c, '比赛记录不存在');
  return c;
}
function upcomingCompetitions() {
  return db.competitions
    .filter((c) => !c.archived && Date.parse(c.end) >= Date.now())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
function competitionOverview() {
  const upcoming = upcomingCompetitions();
  return `<section class="panel"><div class="panel-head"><div><h2>${icon('trophy')} 近期比赛 <span>${upcoming.length} 场</span></h2><p>关注赛程与报名截止时间，提前安排项目进度</p></div><button class="text-btn" data-action="nav" data-view="competitions">全部比赛 ${icon('chevron')}</button></div><div class="competition-overview">${
    upcoming
      .slice(0, 3)
      .map(
        (c) =>
          `<button class="competition-brief" data-action="competition-detail" data-id="${esc(c.id)}"><span class="contest-date"><b>${new Date(c.start).getDate()}</b><small>${new Date(c.start).getMonth() + 1} 月</small></span><span class="stack" style="text-align:left;flex:1;min-width:0"><strong>${esc(c.name)}</strong><small class="muted">${fmt(c.start)} 开赛 · ${fmt(c.registrationEnd)} 报名截止</small></span>${competitionBadge(c)}</button>`,
      )
      .join('') || empty('暂无近期比赛', '管理人员可在比赛管理中录入赛事。')
  }</div></section>`;
}
function competitionsPage() {
  const all = db.competitions,
    list = all
      .filter(
        (c) =>
          matches(c.name, c.organizer, c.location, member(c.ownerId)?.name) &&
          (!filter || competitionStatus(c) === filter) &&
          (!groupFilter || c.level === groupFilter),
      )
      .sort((a, b) => Number(a.archived) - Number(b.archived) || Date.parse(a.start) - Date.parse(b.start)),
    p = paginate(list);
  const current = all.filter((c) => !c.archived),
    open = current.filter((c) => competitionStatus(c) === '报名中').length,
    soon = current.filter((c) => Date.parse(c.start) >= Date.now() && Date.parse(c.start) <= Date.now() + 7 * 86400000).length;
  return `${heading('比赛管理', '从报名到答辩，集中掌握赛程、流程与参赛要求。', can('manageCompetitions') ? btn(`${icon('plus')} 新增比赛`, 'competition-new', 'primary') : '', 'COMPETITIONS / 赛事安排')}<div class="stats">${statsCard('赛事记录', current.length, '场', 'trophy', '', `<span>完整保存比赛安排与须知</span>`)}${statsCard('正在报名', open, '场', 'file', 'green', '<span>留意截止时间，提前完成组队</span>')}${statsCard('近 7 天开赛', soon, '场', 'calendar', 'orange', '<span>提前准备设备与参赛材料</span>')}${statsCard('进行中的比赛', current.filter((c) => competitionStatus(c) === '进行中').length, '场', 'clock', 'purple', '<span>按流程节点推进比赛</span>')}</div><div class="notice">页面内初始赛事均为演示案例，时间相对当前日期生成。正式比赛请以主办方最新通知为准。</div><section class="panel">${toolbar('搜索比赛名称、主办方、地点、负责人…', ['未开放', '报名中', '准备中', '进行中', '已结束', '已归档'], ['实验室', '校级', '省级', '国家级', '国际级'])}<div class="competition-cards">${
    p.rows
      .map((c) => {
        const next = c.stages.filter((s) => Date.parse(s.at) >= Date.now()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
        return `<article class="contest-card"><div class="row between"><span class="contest-category">${icon('trophy')} ${esc(c.level)} · ${esc(c.category)}</span>${competitionBadge(c)}</div><h2>${esc(c.name)}</h2><p class="contest-summary">${esc(c.summary || '查看比赛详情，了解完整安排。')}</p><div class="contest-meta"><div>${icon('calendar')}<span>比赛时间<strong>${fullDate(c.start)} — ${fmt(c.end, true)}</strong></span></div><div>${icon('clock')}<span>报名截止<strong>${fullDate(c.registrationEnd)}</strong></span></div><div>${icon('users')}<span>比赛负责人<strong>${esc(member(c.ownerId)?.name || '待指定')} · ${esc(c.teamSize || '不限')}</strong></span></div></div><div class="contest-next"><span class="dot" style="background:${next ? '#6487ec' : '#adb6c5'}"></span><span>${next ? `下一节点：${esc(next.title)} · ${fmt(next.at, true)}` : '所有计划节点时间已到'}</span></div><div class="row between"><span class="small muted">${esc(c.location)}</span><div style="flex-shrink:0">${recordButton(`查看赛程 ${icon('chevron')}`, 'competition-detail', c.id)}${can('manageCompetitions') ? recordButton('编辑', 'competition-edit', c.id) : ''}</div></div></article>`;
      })
      .join('') || empty('暂无匹配的比赛', '调整筛选条件，或新增比赛记录。')
  }</div>${p.footer}</section>`;
}
function competitionDetail(id) {
  const c = competitionById(id),
    stages = [...c.stages].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  modal(
    '比赛详情',
    `<div class="row between" style="margin-bottom:12px"><span class="contest-category">${icon('trophy')} ${esc(c.level)} · ${esc(c.category)}</span>${competitionBadge(c)}</div><h1 style="font-size:23px;line-height:1.5">${esc(c.name)}</h1><p class="small muted" style="line-height:1.9;margin-top:10px">${esc(c.summary)}</p>${details(
      [
        ['主办方', c.organizer],
        ['负责人', member(c.ownerId)?.name || '待指定'],
        ['报名开始', fullDate(c.registrationStart)],
        ['报名截止', fullDate(c.registrationEnd)],
        ['比赛开始', fullDate(c.start)],
        ['比赛结束', fullDate(c.end)],
        ['比赛地点', c.location],
        ['组队要求', c.teamSize || '不限'],
      ],
    )}${c.link && isHttpURL(c.link) ? `<p style="margin-bottom:20px"><a href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">官方通知 / 比赛官网 ↗</a></p>` : ''}<h2 style="margin:24px 0 18px">比赛流程</h2><div class="contest-timeline">${stages.map((s, i) => `<div class="stage-item ${Date.parse(s.at) < Date.now() ? 'past' : ''}"><span class="stage-number">${i + 1}</span><div><div class="row between" style="gap:8px"><strong>${esc(s.title)}</strong><small>${Date.parse(s.at) < Date.now() ? '计划时间已到' : '待进行'}</small></div><time>${fullDate(s.at)}</time><p>${esc(s.description)}</p></div></div>`).join('')}</div><h2 style="margin:23px 0 14px">参赛须知</h2><div class="contest-requirements">${esc(c.requirements || '暂无补充须知。').replace(/\n/g, '<br>')}</div><p class="privacy-note">流程标签只表示计划时间是否已到，不代表实际任务已完成。正式安排以主办方通知为准。</p>`,
    '',
    null,
    can('manageCompetitions') ? btn('编辑比赛', 'competition-edit', 'primary', `data-id="${esc(id)}"`) : '',
  );
}
function stageFields(stage = { title: '', at: date(7, 18), description: '' }) {
  return `<div class="stage-form-row"><div class="row between"><strong class="small">流程节点</strong><button class="icon-btn" type="button" data-action="competition-stage-remove" aria-label="移除此流程节点">${icon('close')}</button></div><div class="form-grid"><div class="field"><label>节点名称 *<input name="stageTitle" aria-label="节点名称" value="${esc(stage.title)}" required maxlength="50" placeholder="例如：作品提交"></label></div><div class="field"><label>节点时间 *<input type="datetime-local" aria-label="节点时间" name="stageDate" required value="${inputDate(stage.at)}"></label></div><div class="field full"><label>节点说明<input name="stageDescription" aria-label="节点说明" value="${esc(stage.description)}" maxlength="200" placeholder="该阶段需要准备或完成的事项"></label></div></div></div>`;
}
function competitionForm(id) {
  requirePermission(can('manageCompetitions'));
  const c = id ? competitionById(id) : null;
  modal(
    c ? '编辑比赛' : '新增比赛',
    `<div class="form-grid">${fields(c, { name: ['比赛名称 *', 80], organizer: ['主办方 *', 80] })}${selectField('比赛级别', 'level', ['实验室', '校级', '省级', '国家级', '国际级'], c?.level || '校级')}${field('比赛方向', 'category', c?.category || '嵌入式设计', 40)}${field('报名开始 *', 'registrationStart', inputDate(c?.registrationStart || date(0, 9)), 'datetime-local', '')}${field('报名截止 *', 'registrationEnd', inputDate(c?.registrationEnd || date(7, 18)), 'datetime-local', '')}${field('比赛开始 *', 'start', inputDate(c?.start || date(14, 9)), 'datetime-local', '')}${field('比赛结束 *', 'end', inputDate(c?.end || date(14, 18)), 'datetime-local', '')}${field('比赛地点 *', 'location', c?.location || '', 100)}${selectField(
      '比赛负责人',
      'ownerId',
      db.members.filter((m) => m.active || m.id === c?.ownerId).map((m) => [m.id, m.name]),
      c?.ownerId || me().id,
    )}${fields(c, { teamSize: ['组队要求', 'text', 'maxlength="60" placeholder="例如：2–4 人 / 队"'], link: ['官方通知链接', 'url', 'placeholder="https://…"'] })}${area('比赛简介', 'summary', c?.summary || '', 400)}${area('参赛须知 *', 'requirements', c?.requirements || '', 'maxlength="4000" placeholder="填写参赛资格、材料清单、评分规则和现场注意事项，可换行分条。"')}</div><div class="row between" style="margin:24px 0 12px"><h3>比赛流程 *</h3>${btn(`${icon('plus')} 添加节点`, 'competition-stage-add', 'small')}</div><div id="stage-fields">${(
      c?.stages || [
        { title: '报名截止', at: date(7, 18), description: '完成组队并提交报名信息。' },
        { title: '正式比赛', at: date(14, 9), description: '按主办方要求参加比赛。' },
      ]
    )
      .map(stageFields)
      .join('')}</div><p class="privacy-note">可添加报名、初赛、提交作品、决赛、答辩、结果公布等节点，保存后按时间自动排序。</p>`,
    '保存比赛',
    async (f) => {
      const data = cleanFields(Object.fromEntries([...f].filter(([k]) => !k.startsWith('stage'))));
      for (const key of ['name', 'organizer', 'location', 'requirements'])
        requirePermission(data[key], '请填写比赛名称、主办方、地点和参赛须知');
      for (const key of ['registrationStart', 'registrationEnd', 'start', 'end']) data[key] = new Date(data[key]).toISOString();
      requirePermission(Date.parse(data.registrationEnd) > Date.parse(data.registrationStart), '报名截止时间必须晚于报名开始');
      requirePermission(Date.parse(data.start) >= Date.parse(data.registrationEnd), '比赛开始时间不能早于报名截止');
      requirePermission(Date.parse(data.end) > Date.parse(data.start), '比赛结束时间必须晚于比赛开始');
      requirePermission(!data.link || isHttpURL(data.link), '官方通知链接只支持 http 或 https');
      requirePermission(member(data.ownerId), '请选择有效负责人');
      const titles = f.getAll('stageTitle'),
        dates = f.getAll('stageDate'),
        descriptions = f.getAll('stageDescription');
      requirePermission(titles.length >= 1 && titles.length <= 20, '请保留 1–20 个流程节点');
      data.stages = titles
        .map((title, i) => {
          requirePermission(title.trim(), '流程节点名称不能为空');
          return { title: title.trim(), at: new Date(dates[i]).toISOString(), description: descriptions[i].trim() };
        })
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      await save(
        c ? `/competitions/${id}/update` : '/competitions',
        data,
        () => {
          if (c) Object.assign(c, data, { updated: new Date().toISOString() });
          else db.competitions.push({ ...data, id: uid('COMP'), archived: false, created: new Date().toISOString() });
          audit(`${c ? '更新' : '新增'}比赛 ${data.name}`);
        },
        '比赛安排已保存',
      );
    },
    c ? btn(c.archived ? '恢复展示' : '归档比赛', 'competition-archive', c.archived ? '' : 'danger', `data-id="${esc(c.id)}"`) : '',
  );
}
async function competitionAction(type, b) {
  const id = b.dataset.id;
  if (type === 'competition-stage-add') {
    requirePermission(document.querySelectorAll('.stage-form-row').length < 20, '最多添加 20 个节点');
    document.querySelector('#stage-fields').insertAdjacentHTML('beforeend', stageFields());
    document.querySelector('#stage-fields').lastElementChild.querySelector('input').focus();
    return;
  }
  if (type === 'competition-stage-remove') {
    requirePermission(document.querySelectorAll('.stage-form-row').length > 1, '请至少保留一个比赛流程节点');
    b.closest('.stage-form-row').remove();
    return;
  }
  if (type === 'competition-archive') {
    requirePermission(can('manageCompetitions'));
    const c = competitionById(id);
    return confirmation(
      c.archived ? '恢复比赛展示' : '归档比赛',
      c.archived
        ? '恢复后这场比赛会重新出现在近期比赛与统计中。'
        : '归档后不再出现在近期比赛中，完整赛程与参赛须知仍可按“已归档”筛选查看。',
      `/competitions/${id}/archive`,
      { archived: !c.archived },
      () => {
        c.archived = !c.archived;
        audit(`${c.archived ? '归档' : '恢复'}比赛 ${c.name}`);
      },
    );
  }
}
