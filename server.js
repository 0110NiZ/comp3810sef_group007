// 团队协作：仅按负责人分区，不拆出 routes/controllers/services，保持课堂目录结构。
// 每人在自己的分支修改所属区域；公共配置/模型/布局修改需与相关成员协调。
// 当前仍是页面原型：分区和 TODO 不是已实现的权限、CRUD 或 API。

// ============================================================================
// 00 公共区｜Express、模板辅助与示例数据（共同维护）
// ============================================================================
const express = require('express');
const mongoose = require('mongoose');
const path = require('node:path');
const labels = require('./models/constants');
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
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
// 不写放行式的伪权限函数；认证中间件依赖的 session 配置放公共区、路由之前。
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
// 分支 feature/m-rescue；维护 Animal 救助字段及 FollowUp，不重复修改动物基本资料。
app.get('/animals/:id/rescue', (req, res) => {
    const animal = demoAnimals.find(item => item._id === req.params.id);
    if (!animal) return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物记录。' });
    res.render('rescue', { title: '救助管理', activePage: 'list', animal, users: demoUsers,
        adoption: demoAdoptions.find(item => item.animalId === animal._id) || null });
});

app.get('/animals/:id/followups/new', (req, res) => renderFollowUp(req, res, 'create'));
app.get('/animals/:id/followups/:followId/edit', (req, res) => renderFollowUp(req, res, 'edit'));
app.get('/animals/:id/followups/:followId/delete', (req, res) => renderFollowUp(req, res, 'delete'));
function renderFollowUp(req, res, mode) {
    const animal = demoAnimals.find(item => item._id === req.params.id);
    const followUp = mode === 'create' ? null : demoFollowUps.find(item => item._id === req.params.followId && item.animalId === req.params.id);
    if (!animal || (mode !== 'create' && !followUp)) return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物或跟进记录。' });
    res.render('followup', { title: {create:'添加跟进记录',edit:'编辑跟进记录',delete:'删除跟进记录'}[mode], activePage: 'list', mode, animal, followUp });
}

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
app.use((req, res) => res.status(404).render('info', { title: '页面不存在', activePage: '', message: '这个页面暂不存在，请返回首页或动物列表。' }));

// 保留已有数据库连接。原型模式默认不连接数据库，避免浏览页面产生数据库操作。
// 需要单独验证连接时设置 CONNECT_DB=1；它不会把示例数据自动保存到数据库。
async function startServer() {
    try {
        if (process.env.CONNECT_DB === '1') {
            await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/animal_rescue_group007', { serverSelectionTimeoutMS: 5000 });
            console.log('MongoDB 连接成功（页面仍使用示例数据）');
        }
        const port = process.env.PORT || 8099;
        const server = app.listen(port, '127.0.0.1', () => console.log(`页面原型：http://localhost:${port}（示例数据，未启用认证和写入）`));
        server.on('error', error => { console.error('启动失败：', error.message); process.exit(1); });
    } catch (error) {
        console.error('启动失败：', error.message);
        process.exit(1);
    }
}
if (require.main === module) startServer();
module.exports = app;
