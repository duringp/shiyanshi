# 阿里云后端对接契约

本文件描述前端预留的接口，不代表服务器已经实现。当前所有功能默认运行在 mock 模式；尚未部署、连接或配置任何阿里云资源。

## 接入配置

编辑 `src/core.js`（配置、请求与数据快照逻辑均在此文件）：

```js
const CONFIG = {
  mode: 'api',
  API_BASE_URL: 'https://实际后端域名/api',
  timeout: 10000
};
```

保存后刷新页面，无需构建。`api` 模式不会在失败时回退到演示数据。

- API_BASE_URL 不带末尾斜杠，下文路径均相对此地址。
- 时间字段统一使用带时区的 ISO 8601 时间字符串，例如 `2026-10-06T01:00:00.000Z`。页面按浏览器当地时区显示。
- 身份认证建议使用由后端设置的 HttpOnly、Secure 会话 Cookie；前端已设置 `credentials: 'include'`。
- 所有写请求目前使用 POST，并携带 JSON；不需要请求体的操作发送 `{}`。
- 成功响应：`{"data": ...}`；出错响应：`{"message":"可展示给用户的错误说明"}`，配合 400 / 401 / 403 / 404 / 409 / 500 等 HTTP 状态码。
- 写接口至少返回 JSON，例如 `{"data":{"ok":true}}`，不要直接返回空的 204；前端保存后会重新加载工作空间。
- `/auth/me` 返回 401 时显示登录页。服务器不通或 503 等错误显示错误信息和重试按钮。

## 认证与工作空间

| 方法 | 路径 | 请求体 | 成功响应示例 |
| --- | --- | --- | --- |
| POST | `/auth/login` | `{"username":"teacher","password":"用户输入"}` | `{"data":{"id":"m1"}}`，同时设置会话 Cookie |
| GET | `/auth/me` | 无 | `{"data":{"id":"m1"}}` |
| POST | `/auth/logout` | `{}` | `{"data":{"ok":true}}`，清除会话 |
| GET | `/workspace` | 无 | `{"data":{"version":1,"members":[],"assets":[],"loans":[],"leaves":[],"maintenance":[],"logs":[],"competitions":[]}}` |

现有前端实际读取 `/workspace` 聚合快照，再在客户端搜索、分页和计算统计，适合目前小型实验室原型。数据规模增大后可拆分列表接口并改为后端分页。服务器快照必须包含当前用户的成员对象，所有数组即使没有数据也应返回 `[]`。

快照必须由服务器按当前会话裁剪隐私字段。普通成员的其他成员资料不得包含私人联系方式、请假原因或审批意见。为保留模块使用者与人员请假状态，普通成员仍需要：

- 所有成员的公开基本信息；
- 所有模块和当前占用关系；其他人的占用记录只返回公开的资产编号、使用者、借还状态和预计归还时间；
- 自己的完整借用记录；
- 自己的完整请假记录；其他人的有效已批准请假仅返回用于状态计算的 memberId、start、end、status；
- 自己有权查看的日志和赛事信息。

不能仅把未经裁剪的数据库表一次性下发后依赖前端隐藏。

## 数据结构

示例取自演示结构；数据库表结构和技术栈由真实后端自行决定。

```json
{
  "member": {
    "id": "m3", "name": "张子涵", "username": "member", "number": "2024003",
    "role": "member", "group": "硬件研发组", "direction": "STM32 / 电路设计",
    "contact": "member@lab.example", "active": true, "baseStatus": "忙碌",
    "note": "项目调试中", "joined": "2026-01-01T00:00:00.000Z", "updated": "2026-09-22T00:00:00.000Z"
  },
  "asset": {
    "id": "EM-001", "name": "STM32F407 开发板", "model": "STM32F407ZGT6",
    "category": "开发板", "vendor": "STMicroelectronics", "spec": "3.3V · UART / SPI / I²C",
    "location": "器材柜 A-01", "status": "空闲", "created": "2026-06-01T00:00:00.000Z",
    "note": "", "datasheet": ""
  },
  "loan": {
    "id": "BR-001", "memberId": "m3", "assetIds": ["EM-001"],
    "purpose": "主控调试", "project": "智能小车", "status": "使用中",
    "created": "2026-09-20T00:00:00.000Z", "due": "2026-09-30T10:00:00.000Z",
    "reviewer": "m2", "reviewed": "2026-09-21T00:00:00.000Z", "opinion": "同意",
    "issued": "2026-09-21T01:00:00.000Z", "issuer": "m2"
  },
  "leave": {
    "id": "LV-001", "memberId": "m3", "start": "2026-09-23T01:00:00.000Z",
    "end": "2026-09-23T10:00:00.000Z", "reason": "个人事务", "status": "待审批",
    "created": "2026-09-22T00:00:00.000Z"
  },
  "maintenance": {
    "id": "MT-001", "assetId": "EM-008", "description": "舵机齿轮异常",
    "status": "维修中", "created": "2026-09-20T00:00:00.000Z", "actor": "m2"
  },
  "log": {
    "id": "LOG-001", "actor": "林知远", "memberId": "m3",
    "text": "确认发放模块 · STM32F407 开发板", "at": "2026-09-21T01:00:00.000Z", "private": false
  }
}
```

