// 团队协作：仅按负责人分区，不拆出 routes/controllers/services，保持课堂目录结构。
// 每人在自己的分支修改所属区域；公共配置/模型/布局修改需与相关成员协调。
// N 模块已接入真实数据库及事务；T/L/Y/M 仍待完成。没有真实 req.user 时 N 拒绝访问。

// ============================================================================
// 00 公共区｜Express、模板辅助与示例数据（共同维护）
// ============================================================================
const express = require('express');
const mongoose = require('mongoose');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const cookieSession = require('cookie-session');
const labels = require('./models/constants');
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
// 分支 feature/n-adoption。业务路由共用事务函数，不复制网页/API 两套规则。
// T 集成点：在本区之前加载真实 req.user；当前公共区仍将其设为 null，默认拒绝访问。
const { timingSafeEqual: nTimingSafeEqual } = require('node:crypto');
let nModels;
function nGetModels() {
    if (!nModels) nModels = {
        Animal: require('./models/Animal'), Adoption: require('./models/Adoption'),
        FollowUp: require('./models/FollowUp'), User: require('./models/User'),
        DeletionLog: require('./models/DeletionLog')
    };
    return nModels;
}
function nFail(status, code, message) {
    const error = new Error(message);
    Object.assign(error, { nStatus: status, nCode: code });
    throw error;
}
function nId(value) {
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) {
        nFail(400, 'INVALID_ID', '动物编号格式不正确');
    }
    return value;
}
function nText(body, key, maximum, required = true) {
    const value = body?.[key];
    if (!required && value === undefined) return '';
    if (typeof value !== 'string') nFail(400, 'VALIDATION_ERROR', '提交字段必须是文字，请检查表单');
    const text = value.trim();
    if ((required && !text) || text.length > maximum) {
        const label = { adopterName: '姓名', adopterPhone: '电话', remarks: '备注', cancellationReason: '取消原因', deletionReason: '删除原因' }[key] || key;
        nFail(400, 'VALIDATION_ERROR', label + '不能为空且不能超过' + maximum + '字');
    }
    return text;
}
function nConfirmed(value) { return value === true || value === 'yes'; }
function nDatabase() {
    if (mongoose.connection.readyState !== 1) nFail(503, 'DATABASE_UNAVAILABLE', '数据库未连接，请联系维护人员');
}
// 使用数据库唯一索引防止重复领养；不清库、不灌入示例数据。
async function nPrepareDatabase() {
    nDatabase();
    const models = nGetModels();
    for (const Model of Object.values(models)) await Model.init();
    await models.Adoption.createIndexes();
    // 先确保新约束存在，再只移除旧版明确的 animalId 全量唯一索引。
    // 不使用 syncIndexes，不删业务数据，不删除其他未知索引；重复启动安全。
    const indexes = await models.Adoption.collection.indexes();
    const old = indexes.find(index => index.name === 'animalId_1' && index.unique === true
        && index.key.animalId === 1 && Object.keys(index.key).length === 1 && !index.partialFilterExpression);
    if (old) await models.Adoption.collection.dropIndex(old.name);
}
async function nTransaction(id, work) {
    nId(id);
    nDatabase();
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') {
        nFail(503, 'TRANSACTIONS_REQUIRED', '此操作需要支持事务的 MongoDB，请按 README 配置副本集');
    }
    const { Animal } = nGetModels();
    return mongoose.connection.transaction(async session => {
        // 所有 N 写操作都先写同一动物，避免登记/撤回/结案/删除互相穿插。
        // M 后续写跟进也须在同一事务中锁定动物并检查 closedAt，再写关联记录。
        const animal = await Animal.findOneAndUpdate({ _id: id }, { $inc: { __v: 1 } },
            { session, returnDocument: 'after', runValidators: true });
        if (!animal) nFail(404, 'NOT_FOUND', '未找到这条动物档案');
        return work(animal, session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000 });
}
function nOpenAnimal(animal) {
    if (animal.closedAt || animal.adoptionStatus === 'adopted') nFail(409, 'CASE_CLOSED', '该动物已结案，档案只供查看');
}
async function nRead(id) {
    nId(id); nDatabase();
    const { Animal, Adoption } = nGetModels();
    const animal = await Animal.findById(id).lean();
    if (!animal) nFail(404, 'NOT_FOUND', '未找到这条动物档案');
    const adoption = await Adoption.findOne({ animalId: id, cancelledAt: null }).lean();
    const adoptionHistory = await Adoption.find({ animalId: id, cancelledAt: { $ne: null } })
        .sort({ cancelledAt: -1, _id: -1 }).populate('cancelledBy', 'displayName').lean();
    return { animal, adoption, adoptionHistory };
}
async function nChangeStatus(id, body) {
    const target = body?.adoptionStatus;
    if (!['available', 'not_open'].includes(target)) nFail(400, 'VALIDATION_ERROR', '只允许开放或撤回开放领养');
    if (target === 'available' && !nConfirmed(body?.healthConfirmed)) {
        nFail(400, 'HEALTH_CONFIRMATION_REQUIRED', '请确认动物健康状况适宜领养');
    }
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        const expected = target === 'available' ? 'not_open' : 'available';
        if (animal.adoptionStatus !== expected) nFail(409, 'STATE_CONFLICT', '当前领养状态不允许此操作，请刷新页面');
        if (target === 'available' && (animal.rescueStatus !== 'placed' || !animal.assignedTo || !animal.placementLocation.trim())) {
            nFail(409, 'NOT_PLACED', '请先完成负责人分配和安置，再开放领养');
        }
        const adoption = await nGetModels().Adoption.findOne({ animalId: id, cancelledAt: null }).session(session);
        if (adoption) nFail(409, 'ADOPTION_EXISTS', '已经存在领养记录，不能更改开放状态');
        animal.adoptionStatus = target;
        await animal.save({ session });
        return { animal: animal.toObject() };
    });
}
async function nRegister(id, body, user) {
    const fields = { adopterName: nText(body, 'adopterName', 80), adopterPhone: nText(body, 'adopterPhone', 30),
        remarks: nText(body, 'remarks', 2000, false) };
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        if (animal.adoptionStatus !== 'available' || animal.rescueStatus !== 'placed') {
            nFail(409, 'STATE_CONFLICT', '只有已安置且可领养的动物可以登记领养');
        }
        const { Adoption } = nGetModels();
        if (await Adoption.exists({ animalId: id, cancelledAt: null }).session(session)) nFail(409, 'ADOPTION_EXISTS', '该动物已有领养记录');
        const [adoption] = await Adoption.create([{ ...fields, animalId: id, registeredBy: user._id }], { session });
        animal.adoptionStatus = 'processing';
        await animal.save({ session });
        return { animal: animal.toObject(), adoption: adoption.toObject() };
    });
}
function nAdoptionVersion(body, adoption) {
    if (typeof body?.adoptionId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(body.adoptionId)) {
        nFail(400, 'INVALID_ADOPTION', '缺少有效领养登记编号，请刷新页面');
    }
    const raw = body.adoptionVersion;
    if (!['string', 'number'].includes(typeof raw) || !/^(0|[1-9][0-9]*)$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
        nFail(400, 'INVALID_VERSION', '领养资料版本不正确，请刷新页面');
    }
    if (String(adoption._id) !== body.adoptionId.toLowerCase() || (adoption.__v || 0) !== Number(raw)) {
        nFail(409, 'STALE_ADOPTION', '这次领养资料已变化或已取消，请刷新核对后重新操作');
    }
}
async function nProcessingAdoption(animal, session, body) {
    nOpenAnimal(animal);
    if (animal.adoptionStatus !== 'processing') nFail(409, 'STATE_CONFLICT', '只有办理中的领养可以修改或取消');
    const adoption = await nGetModels().Adoption.findOne({ animalId: animal._id, cancelledAt: null }).session(session);
    if (!adoption || adoption.completedAt) nFail(409, 'STATE_CONFLICT', '当前没有可操作的领养登记');
    nAdoptionVersion(body, adoption);
    return adoption;
}
async function nEditAdoption(id, body, user) {
    const fields = { adopterName: nText(body, 'adopterName', 80), adopterPhone: nText(body, 'adopterPhone', 30),
        remarks: nText(body, 'remarks', 2000, false) };
    return nTransaction(id, async (animal, session) => {
        const adoption = await nProcessingAdoption(animal, session, body);
        Object.assign(adoption, fields, { updatedBy: user._id });
        adoption.__v = (adoption.__v || 0) + 1;
        await adoption.save({ session });
        return { animal: animal.toObject(), adoption: adoption.toObject() };
    });
}
async function nCancelAdoption(id, body, user) {
    const reason = nText(body, 'cancellationReason', 1000);
    if (!nConfirmed(body?.confirm)) nFail(400, 'CONFIRMATION_REQUIRED', '请确认取消本次领养办理');
    return nTransaction(id, async (animal, session) => {
        const adoption = await nProcessingAdoption(animal, session, body);
        adoption.cancelledAt = new Date(); adoption.cancelledBy = user._id;
        adoption.cancellationReason = reason; adoption.updatedBy = user._id;
        adoption.__v = (adoption.__v || 0) + 1;
        await adoption.save({ session });
        animal.adoptionStatus = 'available';
        await animal.save({ session });
        return { animal: animal.toObject(), cancelledAdoption: adoption.toObject() };
    });
}

