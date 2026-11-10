// 团队协作：仅按负责人分区，不拆出 routes/controllers/services，保持课堂目录结构。
// 每人在自己的分支修改所属区域；公共配置/模型/布局修改需与相关成员协调。
// 当前仍是页面原型：分区和 TODO 不是已实现的权限、CRUD 或 API。

// ============================================================================
// 00 公共区｜Express、模板辅助与示例数据（共同维护）
// ============================================================================
const express = require('express');
const mongoose = require('mongoose');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const cookieSession = require('cookie-session');
const labels = require('./models/constants');
const Animal = require('./models/Animal');
const FollowUp = require('./models/FollowUp');
const User = require('./models/User');
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// 公共请求体解析：现有表单都是平铺字段，不需要 extended: true 的嵌套对象。
// 解析不等于验证，各模块仍须按字段白名单检查 req.body。
app.use(express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 100 }));
app.use(express.json({ limit: '100kb' }));

// Session 基础配置已就绪；账号验证、用户加载及路由保护仍由 T 实现。
const production = process.env.NODE_ENV === 'production';
const sessionKeys = (process.env.SESSION_KEYS || '').split(',').map(key => key.trim()).filter(Boolean);
if (sessionKeys.some(key => key.length < 32)) throw new Error('SESSION_KEYS 中的每个签名密钥至少需要 32 个字符');
if (!sessionKeys.length) {
    if (production) throw new Error('正式运行必须设置 SESSION_KEYS');
    // 本地原型临时签名密钥，重启后旧 cookie 失效；不打印、不写入代码仓库。
    sessionKeys.push(randomBytes(32).toString('hex'));
}
// 只在已确认恰好一层可信反向代理时设置 TRUST_PROXY=1。
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(cookieSession({
    name: 'group007_session', keys: sessionKeys,
    maxAge: 8 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: production
}));
app.use((req, res, next) => {
    // 当前未认证；后续 T 从 req.session.userId 加载真实用户后再赋值。
    req.user = null;
    res.locals.currentUser = null;
    next();
});

function isApiRequest(req) {
    return req.path === '/api' || req.path.startsWith('/api/');
}
function sendApiError(res, status, code, message) {
    return res.status(status).json({ success: false, error: { code, message } });
}

app.locals.labels = labels;
app.locals.formatDate = (value) => value ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value)) : '—';

// 仅供页面原型。字段与公共 Schema 对齐，不读写 MongoDB，也不模拟登录成功。
// 后续由各模块替换自己的示例查询，保留传给 EJS 的变量名称；不要一次删除共享示例数据。
const demoUsers = [
    { _id: '000000000000000000000001', displayName: '成员 T' },
    { _id: '000000000000000000000002', displayName: '成员 M' },
    { _id: '000000000000000000000003', displayName: '成员 N' }
];
const demoAnimals = [
    ['001', 'cat', '橘白小猫，左前腿有伤', '校园东门', '已处理伤口，正在治疗', 'rescuing', 'not_open', '合作诊所'],
    ['002', 'dog', '黑色小狗，胸前有白毛', '社区公园', '健康状况稳定', 'placed', 'available', '临时安置点 A'],
    ['003', 'cat', '灰色小猫，短毛', '图书馆附近', '健康状况良好', 'placed', 'adopted', '领养人家庭'],
    ['004', 'dog', '棕色小狗，戴蓝色项圈', '校园西门', '待检查', 'pending', 'not_open', '']
].map(([code, type, appearance, location, health, rescue, adoption, placement], i) => ({
    _id: '100000000000000000000' + code,
    animalCode: 'A007-' + code, animalType: type, appearance,
    foundLocation: location, healthStatus: health,
    contactName: '示例发现人' + (i + 1), contactPhone: '00000000',
    createdBy: demoUsers[0]._id, rescueStatus: rescue,
    assignedTo: rescue === 'pending' ? null : demoUsers[1]._id,
    placementLocation: placement, adoptionStatus: adoption,
    closedAt: adoption === 'adopted' ? '2026-11-03T06:00:00Z' : null,
    closedBy: adoption === 'adopted' ? demoUsers[2]._id : null,
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: ['2026-11-04T02:30:00Z', '2026-11-04T01:00:00Z', '2026-11-03T06:00:00Z', '2026-11-02T00:30:00Z'][i]
}));
const demoFollowUps = demoAnimals.map((animal, i) => ({
    _id: '20000000000000000000000' + (i + 1), animalId: animal._id,
    content: ['已送往合作诊所，完成伤口处理。', '完成健康评估，开放领养。', '已完成领养，结案后保留档案。', '收到发现报告，等待安排救助。'][i],
    recordedBy: demoUsers[1]._id, updatedBy: null,
    createdAt: animal.updatedAt, updatedAt: animal.updatedAt
}));
const demoAdoptions = [{
    _id: '300000000000000000000001', animalId: demoAnimals[2]._id,
    adopterName: '示例领养人', adopterPhone: '00000000', remarks: '虚构领养示例',
    registeredBy: demoUsers[2]._id, completedAt: demoAnimals[2].closedAt,
    createdAt: '2026-11-02T03:00:00Z', updatedAt: demoAnimals[2].closedAt
}];
app.locals.userName = (id) => demoUsers.find(user => user._id === String(id))?.displayName || '未指定';


