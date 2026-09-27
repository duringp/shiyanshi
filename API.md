# 实验室管理系统 API 开发文档

版本：v1 · 更新日期：2026-09-24 · 对照前端提交：`d707625`

本文件按当前前端的实际调用编写，可交给后端开发人员或 AI 直接作为对接依据。当前仍为本地 mock 演示，本文不表示阿里云后端已经实现。

现有功能需要 **26 个接口：2 个 GET + 24 个 POST**。除登录外都需要有效会话；未登录查询 `/auth/me` 返回 401，退出接口允许重复调用。

| 模块 | 接口数 | 作用 |
| --- | --- | --- |
| 身份认证 | 3 | 登录、当前身份、退出 |
| 工作空间 | 1 | 返回各页面需要的、按权限裁剪的数据 |
| 成员与账号 | 5 | 创建账号、编辑成员、个人资料、工作状态、启停账号 |
| 硬件模块 | 5 | 录入、编辑、维修、维修完成、报废 |
| 借用与归还 | 6 | 申请、审批、发放、撤销、申请归还、验收 |
| 请假 | 3 | 申请、审批、撤销 |
| 比赛 | 3 | 新增、编辑、归档或恢复 |

当前不需要单独实现工作台统计、通知、搜索、分页和各类详情接口，这些功能读取 `/workspace` 后由前端处理。比赛功能是赛程与须知管理，不包含报名提交、组队、评分或文件上传。

文中“当前契约”指已有前端的输入输出；“建议扩展”需要以后配合修改前端，不是现有功能。

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
- 所有写请求使用 POST；除退出登录外均携带 JSON。不需要参数的业务操作发送 `{}`。`/auth/logout` 当前不发送请求体，后端应同时兼容空请求体和 `{}`。
- 请求头为 `Content-Type: application/json`（GET 也会发送），超时为 10 秒。前端使用 Cookie，会话 Token 放在 JSON 中而不设置 Cookie 不能完成当前对接。
- 成功响应：`{"data": ...}`；出错响应：`{"message":"可展示给用户的错误说明"}`，配合 400 / 401 / 403 / 404 / 409 / 500 等 HTTP 状态码。
- 写接口至少返回 JSON，例如 `{"data":{"ok":true}}`，不要直接返回空的 204；前端保存后会重新加载工作空间。
- `/auth/me` 返回 401 时显示登录页。服务器不通或 503 等错误显示错误信息和重试按钮。

## 通用字段、响应与权限

- ID 均返回 JSON **字符串**，包括成员、借用单、请假单、比赛和关联 ID。不能将 `members[].id` 返回数字而 `/auth/me.id` 返回字符串，前端使用严格相等匹配。
- 当前资产编号就是资产 `id`，创建时由前端提交；其他业务 ID 由后端生成。建议新生成的 ID 使用字母、数字、下划线或横线，避免路径分隔符。
- `active`、`archived`、`private` 是布尔值，不能返回字符串 `"false"`。列表字段是数组，不能返回 `null`。
- 角色代码固定为 `teacher`、`manager`、`member`；业务状态在 API 中使用下文规定的中文字符串。数据库可以使用英文枚举，在输出层转换。
- 必填文本去除首尾空白后不能为空；可选文本建议返回 `""`。密码不要自动 trim。未发生的流转时间可省略或为 `null`，已有日期字段必须是有效日期。
- 更新接口接收表单全部可编辑字段，并非任意数据库字段的通用更新。服务器只接受白名单，不允许传入 `status`、审批人等额外字段绕过业务操作。

创建成功可返回 HTTP 201，其余成功返回 HTTP 200：

```json
{"data":{"id":"m9"}}
```

普通操作成功：

```json
{"data":{"ok":true}}
```

错误格式（`message` 为当前前端实际读取字段，`code` 和 `requestId` 可选）：

```json
{"message":"模块已被借出，无法发放","code":"ASSET_UNAVAILABLE","requestId":"req-example"}
```

| HTTP 状态 | 使用场景 |
| --- | --- |
| 400 | 字段格式错误、必填项缺失、日期关系错误 |
| 401 | 未登录、会话失效、账号密码错误或停用后会话失效 |
| 403 | 身份有会话但无权进行该操作，例如自审批或普通成员创建账号 |
| 404 | 对象不存在；避免在错误内容中泄露无权访问的对象信息 |
| 409 | 账号或编号重复、状态已变化、资产占用冲突、请假时间重叠 |
| 429 | 登录或接口请求超过后端限流规则 |
| 500 / 503 | 服务异常 / 暂不可用；返回安全的中文提示，不返回堆栈或数据库信息 |

