# 1. Project info — 项目信息

**2026-11-05 N 分支进度：领养、结案、管理员删除的真实页面与 API 已实现，并通过独立数据库测试。T 的真实登录尚未实现，所以正常应用中 N 页面跳转登录、API 返回 401；不能把独立测试身份当成可登录账号。L/Y/M 仍为原型，详情、列表统计及其他模块的结案只读限制待共同联调。详见文末“N 模块实施与验收”。**


流浪动物救助与领养管理系统，用于工作人员管理动物从发现、救助、安置到领养结案的档案。
当前版本是页面原型：已完成首页、列表、详情及新增/编辑/救助/跟进/领养/结案/删除/个人资料/密码/登录表单页面。
T/L/Y/M 尚未实现完整真实业务。N 领养/结案/删除已经提供真实数据库写入、状态校验及 REST API，并拒绝未认证访问；其他原型表单仍不会保存。
本地默认监听 127.0.0.1，支持 HOST/PORT 配置；production 默认监听 0.0.0.0。当前没有真实账号验证；N 已有权限检查，其余模块的保护待 T 接入，不用于正式部署。

## 公共字段约定（Group 007 项目设计，并非老师指定业务字段）

所有模型使用 MongoDB `_id: ObjectId`；引用也用 ObjectId，不用展示编号或姓名关联。
所有模型包含 `createdAt/updatedAt: Date`，由 Mongoose timestamps 生成。时间按 UTC 保存，页面按香港时区显示。
英文键和值供代码/数据库使用，中文标签只供页面显示；电话为字符串，保留前导零。

| 模型 | 字段及含义 |
| --- | --- |
| User | username（唯一账号）、passwordHash（密码哈希，不保存明文且默认查询排除）、displayName（姓名）、phone、role（staff/admin，默认 staff）、isActive（默认 true，停用为 false） |
| Animal 基本资料 | animalCode（唯一展示编号，如 A007-001；后续由后端生成，不用记录数量+1）、animalType（cat/dog/other）、appearance、foundLocation、healthStatus（自由文本）、contactName、contactPhone、createdBy（User 引用） |
| Animal 救助 | rescueStatus（默认 pending）、assignedTo（User 引用，默认 null）、placementLocation（默认空字符串） |
| Animal 领养/结案 | adoptionStatus（默认 not_open）、closedAt（默认 null）、closedBy（User 引用，默认 null） |
| FollowUp | animalId（Animal 引用）、content、recordedBy（User 引用）、updatedBy（User 引用，默认 null） |
| DeletionLog | animalId（被删动物 ID，唯一）、animalCode、appearance、reason、deletedBy、deletedAt、deletedFollowUps、deletedAdoptions；仅服务器生成并保留 |
| Adoption | animalId（Animal 引用）、adopterName、adopterPhone、remarks、registeredBy、updatedBy、completedAt、cancelledAt、cancelledBy、cancellationReason；同一动物只允许一条未取消记录，已取消记录保留 |