// ============================================================================
// 01 T 区｜登录退出、用户资料、密码与权限
// ============================================================================
// 分支 feature/t-auth；本区放账号路由、处理函数，以及真实认证中间件。
app.get('/login', (req, res) => res.render('login', { title: '工作人员登录', activePage: '' }));
app.get('/profile', (req, res) => res.render('profile', { title: '个人资料', activePage: 'profile' }));
app.get('/password', (req, res) => res.render('password', { title: '修改密码', activePage: 'profile' }));

// T 后续：实现 requireLogin / requireAdmin，并向其他成员说明调用方式。
// 不写放行式的伪权限函数；Session 已在公共区配置，T 的用户加载中间件应在所有业务路由之前。
// 当前没有这些函数，其他模块不得提前引用；未接入权限的写功能不能视为验收完成。
// T 的账号处理函数、接口和测试说明从这里继续。

// ============================================================================
// 02 L 区｜动物新增、详情、基本资料编辑
// ============================================================================
// 分支 feature/l-animal；只更新基本资料，不修改 M/N 的救助、领养及结案字段。
app.get('/animals/new', (req, res) => res.render('create', { title: '新增动物', activePage: 'create', animal: {} }));

app.get('/animals/:id/edit', (req, res) => {
    const animal = demoAnimals.find(item => item._id === req.params.id);
    if (!animal) return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物记录。' });
    res.render('edit', { title: '编辑动物资料', activePage: 'list', animal, users: demoUsers,
        adoption: demoAdoptions.find(item => item.animalId === animal._id) || null });
});

app.get('/animals/:id', (req, res) => {
    const animal = demoAnimals.find(a => a._id === req.params.id);
    if (!animal) return res.status(404).render('info', { title: '记录不存在', activePage: '', message: '未找到这条动物记录，请返回列表。' });
    res.render('details', { title: '动物详情', activePage: 'list', animal,
        followUps: demoFollowUps.filter(item => item.animalId === animal._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        adoption: demoAdoptions.find(item => item.animalId === animal._id) || null });
});

// 固定路径 /animals/new 必须先于 /animals/:id 注册。
// L 后续：新增/修改处理函数，POST /api/animals、GET/PUT /api/animals/:id。
// 详情页是展示汇总：M/N 提供跟进、领养字段，详情模板由 L 协调整合。

// ============================================================================
// 03 Y 区｜首页统计、动物列表、查询、分页与排序
// ============================================================================
// 分支 feature/y-query；数据库查询只读取公共字段，不重新定义模型或状态。
app.get('/', (req, res) => {
    const countBy = (field, values) => Object.keys(values).map(value => ({
        label: values[value], count: demoAnimals.filter(animal => animal[field] === value).length
    }));
    res.render('dashboard', {
        title: '首页统计', activePage: 'home', total: demoAnimals.length,
        rescueCounts: countBy('rescueStatus', labels.rescueStatuses),
        adoptionCounts: countBy('adoptionStatus', labels.adoptionStatuses),
        animals: [...demoAnimals].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3)
    });
});