### 角色规则

| 操作 | 指导老师 teacher | 负责人 manager | 普通成员 member |
| --- | --- | --- | --- |
| 查看公开成员状态、模块状态、比赛 | 可以 | 可以 | 可以 |
| 修改自己的姓名、方向、联系方式、工作状态 | 可以 | 可以 | 可以 |
| 创建账号、编辑他人账号 | 可管理各角色 | 仅普通成员 | 不可以 |
| 修改角色 | 可以，但不能修改自己的角色 | 不可以 | 不可以 |
| 停用 / 启用成员 | 他人，满足停用条件 | 普通成员，满足停用条件 | 不可以 |
| 管理模块、维修、报废、比赛 | 可以 | 可以 | 不可以 |
| 提交自己的借用 / 请假、撤销待审批申请、申请归还 | 可以 | 可以 | 可以 |
| 审批、发放、验收 | 他人的申请 | 他人且申请人为普通成员 | 不可以 |
| 查看完整请假原因和审批意见 | 本人及自己有审批权限的申请 | 同左 | 仅本人 |

“可审批”统一条件：当前账号有效；角色为老师或负责人；操作者不是申请人；若为负责人，则申请人角色必须为普通成员。发放与验收也使用这一条件。

停用不能针对自己。目标成员有待审批、待发放、使用中、待确认归还的借用，或待审批 / 尚未结束的已通过请假时，拒绝停用。停用后保留历史并使其现有会话失效。成员角色变化不能导致实验室没有可用老师；后者为建议后端补充的保护规则。

## 认证与工作空间

| 方法 | 路径 | 请求体 | 成功响应示例 |
| --- | --- | --- | --- |
| POST | `/auth/login` | `{"username":"teacher","password":"用户输入"}` | `{"data":{"id":"m1"}}`，同时设置会话 Cookie |
| GET | `/auth/me` | 无 | `{"data":{"id":"m1"}}` |
| POST | `/auth/logout` | 空请求体（也应接受 `{}`） | `{"data":{"ok":true}}`，清除会话 |
| GET | `/workspace` | 无 | `{"data":{"version":1,"members":[],"assets":[],"loans":[],"leaves":[],"maintenance":[],"logs":[],"competitions":[]}}` |

现有前端实际读取 `/workspace` 聚合快照，再在客户端搜索、分页和计算统计，适合目前小型实验室原型。数据规模增大后可拆分列表接口并改为后端分页。服务器快照必须包含当前用户的成员对象，所有数组即使没有数据也应返回 `[]`。

快照必须由服务器按当前会话裁剪隐私字段。普通成员的其他成员资料不得包含私人联系方式、请假原因或审批意见。为保留模块使用者与人员请假状态，普通成员仍需要：

- 所有成员的公开基本信息；
- 所有模块和当前占用关系；其他人的占用记录只返回公开的资产编号、使用者、借还状态和预计归还时间；
- 自己的完整借用记录；
- 自己的完整请假记录；其他人尚未结束的已批准请假仅返回公开字段（含未来安排）；
- 自己有权查看的日志和赛事信息。

不能仅把未经裁剪的数据库表一次性下发后依赖前端隐藏。

### 前端调用顺序

1. 打开页面：`GET /auth/me` → `GET /workspace`；前者返回 401 时显示登录页。
2. 登录：`POST /auth/login` → `GET /auth/me` → `GET /workspace`。登录响应必须设置能被后续请求携带的会话 Cookie。
3. 提交任意业务操作：对应 POST → `GET /auth/me` → `GET /workspace` → 页面重绘。
4. 创建账号后，前端从最新工作空间按用户名找到新成员，因此创建事务提交后紧接的读取必须能看到新记录。
5. 详情、筛选、分页、状态统计不另外请求接口。当前 30 秒定时器只重新计算本地时间状态，不轮询服务器；其他用户的修改需重新加载才可见。

### 工作空间的强制约束

`version` 固定为数字 `1`，是快照结构版本，**不是数据库乐观锁版本号**。下列七个数组必须都有：`members`、`assets`、`loans`、`leaves`、`maintenance`、`logs`、`competitions`。当前用户必须位于 `members` 中且 `active: true`。

关联的成员、资产应能在相应数组中找到；停用成员和报废资产保留，避免历史数据引用丢失。比赛每条记录的 `stages` 也必须是数组。

