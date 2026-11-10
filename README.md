# 1. Project info — 项目信息

流浪动物救助与领养管理系统，用于工作人员管理动物从发现、救助、安置到领养结案的档案。
当前版本是页面原型：已完成首页、列表、详情及新增/编辑/救助/跟进/领养/结案/删除/个人资料/密码/登录表单页面。
尚未实现账号认证、数据库 CRUD、跨记录状态校验及 REST API。表单可以填写和查看预览反馈，但不会保存、执行状态转换或认证；页面存在不代表后端功能已完成。
本地默认监听 127.0.0.1，支持 HOST/PORT 配置；production 默认监听 0.0.0.0。当前仍没有真实账号验证和路由保护，不用于正式部署。

## 公共字段约定（Group 007 项目设计，并非老师指定业务字段）

所有模型使用 MongoDB `_id: ObjectId`；引用也用 ObjectId，不用展示编号或姓名关联。
所有模型包含 `createdAt/updatedAt: Date`，由 Mongoose timestamps 生成。时间按 UTC 保存，页面按香港时区显示。
英文键和值供代码/数据库使用，中文标签只供页面显示；电话为字符串，保留前导零。

| 模型 | 字段及含义 |
| --- | --- |
| User | username（唯一账号）、passwordHash（密码哈希，不保存明文且默认查询排除）、displayName（姓名）、phone、role（staff/admin，默认 staff） |
| Animal 基本资料 | animalCode（唯一展示编号，如 A007-001；后续由后端生成，不用记录数量+1）、animalType（cat/dog/other）、appearance、foundLocation、healthStatus（自由文本）、contactName、contactPhone、createdBy（User 引用） |
| Animal 救助 | rescueStatus（默认 pending）、assignedTo（User 引用，默认 null）、placementLocation（默认空字符串） |
| Animal 领养/结案 | adoptionStatus（默认 not_open）、closedAt（默认 null）、closedBy（User 引用，默认 null） |
| FollowUp | animalId（Animal 引用）、content、recordedBy（User 引用）、updatedBy（User 引用，默认 null） |
| Adoption | animalId（Animal 引用、唯一）、adopterName、adopterPhone、remarks（默认空字符串）、registeredBy（User 引用）、completedAt（默认 null） |