app.get('/animals', (req, res) => {
    // 只接收已知查询字段；重复参数或数组参数按空值处理。
    const text = key => typeof req.query[key] === 'string' ? req.query[key].trim() : '';
    const filters = { animalType: text('animalType'), foundLocation: text('foundLocation'),
        rescueStatus: text('rescueStatus'), adoptionStatus: text('adoptionStatus'), sort: text('sort') || 'updated_desc' };
    for (const [field, values] of [['animalType', labels.animalTypes], ['rescueStatus', labels.rescueStatuses], ['adoptionStatus', labels.adoptionStatuses]]) {
        if (!Object.hasOwn(values, filters[field])) filters[field] = '';
    }
    const sorts = { updated_desc: ['updatedAt', -1], updated_asc: ['updatedAt', 1], created_desc: ['createdAt', -1], created_asc: ['createdAt', 1] };
    if (!Object.hasOwn(sorts, filters.sort)) filters.sort = 'updated_desc';
    const matches = demoAnimals.filter(a => (!filters.animalType || a.animalType === filters.animalType)
        && a.foundLocation.includes(filters.foundLocation)
        && (!filters.rescueStatus || a.rescueStatus === filters.rescueStatus)
        && (!filters.adoptionStatus || a.adoptionStatus === filters.adoptionStatus));
    const [field, direction] = sorts[filters.sort];
    matches.sort((a, b) => direction * a[field].localeCompare(b[field]) || a.animalCode.localeCompare(b.animalCode));
    const pageSize = 3;
    const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
    const requestedPage = Number(text('page'));
    const page = Math.min(pageCount, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
    const pageUrl = number => '/animals?' + new URLSearchParams({ ...filters, page: String(number) });
    res.render('list', { title: '动物列表', activePage: 'list', filters, page, pageCount,
        total: matches.length, pageUrl, animals: matches.slice((page - 1) * pageSize, page * pageSize) });
});

// Y 后续：GET /api/animals、GET /api/stats，避免 /api/animals/stats 被 :id 捕获。
// Y 的查询/统计处理函数和接口从这里继续。

// ============================================================================
// 04 M 区｜救助负责人、进度、安置和跟进记录
// ============================================================================
// 分支 feature/m-rescue；维护 Animal 救助字段及 FollowUp，严格遵守课堂与项目约定。

// 辅助工具：获取当前操作人员 ID
function getStaffUserId(req) {
    if (req.session && req.session.userId) {
        return req.session.userId;
    }
    // 未接入正式登录前，使用虚构的成员 M 账号 ID 作为测试回退
    return '000000000000000000000002';
}

// 救助进度顺序权重（确保进度单向推进，不能倒退）
const RESCUE_STAGE = {
    pending: 1,
    rescuing: 2,
    placed: 3
};

// --------------------------- 1. 救助管理（页面与操作） ---------------------------

// GET /animals/:id/rescue - 渲染救助状态修改页面
app.get('/animals/:id/rescue', async function(req, res) {
    try {
        const animalId = req.params.id;
        const animal = await Animal.findById(animalId);
        if (!animal) {
            return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物记录。' });
        }

        // 查询所有工作人员供下拉菜单选择负责人
        let users = await User.find({});
        if (!users || users.length === 0) {
            users = demoUsers; // 回退使用 demoUsers 保证页面正常展示
        }

        res.status(200).render('rescue', {
            title: '救助管理',
            activePage: 'list',
            animal: animal,
            users: users,
            adoption: null
        });
    } catch (err) {
        console.error('获取救助管理页面出错:', err);
        res.status(500).render('info', { title: '服务器错误', activePage: 'list', message: '加载救助页面失败。' });
    }
});

// POST /animals/:id/rescue - 网页表单提交更新救助状态
app.post('/animals/:id/rescue', async function(req, res) {
    try {
        const animalId = req.params.id;
        const animal = await Animal.findById(animalId);
        if (!animal) {
            return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到动物记录。' });
        }

        // 结案保护：已结案不可修改救助资料
        if (animal.closedAt || animal.adoptionStatus === 'adopted') {
            return res.status(403).render('info', { title: '禁止操作', activePage: 'list', message: '该动物档案已结案，无法修改救助进度。' });
        }

        const newStatus = req.body.rescueStatus;
        const newAssignedTo = req.body.assignedTo ? req.body.assignedTo : null;
        const newPlacement = req.body.placementLocation ? req.body.placementLocation.trim() : '';

        // 校验 1：救助进度不能倒退
        const currentRank = RESCUE_STAGE[animal.rescueStatus] || 1;
        const targetRank = RESCUE_STAGE[newStatus] || 1;
        if (targetRank < currentRank) {
            return res.status(400).render('info', { title: '操作被拒绝', activePage: 'list', message: '救助进度只能单向推进，不允许回退。' });
        }

        // 校验 2：进入 rescuing 必须有负责人
        if (newStatus === 'rescuing' && !newAssignedTo && !animal.assignedTo) {
            return res.status(400).render('info', { title: '缺少负责人', activePage: 'list', message: '推进到“救助中”必须指定负责人。' });
        }

        // 校验 3：进入 placed 必须有负责人和安置地点
        if (newStatus === 'placed') {
            const hasAssignee = newAssignedTo || animal.assignedTo;
            const place = newPlacement || animal.placementLocation;
            if (!hasAssignee || !place) {
                return res.status(400).render('info', { title: '信息不全', activePage: 'list', message: '推进到“已安置”必须有负责人及安置地点。' });
            }
            animal.placementLocation = place;
        }

        animal.rescueStatus = newStatus;
        if (newAssignedTo) {
            animal.assignedTo = newAssignedTo;
        }
        await animal.save();

        res.redirect('/animals/' + animalId);
    } catch (err) {
        console.error('更新救助状态出错:', err);
        res.status(500).render('info', { title: '更新失败', activePage: 'list', message: '更新救助信息出错。' });
    }
});

// PUT /api/animals/:id/rescue - RESTful API 更新救助状态 (纯 JSON)
app.put('/api/animals/:id/rescue', async function(req, res) {
    try {
        const animalId = req.params.id;
        const animal = await Animal.findById(animalId);
        if (!animal) {
            return res.status(404).type('json').json({ success: false, error: '未找到该动物记录' }).end();
        }

        if (animal.closedAt || animal.adoptionStatus === 'adopted') {
            return res.status(403).type('json').json({ success: false, error: '该动物档案已结案，无法修改' }).end();
        }

        const newStatus = req.body.rescueStatus;
        if (!newStatus || !RESCUE_STAGE[newStatus]) {
            return res.status(400).type('json').json({ success: false, error: 'rescueStatus 参数无效' }).end();
        }

        const currentRank = RESCUE_STAGE[animal.rescueStatus] || 1;
        const targetRank = RESCUE_STAGE[newStatus];
        if (targetRank < currentRank) {
            return res.status(400).type('json').json({ success: false, error: '救助进度只能单向推进，不允许回退' }).end();
        }

        if (newStatus === 'rescuing' && !req.body.assignedTo && !animal.assignedTo) {
            return res.status(400).type('json').json({ success: false, error: '进入 rescuing 状态必须提供 assignedTo' }).end();
        }

        if (newStatus === 'placed') {
            const hasAssignee = req.body.assignedTo || animal.assignedTo;
            const place = req.body.placementLocation || animal.placementLocation;
            if (!hasAssignee || !place) {
                return res.status(400).type('json').json({ success: false, error: '进入 placed 状态必须具备负责人和安置地点' }).end();
            }
            animal.placementLocation = String(place).trim();
        }

        animal.rescueStatus = newStatus;
        if (req.body.assignedTo) animal.assignedTo = req.body.assignedTo;
        await animal.save();

        res.status(200).type('json').json({ success: true, message: '救助状态更新成功', data: animal }).end();
    } catch (err) {
        console.error('API 救助更新出错:', err);
        res.status(500).type('json').json({ success: false, error: '服务器内部错误' }).end();
    }
});


// --------------------------- 2. 跟进记录 CRUD (FollowUp) ---------------------------

// 页面路由：新增/编辑/删除跟进页面统一处理
app.get('/animals/:id/followups/new', (req, res) => renderFollowUpView(req, res, 'create'));
app.get('/animals/:id/followups/:followId/edit', (req, res) => renderFollowUpView(req, res, 'edit'));
app.get('/animals/:id/followups/:followId/delete', (req, res) => renderFollowUpView(req, res, 'delete'));

async function renderFollowUpView(req, res, mode) {
    try {
        const animalId = req.params.id;
        const followId = req.params.followId;
        const animal = await Animal.findById(animalId);
        if (!animal) {
            return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到动物记录。' });
        }

        let followUp = null;
        if (mode !== 'create') {
            followUp = await FollowUp.findOne({ _id: followId, animalId: animalId });
            if (!followUp) {
                return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到该跟进记录或记录不属于该动物。' });
            }
        }

        const pageTitles = {
            create: '添加跟进记录',
            edit: '编辑跟进记录',
            delete: '删除跟进记录'
        };

        res.status(200).render('followup', {
            title: pageTitles[mode],
            activePage: 'list',
            mode: mode,
            animal: animal,
            followUp: followUp
        });
    } catch (err) {
        console.error('加载跟进页面出错:', err);
        res.status(500).render('info', { title: '错误', activePage: 'list', message: '加载跟进页面出错。' });
    }
}

// POST /animals/:id/followups/new - 网页添加跟进
app.post('/animals/:id/followups/new', async function(req, res) {
    try {
        const animalId = req.params.id;
        const content = req.body.content ? req.body.content.trim() : '';
        if (!content) {
            return res.status(400).render('info', { title: '参数缺失', activePage: 'list', message: '跟进内容不能为空。' });
        }

        const animal = await Animal.findById(animalId);
        if (!animal) {
            return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '动物不存在。' });
        }
        if (animal.closedAt || animal.adoptionStatus === 'adopted') {
            return res.status(403).render('info', { title: '禁止写入', activePage: 'list', message: '已结案动物档案不可追加跟进记录。' });
        }

        await FollowUp.create({
            animalId: animalId,
            content: content,
            recordedBy: getStaffUserId(req)
        });

        res.redirect('/animals/' + animalId);
    } catch (err) {
        console.error('网页添加跟进出错:', err);
        res.status(500).render('info', { title: '错误', activePage: 'list', message: '保存跟进记录失败。' });
    }
});

