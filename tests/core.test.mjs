import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(match => match[1]);
const source = scripts.map(path => readFileSync(new URL('../'+path, import.meta.url), 'utf8'));
const app = source.join('\n');
function setup() {
  const memory = new Map(),
    session = new Map();
  const storage = (m) => ({
    getItem: (k) => m.get(k) || null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  });
  const context = vm.createContext({
    console,
    Date,
    Math,
    JSON,
    Promise,
    AbortController,
    FormData,
    TextEncoder,
    crypto: webcrypto,
    Uint8Array,
    setTimeout,
    clearTimeout,
    setInterval: () => {},
    localStorage: storage(memory),
    sessionStorage: storage(session),
    document: {
      addEventListener() {},
      querySelector() {
        return { close() {}, open: false, innerHTML: '', append() {} };
      },
      createElement() {
        return { remove() {} };
      },
    },
    window: {
      addEventListener() {},
      scrollTo() {},
      matchMedia() {
        return { matches: false };
      },
    },
  });
  // 浏览器逐个执行脚本；分别执行才能发现跨文件初始化顺序错误。
  source.forEach(script => vm.runInContext(script, context));
  const run = (code) => vm.runInContext(code, context);
  run("db=seed();sessionId='m1'");
  return { run, context, memory };
}
test('种子库存总数、占用和成员状态一致', () => {
  const { run } = setup();
  assert.equal(run('db.members.length'), 8);
  assert.equal(run('db.assets.length'), 18);
  assert.equal(run("db.assets.filter(a=>assetStatus(a)==='使用中').length"), 5);
  assert.equal(run("db.assets.filter(a=>assetStatus(a)==='空闲').length"), 10);
  assert.equal(run("memberStatus(member('m5'))"), '请假');
  assert.equal(run('db.loans.filter(overdue).length'), 1);
});
test('三种角色的全部页面都能渲染', () => {
  const { run } = setup();
  for (const id of ['m1', 'm2', 'm3'])
    for (const name of [
      'dashboard',
      'members',
      'assets',
      'loans',
      'leaves',
      'logs',
      'profile',
      'competitions',
    ]) {
      assert.ok(run(`sessionId='${id}';view='${name}';renderView()`).length > 100);
    }
});
test('审批不占用模块，发放后占用并阻止另一笔发放', () => {
  const { run } = setup();
  run("transitionLoan('BR-2026-005','review',{decision:'approve',opinion:'通过'})");
  assert.equal(run("assetStatus(asset('EM-006'))"), '空闲');
  run("transitionLoan('BR-2026-005','issue')");
  assert.equal(run("assetStatus(asset('EM-006'))"), '使用中');
  assert.equal(run("activeLoan('EM-006').memberId"), 'm3');
  run(
    "db.loans.push({...db.loans.find(l=>l.id==='BR-2026-005'),id:'CONFLICT',memberId:'m4',status:'待发放'})",
  );
  assert.throws(() => run("transitionLoan('CONFLICT','issue')"), /无法重复发放/);
  assert.equal(run("db.loans.find(l=>l.id==='CONFLICT').status"), '待发放');
});
test('申请归还不释放库存，验收后恢复空闲', () => {
  const { run } = setup();
  run("sessionId='m3';transitionLoan('BR-2026-001','request-return')");
  assert.equal(run("assetStatus(asset('EM-001'))"), '使用中');
  run("sessionId='m2';transitionLoan('BR-2026-001','receive',{damagedIds:[],note:'完好'})");
  assert.equal(run("assetStatus(asset('EM-001'))"), '空闲');
  assert.equal(run("assetStatus(asset('EM-007'))"), '空闲');
  assert.equal(run("db.loans.find(l=>l.id==='BR-2026-001').receiver"), 'm2');
});
test('损坏资产归还后进入维修，其他资产恢复可用', () => {
  const { run } = setup();
  run(
    "sessionId='m3';transitionLoan('BR-2026-001','request-return');sessionId='m1';transitionLoan('BR-2026-001','receive',{damagedIds:['EM-001'],note:'接口损坏'})",
  );
  assert.equal(run("assetStatus(asset('EM-001'))"), '维修中');
  assert.equal(run("assetStatus(asset('EM-007'))"), '空闲');
  assert.equal(run("db.maintenance.filter(r=>r.assetId==='EM-001').length"), 1);
});
test('普通成员不能审批、读取他人请假详情或修改角色', () => {
  const { run } = setup();
  run("sessionId='m3'");
  assert.equal(run("can('assignRoles')"), false);
  assert.equal(run("can('manageAssets')"), false);
  assert.equal(run("editableMember(member('m2'))"), false);
  assert.throws(() => run("transitionLoan('BR-2026-005','review',{decision:'approve'})"), /权限/);
  assert.throws(() => run("getLeave('LV-001')"), /权限/);
  assert.ok(!run('leavesPage()').includes('个人事务'));
  assert.ok(!run('loansPage()').includes('BR-2026-003'));
});
test('负责人只能管理普通成员，不得审批自己的申请', () => {
  const { run } = setup();
  run("sessionId='m2'");
  assert.equal(run("editableMember(member('m1'))"), false);
  assert.equal(run("editableMember(member('m3'))"), true);
  assert.equal(run("canReview({memberId:'m2'})"), false);
  assert.equal(run("canReview({memberId:'m1'})"), false);
  assert.equal(run("canReview({memberId:'m3'})"), true);
});
test('请假审批在有效时段生效，到期恢复之前工作状态', () => {
  const { run } = setup();
  run(
    "db.leaves[1].start=date(-1);db.leaves[1].end=date(1);transitionLeave('LV-002','review',{decision:'approve',opinion:'同意'})",
  );
  assert.equal(run("memberStatus(member('m7'))"), '请假');
  run('db.leaves[1].end=date(-1)');
  assert.equal(run("memberStatus(member('m7'))"), '空闲');
});
test('过期审批、错误状态和非本人归还被拦截', () => {
  const { run } = setup();
  run("db.loans.find(l=>l.id==='BR-2026-005').due=date(-1)");
  assert.throws(() => run("transitionLoan('BR-2026-005','review',{decision:'approve'})"), /时间已过/);
  assert.throws(() => run("transitionLoan('BR-2026-001','issue')"), /状态已改变/);
  assert.throws(() => run("transitionLoan('BR-2026-001','request-return')"), /权限/);
});
test('保存后重新加载仍保留操作，存储异常回滚', async () => {
  const { run, context } = setup();
  await run(
    "API.mutate('/test',{},()=>transitionLoan('BR-2026-005','review',{decision:'approve',opinion:'持久化测试'}))",
  );
  run("db=seed();sessionStorage.setItem(SESSION_KEY,'m1')");
  await run('API.load()');
  assert.equal(run("db.loans.find(l=>l.id==='BR-2026-005').status"), '待发放');
  context.localStorage.setItem = () => {
    throw new Error('QuotaExceeded');
  };
  await assert.rejects(
    run("API.mutate('/test',{},()=>transitionLoan('BR-2026-005','issue'))"),
    /QuotaExceeded/,
  );
  assert.equal(run("assetStatus(asset('EM-006'))"), '空闲');
});
test('测试账号登录校验与停用生效', async () => {
  const { run } = setup();
  await assert.rejects(run("API.login('teacher','wrong')"), /账号或密码/);
  await run("API.login('member','Lab@123456')");
  assert.equal(run('me().id'), 'm3');
  run("member('m3').active=false");
  await assert.rejects(run("API.login('member','Lab@123456')"), /账号或密码/);
});
test('输入文本转义防止插入可执行标签', () => {
  const { run } = setup();
  assert.equal(
    run(`esc('<img src=x onerror="alert(1)">')`),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
  );
  run(`member('m3').name='<script>alert(1)</script>'`);
  assert.ok(!run('membersPage()').includes('<script>'));
});
test('API 模式未连接时明确失败，不回退到模拟数据', async () => {
  const { run, context } = setup();
  context.fetch = async () => ({ ok: false, status: 503, json: async () => ({ message: '服务器尚未连接' }) });
  run("CONFIG.mode='api'");
  await assert.rejects(run('API.load()'), /服务器尚未连接/);
});
test('HTML 只引用项目本地资源，六个脚本均可解析', () => {
  assert.equal(scripts.length, 6);
  assert.ok(scripts.every(path => /^src\/[a-z]+\.js$/.test(path)));
  assert.ok(html.includes('href="src/styles.css"'));
  assert.ok(!/<script(?! defer src=)[^>]*>/.test(html));
  source.forEach(script => new vm.Script(script));
});
test('比赛状态由日期推导，归档优先', () => {
  const { run } = setup();
  assert.equal(run('competitionStatus(db.competitions[0])'), '报名中');
  assert.equal(run('competitionStatus(db.competitions[1])'), '准备中');
  assert.equal(run('competitionStatus(db.competitions[2])'), '未开放');
  run('db.competitions[0].start=date(-1);db.competitions[0].end=date(1)');
  assert.equal(run('competitionStatus(db.competitions[0])'), '进行中');
  run('db.competitions[0].end=date(-1)');
  assert.equal(run('competitionStatus(db.competitions[0])'), '已结束');
  run('db.competitions[0].archived=true');
  assert.equal(run('competitionStatus(db.competitions[0])'), '已归档');
});
test('只有老师与负责人可维护比赛', () => {
  const { run } = setup();
  for (const id of ['m1', 'm2']) {
    run(`sessionId='${id}'`);
    assert.equal(run("can('manageCompetitions')"), true);
    assert.ok(run('competitionsPage()').includes('新增比赛'));
  }
  run("sessionId='m3'");
  assert.equal(run("can('manageCompetitions')"), false);
  assert.ok(!run('competitionsPage()').includes('新增比赛'));
  assert.throws(() => run('competitionForm()'), /权限/);
});
test('旧版数据自动补充比赛记录，保留已有修改', async () => {
  const { run } = setup();
  run(
    "delete db.competitions;member('m3').note='保留原有数据';localStorage.setItem(DB_KEY,JSON.stringify(db));sessionStorage.setItem(SESSION_KEY,'m1')",
  );
  await run('API.load()');
  assert.equal(run('db.competitions.length'), 3);
  assert.equal(run("member('m3').note"), '保留原有数据');
});
test('API 会话未登录显示登录入口，不读取私有快照', async () => {
  const { run, context } = setup();
  let calls = 0;
  context.fetch = async () => {
    calls++;
    return { ok: false, status: 401, json: async () => ({ message: '未登录' }) };
  };
  run("CONFIG.mode='api'");
  await run('API.load()');
  assert.equal(calls, 1);
  assert.equal(run('sessionId'), null);
  assert.ok(run('loginPage()').includes('登录工作台'));
});
test('老师创建自定义账号后可登录，密码不以明文保存', async () => {
  const { run, memory } = setup();
  const created = await run(
    "createMemberAccount({name:'新成员测试',number:'TEST-001',username:'new_member',role:'member',group:'硬件研发组',direction:'STM32',contact:''},'Member@2026','Member@2026')",
  );
  assert.equal(created.username, 'new_member');
  assert.equal(run(`db.credentials['${created.id}'].algorithm`), 'PBKDF2-SHA256');
  assert.ok(![...memory.values()].join('').includes('Member@2026'));
  await assert.rejects(run("API.login('new_member','Lab@123456')"), /账号或密码/);
  await run("API.login('new_member','Member@2026')");
  assert.equal(run('me().name'), '新成员测试');
});
test('负责人可创建普通成员账号，但不能创建老师或负责人', async () => {
  const { run } = setup();
  run("sessionId='m2'");
  for (const role of ['teacher', 'manager'])
    await assert.rejects(
      run(
        `createMemberAccount({name:'越权测试',number:'TEST-002',username:'invalid_role',role:'${role}',group:'测试组'},'Member@2026')`,
      ),
      /负责人只能/,
    );
  await run(
    "createMemberAccount({name:'负责人新增',number:'TEST-003',username:'manager_added',role:'member',group:'测试组'},'Manager@2026')",
  );
  assert.equal(run("db.members.find(m=>m.username==='manager_added').role"), 'member');
});
test('新成员账号重复、弱密码与确认不一致时不写入数据', async () => {
  const { run } = setup();
  const before = run('db.members.length');
  await assert.rejects(
    run(
      "createMemberAccount({name:'测试',number:'T-NEW',username:'Teacher',role:'member',group:'测试组'},'Member@2026')",
    ),
    /账号已存在/,
  );
  await assert.rejects(
    run(
      "createMemberAccount({name:'测试',number:'T-NEW',username:'test_new',role:'member',group:'测试组'},'12345678')",
    ),
    /英文字母和一个数字/,
  );
  await assert.rejects(
    run(
      "createMemberAccount({name:'测试',number:'T-NEW',username:'test_new',role:'member',group:'测试组'},'Member@2026','Different@2026')",
    ),
    /不一致/,
  );
  assert.equal(run('db.members.length'), before);
});
test('普通成员不能创建账号；新账号刷新后仍使用独立密码', async () => {
  const { run } = setup();
  run("sessionId='m3'");
  await assert.rejects(
    run(
      "createMemberAccount({name:'测试',number:'T-NEW',username:'no_permission',role:'member',group:'测试组'},'Member@2026')",
    ),
    /权限/,
  );
  run("sessionId='m1'");
  await run(
    "createMemberAccount({name:'持久化账号',number:'TEST-004',username:'persist_account',role:'member',group:'测试组'},'Persist@2026')",
  );
  await run('API.load()');
  await run("API.login('persist_account','Persist@2026')");
  assert.equal(run('me().name'), '持久化账号');
});
test('同一密码为不同成员生成不同的随机盐和校验值', async () => {
  const { run } = setup();
  const a = await run("makeCredential('Member@2026')"),
    b = await run("makeCredential('Member@2026')");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.digest, b.digest);
});