各模型字段类型、required/default/enum 以 models/*.js 为准。现阶段模型只定义，不导入启动流程、不建集合/索引、不保存。
示例数据中的用户仅用于显示姓名，不是可登录账号，不包含密码。

## 状态约定（规则已确定，业务执行暂未接入）

| 维度 | 值与中文 | 允许流程 |
| --- | --- | --- |
| 救助 | pending 待救助；rescuing 救助中；placed 已安置 | pending → rescuing → placed |
| 领养 | not_open 未开放；available 可领养；processing 办理中；adopted 已领养 | not_open → available → processing → adopted |

- 新增默认 pending / not_open，未指定负责人、未结案。
- 进入 rescuing 前指定负责人；进入 placed 前填写负责人及安置地点。
- 只有 placed 且未结案的动物可开放领养；工作人员确认健康适宜，不能通过匹配健康描述文字自动决定。
- available → processing 必须同时登记领养人和电话。第一版每只动物只有一条有效领养记录。
- processing → adopted 同时填写 Adoption.completedAt、Animal.closedAt/closedBy；已领养后保留档案，业务编辑及跟进写入关闭。
- 尚未登记领养时可 available → not_open 撤回开放；第一版不提供领养取消、退养、重开或救助进度回退。
- 结案只由完成领养产生，不单独维护 closed 布尔字段，避免两个结案标志矛盾。
- 工作人员可管理未结案业务；跟进编辑/删除仅作者或管理员；动物删除仅管理员，需同时清理 FollowUp、Adoption。已结案误录仍由管理员确认删除。
- 后续所有写入口使用相同的服务器端规则、字段白名单和权限检查；不能依赖隐藏按钮或前端校验。
- 领养重复提交使用 animalId 唯一索引、状态条件更新及冲突处理；跨集合保存/删除要有一致性策略和失败恢复。使用事务时先配置 MongoDB 副本集，当前单机默认不支持多文档事务；不能直接加事务代码假定可运行。
- Schema enum/required 只是基础约束，不等于上述状态/权限规则已实现。后续更新需要显式运行验证和处理唯一索引冲突。

# 2. Group info — 小组信息

组号：007。成员真实姓名和 SID 待各成员填写。

| 成员 | 负责范围 |
| --- | --- |
| T（原 A 模块） | 登录退出、用户资料、密码、角色与权限 |
| L（原 B 模块） | 动物新增、详情、基本资料编辑 |
| Y（原 C 模块） | 列表、多条件查询、分页排序、首页统计 |
| M（原 D 模块） | 负责人、救助进度、安置、跟进记录 CRUD |
| N（原 E 模块） | 领养登记、结案、动物删除和关联清理 |

每人负责本模块页面、后端、数据库操作和测试；共同整合、修错、README、curl 和演示。

# 3. Project file intro — 文件说明

保留课堂要求的根目录结构，没有 routes/controllers/services 等额外目录。

- server.js：Express 配置、示例数据、页面 GET 路由和启动逻辑；后续业务处理函数仍放在此文件。
- package.json / package-lock.json：依赖与版本锁定；公共 Session 统一使用 cookie-session，更新后运行 npm ci。
- models/：User.js、Animal.js、FollowUp.js、Adoption.js 定义公共模型；constants.js 统一枚举及标签。
- views/：header.ejs、footer.ejs 为公共布局；animal-fields.ejs、form-actions.ejs 为表单公共部分；其余 EJS 对应各功能页面。footer.ejs 仅闭合布局，不显示页脚文字。
- public/style.css：本地样式，支持窄屏；public/preview.js：拦截原型表单，仅显示未保存的反馈，不请求后端或写本地存储。

页面模板只展示后端传入的数据，并使用 EJS 转义输出。后续将 server.js 中的示例数组查询替换为 Mongoose 查询，保持模板变量约定：
首页 total/rescueCounts/adoptionCounts/animals；列表 filters/page/pageCount/total/pageUrl/animals；详情 animal/followUps/adoption。
userName 当前从示例用户解析姓名，后续改为实际用户查询或 populate 后的显示数据；不要把该函数当作身份认证。

# 4. Operation guides — 操作指南

开发环境参考：Ubuntu 22.04、Node 24.22.2、npm 11.19.1、MongoDB 8.0。

```bash
cd ~/comp3810sef_group007
nvm use 24
npm ci
npm start
```

浏览 http://localhost:8099 。如旧进程仍占用端口，先在启动旧进程的终端 Ctrl+C，再 npm start。

- 首页：显示同一批四只示例动物的救助、领养统计及最近更新。
- 动物列表：点击查询应用四个筛选条件；可排序，每页三条；分页保留筛选；重置恢复全部。
- 详情：查看基本资料、状态、历史跟进；已领养示例另显示领养登记及结案时间。
- 示例联系人及 00000000 电话均为虚构；刷新页面不会创建、修改或删除数据库记录。
- 侧边栏可进入新增、个人资料、登录预览；详情可进入编辑、救助、跟进增删改、领养、结案、删除确认页面。
- 登录/密码表单请勿输入真实密码。提交不会传输密码；密码字段在预览后清空。没有测试登录账号或真实登录会话，退出预览仅返回登录页。
- 表单使用浏览器必填项检查及密码重复输入检查，不执行权限或业务状态校验；method=dialog 在无脚本时也避免向服务器或地址栏发送表单信息。
- `/`、`/animals`、`/animals/:id` 是 HTML 页面路由，不是 REST API；REST GET/POST/PUT/DELETE 及 curl 演示待逐项接入。

如需验证原有 MongoDB 连接（页面仍然使用示例数据）：

```bash
sudo systemctl start mongod
CONNECT_DB=1 npm start
```

后续接入顺序：动物 CRUD → 认证权限 → 救助跟进 → 领养结案/删除一致性 → REST API 和整合测试。
最终提交前完成真实成员资料、登录指引、CRUD/API/curl 指引和各人模块测试记录，并移除 node_modules。

## 本次页面原型检查

2026-11-04：浏览器检查通过首页统计、分页、猫类型筛选、无结果提示、输入转义、详情与结案示例、404、非法查询参数回退；375px/320px 页面无整页横向溢出，无浏览器脚本错误。桌面三页及窄屏详情已截图检查。
示例 Animal、FollowUp、Adoption 逐条通过 Schema 校验，User 字段构造通过，非法救助枚举被拒绝，示例关联 ID 一致；检查未连接数据库。
这些仅覆盖页面原型与字段定义，不代表尚未实现的登录、CRUD、状态转换或并发一致性已通过测试。


## 页面导航补充

- /login：登录预览；/profile：个人资料；/password：密码修改。
- /animals/new：新增动物。
- /animals/:id/edit、/rescue、/adoption、/close、/delete：基本资料编辑、救助、领养、结案与删除确认。
- /animals/:id/followups/new、/animals/:id/followups/:followId/edit、/delete：跟进新增、编辑与删除确认。
- 所有业务页面仍使用公共字段及状态标签；无 POST/PUT/DELETE 写入路由。已结案等业务规则将在真实后端接入时统一校验，原型可以浏览各操作页。

### 第二版 UI 检查

2026-11-04：15 个页面路径及其内部链接返回正常；列表筛选/分页、表单预览反馈、密码重复输入提示、预览后密码清空通过。确认表单提交不发起网络请求；禁用 JavaScript 时登录表单也不发送密码。375px/320px 全页面无整页横向溢出，窄屏领养操作入口可用。桌面首页、列表、新增、详情、登录及窄屏领养截图已检查。公共模型、依赖和数据库未变更。


## 五人并行开发指南

分区和分支只是协作安排，不新增目录、不实现业务功能。分支在建立时来自同一个 main 提交；后续不会自动同步。
GitHub 分享代码，不分享 MongoDB 数据。每人使用自己电脑的 MongoDB 和虚构测试数据。

| 成员 | 个人分支 | server.js 区域 | 主要页面/模型 | 第一项工作 |
| --- | --- | --- | --- | --- |
| T | feature/t-auth | 01 T 区 | login/profile/password；User | 真实账号登录退出，提供 requireLogin / requireAdmin，测试未登录和无权限 |
| L | feature/l-animal | 02 L 区 | create/edit/details/animal-fields；Animal 基本字段 | 新增动物并读取详情，再实现基本资料修改 |
| Y | feature/y-query | 03 Y 区 | dashboard/list | 用 MongoDB 替换示例查询，完成筛选、分页、排序和统计 |
| M | feature/m-rescue | 04 M 区 | rescue/followup；FollowUp 与 Animal 救助字段 | 给测试动物添加跟进记录并查询，再接负责人、进度和安置 |
| N | feature/n-adoption | 05 N 区 | adoption/close/delete；Adoption 与 Animal 领养字段 | 领养登记和状态校验，再接结案、删除与关联清理 |

所有人都负责本模块页面、业务逻辑、数据库、接口、测试、模块说明和演示。T 的权限中间件是公共依赖；其他人可先本地实现模块，但保护页面和写操作必须在整合验收前接好。不要用“始终 next()”假装已完成认证。

### 第一次开始：已有克隆仓库

先确认 git status 没有未处理的修改。若有，先在自己的分支保存并提交，不要强制切换或丢弃文件。

```bash
cd ~/comp3810sef_group007
git status
git fetch origin
```

只执行本人对应的一条命令（首次创建本地跟踪分支）：

```bash
# T
git switch --track origin/feature/t-auth
# L
git switch --track origin/feature/l-animal
# Y
git switch --track origin/feature/y-query
# M
git switch --track origin/feature/m-rescue
# N
git switch --track origin/feature/n-adoption
```

如果本地已经有个人分支，使用 git switch feature/t-auth 等本地分支名，不重复执行 --track。
还没有克隆项目的成员，先在 Ubuntu 主目录执行下方命令，再按上面步骤选择自己的分支。先接受仓库协作者邀请才能推送。

```bash
cd ~
git clone https://github.com/0110NiZ/comp3810sef_group007.git
cd comp3810sef_group007
```

进入个人分支后：

```bash
nvm use 24
npm ci
code .
npm start
```

浏览 http://localhost:8099。VS Code 左下角确认 WSL 和自己的分支。每个人电脑都可使用 8099；只有同一台电脑同时启动多份时才需要换端口。

### 开发时如何把预览接成真实功能

1. 阅读自己的页面、模型和 server.js 区域；保持公共字段、英文状态、EJS 模板变量一致。
2. 先准备自己本机的 MongoDB 测试数据。CONNECT_DB=1 目前只连接，不自动替换示例数据；每个模块仍需改为真实查询/写入。
3. 对准备接入的那个表单，将 method="dialog" 改为实际 method/action，移除 data-preview（以及不再使用的 data-sensitive），否则 preview.js 会继续拦截提交。不要一次解除其他成员的表单预览。
4. HTML 表单可用 POST 页面路由；另提供真正 GET/POST/PUT/DELETE 的 /api 接口。二者共用本区域的业务处理函数，不复制一套状态规则。
5. 公共区的 express.urlencoded/express.json、模型引入、数据库启动配置、session 依赖等变更先与组员协调。真实数据库功能必须在连接成功后运行，不要悄悄回退为示例数据并报告保存成功。
6. 测试正常流程及无权限、无效 ID、缺少字段、空结果/重复提交等相关异常。各人补充下方自己的模块记录。

### 保存、提交与合并

只在本人分支开发，先 git status / git diff 检查，再 git add 指定改过的文件；不要提交 node_modules、.env、密码、数据库文件或真实个人资料。

```bash
git status
git diff
# 示例：T；其他成员换成自己实际修改的文件
git add server.js views/login.ejs models/User.js README.md
git commit -m "Implement login flow"
git push
```

去 GitHub 创建 Pull Request：base=main，compare=本人 feature 分支。写清完成内容、测试结果和依赖；由另一位成员检查后再合并。不要直接向 main 推送日常开发，也不要强制推送。

main 合入新功能后，先提交完自己的工作，再在自己的分支同步：

```bash
git fetch origin
git merge origin/main
# 无冲突或冲突解决后，运行相关测试，再同步个人分支
git push
```

如有冲突，停止继续改功能，与另一位作者逐段核对。保留双方需要的代码，删除冲突标记后 git add 对应文件、git commit；不要直接全选“接受当前/传入”。依赖锁文件变化后再运行 npm ci。
PR 合并时暂时保留这五个长期个人分支，避免初学阶段丢失远程分支入口。

### 公共文件与接口归属

- server.js 的 00/99 公共区、models/constants.js、views/header.ejs/footer.ejs/form-actions.ejs、public/style.css/preview.js、package*.json 均需协调修改；无指定个人独占维护权。
- Animal.js：L 维护基本资料；M 维护负责人/进度/安置；N 维护领养/结案。改字段前先协调，不能另建同义模型。
- details.ejs 由 L 主维护，M/N 提供字段和展示需求。每人的样式补充放 style.css 的对应注释区域，避免全文件格式化。
- 后续 API 分工：T 账号相关；L POST /api/animals、GET/PUT /api/animals/:id；Y GET /api/animals、GET /api/stats；M 救助与跟进；N 领养、结案、DELETE /api/animals/:id。这些只是待实现约定，不是可调用接口。
- 固定路径 /animals/new 先于 /animals/:id；所有路由在 99 区 404 之前。统计使用 /api/stats，避免与动物详情 ID 路由冲突。
- 老师要求 API 至少覆盖 GET、POST、PUT、DELETE；业务字段和本分工为小组约定，不应称作老师指定内容。

### 各人模块记录（各自填写自己的小节）

#### T — 登录与用户
完成内容：待填写。测试及 curl：待填写。

#### L — 动物基本资料
完成内容：待填写。测试及 curl：待填写。

#### Y — 查询统计
完成内容：待填写。测试及 curl：待填写。

#### M — 救助跟进
2026-11-10: 已实现救助进度推进（pending -> rescuing -> placed）、负责人指定、安置地点管理及跟进记录（FollowUp）完整 CRUD，严格遵守单向流转、结案只读保护、跨动物跟进归属校验与 5 组 RESTful API，已通过本地真实数据库测试。具体测试、curl 演示及与 N 模块的联动说明见文末“M 模块实施与验收”。

#### N — 领养结案与删除
完成内容：待填写。测试及 curl：待填写。


## 公共开发约定 第一版

以下是五人的统一实施约定；其中标记“待实现”的内容不能当作已完成功能。以本节为后续开发准则，历史检查记录只代表当时已验证的范围。

### 截图问题核对与本次处理

| 问题 | 核对结果 | 本次处理 |
| --- | --- | --- |
| 登录与 Session 缺失 | 真实登录及 CRUD 网页权限保护确实尚未实现。老师允许 cookie-session、OAuth 或其他认证方式，并未指定某一个库 | 已安装并配置 cookie-session；T 负责实际密码验证、用户加载、退出与路由保护，不能仅安装中间件就宣称完成认证 |
| 缺少请求体解析 | 属实，真实表单与 JSON API 接入前需补齐 | 已加入 express.urlencoded 和 express.json；现有字段为平铺结构，选择 extended:false，不需要机械照搬 true |
| method=dialog 和 data-preview 阻止提交 | 属实，也是当前原型防止误提交的设计 | 保留未接后端的表单拦截；由各模块在真实处理路由完成后逐个改 POST/action 并移除 data-preview |
| 固定监听 127.0.0.1 | 本机 Ubuntu 演示可用，外部或云端访问需调整 | 增加 HOST 环境变量，production 默认 0.0.0.0；不是现在就把无认证原型暴露到公网。省略 host 也可能监听 IPv6 ::，不应一概称作 0.0.0.0 |
| 四类 REST 方法 | 必须真正提供 GET/POST/PUT/DELETE；HTML POST 路由不能替代 PUT/DELETE API | 明确网页路由和 API 表，业务仍由各人实现；API 未实现时统一 JSON 404，不伪造成功 |
| API 是否必须无认证 | 老师原文是 “no need to add authentication”，即不要求，不是禁止 | 本组选择 API 也使用同一 Session 与角色规则，保持管理员删除等约束；curl 先登录再带 cookie。这是小组设计，不是老师的强制要求 |

依据：Group Project Requirements.pdf 第 1 页及第 2 页目录要求。技术参考：[Express cookie-session](https://expressjs.com/en/resources/middleware/cookie-session/)；[Express 5 API](https://expressjs.com/en/5x/api/)。

### 当前用户与权限接口 由 T 实现

- 统一 `req.user = { _id, username, displayName, role }`，未登录为 null；`res.locals.currentUser` 同步同一个安全对象供 EJS 使用。当前代码只初始化为 null，不信任浏览器传来的用户 ID、角色或示例用户。
- T 在 Session 之后、业务路由之前读取 req.session.userId，查询 User 并加载当前角色。无效、过期、用户不存在时清除 Session；数据库故障应报错，不能伪装登录成功。
- cookie-session 是签名而非加密。Session 只保存最少信息，如 userId 和 expiresAt；不保存密码、passwordHash、电话或完整用户对象。T 校验 expiresAt；退出用 req.session=null。密码更改后的旧会话撤销策略由 T 在认证 PR 中说明并测试。
- 密码统一由 T 提供 hashPassword / verifyPassword：使用 Node.js crypto.scrypt、每次随机 salt、固定参数并保存格式版本；其他成员不自行实现密码处理。登录失败不区分账号不存在还是密码错误，不打印密码。
- `requireLogin(req,res,next)`：先依据服务器加载的 req.user 判断。网页未登录跳转固定 /login；/api 下返回 401 JSON，不跳转 HTML。
- `requireAdmin(req,res,next)`：先执行登录检查，再检查真实 role==='admin'；普通工作人员返回 403。跟进作者检查由 M 在登录后执行；删除动物由 N 组合 requireAdmin。
- 账号资料仅允许改 displayName/phone；username 和 role 不从普通资料表单更新。写入 createdBy、recordedBy、registeredBy、closedBy 取 req.user._id，不从表单接收。
- 登录真实接入后，管理页面和对应网页写路由都需要保护；首页/列表/详情也视为内部管理页。登录页和必要静态资源可公开，退出改为 POST /logout，不能用 GET 链接执行退出。
- 浏览器写入路由应验证 CSRF（T 统一提供 token 与验证方式），cookie 的 sameSite 不能代替完整业务权限验证。API 使用 JSON 与同一 Session；T 的 API 登录/CSRF 约定落实后再完成最终 curl 示例。
- 当前 requireLogin/requireAdmin/hashPassword/verifyPassword/CSRF 均未实现，禁止复制仅 next() 的空函数充数。

### Session 数据库和运行配置

| 配置 | 统一约定 |
| --- | --- |
| Session 库 | cookie-session；name=group007_session；8 小时；httpOnly=true；sameSite=lax；production 下 secure=true |
| SESSION_KEYS | 逗号分隔的随机签名密钥，每个至少 32 字符。生产必须配置；本地未配置时自动产生进程内随机密钥，重启旧 cookie 失效。密钥不要提交 GitHub |
| MONGODB_URI | 默认 mongodb://127.0.0.1:27017/animal_rescue_group007；只在 server.js 启动函数连接一次，禁止各请求自行连接/断开 |
| CONNECT_DB | 当前 1 表示启动前验证数据库连接；不设置为原型模式。各模块改为真实功能时必须确保连接成功，不能保存失败后回退到示例数组 |
| HOST 与 PORT | 本地默认 127.0.0.1:8099；需要局域网/云端时显式 HOST=0.0.0.0，生产默认为此值；同时配置平台端口和网络规则 |
| HTTPS 代理 | production 要使用 HTTPS；恰好一层可信反向代理时配置 TRUST_PROXY=1，否则不设置。不要为了让 Cookie 工作盲目信任任意代理 |

当前直接使用进程环境变量，没有 dotenv，不会自动读取 .env。仅把密钥写进 .env 文件不会生效；如后续统一采用环境文件加载，先协调公共启动命令。
本地测试连接与 Session 的示例（不是部署完成）：

```bash
sudo systemctl start mongod
export SESSION_KEYS=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
CONNECT_DB=1 npm start
```

同一终端保留 export 的密钥可跨重启使用；新终端重新生成会使旧签名失效。各自电脑不必共用密钥。不要把生成的密钥、真实账号密码和数据库凭证发到群里或提交仓库。

### 页面和 REST API 对照表 待各模块实现

页面读取用 GET；下面网页写入采用 POST。所有写操作共用各负责人区域中的业务处理函数，分别返回网页跳转或 JSON，避免两个版本的状态规则。

| 成员 | 网页操作 | 对应 API |
| --- | --- | --- |
| T | POST /login、/logout、/profile、/password | POST /api/login、/api/logout；GET/PUT /api/profile；PUT /api/password |
| L | POST /animals/new；GET /animals/:id；POST /animals/:id/edit | POST /api/animals；GET/PUT /api/animals/:id |
| Y | GET /animals 与 GET / | GET /api/animals；GET /api/stats |
| M | POST /animals/:id/rescue | PUT /api/animals/:id/rescue |
| M | GET/POST /animals/:id/followups/new；POST /animals/:id/followups/:followId/edit 或 /delete | GET/POST /api/animals/:id/followups；PUT/DELETE /api/animals/:id/followups/:followId |
| N | POST /animals/:id/adoption-status、/adoption、/close、/delete | PUT /api/animals/:id/adoption-status；GET/POST /api/animals/:id/adoption；PUT /api/animals/:id/close；DELETE /api/animals/:id |

GET 路由只能读取或显示表单，不能创建/更新/删除。固定 /animals/new 在 /animals/:id 前，所有路由必须在 99 区 404 处理前。已存在的 GET 表单页不等于本表的写接口已经可用。

### 请求字段与响应格式

- 所有 ID 为数据库 ObjectId 对应的 24 位十六进制字符串，animalCode 仅供展示。错误格式返回 400；格式正确但不存在返回 404。跟进 ID 必须同时属于 URL 中的 animalId。
- POST 新增 Animal 只接收 animalType/appearance/foundLocation/healthStatus/contactName/contactPhone；animalCode、createdBy、默认状态由服务器赋值。L 负责编号唯一性，不能用文档总数加一；重复编号返回 409。
- PUT 基本资料只接收上述六个字段；M 的救助更新只接收 rescueStatus/assignedTo/placementLocation；N 的开放领养只接收 adoptionStatus，领养登记只接收 adopterName/adopterPhone/remarks。结案时间和操作者由服务器产生。
- 查询条件沿用 animalType/foundLocation/rescueStatus/adoptionStatus/sort/page；每页统一 3 条，page 从 1 开始，排序沿用现有四种值。无匹配是成功空列表，不是 404。网页/API 对无效查询使用同一归一化逻辑。
- 不直接使用 req.body 或 req.query 作为 MongoDB 查询或整文档更新。标量字段拒绝数组和对象，字符串去首尾空白；枚举按 constants 检查。日期存 UTC，显示香港时区。
- 长度统一：账号 3–40、显示姓名/联系人/领养人 1–80、电话 1–30（User.phone 可空）、地点最多 200、外观/健康最多 1000、跟进/备注最多 2000、新密码 8–128 字符。各模块在自己的字段接入这些约束；当前 Schema 的 required/enum 不代表全部长度校验已完成。
- 网页成功保存后用 303 跳转详情/列表并重新查询。表单错误重新显示本页、保留非密码字段、显示原因；密码不回填。没有完成数据库写入之前不得显示保存成功。

API 约定示例（不是当前业务接口的实际响应）：

```json
{ "success": true, "data": { "_id": "..." }, "message": "已保存" }
```

```json
{ "success": true, "data": [], "pagination": { "page": 1, "pageSize": 3, "total": 0, "pageCount": 1 } }
```

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "请填写联系人" } }
```

状态码统一：200 读取/更新/删除成功；201 创建成功；400 参数或 JSON 错误；401 未登录；403 无权限；404 不存在；409 重复/状态冲突；413 内容过大；500 未预期错误。删除成功使用 200 JSON，不返回 204 后再写正文。API 不返回 EJS、不泄露密码哈希或堆栈。
API 通用 404、JSON 解析错误与请求体过大处理本次已实现，其余业务状态码由模块接入。

### 测试数据与跨页面验收

测试数据以场景和唯一 animalCode 对齐，不要求不同电脑的 ObjectId 相同。正式初始化脚本/命令由 T 与 L 协调在现有 server.js 内提供手动入口，不新增目录，也不在 npm start 时清空或灌入数据库；此入口目前尚未实现。

| 测试对象 | 统一场景 |
| --- | --- |
| demo_admin / demo_staff | 管理员与普通工作人员两个虚构账号；密码由初始化过程本地输入并哈希，不在 README 声称账号已经可登录 |
| A007-001 | 猫，救助中/未开放，负责人已指定，有跟进记录 |
| A007-002 | 狗，已安置/可领养，测试领养登记 |
| A007-003 | 猫，已安置/已领养，领养记录及结案时间完整，测试只读与保留档案 |
| A007-004 | 狗，待救助/未开放，无负责人，测试救助进度前置条件 |
| A007-005 | 已安置/办理中，存在一条未完成的领养记录，测试结案与重复请求；当前页面原型尚无此条 |

目前 001–004 仅存在于示例数组，demoUsers 不是真实账号。导入后用数据库返回的 _id 构造链接，不复制示例数组 ID 当作真实库中一定存在的 ID。

共同验收：L 新增 → Y 列表可查 → L 详情正确；M 添加跟进 → L 详情显示且不串到别的动物；N 结案 → L 详情、Y 统计同步，重复提交不重复领养；T 登录/退出 → 管理页访问正确；N 删除 → M 的跟进和领养关联记录处理一致。每次保存后从数据库读取验证，不只看提示文字。

### 公共改动与开始顺序

1. 五人先同步本次公共提交并 npm ci。不要复制对方整个 server.js；本次没有实现个人模块，也没有开放真实写接口。
2. T 优先完成真实用户加载与 requireLogin/requireAdmin；其他成员可并行实现页面和数据库逻辑，但未接权限的写功能不能作为完成项合并验收。
3. 公共数据库启动、请求解析、Session、导航、依赖由需要修改的人先通知组员，只提交必要改动。每个 PR 写清字段、路由、运行配置及影响到的另一位成员。
4. 同一份 Animal 按字段更新，不整份覆盖；跟进和领养由其模型单独关联。N 的并发结案、重复领养、删除失败恢复需与 M 联测，不假定当前单机 MongoDB 支持事务。
5. curl 最终演示至少覆盖 GET/POST/PUT/DELETE。按本组选择，先 POST /api/login 用 -c 保存 Cookie，再用 -b 带 Cookie；不要将未实现的示例命令写成已测试成功。

本次同步后，已克隆个人分支的组员运行：

```bash
git status
# 工作区干净时，在自己的 feature 分支执行
git pull --ff-only
npm ci
```

若本地有提交导致不能 fast-forward，先 git fetch origin，再与成员确认后合并对应远程分支，禁止 reset --hard 或 force push 覆盖工作。


### 本次公共配置验证

2026-11-04：JSON 与 URL 编码表单解析、400/413 错误、API JSON 404、网页 HTML 404、Session 签名与篡改拒绝、未自动产生认证用户、生产密钥要求均通过检查。HOST=0.0.0.0 的临时监听已验证；15 个页面与内部链接、筛选分页、预览表单及 375px/320px 布局回归通过。测试未写入数据库，未实现或验收真实登录、业务状态转换及 CRUD。


### M 模块实施与验收 2026-11-10

### 负责范围与业务逻辑边界
- 分支 `feature/m-rescue`。业务与 RESTful API 路由集中在 `server.js` 的 04 M 区，未增加外部目录及多余依赖。
- 维护模型：`FollowUp.js` 全量字段，以及 `Animal.js` 中的救助维度字段（`rescueStatus`、`assignedTo`、`placementLocation`）。
- 前端页面接入：真实页面 `views/rescue.ejs`、`views/followup.ejs`，解除了原型表单拦截，支持真实 POST 提交与重定向。
- 救助单向推进：严格限制 `pending` -> `rescuing` -> `placed`，禁止进度倒退；进入 `rescuing` 必须指定负责人；进入 `placed` 必须有负责人及安置地点。
- 跟进记录（FollowUp）：提供完整 CRUD；严格校验 `followUp.animalId` 与当前操作动物一致，防范跨档案非法修改与删除。
- 结案只读保护：严格执行全组约定，动物一旦结案（`closedAt` 存在或 `adoptionStatus === "adopted"`），后端拒绝修改救助状态，拒绝新增、修改或删除跟进记录。

### 与 N 模块的跨集合联动说明
- 结案状态约束：M 模块的所有写操作均在执行前检索动物的 `closedAt` 与 `adoptionStatus`，保证与 N 模块的结案状态强一致。
- 关联清理协同：当 N 模块执行动物删除时，清理相关联的 `FollowUp` 记录。M 模块在跟进操作中强制校验动物存在性，避免产生孤立记录。

### 页面与 RESTful API 路由对照表

| 业务功能 | 网页 POST 路由 | RESTful API (对齐 Lab 09) | HTTP 状态码 |
| :--- | :--- | :--- | :--- |
| 更新救助状态 | POST /animals/:id/rescue | PUT /api/animals/:id/rescue | 200 / 400 / 403 / 404 |
| 查询动物跟进列表 | — (详情页内嵌) | GET /api/animals/:id/followups | 200 / 404 |
| 添加跟进记录 | POST /animals/:id/followups/new | POST /api/animals/:id/followups | 201 / 400 / 403 / 404 |
| 修改跟进记录 | POST /animals/:id/followups/:followId/edit | PUT /api/animals/:id/followups/:followId | 200 / 400 / 403 / 404 |
| 删除跟进记录 | POST /animals/:id/followups/:followId/delete | DELETE /api/animals/:id/followups/:followId | 200 / 403 / 404 |

### CURL 测试命令 (用于课堂演示与登记表)

在终端中使用真实测试动物 ID（如 `672db0000000000000000001`）进行验证：

```bash
BASE="http://localhost:8099"
ID="672db0000000000000000001"

# 1. 查询跟进列表 (GET)
curl -sS "$BASE/api/animals/$ID/followups"

# 2. 新增跟进记录 (POST)
curl -i -X POST -d "content=今天完成了狂犬疫苗注射与驱虫" "$BASE/api/animals/$ID/followups"

# 3. 推进救助状态至 rescuing (PUT)
curl -i -X PUT -d "rescueStatus=rescuing&assignedTo=000000000000000000000002" "$BASE/api/animals/$ID/rescue"

# 4. 修改跟进记录 (PUT - 替换为实际返回的 followId)
curl -i -X PUT -d "content=今天完成了狂犬疫苗注射，复查情况良好" "$BASE/api/animals/$ID/followups/<FOLLOW_ID>"

# 5. 删除跟进记录 (DELETE)
curl -i -X DELETE "$BASE/api/animals/$ID/followups/<FOLLOW_ID>"
```