各模型字段类型、required/default/enum 以 models/*.js 为准。原型模式不初始化数据库；CONNECT_DB=1 时 N 初始化模型并确保领养唯一索引，不自动灌入任何业务数据。
示例数据中的用户仅用于显示姓名，不是可登录账号，不包含密码。

## 状态约定（N 已实现，其余模块待接入）

| 维度 | 值与中文 | 允许流程 |
| --- | --- | --- |
| 救助 | pending 待救助；rescuing 救助中；placed 已安置 | pending → rescuing → placed |
| 领养 | not_open 未开放；available 可领养；processing 办理中；adopted 已领养 | not_open → available → processing → adopted |

- 新增默认 pending / not_open，未指定负责人、未结案。
- 进入 rescuing 前指定负责人；进入 placed 前填写负责人及安置地点。
- 只有 placed 且未结案的动物可开放领养；工作人员确认健康适宜，不能通过匹配健康描述文字自动决定。
- available → processing 必须同时登记领养人和电话。每只动物至多一条未取消领养记录；历史取消记录可以有多条。
- processing → adopted 同时填写 Adoption.completedAt、Animal.closedAt/closedBy；已领养后保留档案，业务编辑及跟进写入关闭。
- 尚未登记领养时可 available → not_open 撤回开放；processing 可修改领养资料，或填写原因取消并退回 available，保留取消历史。暂不支持完成领养后的退养、重开或救助进度回退。
- 结案只由完成领养产生，不单独维护 closed 布尔字段，避免两个结案标志矛盾。
- 工作人员可管理未结案业务；跟进编辑/删除仅作者或管理员；动物删除仅管理员，需同时清理 FollowUp、Adoption。删除必须填写原因、确认并留存删除日志；已结案档案包括管理员也不能修改或删除。
- 后续所有写入口使用相同的服务器端规则、字段白名单和权限检查；不能依赖隐藏按钮或前端校验。
- 领养重复提交使用 animalId 的未取消记录部分唯一索引、状态条件更新及冲突处理；跨集合保存/删除要有一致性策略和失败恢复。使用事务时先配置 MongoDB 副本集，当前单机默认不支持多文档事务；不能直接加事务代码假定可运行。
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
- models/：User.js、Animal.js、FollowUp.js、Adoption.js、DeletionLog.js 定义公共模型；constants.js 统一枚举及标签。
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

以下仅验证原有单机 MongoDB 连接（其他模块仍使用示例数据）；N 写入需要下文的 27018 副本集配置：

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
- 所有业务页面仍使用公共字段及状态标签；除 N 领养/结案/删除外，其余模块尚无真实写入路由。已结案等业务规则将在真实后端接入时统一校验，原型可以浏览各操作页。

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
- 后续 API 分工：T 账号相关；L POST /api/animals、GET/PUT /api/animals/:id；Y GET /api/animals、GET /api/stats；M 救助与跟进；N 领养、结案、DELETE /api/animals/:id。N 接口已实现并需要认证；其余接口待负责人完成。
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
完成内容：待填写。测试及 curl：待填写。

#### N — 领养结案与删除
2026-11-05：已实现真实读取、开放/撤回、登记、领养资料修改、取消办理、结案和管理员关联删除日志，包含权限接入适配器、CSRF、事务和独立集成测试。具体测试、运行配置、curl 和整合依赖见文末“N 模块实施与验收”。


## 公共开发约定（2026-11-05 更新）

以下是五人的统一实施约定；其中标记“待实现”的内容不能当作已完成功能。以本节为后续开发准则，历史检查记录只代表当时已验证的范围。

### 全组采用的业务与权限规则

以下是小组确认的设计，不是老师额外指定的页面或字段。**本次落实 N 的功能与公共字段；T/L/M/Y 的业务仍需各负责人实现并联调。**

| 操作 | 工作人员 | 管理员 |
| --- | --- | --- |
| 查看全部档案、统计 | 可以 | 可以 |
| 编辑任何未结案动物、救助与领养 | 可以 | 可以 |
| 编辑/删除本人跟进记录 | 未结案时可以 | 未结案时可以 |
| 编辑/删除他人跟进记录 | 不可以 | 未结案时可以 |
| 修改或删除已结案档案及关联资料 | 不可以 | 不可以 |
| 删除未结案误录动物 | 不可以 | 填原因并确认，保留日志 |
| 创建/查看/启用/停用工作人员账号 | 不可以 | 可以（T 待实现） |

- 一个登录入口，两种角色，共用动物业务页面。负责人表示主要跟进人，不限制其他工作人员共同编辑。
- 系统只覆盖救助至领养；按钮统一为“完成领养并结案”。转交机构、死亡等其他结案类型，以及重新开案暂不加入。
- 结案后基本资料、救助、跟进及领养全部只读，仍可查看、检索和统计。每个后端页面写入口及 API 都要检查，不能仅隐藏按钮。
- T 的第一版账号管理只做工作人员创建、列表和启用/停用；管理员通过初始化数据建立，暂不提供角色调整和账号删除。每次请求检查 isActive，停用已登录用户也立即失去访问权限；保留历史负责人及操作者引用。
- M 的负责人候选只列启用用户；停用有未完成任务的人员时，T/M 提示重新分配。跟进新增/修改/删除同时更新 Animal.updatedAt，让最近更新反映救助进展。
- Y 使用一个首页结构，工作人员看动物统计和最近更新，管理员增加账号统计及管理入口。“可领养”只统计 closedAt:null 且 adoptionStatus:available；“已领养”统计完成领养档案。
- 联调顺序：T 真实登录和用户状态 → L/Y/M 真实数据与 N 接入 → 整体救助至领养流程 → 越权/停用/结案只读/取消/并发验证 → 用户管理和管理员统计。

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
- T 在 Session 之后、业务路由之前读取 req.session.userId，查询 User 并加载当前角色及 isActive。无效、过期、用户不存在或已停用时清除 Session；数据库故障应报错，不能伪装登录成功。
- cookie-session 是签名而非加密。Session 只保存最少信息，如 userId 和 expiresAt；不保存密码、passwordHash、电话或完整用户对象。T 校验 expiresAt；退出用 req.session=null。密码更改后的旧会话撤销策略由 T 在认证 PR 中说明并测试。
- 密码统一由 T 提供 hashPassword / verifyPassword：使用 Node.js crypto.scrypt、每次随机 salt、固定参数并保存格式版本；其他成员不自行实现密码处理。登录失败不区分账号不存在还是密码错误，不打印密码。
- `requireLogin(req,res,next)`：先依据服务器加载的 req.user 判断。网页未登录跳转固定 /login；/api 下返回 401 JSON，不跳转 HTML。
- `requireAdmin(req,res,next)`：先执行登录检查，再检查真实 role==='admin'；普通工作人员返回 403。跟进作者检查由 M 在登录后执行；删除动物由 N 组合 requireAdmin。
- 账号资料仅允许改 displayName/phone；username 和 role 不从普通资料表单更新。写入 createdBy、recordedBy、registeredBy、closedBy 取 req.user._id，不从表单接收。
- 登录真实接入后，管理页面和对应网页写路由都需要保护；首页/列表/详情也视为内部管理页。登录页和必要静态资源可公开，退出改为 POST /logout，不能用 GET 链接执行退出。
- 浏览器写入路由应验证 CSRF（T 统一提供 token 与验证方式），cookie 的 sameSite 不能代替完整业务权限验证。API 使用 JSON 与同一 Session；T 的 API 登录/CSRF 约定落实后再完成最终 curl 示例。
- T 的 requireLogin/requireAdmin/hashPassword/verifyPassword 和统一登录 CSRF 待实现。N 已有拒绝未认证访问的适配器与写入 CSRF 检查，待 T 整合，禁止复制仅 next() 的空函数充数。

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

### 页面和 REST API 对照表

N 项已在 N 分支实现；其余模块待各负责人完成。

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

1. 五人先同步本次公共提交并 npm ci。不要复制对方整个 server.js；这条为 2026-11-04 公共基线说明；2026-11-05 N 进度以文末模块说明为准。
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


## N 模块实施与验收 2026-11-05

### 已完成与待整合的边界

- 分支 `feature/n-adoption`。业务、页面/API 路由和测试都在 `server.js` 的 05 N 区，未新增 routes/controllers/services 或测试目录，未新增依赖。
- 三个真实页面：`views/adoption.ejs`、`close.ejs`、`delete.ejs`。仅这些表单移除预览拦截；其他成员表单不变。`header.ejs` 仅增加真实 N 页面状态与当前用户显示。
- 实现开放/撤回开放、领养登记及修改、取消办理并保留历史、完成领养结案、管理员删除审计及 FollowUp/Adoption 关联清理；Adoption 增加姓名80、电话30、备注2000的 Schema 长度约束。
- N 不实现 T 的登录，不创建默认管理员，不接收请求头或表单里的用户身份；正常 app 未加载真实 `req.user` 时网页跳转 `/login`、API 401。安装 Session 不等于已完成认证。
- 当前正常启动没有可用测试账号。独立集成测试会临时模拟已由 T 认证的身份，仅用于验证 N 模块，不能据此宣称 T 登录已完成。
- L/Y/M 的详情、列表、统计仍使用示例数据。N 成功后暂时 303 跳回自身真实读取页，删除后跳到本次删除确认结果页，避免将未接入数据库的详情页当作保存结果。公共导航暂保留，整合时由 L/Y 接真实查询。
- 原 README 中 2026-11-04 的“全站原型/无写接口”是历史基线，本节覆盖 N 部分。

### 事务和本机运行

**N 的业务写入均使用真实 MongoDB 事务。MongoDB 原来的单机 27017 不支持这些事务，N 写操作会明确返回 503 TRANSACTIONS_REQUIRED，不降级为不完整保存。**

本机新增独立开发实例：127.0.0.1:27018，副本集 group007rs，数据目录 `~/.local/share/group007-mongo-rs`。原 27017 服务、配置和数据未修改。它只监听本机；单节点实例仅供本地开发，不代表生产高可用配置。关闭 WSL 后需要重新启动该实例。

其他成员首次配置（端口未被占用时）：

```bash
mkdir -p "$HOME/.local/share/group007-mongo-rs"
mongod --replSet group007rs --port 27018 --bind_ip 127.0.0.1 \
  --dbpath "$HOME/.local/share/group007-mongo-rs" \
  --logpath "$HOME/.local/share/group007-mongo-rs/mongod.log" --fork
mongosh 'mongodb://127.0.0.1:27018/?directConnection=true' --eval \
  'rs.initiate({_id:"group007rs",members:[{_id:0,host:"127.0.0.1:27018"}]})'
```

`rs.initiate` 仅首次执行；之后重启只执行上面的 mongod 命令，不重复初始化。若实例已运行，不重复启动。检查：

```bash
mongosh 'mongodb://127.0.0.1:27018/?replicaSet=group007rs' --quiet \
  --eval 'db.adminCommand({hello:1}).isWritablePrimary'
```

启动项目（依旧需要 T 完成身份加载才能进行网页操作）：

```bash
cd ~/comp3810sef_group007
nvm use 24.22.2
npm ci
export MONGODB_URI='mongodb://127.0.0.1:27018/animal_rescue_group007?replicaSet=group007rs'
CONNECT_DB=1 npm start
```

数据库名仍为 animal_rescue_group007，但端口不同意味着独立数据，不会自动迁移 27017 的记录。不要用旧示例 ID 假定真实记录存在。副本集配置是本组为一致性选择的实现方式，不是老师指定的额外功能。

### 统一规则及新增请求字段

- `nRequireLogin` 是 N 的权限接入适配器：需要 T 先加载 `req.user`，再从数据库核对用户及当前角色；未登录不会赋予模拟身份。删除页和删除接口额外检查管理员。
- N 表单保存 CSRF 令牌于 `req.session.csrfToken`，隐藏字段 `_csrf`；API 用 `X-CSRF-Token` 请求头。已认证的 GET 领养 API 返回同名响应头和签名 Session Cookie。缺失/错误令牌为 403。
- T 合并时保留或统一该 token 约定，登录时重新生成令牌、退出清除 Session；不能只移除 N 校验来让请求通过。T 仍负责会话过期、真实密码验证和密码变更撤销。
- 开放 API 增加 `healthConfirmed:true`（网页为 `yes`），表示工作人员确认健康适宜；还检查已安置、负责人、安置地点。不能自动匹配健康描述文字。
- 取消、结案和删除 API 必须有 `confirm:true`（网页为 `yes`），不能靠 GET 执行写入。
- 除上述确认字段与 CSRF 外，使用既有字段白名单；忽略客户端的 registeredBy、closedBy、completedAt 等，始终由服务器赋值。
- `GET /api/animals/:id/adoption` 的 `data` 为 `{animal, adoption, adoptionHistory}`；adoption 是未取消的当前登记（没有时为 null），adoptionHistory 是只读取消历史，按取消时间倒序，cancelledBy 查询显示姓名。写入成功为 `{success:true,data,message}`，登记201，其余200。网页写入303跳转，错误400/409重新显示表单并保留非密码字段。
- 业务状态不符、重复登记和重复结案409；非法 ID 400；不存在404；未认证401；无权限/CSRF403；数据库未连接或不支持事务503；未预期错误500。不返回错误堆栈。
- 删除结果页 `/animals/:id/deletion-result` 仅管理员可访问，并核对当前会话中的 `nDeletedAnimal`（仅一个已删除的动物 ID，无个人资料），防止伪造成功提示。

### N 第二版：取消、版本核对、删除审计

- 办理中可修改 adopterName（1–80）、adopterPhone（1–30）、remarks（0–2000）；操作者 updatedBy 由服务器写入，registeredBy 保留原登记人。
- 取消必须提供 cancellationReason（1–1000）和 confirm:true；写入 cancelledAt/cancelledBy/cancellationReason，动物回到 available。历史仅查看，可再次登记产生新的 Adoption。
- **修改、取消和结案必须带 adoptionId 与 adoptionVersion**，分别取最近 GET 返回的 data.adoption._id 与 data.adoption.__v（旧记录无 __v 时用 0）。修改会增加版本；每次操作前重新读取。版本或记录不匹配返回409，网页要求刷新后核对，不自动覆盖他人修改。
- 删除必须管理员且动物未结案，提供 deletionReason（1–1000）和 confirm:true。删除动物、全部跟进、全部领养历史与创建 DeletionLog 在同一事务内完成；任何一步失败全部回滚。日志保留编号、外观、原因、删除人、时间及删除数量，没有额外日志管理页面。
- User.isActive 已加入公共模型，N 每次请求重新核对用户是否停用。真正的账号管理、全站停用检查仍由 T 实现。
- details.ejs 仅作最小配合：已领养/已结案时隐藏编辑、救助、跟进写入与删除入口；L/M 真实后端仍须执行相同限制。

### 旧索引升级

首次更新前停止旧版本应用写入，再启动本版本。nPrepareDatabase 先建立 one_current_adoption 部分唯一索引，成功后仅移除旧版 animalId_1 的单字段完整唯一索引；不删记录、不批量重建其他索引。没有 cancelledAt 的旧登记仍视为当前登记。旧版本不要与新版同时运行同一数据库，否则旧查询可能读到取消历史。若数据冲突导致建立新索引失败，应先人工核对数据，不能删除索引跳过约束。迁移可重复运行，已有记录及其他索引保留，已通过真实数据库测试。

### API 与网页入口

| 功能 | 网页 POST | JSON API |
| --- | --- | --- |
| 查看领养 | GET /animals/:id/adoption | GET /api/animals/:id/adoption |
| 开放或撤回 | /animals/:id/adoption-status | PUT /api/animals/:id/adoption-status |
| 领养登记 | /animals/:id/adoption | POST /api/animals/:id/adoption |
| 修改办理资料 | /animals/:id/adoption/edit | PUT /api/animals/:id/adoption |
| 取消本次办理 | /animals/:id/adoption/cancel | PUT /api/animals/:id/adoption/cancel |
| 完成领养并结案 | /animals/:id/close | PUT /api/animals/:id/close |
| 删除误录 | /animals/:id/delete | DELETE /api/animals/:id |

### 跨集合一致性及其他成员的接入点

- N 的每次写入先在事务内更新同一 Animal 的版本字段，再读取并验证状态，因此并发登记、修改、取消、撤回、结案和删除会发生数据库写冲突并重试，重新验证后的冲突请求返回409/404。
- Adoption 的 one_current_adoption 部分唯一索引（cancelledAt:null）在连接启动时确保存在；登记与状态更新、结案双方完成时间、关联清理与动物删除都在同一个事务内串行执行。任何一步抛错，整体回滚。
- `nTransaction` 不使用进程内锁，因此不是只有单进程才生效。事务内不要 Promise.all 并行执行数据库操作。
- **M 必须让跟进新增/编辑/删除也在事务内先写同一 Animal，再检查未结案，然后处理 FollowUp。**可复用本区 `nTransaction(id, async (animal, session) => {...})`（对外测试导出名 withAnimalTransaction），每项 M 数据库调用都传 session。否则 M 若在 N 删除后仍插入跟进，就会产生孤立记录。M 现在未实现，不能声称这一跨模块联测已通过。
- L 更新基本资料必须条件检查 closedAt:null；M 救助变更也必须验证未结案并遵守领养期间状态规则。N 不重写他们的模块。
- Y/L 在真实读取接入后即可显示 N 写入的同一状态；结案后仍保留 Animal、Adoption、FollowUp。

### 可重复运行的独立测试

```bash
cd ~/comp3810sef_group007
nvm use 24.22.2
npm run test:n
```

默认连接上述27018副本集；可用 TEST_MONGODB_URI 指定其他测试副本集。每次生成随机 `group007_n_test_<随机串>` 数据库，并通过独立 HTTP 测试应用注入测试身份；结束仅清理该随机数据库，不清理 animal_rescue_group007。测试入口只在 `node server.js --test-n` 且 NODE_ENV=test 时运行，正式 app 不挂测试登录、身份请求头或任何权限绕过接口。

2026-11-05 第二版验证：28组集成测试通过，含未登录401/跳转、正式app拒绝测试身份头、CSRF、非法ID、字段类型与长度、安置/健康确认、开放撤回、并发登记、并发结案、服务器操作者、XSS转义、结案只读、管理员删除、角色撤销立即生效、网页字段保留和303。

故障注入验证了：领养记录创建后动物保存失败、完成时间写入后动物结案失败、跟进删除后领养删除失败，三种情况都完整回滚。登记与删除并发后无孤立领养记录。正常结案保留档案。第二版补测索引迁移、并发编辑与旧版本拒绝、取消回滚、取消后重新登记、旧标签页隔离、取消与结案竞争、删除日志创建前后故障回滚、停用账号立即拒绝及历史引用保留。

12种页面状态（未开放/可领养/办理中/已领养 × 领养/结案/删除）在1440、375、320像素下检查通过，无横向溢出和页面脚本异常；桌面与手机截图已检查。页面快照使用隔离测试数据，不代表真实登录流程已验收。第二版还通过浏览器实操：登记、修改、取消、查看历史、再次登记、结案，以及管理员填写原因删除未结案记录；取消历史在375像素宽度无横向溢出。试玩期间曾短暂返回数据库不可用，连接恢复后完整流程通过，未将失败提示为成功。

### curl 操作模板 需 T 登录和真实测试动物就绪

下面列出 N 的真实 API 用法；T 尚未实现登录，因此这些是整合时使用的命令，不声称现在能跳过登录运行。先按 T 的登录接口取得 Cookie 文件，把文件路径设为 COOKIE_FILE（文件放项目外）；按 T 要求处理登录 CSRF。普通工作人员可领养和结案，最后删除必须换管理员的 Cookie 并重新获取 token。

```bash
BASE='http://localhost:8099'
ID='替换成真实测试动物的24位_id'
COOKIE_FILE='/tmp/group007-staff-cookies.txt'

# GET：读取领养并取得写入 token，同时保存响应中的签名 Cookie
curl -sS -D /tmp/group007-n-headers.txt -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  "$BASE/api/animals/$ID/adoption"
TOKEN=$(awk 'tolower($1)=="x-csrf-token:" {gsub("\r", "", $2); print $2}' /tmp/group007-n-headers.txt)

# PUT：动物已安置且有负责人和安置地点，人工确认健康适宜
curl -i -X PUT -b "$COOKIE_FILE" -H "X-CSRF-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"adoptionStatus":"available","healthConfirmed":true}' \
  "$BASE/api/animals/$ID/adoption-status"

# POST：登记虚构领养人，状态变为 processing
curl -i -X POST -b "$COOKIE_FILE" -H "X-CSRF-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"adopterName":"测试领养人","adopterPhone":"00000000","remarks":"演示"}' \
  "$BASE/api/animals/$ID/adoption"

# 先再次 GET，核对 data.adoption._id 和 __v，再替换以下 ID/版本；0 只是示例
# PUT：确认完成交接并结案，档案保留
curl -i -X PUT -b "$COOKIE_FILE" -H "X-CSRF-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"adoptionId":"替换成当前领养记录_id","adoptionVersion":0,"confirm":true}' \
  "$BASE/api/animals/$ID/close"
```

修改及取消的 JSON 示例（同样带 Cookie、X-CSRF-Token 与 Content-Type: application/json；先用 GET 取得最新 ID/版本，不要连续照抄旧版本）：

```json
{ "adoptionId": "当前领养记录_id", "adoptionVersion": 0, "adopterName": "新虚构姓名", "adopterPhone": "00000000", "remarks": "更正资料" }
```

以上发往 `PUT /api/animals/:id/adoption`。取消发往 `PUT /api/animals/:id/adoption/cancel`：

```json
{ "adoptionId": "当前领养记录_id", "adoptionVersion": 1, "cancellationReason": "虚构领养人暂时无法接养", "confirm": true }
```

取消后可以再次登记；要演示结案，必须对最新一条未取消记录操作。

DELETE 演示另外准备一只未结案的虚构误录动物。将 ID 改为那只动物，将 COOKIE_FILE 改为已由 T 登录产生的管理员 Cookie 文件，再执行上面的 GET 重新取得 TOKEN，然后：

```bash
curl -i -X DELETE -b "$COOKIE_FILE" -H "X-CSRF-Token: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"confirm":true,"deletionReason":"虚构重复登记，测试清理"}' \
  "$BASE/api/animals/$ID"
```

每步检查 HTTP 状态和数据库实际结果；不要把真实个人资料、Cookie 或密钥提交仓库。curl 的全部方法已通过独立 HTTP 测试覆盖，但完整的“真实登录→curl”仍需 T 接入后共同验收。