资产状态在当前前端由有效借用记录优先推导为“使用中”；其他状态来自 asset.status。后端也应保持占用关系一致。成员“请假”由当前时间落在已通过请假记录的 start/end 内计算，其他时间显示 baseStatus。

## 写接口

下表接口是页面已经使用的路径。服务器从会话获取操作者与申请人，不能信任客户端传来的角色、操作人或审批人。

| 路径（均为 POST） | 请求字段 | 响应 |
| --- | --- | --- |
| `/members` | name, number, username, role, group, direction, contact, password（创建时必填） | `{"data":{"id":"m9"}}` |
| `/members/:id/update` | name, number, username, role, group, direction, contact | `{"data":{"ok":true}}` |
| `/members/me/update` | name, direction, contact | 同上 |
| `/members/me/status` | status（空闲/忙碌）, note | 同上 |
| `/members/:id/active` | active（布尔） | 同上 |
| `/assets` | id, name, model, category, vendor, spec, location, note, datasheet | `{"data":{"id":"EM-019"}}` |
| `/assets/:id/update` | 同上，资产编号不可修改 | `{"data":{"ok":true}}` |
| `/assets/:id/maintenance` | description | 同上 |
| `/assets/:id/repair-complete` | `{}` | 同上 |
| `/assets/:id/retire` | `{}` | 同上 |
| `/loans` | assetIds（数组）, purpose, project, due | `{"data":{"id":"BR-007"}}` |
| `/loans/:id/review` | decision（approve/reject）, opinion | `{"data":{"ok":true}}` |
| `/loans/:id/issue` | `{}` | 同上 |
| `/loans/:id/cancel` | `{}` | 同上 |
| `/loans/:id/request-return` | `{}` | 同上 |
| `/loans/:id/receive` | damagedIds（数组，完好为 `[]`）, note | 同上 |
| `/leaves` | start, end, reason | `{"data":{"id":"LV-003"}}` |
| `/leaves/:id/review` | decision（approve/reject）, opinion | `{"data":{"ok":true}}` |
| `/leaves/:id/cancel` | `{}` | 同上 |
| `/competitions` | 下方比赛表单字段，不含 id、created、archived | `{"data":{"id":"COMP-004"}}` |
| `/competitions/:id/update` | 下方比赛表单字段 | `{"data":{"ok":true}}` |
| `/competitions/:id/archive` | archived（布尔） | 同上 |

## 新成员账号创建

- 创建请求示例：`{"name":"新成员","number":"20260101","username":"new_member","role":"member","group":"硬件研发组","direction":"STM32","contact":"","password":"用户设置的初始密码"}`。
- 服务器需要在同一个事务中创建成员资料、登录账号和密码校验记录。
- 前端要求密码 8–64 字符、至少包含一个英文字母和一个数字；服务端必须再次验证自己的密码规则。
- 用户名为 3–30 位字母、数字或下划线；按不区分大小写查重，学号 / 工号同样唯一；数据库应通过唯一约束保证。
- 负责人只能创建 role=member 的账户；指导老师可以创建允许的其他角色。角色从会话校验，不信任提交参数。
- password 仅通过 HTTPS 发送给后端；后端自行散列存储。不要在响应、工作空间快照或日志返回密码或密码散列。
- 本地演示的 `db.credentials` 为独立的客户端校验器字典，只在 mock 模式使用，不是生产认证实现，不作为后端可接受的登录凭证。
- 更新成员资料的 `/members/:id/update` 不接收 password，不改变密码。

## 比赛记录