// POST /animals/:id/followups/:followId/edit - 网页修改跟进
app.post('/animals/:id/followups/:followId/edit', async function(req, res) {
    try {
        const { id, followId } = req.params;
        const content = req.body.content ? req.body.content.trim() : '';
        if (!content) {
            return res.status(400).render('info', { title: '参数缺失', activePage: 'list', message: '跟进内容不能为空。' });
        }

        const animal = await Animal.findById(id);
        if (!animal || animal.closedAt) {
            return res.status(403).render('info', { title: '禁止操作', activePage: 'list', message: '动物档案已结案或不存在。' });
        }

        const followUp = await FollowUp.findOne({ _id: followId, animalId: id });
        if (!followUp) {
            return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '跟进记录不存在。' });
        }

        followUp.content = content;
        followUp.updatedBy = getStaffUserId(req);
        await followUp.save();

        res.redirect('/animals/' + id);
    } catch (err) {
        console.error('网页编辑跟进出错:', err);
        res.status(500).render('info', { title: '错误', activePage: 'list', message: '修改跟进记录失败。' });
    }
});

// POST /animals/:id/followups/:followId/delete - 网页删除跟进
app.post('/animals/:id/followups/:followId/delete', async function(req, res) {
    try {
        const { id, followId } = req.params;
        const animal = await Animal.findById(id);
        if (!animal || animal.closedAt) {
            return res.status(403).render('info', { title: '禁止操作', activePage: 'list', message: '动物档案已结案或不存在。' });
        }

        const result = await FollowUp.findOneAndDelete({ _id: followId, animalId: id });
        if (!result) {
            return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到要删除的记录。' });
        }

        res.redirect('/animals/' + id);
    } catch (err) {
        console.error('网页删除跟进出错:', err);
        res.status(500).render('info', { title: '错误', activePage: 'list', message: '删除跟进失败。' });
    }
});


