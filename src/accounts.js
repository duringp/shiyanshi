// 仅用于本地演示的密码校验器。生产环境必须由服务器验证密码和权限。
// 自定义密码只保存随机盐与 PBKDF2 校验结果，不保存明文，不写入成员公开资料或日志。
const PASSWORD_ITERATIONS = 150000;
function validatePassword(password, confirmation=password) {
  requirePermission(typeof password==='string'&&password.length>=8&&password.length<=64,'密码需要 8–64 个字符');
  requirePermission(/[A-Za-z]/.test(password)&&/[0-9]/.test(password),'密码至少包含一个英文字母和一个数字');
  requirePermission(password===confirmation,'两次输入的密码不一致');
}
const bytesToHex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
function hexToBytes(text) {
  requirePermission(typeof text==='string'&&/^(?:[a-f0-9]{2})+$/i.test(text),'账号密码记录无效，请联系管理员');
  return Uint8Array.from(text.match(/.{2}/g),part=>parseInt(part,16));
}
async function passwordDigest(password,salt,iterations) {
  requirePermission(globalThis.crypto?.subtle,'当前浏览器无法创建密码，请使用本地预览地址或 HTTPS 打开');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,256);
  return bytesToHex(new Uint8Array(bits));
}
async function makeCredential(password) {
  validatePassword(password);
  requirePermission(globalThis.crypto?.getRandomValues,'当前浏览器不支持密码初始化，请使用本地预览地址');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return {algorithm:'PBKDF2-SHA256',iterations:PASSWORD_ITERATIONS,salt:bytesToHex(salt),digest:await passwordDigest(password,salt,PASSWORD_ITERATIONS)};
}
async function verifyCredential(password,credential) {
  if(!credential||credential.algorithm!=='PBKDF2-SHA256'||!Number.isInteger(credential.iterations)||credential.iterations<10000||credential.iterations>1000000)return false;
  if(typeof password!=='string'||password.length>64)return false;
  const actual=await passwordDigest(password,hexToBytes(credential.salt),credential.iterations);
  if(typeof credential.digest!=='string'||actual.length!==credential.digest.length)return false;
  let mismatch=0;
  for(let i=0;i<actual.length;i++)mismatch|=actual.charCodeAt(i)^credential.digest.charCodeAt(i);
  return mismatch===0;
}
function cleanMemberData(input,self=false) {
  const keys=self?['name','direction','contact']:['name','number','username','role','group','direction','contact'];
  return Object.fromEntries(keys.map(key=>[key,String(input[key]??'').trim()]));
}
function validateMemberData(data,id=null,self=false) {
  requirePermission(data.name&&data.name.length<=30,'姓名不能为空，且不能超过 30 个字符');
  if(self)return;
  requirePermission(data.number&&data.number.length<=30&&data.group&&data.group.length<=40,'请填写有效的学号 / 工号和所属小组');
  requirePermission(/^[A-Za-z0-9_]{3,30}$/.test(data.username),'账号须为 3–30 位字母、数字或下划线');
  requirePermission(Object.hasOwn(ROLE,data.role),'请选择有效角色');
  requirePermission(me()?.role==='teacher'||data.role==='member','负责人只能为普通成员创建或维护账号');
  requirePermission(!db.members.some(m=>m.id!==id&&m.number===data.number),'该学号 / 工号已存在');
  requirePermission(!db.members.some(m=>m.id!==id&&m.username.toLowerCase()===data.username.toLowerCase()),'该登录账号已存在，请换一个账号');
}
async function createMemberAccount(input,password,confirmation=password) {
  requirePermission(can('manageMembers'));
  const data=cleanMemberData(input);
  validateMemberData(data);
  validatePassword(password,confirmation);
  const actorId=me().id;
  const credential=CONFIG.mode==='mock'?await makeCredential(password):null;
  // 校验在异步密码派生后再做一次，防止同一标签页状态变化。
  requirePermission(me()?.id===actorId&&can('manageMembers'),'当前身份已变化，请重新提交');
  validateMemberData(data);
  let created=null;
  await API.mutate('/members',{...data,password},()=>{
    const now=new Date().toISOString();
    created={...data,id:uid('m'),active:true,baseStatus:'空闲',joined:now,updated:now,note:''};
    db.members.push(created);
    db.credentials??={};
    db.credentials[created.id]=credential;
    audit(`创建成员账号 ${data.name}（${data.username}）`,created.id);
  });
  return created||db.members.find(m=>m.username===data.username);
}
function passwordFields(){return `<div class="form-grid">${field('初始密码 *','newPassword','','password','required minlength="8" maxlength="64" autocomplete="new-password" placeholder="8–64 位，至少包含字母和数字"')}${field('确认密码 *','confirmPassword','','password','required minlength="8" maxlength="64" autocomplete="new-password" placeholder="再次输入初始密码"')}</div><div class="password-help"><label class="check-label"><input type="checkbox" id="show-new-password">显示密码</label><span>请将账号与初始密码告知对应成员</span></div>`}
function showAccountCreated(created){modal('成员账号已创建',`<div class="account-success"><div class="success-mark">${icon('check')}</div><h2>${esc(created?.name||'新成员')}，欢迎加入实验室</h2><p>成员资料和登录账号已同时保存。</p></div><div class="account-result">${details([['登录账号',created?.username||'已创建'],['角色',ROLE[created?.role]||'普通成员'],['账号状态','已启用'],['登录密码','使用刚刚设置的初始密码']])}</div><p class="privacy-note">密码不会在成员列表、详情或操作记录中展示。${CONFIG.mode==='mock'?'当前为本地演示，新账号可以在此浏览器中退出后重新登录。':''}</p>`,'',null,btn('继续创建','member-new','primary'))}