function setupTabSync() {
  const env = setup(),
    notices = [],
    messages = [];
  const dialog = {
    open: false,
    innerHTML: '',
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    querySelector(selector) {
      return selector === '[data-sync-notice]'
        ? notices[0] || null
        : {
            append(node) {
              notices.push(node);
            },
          };
    },
  };
  env.context.document.querySelector = (selector) => (selector === '#modal' ? dialog : null);
  env.context.document.createElement = () => ({ dataset: {}, setAttribute() {} });
  env.context.syncRenders = 0;
  env.context.syncMessages = messages;
  env.run(
    "render=()=>{syncRenders++};toast=message=>syncMessages.push(message);sessionStorage.setItem(SESSION_KEY,'m1');localStorage.setItem(DB_KEY,JSON.stringify(db))",
  );
  return { ...env, dialog, notices, messages };
}
test('跨标签页同步保留编辑窗口和回调，保存时保留其他成员的最新修改', async () => {
  const { run, dialog, notices, memory, context } = setupTabSync();
  run("memberForm('m3');globalThis.originalSubmit=modalSubmit;globalThis.originalMember=member('m3')");
  const html = dialog.innerHTML;
  const form = new FormData();
  for (const [key, value] of Object.entries(
    run(
      "(({name,number,group,direction,contact,username,role})=>({name,number,group,direction,contact,username,role}))(member('m3'))",
    ),
  ))
    form.set(key, value);
  form.set('name', '保留的表单草稿');
  context.draft = form;
  const remote = JSON.parse(memory.get(run('DB_KEY')));
  remote.members.find((m) => m.id === 'm4').direction = '另一标签页已保存';
  memory.set(run('DB_KEY'), JSON.stringify(remote));
  await run('syncOtherTab({key:DB_KEY})');
  assert.equal(dialog.open, true);
  assert.equal(dialog.innerHTML, html);
  assert.equal(run('modalSubmit===originalSubmit'), true);
  assert.equal(run("member('m3')===originalMember"), true);
  assert.equal(notices.length, 1);
  assert.match(notices[0].textContent, /当前填写内容已保留/);
  await run('syncOtherTab({key:DB_KEY})');
  assert.equal(notices.length, 1);
  await run('modalSubmit(draft)');
  const saved = JSON.parse(memory.get(run('DB_KEY')));
  assert.equal(saved.members.find((m) => m.id === 'm3').name, '保留的表单草稿');
  assert.equal(saved.members.find((m) => m.id === 'm4').direction, '另一标签页已保存');
  assert.equal(dialog.open, false);
});
test('跨标签页同步后，已打开的借用表单按最新库存阻止无效提交并保持打开', async () => {
  const { run, dialog, memory, context } = setupTabSync();
  run("loanForm('EM-006')");
  const remote = JSON.parse(memory.get(run('DB_KEY')));
  remote.assets.find((a) => a.id === 'EM-006').status = '维修中';
  memory.set(run('DB_KEY'), JSON.stringify(remote));
  await run('syncOtherTab({key:DB_KEY})');
  const form = new FormData();
  form.set('assetIds', 'EM-006');
  form.set('due', run('date(7)'));
  form.set('project', '保留项目');
  form.set('purpose', '保留用途');
  context.draft = form;
  await assert.rejects(run('modalSubmit(draft)'), /所选模块已被使用/);
  assert.equal(dialog.open, true);
  assert.equal(form.get('purpose'), '保留用途');
});
test('没有弹窗时同步刷新页面；无关存储事件不刷新', async () => {
  const { run, context, messages } = setupTabSync();
  await run("syncOtherTab({key:'unrelated'})");
  assert.equal(context.syncRenders, 0);
  await run('syncOtherTab({key:DB_KEY})');
  assert.equal(context.syncRenders, 1);
  assert.deepEqual(messages, ['已同步其他标签页的数据']);
});
test('同步读取失败保留当前表单和已有数据', async () => {
  const { run, dialog, memory, messages } = setupTabSync();
  run("memberForm('m3');globalThis.beforeSync=db");
  const html = dialog.innerHTML;
  memory.set(run('DB_KEY'), '{invalid');
  await run('syncOtherTab({key:DB_KEY})');
  assert.equal(dialog.open, true);
  assert.equal(dialog.innerHTML, html);
  assert.equal(run('db===beforeSync'), true);
  assert.equal(messages.length, 1);
});