以下是可供老师登录后打开空实验室的最小响应，实际 `id` 必须与会话匹配：

```json
{
  "data": {
    "version": 1,
    "members": [{
      "id": "m1", "name": "指导老师", "username": "teacher",
      "number": "T001", "role": "teacher", "group": "导师组",
      "direction": "嵌入式系统", "contact": "", "active": true,
      "baseStatus": "空闲", "note": "",
      "joined": "2026-09-24T01:00:00.000Z", "updated": "2026-09-24T01:00:00.000Z"
    }],
    "assets": [], "loans": [], "leaves": [],
    "maintenance": [], "logs": [], "competitions": []
  }
}
```

### 工作空间的字段可见范围

- `members`：普通成员读取他人公开资料时，去除 `username`、`contact` 等非公开字段；当前页面会展示姓名、学号、小组、研究方向、状态和状态备注。账号管理员需要用户名以维护账号。密码、密码散列、盐、会话信息永不返回。
- `loans`：管理人员可查看借用记录；普通成员自己的记录完整返回，其他人的记录仅返回当前占用必需字段：`id`、`memberId`、`assetIds`、`status`、`due`，以及必要的 `created`、`issued`。不返回他人的用途、项目、意见和验收备注。若要公开历史，需先确定额外可见字段，不能直接返回完整历史。
- `leaves`：本人或有审批权限的人返回完整记录。其他人只接收已通过且尚未结束的请假公开字段：`id`、`memberId`、`start`、`end`、`status`，包含未来已批准的请假，以便到时自动显示状态。不能返回 `reason` 或 `opinion`。
- `logs`：服务端过滤私密日志。请假日志仅提供给本人及有权管理该请假的人员；不能因为客户端会过滤就下发全部日志。`memberId` 表示日志关联成员，不一定是操作者。
- `assets`、`competitions` 和维护历史返回用于页面展示的数据；描述中不要混入账号密码等非公开信息。
- 不返回本地演示专用的 `credentials` 字典。

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

## 请求字段与业务处理明细

以下长度对应当前页面限制；没有页面长度限制的 URL 字段，后端如需限制，应与前端同步约定。表单更新发送完整可编辑字段；可选字段未填写时传空字符串。

### 成员接口（5 个）

`POST /members` 与 `POST /members/:id/update` 使用下列成员资料字段；仅创建多传 `password`。

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| name | string | 是 | 姓名，1–30 字符 |
| number | string | 是 | 学号 / 工号，1–30 字符，唯一 |
| username | string | 是 | 3–30 位字母、数字或下划线，不区分大小写查重 |
| role | string | 是 | teacher / manager / member，按操作者权限限制 |
| group | string | 是 | 所属小组，1–40 字符 |
| direction | string | 否 | 研究方向，最多 80 字符 |
| contact | string | 否 | 联系方式，最多 80 字符 |
| password | string | 仅创建 | 8–64 字符，至少含英文字母和数字；不返回 |

- 新成员由服务器生成 `id`，初始化 `active: true`、`baseStatus: "空闲"`、`note: ""`，设置 `joined`、`updated`。成员和密码记录在同一事务内创建。
- 修改成员时 `id`、`joined`、密码保持不变，更新 `updated`。当前无修改密码界面。
- `POST /members/me/update` 仅接收 `name`、`direction`、`contact`，目标 ID 从会话取，不接收他人的 ID、角色、学号或账号。
- `POST /members/me/status` 接收 `{"status":"忙碌","note":"正在调试开发板"}`，`status` 必须为“空闲”或“忙碌”，`note` 最多 60 字符；写入成员的 `baseStatus`、`note`、`updated`。
- “请假”由审批记录推导，不能作为上述 status 提交。“离线”目前只是演示状态，没有心跳或连接状态接口。
- `POST /members/:id/active` 接收 `{"active":false}` 或 `{"active":true}`，按前面的启停权限和未完成业务条件校验。
- 后端路由优先匹配 `/members/me/...`，避免被 `/members/:id/...` 当成 ID 为 `me` 的请求。

### 硬件模块接口（5 个）