// --------------------------- 3. 跟进记录 RESTful API (对齐 Lab09 规范) ---------------------------

// GET /api/animals/:id/followups - READ 跟进列表
app.get('/api/animals/:id/followups', async function(req, res) {
    try {
        const animalId = req.params.id;
        const list = await FollowUp.find({ animalId: animalId }).sort({ createdAt: -1 });
        res.status(200).type('json').json(list).end();
    } catch (err) {
        res.status(500).type('json').json({ success: false, error: '查询跟进失败' }).end();
    }
});

// POST /api/animals/:id/followups - CREATE 新增一条跟进
app.post('/api/animals/:id/followups', async function(req, res) {
    try {
        const animalId = req.params.id;
        const content = req.body.content ? req.body.content.trim() : '';
        if (!content) {
            return res.status(400).type('json').json({ success: false, error: 'content 不能为空' }).end();
        }

        const animal = await Animal.findById(animalId);
        if (!animal) {
            return res.status(404).type('json').json({ success: false, error: '动物不存在' }).end();
        }
        if (animal.closedAt || animal.adoptionStatus === 'adopted') {
            return res.status(403).type('json').json({ success: false, error: '档案已结案，无法添加' }).end();
        }

        const newFollowUp = await FollowUp.create({
            animalId: animalId,
            content: content,
            recordedBy: getStaffUserId(req)
        });

        res.status(201).type('json').json(newFollowUp).end();
    } catch (err) {
        res.status(500).type('json').json({ success: false, error: '创建跟进失败' }).end();
    }
});