test('测试直接读取首页脚本顺序，源码没有遗漏或重复加载', () => {
  assert.deepEqual([...scripts].sort(), readdirSync(new URL('../src',import.meta.url)).filter(name=>name.endsWith('.js')).map(name=>'src/'+name).sort());
  new vm.Script(app);
});
test('保存失败回滚保留编辑对象引用，原表单重试可真正持久化', async () => {
  const { run, context, memory, dialog } = setupTabSync();
  run("memberForm('m3');globalThis.editingRecord=member('m3')");
  const form = new FormData();
  for (const [key, value] of Object.entries(run("cleanMemberData(member('m3'))"))) form.set(key, value);
  form.set('name', '重试后保存的名字');
  context.draft = form;
  const persist = context.localStorage.setItem;
  context.localStorage.setItem = () => {
    throw new Error('QuotaExceeded');
  };
  await assert.rejects(run('modalSubmit(draft)'), /QuotaExceeded/);
  assert.equal(run("member('m3')===editingRecord"), true);
  assert.equal(run("member('m3').name"), '张子涵');
  assert.equal(dialog.open, true);
  context.localStorage.setItem = persist;
  await run('modalSubmit(draft)');
  assert.equal(
    JSON.parse(memory.get(run('DB_KEY'))).members.find((m) => m.id === 'm3').name,
    '重试后保存的名字',
  );
});
test('失败事务移除新增记录和字段，已有记录仍能继续使用', async () => {
  const { run, context } = setup();
  run("globalThis.originalAsset=asset('EM-006')");
  context.localStorage.setItem = () => {
    throw new Error('QuotaExceeded');
  };
  await assert.rejects(
    run(
      "API.mutate('/test',{},()=>{asset('EM-006').temporary='未提交';db.assets.push({id:'TEMP'});db.credentials={temporary:{digest:'未提交'}}})",
    ),
    /QuotaExceeded/,
  );
  assert.equal(run("asset('EM-006')===originalAsset"), true);
  assert.equal(run("'temporary' in originalAsset"), false);
  assert.equal(run("asset('TEMP')"), undefined);
  assert.equal(run('db.credentials'), undefined);
});
test('错误快照不破坏已加载的数据', async () => {
  const { run, memory } = setup();
  run('globalThis.loaded=db');
  memory.set(run('DB_KEY'), JSON.stringify({ version: 1, members: [] }));
  await assert.rejects(run('API.load()'), /数据格式无效/);
  assert.equal(run('db===loaded'), true);
  assert.equal(run('db.assets.length'), 18);
});
test('空库存可正常渲染；特殊型号名称可正常分组', () => {
  const { run } = setup();
  run('db.assets=[];db.loans=[]');
  const html = run('dashboard()');
  assert.ok(!/NaN|Infinity/.test(html));
  assert.ok(html.includes('0% 可借用'));
  run(
    "db=seed();db.assets[0].model='__proto__';db.assets[1].model='__proto__';db.assets[2].model='constructor'",
  );
  assert.ok(run('assetsPage()').includes('STM32F407'));
});
test('公共审批逻辑保留两种业务的状态、审批人和隐私日志', () => {
  const { run } = setup();
  run(
    "transitionLoan('BR-2026-005','review',{decision:'reject',opinion:'请补充用途'});transitionLeave('LV-002','review',{decision:'approve',opinion:'同意'})",
  );
  assert.equal(run("getLoan('BR-2026-005').status"), '已拒绝');
  assert.equal(run("getLoan('BR-2026-005').opinion"), '请补充用途');
  assert.equal(run("getLeave('LV-002').status"), '已通过');
  assert.equal(run("getLeave('LV-002').reviewer"), 'm1');
  assert.equal(run('db.logs.at(-1).private'), true);
});

test('共用确认窗口保持撤销、发放、归还四条操作流程', async () => {
  for (const [type, id, actor, status, prepare] of [
    ['loan-cancel','BR-2026-005','m3','已撤销',''],
    ['loan-return','BR-2026-001','m3','待确认归还',''],
    ['leave-cancel','LV-002','m7','已撤销',''],
    ['loan-issue','BR-2026-005','m1','使用中',"transitionLoan('BR-2026-005','review',{decision:'approve'})"],
  ]) {
    const {run,dialog}=setupTabSync();
    run(`sessionId='${actor}';${prepare}`);
    await run(`handleAction('${type}',{dataset:{id:'${id}'}})`);
    assert.equal(dialog.open,true);
    await run('modalSubmit()');
    assert.equal(dialog.open,false);
    assert.equal(run(`db.${type.startsWith('leave')?'leaves':'loans'}.find(r=>r.id==='${id}').status`),status);
  }
});