`POST /assets` 与 `POST /assets/:id/update` 的字段：

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| id | string | 是 | 实物编号，匹配 `[A-Za-z0-9_-]{2,40}`，创建时唯一；更新不得更改 |
| name | string | 是 | 模块名称，最多 60 字符 |
| model | string | 是 | 型号，最多 70 字符 |
| category | string | 是 | 分类，最多 30 字符；页面允许自定义，不应只接受下拉提示值 |
| location | string | 是 | 存放位置，最多 60 字符 |
| vendor | string | 否 | 厂商，最多 60 字符 |
| spec | string | 否 | 规格，最多 100 字符 |
| note | string | 否 | 备注，最多 300 字符 |
| datasheet | string | 否 | 空字符串或有效 http / https 地址 |

一个对象代表一件实物；同型号多件应创建多个不同编号，不传 `quantity`。创建时服务器设置 `status: "空闲"` 和 `created`。编辑不得借助额外参数直接更改状态或使用者；请求体 `id` 必须与路径一致。

```json
{
  "id":"EM-019", "name":"ESP32 开发板", "model":"ESP32-WROOM-32",
  "category":"开发板", "vendor":"Espressif", "spec":"3.3V · Wi-Fi / BLE",
  "location":"器材柜 A-02", "note":"", "datasheet":""
}
```

- `POST /assets/:id/maintenance`：`{"description":"无法正常上电"}`，故障说明必填，最多 200 字符；仅空闲资产可送修。将资产设为“维修中”，创建维修记录。
- `POST /assets/:id/repair-complete`：`{}`，仅未被占用且状态为“维修中”的资产可完成；恢复“空闲”，相关进行中的维修记录改为“已完成”，设置 `completed`、`completer`。
- `POST /assets/:id/retire`：`{}`，仅未被占用且未报废资产可以报废；资产改为“已报废”，未完成维修记录同步改为“已报废”并填写完成时间与操作人。
- 维修与报废都需与发放操作做事务级互斥，不能只检查前端状态；保留资产和历史，不物理删除。

资产基础状态建议保存“空闲 / 维修中 / 已报废”。当前前端优先从“使用中 / 待确认归还”的借用记录推导占用状态，因此 `/workspace` 不能遗漏这些占用关系。后端若另外持久化“使用中”，验收时也必须同步恢复或送修。

### 借用与归还接口（6 个）

创建 `POST /loans`：

```json
{"assetIds":["EM-019"],"purpose":"无线采集节点联调","project":"环境监测","due":"2026-10-10T10:00:00.000Z"}
```

- `assetIds`：非空字符串数组，无重复，所有资产存在且当前空闲。前端一次可选择多件。
- `purpose`：必填，最多 300 字符；`project`：可选，最多 60 字符；`due`：有效带时区日期，必须晚于服务器当前时间。
- 申请人从会话取。若本人已有待审批 / 待发放申请包含相同资产，返回 409。创建服务器 `id`、`created`，状态为“待审批”。
- 不同成员的待审批 / 待发放申请可以指向同一空闲资产；审批不占用库存，最终以发放事务抢占结果为准。

| 操作接口 | 请求 JSON | 原状态 → 新状态 | 条件 / 写入 |
| --- | --- | --- | --- |
| `/loans/:id/review` | `{"decision":"approve","opinion":"同意"}` | 待审批 → 待发放 | 可审批，due 尚未到期；记录 reviewer、reviewed、opinion |
| 同上 | `{"decision":"reject","opinion":"请补充用途"}` | 待审批 → 已拒绝 | 可审批，拒绝意见不能为空；过期申请仍可拒绝 |
| `/loans/:id/issue` | `{}` | 待发放 → 使用中 | 可审批，due 尚未到期，全部资产空闲；记录 issued、issuer |
| `/loans/:id/cancel` | `{}` | 待审批 → 已撤销 | 仅申请人 |
| `/loans/:id/request-return` | `{}` | 使用中 → 待确认归还 | 仅申请人；记录 returnRequested，仍占用全部资产 |
| `/loans/:id/receive` | `{"damagedIds":[],"note":"实物完好"}` | 待确认归还 → 已归还 | 可审批，确认收到全部实物；记录 returned、receiver、returnNote |

`decision` 只能为 `approve` / `reject`，`opinion` 最多 200 字符。验收 `damagedIds` 是借用单资产 ID 的无重复子集，全部完好传 `[]`，`note` 最多 200 字符；存在损坏时 note 必填。损坏资产转“维修中”并创建维修记录，其余恢复“空闲”。**当前只支持整单归还，不支持分批归还。**

发放和验收必须作为单一数据库事务：锁定借用单及资产，校验当前状态，更新占用 / 库存 / 维修 / 日志后一起提交；任何一件资产校验失败则整单回滚。

