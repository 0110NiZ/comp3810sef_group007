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
// 后续在下方三个路由内换为 Mongoose 查询，保留传给 EJS 的变量名称。
const demoUsers = [
    { _id: '000000000000000000000001', displayName: '成员 A' },
    { _id: '000000000000000000000002', displayName: '成员 D' },
    { _id: '000000000000000000000003', displayName: '成员 E' }
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


// 以下只提供表单页面，不接收表单写入。真实权限和业务校验后续接入。
app.get('/login', (req, res) => res.render('login', { title: '工作人员登录', activePage: '' }));
app.get('/profile', (req, res) => res.render('profile', { title: '个人资料', activePage: 'profile' }));
app.get('/password', (req, res) => res.render('password', { title: '修改密码', activePage: 'profile' }));
app.get('/animals/new', (req, res) => res.render('create', { title: '新增动物', activePage: 'create', animal: {} }));

const formPages = { edit: '编辑动物资料', rescue: '救助管理', adoption: '领养登记', close: '领养结案', delete: '删除动物档案' };
for (const [page, title] of Object.entries(formPages)) {
    app.get('/animals/:id/' + page, (req, res) => {
        const animal = demoAnimals.find(item => item._id === req.params.id);
        if (!animal) return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物记录。' });
        res.render(page, { title, activePage: 'list', animal, users: demoUsers,
            adoption: demoAdoptions.find(item => item.animalId === animal._id) || null });
    });
}
app.get('/animals/:id/followups/new', (req, res) => renderFollowUp(req, res, 'create'));
app.get('/animals/:id/followups/:followId/edit', (req, res) => renderFollowUp(req, res, 'edit'));
app.get('/animals/:id/followups/:followId/delete', (req, res) => renderFollowUp(req, res, 'delete'));
function renderFollowUp(req, res, mode) {
    const animal = demoAnimals.find(item => item._id === req.params.id);
    const followUp = mode === 'create' ? null : demoFollowUps.find(item => item._id === req.params.followId && item.animalId === req.params.id);
    if (!animal || (mode !== 'create' && !followUp)) return res.status(404).render('info', { title: '记录不存在', activePage: 'list', message: '未找到这条动物或跟进记录。' });
    res.render('followup', { title: {create:'添加跟进记录',edit:'编辑跟进记录',delete:'删除跟进记录'}[mode], activePage: 'list', mode, animal, followUp });
}

app.get('/animals/:id', (req, res) => {
    const animal = demoAnimals.find(a => a._id === req.params.id);
    if (!animal) return res.status(404).render('info', { title: '记录不存在', activePage: '', message: '未找到这条动物记录，请返回列表。' });
    res.render('details', { title: '动物详情', activePage: 'list', animal,
        followUps: demoFollowUps.filter(item => item.animalId === animal._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        adoption: demoAdoptions.find(item => item.animalId === animal._id) || null });
});

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