async function nClose(id, body, user) {
    if (!nConfirmed(body?.confirm)) nFail(400, 'CONFIRMATION_REQUIRED', '请确认领养资料和交接情况');
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        if (animal.adoptionStatus !== 'processing' || animal.rescueStatus !== 'placed') {
            nFail(409, 'STATE_CONFLICT', '只有已安置且领养办理中的动物可以结案');
        }
        const { Adoption } = nGetModels();
        const adoption = await Adoption.findOne({ animalId: id, cancelledAt: null }).session(session);
        if (!adoption || adoption.completedAt) nFail(409, 'STATE_CONFLICT', '领养记录缺失或已完成，请核对');
        nAdoptionVersion(body, adoption);
        const completedAt = new Date();
        adoption.completedAt = completedAt; adoption.updatedBy = user._id;
        adoption.__v = (adoption.__v || 0) + 1;
        animal.adoptionStatus = 'adopted'; animal.closedAt = completedAt; animal.closedBy = user._id;
        await adoption.save({ session });
        await animal.save({ session });
        return { animal: animal.toObject(), adoption: adoption.toObject() };
    });
}
async function nDelete(id, body, user) {
    // 业务层再检查一次，避免未来其他调用入口漏掉管理员限制。
    if (user.role !== 'admin') nFail(403, 'FORBIDDEN', '只有管理员可以删除动物档案');
    if (!nConfirmed(body?.confirm)) nFail(400, 'CONFIRMATION_REQUIRED', '请确认这是误录或重复档案');
    const reason = nText(body, 'deletionReason', 1000);
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        const { Animal, FollowUp, Adoption, DeletionLog } = nGetModels();
        const followUps = await FollowUp.deleteMany({ animalId: id }, { session });
        const adoptions = await Adoption.deleteMany({ animalId: id }, { session });
        await DeletionLog.create([{ animalId: animal._id, animalCode: animal.animalCode, appearance: animal.appearance,
            reason, deletedBy: user._id, deletedAt: new Date(), deletedFollowUps: followUps.deletedCount, deletedAdoptions: adoptions.deletedCount }], { session });
        await Animal.deleteOne({ _id: id }, { session });
        return { _id: String(animal._id), deletedFollowUps: followUps.deletedCount, deletedAdoptions: adoptions.deletedCount };
    });
}
function nErrorInfo(error) {
    if (error.nStatus) return { status: error.nStatus, code: error.nCode, message: error.message };
    if (error.code === 11000) return { status: 409, code: 'ADOPTION_EXISTS', message: '该动物已有领养记录，请刷新后查看' };
    if (error.name === 'ValidationError') return { status: 400, code: 'VALIDATION_ERROR', message: '提交数据不符合字段要求' };
    const unavailable = /ServerSelection|Network|NotConnected/.test(error.name || '');
    return { status: unavailable ? 503 : 500, code: unavailable ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR', message: '操作未能确认完成，请刷新核对后重试；不要重复提交' };
}
function nApi(req) { return req.path.startsWith('/api/'); }
function nReplyError(req, res, error) {
    const info = nErrorInfo(error);
    if (info.status >= 500) console.error('N 模块操作失败：', error.name || info.code, error.code || '');
    if (nApi(req)) return res.status(info.status).json({ success: false, error: { code: info.code, message: info.message } });
    return res.status(info.status).render('info', { title: '操作未完成', activePage: 'list', message: info.message });
}
// 这只是 N 的接入适配器，不认证账号、不创建用户、不接受客户端提供的身份。
// T 提供真实 req.user 后即可运行；额外查库保证删除采用最新角色。
async function nRequireLogin(req, res, next) {
    res.locals.nLive = true;
    res.set('Cache-Control', 'no-store');
    try {
        if (!req.user?._id) {
            if (!nApi(req)) return res.redirect(303, '/login');
            nFail(401, 'UNAUTHENTICATED', '请先登录');
        }
        nDatabase();
        const user = await nGetModels().User.findById(req.user._id).select('_id username displayName role isActive').lean();
        if (!user || user.isActive === false || !['staff', 'admin'].includes(user.role)) {
            req.user = null; req.session = null;
            if (!nApi(req)) return res.redirect(303, '/login');
            nFail(401, 'UNAUTHENTICATED', '登录用户已失效');
        }
        req.user = user; res.locals.currentUser = user;
        if (!req.session) nFail(503, 'SESSION_UNAVAILABLE', '登录会话未配置');
        if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
        res.locals.csrfToken = req.session.csrfToken;
        res.set('X-CSRF-Token', req.session.csrfToken);
        next();
    } catch (error) { return nReplyError(req, res, error); }
}
function nRequireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return nReplyError(req, res, { nStatus: 403, nCode: 'FORBIDDEN', message: '只有管理员可以删除动物档案' });
    }
    next();
}
function nCheckCsrf(req, res, next) {
    const supplied = req.get('X-CSRF-Token') || req.body?._csrf;
    const expected = req.session?.csrfToken;
    const a = typeof supplied === 'string' ? Buffer.from(supplied) : Buffer.alloc(0);
    const b = typeof expected === 'string' ? Buffer.from(expected) : Buffer.alloc(0);
    if (!a.length || a.length !== b.length || !nTimingSafeEqual(a, b)) {
        return nReplyError(req, res, { nStatus: 403, nCode: 'CSRF_INVALID', message: '表单已失效，请刷新页面后重新提交' });
    }
    next();
}
async function nRender(req, res, view, error = null, status = 200) {
    const data = await nRead(req.params.id);
    if (view === 'delete') nOpenAnimal(data.animal);
    // 不把任意请求字段反射到模板；只保留有长度限制、转义显示的非密码业务字段。
    const values = {};
    for (const [key, limit] of [['adopterName', 80], ['adopterPhone', 30], ['remarks', 2000], ['cancellationReason', 1000], ['deletionReason', 1000]]) {
        values[key] = error && typeof req.body?.[key] === 'string' ? req.body[key].slice(0, limit) : '';
    }
    return res.status(status).render(view, { ...data, values, error, stale: status === 409, formAction: req.path.split('/').pop(),
        title: { adoption: '领养管理', close: '领养结案', delete: '删除动物档案' }[view], activePage: 'list' });
}
function nRegisterRoutes(target) {
    target.get('/animals/:id/deletion-result', nRequireLogin, nRequireAdmin, (req, res) => {
        if (req.session.nDeletedAnimal !== req.params.id) return nReplyError(req, res, { nStatus: 404, nCode: 'NOT_FOUND', message: '未找到这次删除的确认结果' });
        return res.render('info', { title: '删除成功', activePage: 'list', message: '动物档案及关联跟进、领养记录已删除。' });
    });
    for (const view of ['adoption', 'close', 'delete']) {
        const guards = view === 'delete' ? [nRequireLogin, nRequireAdmin] : [nRequireLogin];
        target.get('/animals/:id/' + view, ...guards, async (req, res) => {
            try { await nRender(req, res, view); } catch (error) { nReplyError(req, res, error); }
        });
    }
    target.get('/api/animals/:id/adoption', nRequireLogin, async (req, res) => {
        try { res.json({ success: true, data: await nRead(req.params.id) }); }
        catch (error) { nReplyError(req, res, error); }
    });
    const actions = [
        ['adoption-status', 'put', '/api/animals/:id/adoption-status', nChangeStatus, 'adoption', 200],
        ['adoption', 'post', '/api/animals/:id/adoption', nRegister, 'adoption', 201],
        ['adoption/edit', 'put', '/api/animals/:id/adoption', nEditAdoption, 'adoption', 200],
        ['adoption/cancel', 'put', '/api/animals/:id/adoption/cancel', nCancelAdoption, 'adoption', 200],
        ['close', 'put', '/api/animals/:id/close', nClose, 'close', 200],
        ['delete', 'delete', '/api/animals/:id', nDelete, 'delete', 200]
    ];
    for (const [suffix, method, apiPath, operation, view, successStatus] of actions) {
        const guards = suffix === 'delete' ? [nRequireLogin, nRequireAdmin, nCheckCsrf] : [nRequireLogin, nCheckCsrf];
        const handler = async (req, res) => {
            try {
                const data = await operation(req.params.id, req.body, req.user);
                if (nApi(req)) return res.status(successStatus).json({ success: true, data, message: '操作成功' });
                // 返回本模块真实读取页，暂不跳到其他成员尚未接入数据库的详情/列表。
                if (suffix === 'delete') {
                    req.session.nDeletedAnimal = req.params.id;
                    return res.redirect(303, '/animals/' + req.params.id + '/deletion-result');
                }
                return res.redirect(303, '/animals/' + req.params.id + '/' + (suffix === 'close' ? 'close' : 'adoption'));
            } catch (error) {
                const info = nErrorInfo(error);
                if (!nApi(req) && [400, 409].includes(info.status)) {
                    try { return await nRender(req, res, view, info.message, info.status); }
                    catch (readError) { return nReplyError(req, res, readError); }
                }
                return nReplyError(req, res, error);
            }
        };
        target.post('/animals/:id/' + suffix, ...guards, handler);
        target[method](apiPath, ...guards, handler);
    }
}
nRegisterRoutes(app);