“逾期”是 `status` 为使用中或待确认归还、且 `due < 当前时间` 时的派生标签，不是借用单 status 值。不能将 status 直接改为“逾期”。

### 请假接口（3 个）

创建 `POST /leaves`：

```json
{"start":"2026-10-08T01:00:00.000Z","end":"2026-10-08T10:00:00.000Z","reason":"参加技术交流"}
```

`start`、`end`、`reason` 必填，原因最多 300 字符；`start < end` 且 `end > 服务器当前时间`。当前允许开始时间在过去，但不允许结束时间已过。

同一申请人不能与待审批 / 已通过请假重叠。重叠条件为 `existing.start < new.end && existing.end > new.start`，首尾恰好相接不算重叠；在事务中检查以避免并发插入。服务器生成 `id`、`memberId`、`created`，初始状态“待审批”。

- `POST /leaves/:id/review`：与借用审批使用相同 decision、opinion 格式、角色规则和意见长度。通过变“已通过”，拒绝变“已拒绝”；仅待审批可处理，通过时 end 尚未到期；写入 reviewer、reviewed、opinion。
- `POST /leaves/:id/cancel`：`{}`，仅本人且仍为“待审批”可撤销，变“已撤销”。
- 已通过记录在 `start <= now <= end` 时使成员显示“请假”，不覆盖其基础工作状态；到期后前端自动恢复显示 `baseStatus`。已通过记录到期后仍保留“已通过”，不用改成“已结束”。
- 当前无撤销已通过请假、补销假、请假类型、附件功能。

### 比赛接口（3 个）

新增和编辑字段见下一节比赛对象示例；请求只包含以下表单字段：

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| name / organizer | string | 是 | 比赛名称 / 主办方，各最多 80 字符 |
| level | string | 是 | 实验室 / 校级 / 省级 / 国家级 / 国际级 |
| category | string | 否 | 比赛方向，最多 40 字符 |
| registrationStart / registrationEnd / start / end | string | 是 | 四个带时区日期，顺序见下一节 |
| location | string | 是 | 地点，最多 100 字符 |
| ownerId | string | 是 | 现有成员 ID，不局限于 teacher / manager；新选成员应启用，编辑允许保留已有停用负责人 |
| teamSize | string | 否 | 组队要求文本，最多 60 字符，不是人数整数 |
| link | string | 否 | 空字符串或有效 http / https 地址 |
| summary | string | 否 | 简介，最多 400 字符 |
| requirements | string | 是 | 参赛须知，最多 4000 字符，保留换行 |
| stages | array | 是 | 1–20 项，每项 title 必填且最多 50 字符，at 必填有效日期，description 可选且最多 200 字符 |

- `POST /competitions`：创建服务器 ID、created，初始化 archived=false。
- `POST /competitions/:id/update`：更新表单字段和 updated；stages 为完整替换数组，保留 id、created、archived。
- `POST /competitions/:id/archive`：`{"archived":true}` 归档，`{"archived":false}` 恢复，不删除流程和须知。归档记录仍应返回，供已归档筛选查看。
- 不传 `stageTitle`、`stageDate`、`stageDescription`，这些只是 HTML 表单控件名；请求已转换为 stages 对象数组。

## 新成员账号创建示例与认证边界

- 创建请求示例：`{"name":"新成员","number":"20260101","username":"new_member","role":"member","group":"硬件研发组","direction":"STM32","contact":"","password":"用户设置的初始密码"}`。
- 服务器需要在同一个事务中创建成员资料、登录账号和密码校验记录。
- 前端要求密码 8–64 字符、至少包含一个英文字母和一个数字；服务端必须再次验证自己的密码规则。
- 用户名为 3–30 位字母、数字或下划线；按不区分大小写查重，学号 / 工号同样唯一；数据库应通过唯一约束保证。
- 负责人只能创建 role=member 的账户；指导老师可以创建允许的其他角色。角色从会话校验，不信任提交参数。
- password 仅通过 HTTPS 发送给后端；后端自行散列存储。不要在响应、工作空间快照或日志返回密码或密码散列。
- 本地演示的 `db.credentials` 为独立的客户端校验器字典，只在 mock 模式使用，不是生产认证实现，不作为后端可接受的登录凭证。
- 更新成员资料的 `/members/:id/update` 不接收 password，不改变密码。

## 比赛记录示例

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

## 响应对象的附加字段