// PUT /api/animals/:id/followups/:followId - UPDATE 修改跟进
app.put('/api/animals/:id/followups/:followId', async function(req, res) {
    try {
        const { id, followId } = req.params;
        const content = req.body.content ? req.body.content.trim() : '';
        if (!content) {
            return res.status(400).type('json').json({ success: false, error: 'content 不能为空' }).end();
        }

        const animal = await Animal.findById(id);
        if (!animal || animal.closedAt) {
            return res.status(403).type('json').json({ success: false, error: '档案已结案或不存在' }).end();
        }

        const followUp = await FollowUp.findOne({ _id: followId, animalId: id });
        if (!followUp) {
            return res.status(404).type('json').json({ success: false, error: '跟进记录不存在' }).end();
        }

        followUp.content = content;
        followUp.updatedBy = getStaffUserId(req);
        await followUp.save();

        res.status(200).type('json').json(followUp).end();
    } catch (err) {
        res.status(500).type('json').json({ success: false, error: '更新跟进失败' }).end();
    }
});

// DELETE /api/animals/:id/followups/:followId - DELETE 删除跟进
app.delete('/api/animals/:id/followups/:followId', async function(req, res) {
    try {
        const { id, followId } = req.params;
        const animal = await Animal.findById(id);
        if (!animal || animal.closedAt) {
            return res.status(403).type('json').json({ success: false, error: '档案已结案或不存在' }).end();
        }

        const deleted = await FollowUp.findOneAndDelete({ _id: followId, animalId: id });
        if (!deleted) {
            return res.status(404).type('json').json({ success: false, error: '记录不存在' }).end();
        }

        res.status(200).type('json').json({ success: true, message: '删除成功' }).end();
    } catch (err) {
        res.status(500).type('json').json({ success: false, error: '删除跟进失败' }).end();
    }
});