```json
{
  "id": "COMP-004",
  "name": "嵌入式创新设计赛",
  "organizer": "示例主办方",
  "level": "校级",
  "category": "嵌入式设计",
  "registrationStart": "2026-09-22T01:00:00.000Z",
  "registrationEnd": "2026-09-29T10:00:00.000Z",
  "start": "2026-10-06T01:00:00.000Z",
  "end": "2026-10-06T10:00:00.000Z",
  "location": "工程实践中心 A301",
  "ownerId": "m2",
  "teamSize": "2–4 人 / 队",
  "link": "",
  "summary": "完成一套可演示的嵌入式系统作品。",
  "requirements": "提前提交项目说明。\n自备开发板与调试设备。",
  "stages": [
    {"title":"报名截止","at":"2026-09-29T10:00:00.000Z","description":"提交成员名单及项目方向。"},
    {"title":"正式比赛","at":"2026-10-06T01:00:00.000Z","description":"演示作品并参加答辩。"}
  ],
  "archived": false,
  "created": "2026-09-22T00:00:00.000Z"
}
```

- 时间应满足 registrationStart < registrationEnd <= start < end。
- 流程节点 1–20 个，按 at 排序；允许赛后公布结果的节点晚于 end。
- 主办方链接仅支持 http/https。
- 角色 teacher / manager 可维护赛事，member 只能查看。
- 比赛状态由时间计算：未开放、报名中、准备中、进行中、已结束；archived 为 true 时优先显示已归档。
- 流程“计划时间已到”仅表示时间，不等同于实际执行完成。

## 可选的后续拆分读取接口

前端目前不调用以下接口，后续对大数据量进行服务端分页时可替换 `/workspace`。

| GET 路径 | 查询字段 | 响应示例 |
| --- | --- | --- |
| `/members` | q, role, status, page, pageSize | `{"data":{"items":[],"total":0}}` |
| `/assets` | q, category, status, userId, page, pageSize | 同上 |
| `/assets/:id` | 无 | `{"data":{"asset":{},"loans":[],"maintenance":[]}}` |
| `/loans` | q, status, page, pageSize | `{"data":{"items":[],"total":0}}` |
| `/leaves` | q, status, page, pageSize | 同上 |
| `/competitions` | q, status, level, page, pageSize | 同上 |
| `/competitions/:id` | 无 | `{"data":{比赛完整对象}}` |
| `/logs` | q, page, pageSize | `{"data":{"items":[],"total":0}}` |
| `/stats` | 无 | `{"data":{"members":8,"assets":18,"available":10,"inUse":5,"maintenance":2,"overdue":1}}` |

## 服务端必须保证的规则

- 指导老师可管理角色；负责人只管理普通成员，不得修改老师、负责人或自己的角色。
- 不能审批自己的申请；负责人只能审批普通成员申请。
- 发放需在一个数据库事务中锁定借用单与全部资产，再次检查空闲状态，全部成功才发放；冲突返回 409。
- 审批通过不直接占用库存；归还申请不释放库存，直到管理员确认收到实物。
- 停用前检查未完成借用与请假；保留历史记录。普通成员只能修改自己的允许字段。
- 请假开始必须早于结束，不能提交已结束或与待审批/已通过记录重叠的请假。
- 审批拒绝需填写原因；过期借用不能发放，必要时拒绝或重新申请。
- 所有时间、枚举、文本长度、URL 协议、ID 唯一性及对象所属关系均应在服务器验证。
- 后端生成审计记录，不能使用客户端自报的日志或身份作为可信依据。
- 生产服务需要真正的密码散列与会话机制；不返回密码或散列，不沿用演示共用密码。

## 在阿里云上的部署方式

不限定后端语言或数据库；可在现有云服务器上提供 HTTP API 并连接私有数据库。

1. 在服务器实现上述 API，先检查 `/auth/me`、`/workspace` 和写接口响应。
2. 将前端 `index.html` 和 `src/` 文件夹一并作为静态文件，由现有站点服务提供。
3. 推荐同域部署，通过 `/api` 反向代理到后端服务。此时 API_BASE_URL 可设为 `/api`。
4. 如果前后端不同域，后端只允许指定前端域名跨域，返回 `Access-Control-Allow-Credentials: true`，不能使用 `*`，并处理 OPTIONS 预检。
5. Cookie 的 Secure、SameSite、CSRF 防护、允许的 Origin 等由真实部署关系决定，在服务器上配置。前端 API 层可根据实际 CSRF 方案增加请求头。
6. 配置 HTTPS，数据库仅供后端访问，不把数据库密码或阿里云 AccessKey 放入前端文件。
7. 修改 CONFIG 并刷新页面，验证真实登录、权限与资产并发后再正式使用。

本地演示不提供服务器间同步、真实离线检测、真实消息通知、自动邮件或短信。提醒仅在页面中展示，定时器用于刷新状态，不在页面关闭后后台运行。