数据对象示例中的 `member`、`asset`、`loan` 等只是字段说明，不是 `/workspace` 的单数键；实际应放进 `members`、`assets`、`loans` 等数组。

| 对象 | 服务器额外生成或维护的字段 |
| --- | --- |
| 成员 | id、active、baseStatus、note、joined、updated |
| 资产 | created、status；id 按录入编号 |
| 借用 | id、memberId、status、created；审批后 reviewer、reviewed、opinion；发放后 issued、issuer；申请归还后 returnRequested；验收后 returned、receiver、returnNote |
| 请假 | id、memberId、status、created；审批后 reviewer、reviewed、opinion |
| 维修 | id、assetId、description、status、created、actor；完成或报废后 completed、completer |
| 日志 | id、actor（显示姓名）、memberId（关联成员 ID）、text、at、private（布尔） |
| 比赛 | id、created、archived；编辑后 updated |

业务操作与相应日志应在同一事务内持久化，不能让客户端自己提交日志记录。前端未提供独立写日志、写维修记录、删除成员或删除资产接口。

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

## 建议数据库表（不限定技术栈）

| 表 | 主要用途 / 约束 |
| --- | --- |
| members | 成员及账号资料；username 的大小写归一化唯一约束、number 唯一约束 |
| credentials / sessions | 密码散列与会话；可按后端框架合并或使用会话存储，永不进入 workspace |
| assets | 一行一件实物，id 唯一，基础状态 |
| loans | 借用单、申请人、状态、时间和审批 / 验收字段 |
| loan_assets | 一张借用单关联多件资产；loan_id + asset_id 唯一 |
| leaves | 请假时间、原因、状态和审批字段 |
| maintenance | 资产维修历史及完成信息 |
| competitions / competition_stages | 比赛与节点；stages 也可使用 JSON 字段保存 |
| audit_logs | 操作人、关联成员、时间、内容和可见范围 |

占用可使用独立表或数据库约束维护，确保同一资产至多有一个有效占用。业务并发校验必须以数据库事务为准；前端的本地判断不能代替它。初始化第一位指导老师由后端迁移、管理命令或受控初始化流程完成，不能依赖公开注册或复制演示密码。

## 联调顺序与验收清单

1. 先实现登录、会话、退出和最小 `/workspace`，确认刷新后仍登录、退出后 `/auth/me` 返回 401。
2. 完成成员与模块接口，验证老师 / 负责人创建新账号，新账号能独立登录，停用后不能继续使用旧会话。
3. 跑通“申请 → 审批 → 发放 → 申请归还 → 验收”；验证多资产整单事务、重复发放拒绝、损坏转维修。
4. 完成请假，验证有效时段显示、结束恢复、拒绝意见、时间重叠和不能自审批。
5. 完成比赛录入、流程排序、多行须知、编辑及归档恢复。
6. 使用三种身份直接调用 HTTP 接口验证越权拦截；检查返回 JSON 本身没有泄露密码或他人请假原因，而不仅是页面没显示。
7. 用两个不同会话并发发放同一资产，应仅一个成功、另一个返回 409；验收重复请求不能重复创建维修记录。
8. 验证每次 POST 成功后紧接的 workspace 读取能看到已提交数据，错误响应均为 JSON 且包含 message。

### 需要后续协同处理的功能边界

- 保存请求成功但随后的 workspace 读取失败时，当前前端会提示错误，无法区分已写入和未写入；创建类接口建议与前端一起加入幂等键。**前端目前未发送 `Idempotency-Key` 或记录版本号，后端不要未经对接就将这些头设为必填。**不能仅凭相同请求体永久去重，因为用户可能合法重复提交相同内容。
- `/workspace.version: 1` 不是并发控制字段；编辑冲突检测需要另加记录版本并修改提交逻辑。
- 当前待发放借用超过归还期限后没有取消 / 重新安排入口；已通过请假也没有取消接口。这些是扩展需求，不应擅自扩大现有撤销接口的状态范围。
- 默认仅一位老师时，老师自己的申请无人可审批；需要另一个有权限的老师或后续调整审批策略，不能由后端静默允许自审批。
- API 模式目前没有 WebSocket、SSE 或数据轮询；跨设备实时状态同步需要补充前端订阅 / 刷新流程。登录过期的写请求虽然会显示错误，但自动跳转登录的统一处理仍待联调完善。
- 修改 / 重置密码、首次登录改密、比赛报名、附件上传、离线心跳属于建议后续接口，目前没有对应前端调用。

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
