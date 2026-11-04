# 1. Project info — 项目信息

流浪动物救助与领养管理系统，用于工作人员管理动物从发现、救助、安置到领养结案的档案。
当前版本是页面原型：已完成首页、列表、详情及新增/编辑/救助/跟进/领养/结案/删除/个人资料/密码/登录表单页面。
尚未实现账号认证、数据库 CRUD、跨记录状态校验及 REST API。表单可以填写和查看预览反馈，但不会保存、执行状态转换或认证；页面存在不代表后端功能已完成。
本版只监听本机 127.0.0.1。没有账号权限保护，不用于正式部署。

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
| A | 登录退出、用户资料、密码、角色与权限 |
| B | 动物新增、详情、基本资料编辑 |
| C | 列表、多条件查询、分页排序、首页统计 |
| D | 负责人、救助进度、安置、跟进记录 CRUD |
| E | 领养登记、结案、动物删除和关联清理 |

每人负责本模块页面、后端、数据库操作和测试；共同整合、修错、README、curl 和演示。

# 3. Project file intro — 文件说明

保留课堂要求的根目录结构，没有 routes/controllers/services 等额外目录。

- server.js：Express 配置、示例数据、页面 GET 路由和启动逻辑；后续业务处理函数仍放在此文件。
- package.json / package-lock.json：现有依赖与版本锁定，无新增依赖。
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