// M 后续：PUT /api/animals/:id/rescue；GET/POST /api/animals/:id/followups；
// PUT/DELETE /api/animals/:id/followups/:followId。
// 关联检查、作者/管理员权限及结案后限制，在真实写入接入时统一实现。

// ============================================================================
// 05 N 区｜领养登记、结案与动物删除
// ============================================================================
// 分支 feature/n-adoption；维护 Animal 领养/结案字段及 Adoption，协调关联记录清理。
app.get('/animals/:id/adoption', (req, res) => {
    const animal = demoAnimals.find(item => item._id === req.params.id);
    if (!animal) return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物记录。' });
    res.render('adoption', { title: '领养登记', activePage: 'list', animal, users: demoUsers,
        adoption: demoAdoptions.find(item => item.animalId === animal._id) || null });
});

app.get('/animals/:id/close', (req, res) => {
    const animal = demoAnimals.find(item => item._id === req.params.id);
    if (!animal) return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物记录。' });
    res.render('close', { title: '领养结案', activePage: 'list', animal, users: demoUsers,
        adoption: demoAdoptions.find(item => item.animalId === animal._id) || null });
});

app.get('/animals/:id/delete', (req, res) => {
    const animal = demoAnimals.find(item => item._id === req.params.id);
    if (!animal) return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物记录。' });
    res.render('delete', { title: '删除动物档案', activePage: 'list', animal, users: demoUsers,
        adoption: demoAdoptions.find(item => item.animalId === animal._id) || null });
});

// N 后续：PUT /api/animals/:id/adoption-status；GET/POST /api/animals/:id/adoption；
// PUT /api/animals/:id/close；DELETE /api/animals/:id。
// 删除 FollowUp/Adoption 和并发领养的一致性由 N 与 M 协同处理。

// ============================================================================
// 99 公共区｜404 和服务器启动（共同维护）
// ============================================================================
// 所有页面及 API 路由必须写在这个区域之前；不要在 404 后追加路由。
app.use((req, res) => {
    if (isApiRequest(req)) return sendApiError(res, 404, 'NOT_FOUND', '接口不存在或尚未实现');
    return res.status(404).render('info', { title: '页面不存在', activePage: '', message: '这个页面暂不存在，请返回首页或动物列表。' });
});

// 错误处理在所有路由之后；API 返回 JSON，网页返回 EJS，不把堆栈或数据库信息发给用户。
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = '服务器处理失败，请稍后重试';
    if (error.type === 'entity.parse.failed') {
        status = 400; code = 'INVALID_BODY'; message = '请求内容格式不正确';
    } else if (error.status === 413) {
        status = 413; code = 'BODY_TOO_LARGE'; message = '提交内容过大';
    }
    if (status === 500) console.error('请求处理失败：', error.message);
    if (isApiRequest(req)) return sendApiError(res, status, code, message);
    return res.status(status).render('info', { title: '请求失败', activePage: '', message });
});

// 保留已有数据库连接。原型模式默认不连接数据库，避免浏览页面产生数据库操作。
// 需要单独验证连接时设置 CONNECT_DB=1；它不会把示例数据自动保存到数据库。
async function startServer() {
    try {
        if (process.env.CONNECT_DB === '1') {
            await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/animal_rescue_group007', { serverSelectionTimeoutMS: 5000 });
            console.log('MongoDB 连接成功（页面仍使用示例数据）');
        }
        const port = process.env.PORT || 8099;
        const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
        const server = app.listen(port, host, () => console.log(`页面原型：http://${host}:${port}（示例数据，未启用认证和写入）`));
        server.on('error', error => { console.error('启动失败：', error.message); process.exit(1); });
    } catch (error) {
        console.error('启动失败：', error.message);
        process.exit(1);
    }
}
if (require.main === module) startServer();
module.exports = app;