// N 模块集成测试：仅 node server.js --test-n 显式运行，不挂载到正式 app。
// 测试数据库随机命名，测试身份只由独立的本机测试应用注入，不等同于 T 的登录验收。
async function nRunIntegrationTests() {
    if (process.env.NODE_ENV !== 'test') throw new Error('请使用 NODE_ENV=test npm run test:n');
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const databaseName = 'group007_n_test_' + randomBytes(10).toString('hex');
    const uri = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/?replicaSet=group007rs';
    let httpServer; let realServer; let count = 0;
    const passed = label => { count++; console.log('PASS ' + count + ' ' + label); };
    try {
        await mongoose.connect(uri, { dbName: databaseName, serverSelectionTimeoutMS: 5000 });
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        assert.ok(hello.setName, '测试需要副本集，不能在单机实例上跳过事务测试');
        await nPrepareDatabase();
        const { User, Animal, Adoption, FollowUp, DeletionLog } = nGetModels();
        const staff = await User.create({ username: 'n_test_staff', passwordHash: 'not-a-login-password', displayName: '测试工作人员', role: 'staff' });
        const admin = await User.create({ username: 'n_test_admin', passwordHash: 'not-a-login-password', displayName: '测试管理员', role: 'admin' });
        let serial = 0;
        async function animal(overrides = {}) {
            return Animal.create({ animalCode: 'NTEST-' + (++serial), animalType: 'cat', appearance: '橘白小猫',
                foundLocation: '虚构地点', healthStatus: '已评估', contactName: '测试联系人', contactPhone: '00000000',
                createdBy: staff._id, assignedTo: staff._id, placementLocation: '测试安置点', rescueStatus: 'placed', ...overrides });
        }
        const fixture = express();
        fixture.set('view engine', 'ejs'); fixture.set('views', path.join(__dirname, 'views'));
        fixture.locals.labels = labels; fixture.locals.formatDate = app.locals.formatDate;
        fixture.use(express.static(path.join(__dirname, 'public')));
        fixture.use(express.json()); fixture.use(express.urlencoded({ extended: false }));
        fixture.use(cookieSession({ name: 'n_test_session', keys: [randomBytes(32).toString('hex')], httpOnly: true }));
        fixture.use((req, res, next) => {
            const id = req.get('X-Test-User');
            req.user = id === String(staff._id) ? { _id: staff._id } : id === String(admin._id) ? { _id: admin._id } : null;
            res.locals.currentUser = null;
            next();
        });
        nRegisterRoutes(fixture);
        httpServer = await new Promise(resolve => { const server = fixture.listen(0, '127.0.0.1', () => resolve(server)); });
        realServer = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
        const base = 'http://127.0.0.1:' + httpServer.address().port;
        const clients = Object.fromEntries(['staff','admin','anonymous'].map(role => [role, { cookie: '', csrf: '' }]));
        async function request(method, url, body, role = 'staff', options = {}) {
            const client = clients[role];
            const headers = {};
            if (role !== 'anonymous') headers['X-Test-User'] = String(role === 'admin' ? admin._id : staff._id);
            if (client.cookie) headers.Cookie = client.cookie;
            if (client.csrf && !options.noCsrf) headers['X-CSRF-Token'] = client.csrf;
            let payload;
            if (body !== undefined) {
                headers['Content-Type'] = options.form ? 'application/x-www-form-urlencoded' : 'application/json';
                payload = options.form ? new URLSearchParams(body).toString() : JSON.stringify(body);
            }
            const response = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
            const setCookies = response.headers.getSetCookie();
            if (setCookies.length) client.cookie = setCookies.map(value => value.split(';')[0]).join('; ');
            if (response.headers.get('x-csrf-token')) client.csrf = response.headers.get('x-csrf-token');
            const text = await response.text();
            return { status: response.status, text, json: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null,
                location: response.headers.get('location') };
        }
        const a = await animal(); const id = String(a._id); const api = '/api/animals/' + id;
        assert.equal((await request('GET', api + '/adoption', undefined, 'anonymous')).status, 401);
        assert.equal((await request('GET', '/animals/' + id + '/adoption', undefined, 'anonymous')).location, '/login');
        passed('未登录 API 401、网页跳转登录');
        const realResponse = await fetch('http://127.0.0.1:' + realServer.address().port + api + '/adoption', { headers: { 'X-Test-User': String(admin._id) } });
        assert.equal(realResponse.status, 401); await realResponse.text();
        passed('正式 app 不接受测试身份请求头，无认证绕过');
        assert.equal((await request('GET', api + '/adoption')).json.data.adoption, null);
        assert.ok(clients.staff.csrf);
        assert.equal((await request('PUT', api + '/adoption-status', { adoptionStatus: 'available', healthConfirmed: true }, 'staff', { noCsrf: true })).status, 403);
        assert.equal((await Animal.findById(id)).adoptionStatus, 'not_open');
        passed('真实读取、获取 CSRF、拒绝缺失令牌且数据库不变');
        assert.equal((await request('GET', '/api/animals/bad/adoption')).status, 400);
        assert.equal((await request('GET', '/api/animals/' + new mongoose.Types.ObjectId() + '/adoption')).status, 404);
        passed('非法 ID 400，不存在 ID 404');
        assert.equal((await request('PUT', api + '/adoption-status', { adoptionStatus: 'available' })).status, 400);
        const pending = await animal({ rescueStatus: 'pending', assignedTo: null, placementLocation: '' });
        assert.equal((await request('PUT', '/api/animals/' + pending._id + '/adoption-status', { adoptionStatus: 'available', healthConfirmed: true })).status, 409);
        const incomplete = await animal({ assignedTo: null });
        assert.equal((await request('PUT', '/api/animals/' + incomplete._id + '/adoption-status', { adoptionStatus: 'available', healthConfirmed: true })).status, 409);
        passed('开放领养验证人工健康确认、已安置及负责人');
        assert.equal((await request('PUT', api + '/adoption-status', { adoptionStatus: 'available', healthConfirmed: true })).status, 200);
        assert.equal((await request('PUT', api + '/adoption-status', { adoptionStatus: 'not_open' })).status, 200);
        assert.equal((await request('PUT', api + '/adoption-status', { adoptionStatus: 'available', healthConfirmed: true })).status, 200);
        passed('开放与登记前撤回开放');
        for (const body of [{ adopterName: '甲' }, { adopterName: {}, adopterPhone: '0' }, { adopterName: 'a'.repeat(81), adopterPhone: '0' }, { adopterName: '甲', adopterPhone: '0', remarks: 'a'.repeat(2001) }]) {
            assert.equal((await request('POST', api + '/adoption', body)).status, 400);
        }
        assert.equal(await Adoption.countDocuments({ animalId: id }), 0);
        assert.equal((await request('PUT', api + '/close', { confirm: true })).status, 409);
        passed('缺少/对象/超长字段拒绝，未登记不得结案');
        const registration = { adopterName: ' <script>alert(1)</script> ', adopterPhone: '00000123', remarks: ' 测试备注 ', registeredBy: admin._id, completedAt: new Date() };
        const races = await Promise.all([request('POST', api + '/adoption', registration), request('POST', api + '/adoption', registration)]);
        assert.deepEqual(races.map(r => r.status).sort(), [201,409]);
        const saved = await Adoption.findOne({ animalId: id });
        const firstStamp = { adoptionId: String(saved._id), adoptionVersion: saved.__v || 0 };
        assert.equal(await Adoption.countDocuments({ animalId: id }), 1);
        assert.equal(String(saved.registeredBy), String(staff._id)); assert.equal(saved.completedAt, null);
        assert.equal(saved.adopterPhone, '00000123'); assert.equal(saved.remarks, '测试备注');
        assert.equal((await Animal.findById(id)).adoptionStatus, 'processing');
        passed('并发登记只成功一次，身份白名单与电话前导零正确');
        const html = await request('GET', '/animals/' + id + '/adoption');
        assert.equal(html.status, 200); assert.ok(html.text.includes('&lt;script&gt;')); assert.ok(!html.text.includes('<script>alert(1)</script>'));
        assert.ok(!html.text.includes('data-preview='));
        passed('真实领养页面转义输出、没有原型拦截');
        assert.equal((await request('PUT', api + '/adoption-status', { adoptionStatus: 'not_open' })).status, 409);
        assert.equal((await request('PUT', api + '/close', {})).status, 400);
        const closeRaces = await Promise.all([request('PUT', api + '/close', { ...firstStamp, confirm: true }), request('PUT', api + '/close', { ...firstStamp, confirm: true })]);
        assert.deepEqual(closeRaces.map(r => r.status).sort(), [200,409]);
        const closed = await Animal.findById(id); const completed = await Adoption.findOne({ animalId: id });
        assert.equal(closed.adoptionStatus, 'adopted'); assert.equal(String(closed.closedBy), String(staff._id));
        assert.equal(closed.closedAt.toISOString(), completed.completedAt.toISOString());
        assert.equal((await request('PUT', api + '/adoption-status', { adoptionStatus: 'available', healthConfirmed: true })).status, 409);
        assert.equal((await request('POST', api + '/adoption', registration)).status, 409);
        assert.equal((await Animal.findById(id)).closedAt.toISOString(), closed.closedAt.toISOString());
        passed('并发结案一次成功，完成时间一致，档案保留且禁止再次写入');
        const closedPage = await request('GET', '/animals/' + id + '/close');
        assert.equal(closedPage.status, 200); assert.ok(!closedPage.text.includes('name="confirm"'));
        assert.equal((await request('GET', '/animals/' + id + '/delete')).status, 403);
        assert.equal((await request('DELETE', api, { confirm: true, deletionReason: '误录' })).status, 403);
        await request('GET', api + '/adoption', undefined, 'admin');
        assert.equal((await request('DELETE', api, { confirm: true, deletionReason: '误录' }, 'admin')).status, 409);
        assert.equal((await request('GET', '/animals/' + id + '/delete', undefined, 'admin')).status, 409);
        passed('已结案只读，管理员同样不能删除');
        const victim = await animal({ adoptionStatus: 'available' });
        const vid = String(victim._id); const vapi = '/api/animals/' + vid;
        await request('POST', vapi + '/adoption', registration);
        const follow = await FollowUp.create({ animalId: vid, content: '测试跟进', recordedBy: staff._id });
        const originalDelete = Adoption.deleteMany;
        Adoption.deleteMany = async function () { throw new Error('INJECTED_AFTER_FOLLOWUP_DELETE'); };
        try { assert.equal((await request('DELETE', vapi, { confirm: true, deletionReason: '重复' }, 'admin')).status, 500); }
        finally { Adoption.deleteMany = originalDelete; }
        assert.ok(await Animal.exists({ _id: vid })); assert.ok(await FollowUp.exists({ _id: follow._id })); assert.ok(await Adoption.exists({ animalId: vid }));
        assert.equal(await DeletionLog.countDocuments({animalId:vid}),0);
        passed('关联删除中途故障，动物、跟进、领养全部保留且不产生假日志');
        const deleted = await request('DELETE', vapi, { confirm: true, deletionReason: '重复' }, 'admin');
        assert.equal(deleted.status, 200); assert.equal(deleted.json.data.deletedFollowUps, 1);
        assert.equal(await Animal.countDocuments({ _id: vid }), 0); assert.equal(await FollowUp.countDocuments({ animalId: vid }), 0); assert.equal(await Adoption.countDocuments({ animalId: vid }), 0);
        assert.equal((await request('DELETE', vapi, { confirm: true, deletionReason: '重复' }, 'admin')).status, 404);
        assert.equal(await DeletionLog.countDocuments({animalId:vid}),1);
        passed('管理员清理误录及关联记录，删除日志独立保留');
        const b = await animal({ adoptionStatus: 'available' }); const bid = String(b._id);
        const originalSave = Animal.prototype.save;
        Animal.prototype.save = async function (...args) {
            if (String(this._id) === bid && this.adoptionStatus === 'processing') throw new Error('INJECTED_AFTER_ADOPTION_CREATE');
            return originalSave.apply(this, args);
        };
        try { assert.equal((await request('POST', '/api/animals/' + bid + '/adoption', registration)).status, 500); }
        finally { Animal.prototype.save = originalSave; }
        assert.equal(await Adoption.countDocuments({ animalId: bid }), 0); assert.equal((await Animal.findById(bid)).adoptionStatus, 'available');
        passed('登记中途故障：新领养记录回滚、状态不变');
        const formError = await request('POST', '/animals/' + bid + '/adoption', { adopterName: '保留姓名', adopterPhone: '' }, 'staff', { form: true });
        assert.equal(formError.status, 400); assert.ok(formError.text.includes('value="保留姓名"'));
        const formOk = await request('POST', '/animals/' + bid + '/adoption', { adopterName: '测试领养人', adopterPhone: '00000000', remarks: '网页' }, 'staff', { form: true });
        assert.equal(formOk.status, 303); assert.equal((await request('GET', formOk.location)).status, 200);
        const bAdoption = await Adoption.findOne({ animalId: bid });
        const bStamp = { adoptionId: String(bAdoption._id), adoptionVersion: bAdoption.__v || 0 };
        Animal.prototype.save = async function (...args) {
            if (String(this._id) === bid && this.adoptionStatus === 'adopted') throw new Error('INJECTED_AFTER_COMPLETION');
            return originalSave.apply(this, args);
        };
        try { assert.equal((await request('PUT', '/api/animals/' + bid + '/close', { ...bStamp, confirm: true })).status, 500); }
        finally { Animal.prototype.save = originalSave; }
        assert.equal((await Adoption.findOne({ animalId: bid })).completedAt, null); assert.equal((await Animal.findById(bid)).adoptionStatus, 'processing');
        passed('网页字段保留与 303，结案中途故障回滚');
        const c = await animal({ adoptionStatus: 'available' });
        await request('GET', '/api/animals/' + c._id + '/adoption', undefined, 'admin');
        const deleteRace = await Promise.all([
            request('POST', '/api/animals/' + c._id + '/adoption', registration),
            request('DELETE', '/api/animals/' + c._id, { confirm: true, deletionReason: '并发测试' }, 'admin')
        ]);
        assert.equal(deleteRace[1].status, 200); assert.ok([201,404].includes(deleteRace[0].status));
        assert.equal(await Animal.countDocuments({ _id: c._id }), 0); assert.equal(await Adoption.countDocuments({ animalId: c._id }), 0);
        passed('登记与删除并发不留下孤立领养记录');
        await User.updateOne({ _id: admin._id }, { role: 'staff' });
        assert.equal((await request('DELETE', '/api/animals/' + bid, { confirm: true }, 'admin')).status, 403);
        await User.updateOne({ _id: admin._id }, { role: 'admin' });
        passed('管理员角色撤销后立即拒绝删除');
        const cform = await request('POST', '/animals/' + bid + '/close', { ...bStamp, confirm: 'yes' }, 'staff', { form: true });
        assert.equal(cform.status, 303); assert.equal((await request('GET', cform.location)).status, 200);
        const d = await animal();
        const dform = await request('POST', '/animals/' + d._id + '/delete', { confirm: 'yes', deletionReason: '网页测试误录' }, 'admin', { form: true });
        assert.equal(dform.status, 303); assert.equal((await request('GET', dform.location, undefined, 'admin')).status, 200);
        passed('网页结案和删除使用 POST 后 303 跳转，结果可查看');
        async function stampFor(animalId) {
            const row = await Adoption.findOne({ animalId, cancelledAt: null });
            return { adoptionId: String(row._id), adoptionVersion: row.__v || 0 };
        }
        // 仿真旧版数据库：缺少取消字段的旧记录 + 原全量唯一索引。
        const legacyAnimal = await animal({ adoptionStatus: 'processing' });
        const legacy = await Adoption.collection.insertOne({ animalId: legacyAnimal._id, adopterName: '旧登记', adopterPhone: '00000', registeredBy: staff._id, completedAt: null, __v: 0 });
        await Adoption.collection.createIndex({ animalId: 1 }, { name: 'animalId_1', unique: true });
        await Adoption.collection.createIndex({ adopterName: 1 }, { name: 'keep_unrelated_index' });
        await nPrepareDatabase(); await nPrepareDatabase();
        const indexes = await Adoption.collection.indexes();
        assert.ok(!indexes.some(x => x.name === 'animalId_1'));
        assert.ok(indexes.some(x => x.name === 'one_current_adoption' && x.unique));
        assert.ok(indexes.some(x => x.name === 'keep_unrelated_index'));
        assert.ok(await Adoption.collection.findOne({ _id: legacy.insertedId }));
        assert.equal((await request('GET', '/api/animals/' + legacyAnimal._id + '/adoption')).json.data.adoption.adopterName, '旧登记');
        await assert.rejects(() => Adoption.create({ animalId: legacyAnimal._id, adopterName: '重复', adopterPhone: '0', registeredBy: staff._id }), e => e.code === 11000);
        passed('旧记录兼容、唯一索引安全迁移且幂等，不删除其他索引或记录');

        const e = await animal({ adoptionStatus: 'available' }); const eid = String(e._id); const eapi = '/api/animals/' + eid;
        await request('POST', eapi + '/adoption', registration);
        let est = await stampFor(eid);
        const originalRegistration = await Adoption.findById(est.adoptionId);
        const changed = { ...est, adopterName: '新姓名', adopterPhone: '00000999', remarks: '<script>备注</script>', updatedBy: admin._id };
        assert.equal((await request('PUT', eapi + '/adoption', changed)).status, 200);
        assert.equal((await Adoption.findById(est.adoptionId)).adopterName, '新姓名');
        assert.equal(String((await Adoption.findById(est.adoptionId)).updatedBy), String(staff._id));
        assert.equal(String((await Adoption.findById(est.adoptionId)).registeredBy), String(originalRegistration.registeredBy));
        assert.equal((await request('PUT', eapi + '/adoption', changed)).status, 409);
        assert.equal((await request('PUT', eapi + '/close', { ...est, confirm: true })).status, 409);
        est = await stampFor(eid);
        assert.equal((await request('PUT', eapi + '/adoption', { ...changed, ...est, adoptionVersion: {} })).status, 400);
        const concurrentEdits = await Promise.all([request('PUT', eapi + '/adoption', { ...changed, ...est, adopterName: '甲' }), request('PUT', eapi + '/adoption', { ...changed, ...est, adopterName: '乙' })]);
        assert.deepEqual(concurrentEdits.map(x => x.status).sort(), [200,409]);
        passed('办理中编辑成功、操作者不可伪造，旧版本/并发编辑不会覆盖新资料');
        est = await stampFor(eid);
        for (const cancellationReason of ['', '  ', {}, 'a'.repeat(1001)]) {
            assert.equal((await request('PUT', eapi + '/adoption/cancel', { ...est, confirm: true, cancellationReason })).status, 400);
        }
        assert.equal((await request('PUT', eapi + '/adoption/cancel', { ...est, cancellationReason: '放弃' })).status, 400);
        assert.equal((await request('PUT', eapi + '/adoption/cancel', { ...est, confirm: true, cancellationReason: '放弃' }, 'staff', { noCsrf: true })).status, 403);
        assert.equal((await request('PUT', eapi + '/adoption/cancel', { ...est, adoptionId: String(legacy.insertedId), confirm: true, cancellationReason: '放弃' })).status, 409);
        passed('取消必须有有效原因、确认、CSRF和正确的当前领养编号');

        const saveBeforeCancel = Animal.prototype.save;
        Animal.prototype.save = async function (...args) {
            if (String(this._id) === eid && this.adoptionStatus === 'available') throw new Error('INJECTED_CANCEL_FAILURE');
            return saveBeforeCancel.apply(this, args);
        };
        try { assert.equal((await request('PUT', eapi + '/adoption/cancel', { ...est, confirm: true, cancellationReason: '模拟失败' })).status, 500); }
        finally { Animal.prototype.save = saveBeforeCancel; }
        assert.equal((await Adoption.findById(est.adoptionId)).cancelledAt, null);
        assert.equal((await Animal.findById(eid)).adoptionStatus, 'processing');
        assert.deepEqual(await stampFor(eid), est);
        passed('取消中途失败，历史状态、动物状态和版本全部回滚');
        const cancelBody = { ...est, confirm: true, cancellationReason: '领养人临时放弃', cancelledBy: admin._id };
        assert.equal((await request('PUT', eapi + '/adoption/cancel', cancelBody)).status, 200);
        const historyRow = await Adoption.findById(est.adoptionId);
        assert.equal(historyRow.cancellationReason, '领养人临时放弃'); assert.equal(String(historyRow.cancelledBy), String(staff._id)); assert.ok(historyRow.cancelledAt);
        assert.equal((await Animal.findById(eid)).adoptionStatus, 'available');
        const afterCancel = (await request('GET', eapi + '/adoption')).json.data;
        assert.equal(afterCancel.adoption, null); assert.equal(afterCancel.adoptionHistory.length, 1);
        assert.equal((await request('PUT', eapi + '/adoption/cancel', cancelBody)).status, 409);
        assert.equal((await request('PUT', eapi + '/adoption-status', { adoptionStatus: 'not_open' })).status, 200);
        assert.equal((await request('PUT', eapi + '/adoption-status', { adoptionStatus: 'available', healthConfirmed: true })).status, 200);
        const reregister = await Promise.all([request('POST', eapi + '/adoption', registration), request('POST', eapi + '/adoption', registration)]);
        assert.deepEqual(reregister.map(r=>r.status).sort(),[201,409]);
        assert.equal(await Adoption.countDocuments({ animalId:eid }),2);
        assert.equal(await Adoption.countDocuments({ animalId:eid,cancelledAt:null }),1);
        assert.equal((await request('PUT', eapi + '/adoption/cancel', cancelBody)).status, 409);
        assert.equal((await request('PUT', eapi + '/close', { ...est, confirm:true })).status, 409);
        assert.equal((await request('PUT', eapi + '/adoption', { ...registration,...est })).status, 409);
        assert.equal((await Adoption.findById(est.adoptionId)).cancellationReason, '领养人临时放弃');
        const historyPage = await request('GET', '/animals/'+eid+'/adoption');
        assert.ok(historyPage.text.includes('已取消的领养办理记录'));assert.ok(historyPage.text.includes('领养人临时放弃'));
        passed('取消历史保留，可重新登记且仅一条有效记录，旧页面不能操作新办理');

        // 网页编辑失败保留字段；旧版本冲突禁用按钮，要求显式刷新。
        let currentStamp = await stampFor(eid);
        const badEdit=await request('POST','/animals/'+eid+'/adoption/edit',{...currentStamp,adopterName:'保留修改',adopterPhone:''},'staff',{form:true});
        assert.equal(badEdit.status,400);assert.ok(badEdit.text.includes('value="保留修改"'));
        assert.equal((await request('POST','/animals/'+eid+'/adoption/edit',{...registration,...currentStamp},'staff',{form:true})).status,303);
        const staleForm=await request('POST','/animals/'+eid+'/adoption/edit',{...registration,...currentStamp},'staff',{form:true});
        assert.equal(staleForm.status,409);assert.ok(staleForm.text.includes('刷新并重新核对'));assert.ok(staleForm.text.includes('disabled'));
        currentStamp=await stampFor(eid);
        assert.equal((await request('POST','/animals/'+eid+'/adoption/cancel',{...currentStamp,confirm:'yes',cancellationReason:'网页取消'},'staff',{form:true})).status,303);
        assert.equal(await Adoption.countDocuments({animalId:eid,cancelledAt:{$ne:null}}),2);
        passed('网页编辑与取消、非密码字段保留、冲突页面防止再次误提交');

        await request('POST',eapi+'/adoption',registration);currentStamp=await stampFor(eid);
        const cancelledSnapshot=await Adoption.find({animalId:eid,cancelledAt:{$ne:null}}).sort({_id:1}).lean();
        assert.equal((await request('PUT',eapi+'/close',{...currentStamp,confirm:true})).status,200);
        assert.equal((await request('PUT',eapi+'/adoption',{...registration,...currentStamp})).status,409);
        assert.equal((await request('PUT',eapi+'/adoption/cancel',{...currentStamp,confirm:true,cancellationReason:'不允许'})).status,409);
        assert.equal((await request('DELETE',eapi,{confirm:true,deletionReason:'不允许'},'admin')).status,409);
        assert.equal((await request('GET','/animals/'+eid+'/delete',undefined,'admin')).status,409);
        assert.deepEqual(await Adoption.find({animalId:eid,cancelledAt:{$ne:null}}).sort({_id:1}).lean(),cancelledSnapshot);
        const closedAdoptionPage=await request('GET','/animals/'+eid+'/adoption',undefined,'admin');
        assert.ok(!closedAdoptionPage.text.includes('删除误录档案'));assert.ok(!closedAdoptionPage.text.includes('action="/animals/'+eid+'/adoption/edit"'));
        passed('再次登记后正常结案；全体角色禁止编辑/取消/删除，历史仍保留');

        const f=await animal({adoptionStatus:'available'});const fid=String(f._id);const fapi='/api/animals/'+fid;
        await request('POST',fapi+'/adoption',registration);const fst=await stampFor(fid);
        const finishRace=await Promise.all([request('PUT',fapi+'/adoption/cancel',{...fst,confirm:true,cancellationReason:'取消竞态'}),request('PUT',fapi+'/close',{...fst,confirm:true})]);
        assert.deepEqual(finishRace.map(x=>x.status).sort(),[200,409]);
        const fAnimal=await Animal.findById(fid),fAdoption=await Adoption.findById(fst.adoptionId);
        if(fAdoption.cancelledAt){assert.equal(fAnimal.adoptionStatus,'available');assert.equal(fAnimal.closedAt,null);assert.equal(fAdoption.completedAt,null);}
        else{assert.equal(fAnimal.adoptionStatus,'adopted');assert.ok(fAnimal.closedAt);assert.ok(fAdoption.completedAt);}
        passed('取消与结案并发只能成功一项，不产生互相矛盾的状态');

        const g=await animal({adoptionStatus:'available'});const gid=String(g._id);const gapi='/api/animals/'+gid;
        await request('POST',gapi+'/adoption',registration);
        await request('PUT',gapi+'/adoption/cancel',{...await stampFor(gid),confirm:true,cancellationReason:'保留过往记录'});
        await request('POST',gapi+'/adoption',registration);
        await FollowUp.create({animalId:gid,content:'应随误录删除',recordedBy:staff._id});
        await request('GET',gapi+'/adoption',undefined,'admin');
        for(const deletionReason of ['', '  ', {}, 'x'.repeat(1001)])assert.equal((await request('DELETE',gapi,{confirm:true,deletionReason},'admin')).status,400);
        assert.equal(await DeletionLog.countDocuments({animalId:gid}),0);
        const logCreate=DeletionLog.create;
        DeletionLog.create=async()=>{throw new Error('INJECTED_AUDIT_FAILURE');};
        try{assert.equal((await request('DELETE',gapi,{confirm:true,deletionReason:'重复档案'},'admin')).status,500);}finally{DeletionLog.create=logCreate;}
        assert.ok(await Animal.exists({_id:gid}));assert.equal(await Adoption.countDocuments({animalId:gid}),2);assert.equal(await FollowUp.countDocuments({animalId:gid}),1);
        const animalDelete=Animal.deleteOne;
        Animal.deleteOne=async()=>{throw new Error('INJECTED_AFTER_AUDIT_CREATE');};
        try{assert.equal((await request('DELETE',gapi,{confirm:true,deletionReason:'重复档案'},'admin')).status,500);}finally{Animal.deleteOne=animalDelete;}
        assert.equal(await DeletionLog.countDocuments({animalId:gid}),0);assert.ok(await Animal.exists({_id:gid}));assert.equal(await Adoption.countDocuments({animalId:gid}),2);
        const deletion=await request('DELETE',gapi,{confirm:true,deletionReason:'重复档案',deletedBy:staff._id,animalCode:'伪造编号'},'admin');
        assert.equal(deletion.status,200);assert.equal(deletion.json.data.deletedAdoptions,2);
        const audit=await DeletionLog.findOne({animalId:gid});
        assert.equal(audit.animalCode,g.animalCode);assert.equal(String(audit.deletedBy),String(admin._id));assert.equal(audit.reason,'重复档案');assert.ok(audit.deletedAt);assert.equal(audit.deletedFollowUps,1);assert.equal(audit.deletedAdoptions,2);
        assert.equal(await Adoption.countDocuments({animalId:gid}),0);assert.equal(await FollowUp.countDocuments({animalId:gid}),0);
        assert.equal((await request('DELETE',gapi,{confirm:true,deletionReason:'再次删除'},'admin')).status,404);assert.equal(await DeletionLog.countDocuments({animalId:gid}),1);
        passed('删除必须有原因，日志不可伪造；含取消历史的关联清理与审计同事务回滚');

        await User.updateOne({_id:staff._id},{isActive:false});
        assert.equal((await request('GET',eapi+'/adoption')).status,401);
        assert.equal((await request('PUT',eapi+'/adoption/cancel',{...currentStamp,confirm:true,cancellationReason:'不允许'})).status,401);
        assert.equal((await request('GET','/animals/'+eid+'/adoption')).location,'/login');
        assert.ok(await Animal.exists({createdBy:staff._id}));assert.ok(await Adoption.exists({registeredBy:staff._id}));
        await User.updateOne({_id:staff._id},{isActive:true});await request('GET',eapi+'/adoption');
        passed('停用工作人员下一请求立即拒绝访问，历史用户引用保留');

        // 可选截图仅写到显式指定的外部目录，不写生产数据或项目目录。
        if (process.env.N_TEST_HTML_DIR) {
            const folder = process.env.N_TEST_HTML_DIR;
            fs.mkdirSync(folder, { recursive: true });
            for (const state of ['not_open','available','processing','adopted']) {
                const sample = await animal({ adoptionStatus: state, ...(state === 'adopted' ? { closedAt: new Date(), closedBy: staff._id } : {}) });
                if (['processing','adopted'].includes(state)) await Adoption.create({ animalId: sample._id, adopterName: '示例领养人', adopterPhone: '00000000', registeredBy: staff._id, completedAt: state === 'adopted' ? sample.closedAt : null });
                for (const view of ['adoption','close','delete']) {
                    const page = await request('GET', '/animals/' + sample._id + '/' + view, undefined, 'admin');
                    assert.equal(page.status, state === 'adopted' && view === 'delete' ? 409 : 200);
                    fs.writeFileSync(path.join(folder, state + '-' + view + '.html'), page.text.replace('href="/style.css"', 'href="style.css"').replace('src="/preview.js"', 'src="preview.js"'));
                }
            }
            fs.copyFileSync(path.join(__dirname,'public/style.css'),path.join(folder,'style.css'));
            fs.copyFileSync(path.join(__dirname,'public/preview.js'),path.join(folder,'preview.js'));
        }
        console.log('N integration tests passed: ' + count + ' groups; isolated database: ' + databaseName);
    } finally {
        for (const server of [httpServer, realServer]) if (server) await new Promise(resolve => server.close(resolve));
        if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName && /^group007_n_test_[a-f0-9]{20}$/.test(databaseName)) await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
}




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
            await nPrepareDatabase();
            console.log('MongoDB 已连接；N 模块使用真实数据，其他模块仍待整合');
        }
        const port = process.env.PORT || 8099;
        const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
        const server = app.listen(port, host, () => console.log(`项目地址：http://${host}:${port}（N 已接数据库业务，登录及其他模块待整合）`));
        server.on('error', error => { console.error('启动失败：', error.message); process.exit(1); });
    } catch (error) {
        console.error('启动失败：', error.message);
        process.exit(1);
    }
}
if (require.main === module) {
    if (process.argv.includes('--test-n')) nRunIntegrationTests().catch(error => { console.error(error); process.exitCode = 1; });
    else startServer();
}
module.exports = app;
// 供独立集成测试及 M 的事务整合复用；不是 HTTP 登录或权限绕过入口。
module.exports.nModule = { registerRoutes: nRegisterRoutes, prepareDatabase: nPrepareDatabase, withAnimalTransaction: nTransaction };
