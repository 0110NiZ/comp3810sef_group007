
// 团队协作：仅按负责人分区，不拆出 routes/controllers/services，保持课堂目录结构。
// 每人在自己的分支修改所属区域；公共配置/模型/布局修改需与相关成员协调。
// 当前其他业务模块仍是页面原型，T 区接入真实认证与账号管理。

// ============================================================================
// 00 公共区｜Express、模板辅助与示例数据（共同维护）
// ============================================================================
const express = require('express');
const mongoose = require('mongoose');
const path = require('node:path');
const { randomBytes, scrypt, timingSafeEqual, createHmac } = require('node:crypto');
const { promisify } = require('node:util');
const cookieSession = require('cookie-session');
const labels = require('./models/constants');
const User = require('./models/User');
const app = express();
const scryptAsync = promisify(scrypt);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// 公共请求体解析：现有表单都是平铺字段，不需要 extended: true 的嵌套对象。
// 解析不等于验证，各模块仍须按字段白名单检查 req.body。
app.use(express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 100 }));
app.use(express.json({ limit: '100kb' }));

// Session 配置与 T 模块用户加载。
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
app.use(async (req, res, next) => {
    // 每个请求先清空身份；只有有效 Session 且数据库中存在的用户才被识别为已登录。
    req.user = null;
    res.locals.currentUser = null;
    const userId = req.session?.userId;
    if (userId == null) return next();
    if (!Number.isSafeInteger(req.session.expiresAt) || req.session.expiresAt <= Date.now()) {
        req.session = null;
        return next();
    }
    if (typeof userId !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) {
        req.session = null;
        return next();
    }
    try {
        // cookie-session 只有签名，没有服务器端会话表。
        // 每次使用数据库中的密码哈希检查会话标记，密码改变后旧会话失效。
        const user = await User.findById(userId)
            .select('_id username displayName role +passwordHash').lean();
        const marker = req.session?.credentialMarker;
        if (!user || typeof user.passwordHash !== 'string' ||
            typeof marker !== 'string' || !/^[a-f0-9]{64}$/.test(marker) ||
            !timingSafeEqual(Buffer.from(marker, 'hex'),
                Buffer.from(sessionCredentialMarker(user.passwordHash), 'hex'))) {
            req.session = null;
            return next();
        }
        req.user = {
            _id: user._id,
            username: user.username,
            displayName: user.displayName,
            role: user.role
        };
        res.locals.currentUser = req.user;
        return next();
    } catch (error) {
        return next(error);
    }
});

// 在尚未登录时也提供 CSRF Token；登录成功后生成新 Token。
app.use((req, res, next) => {
    if (!req.session?.csrfToken) {
        req.session = { ...(req.session || {}), csrfToken: randomBytes(32).toString('hex') };
    }
    res.locals.csrfToken = req.session.csrfToken;
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
// 分支 feature/t-auth；账号路由、处理函数与权限中间件。
function requireLogin(req, res, next) {
    if (req.user) return next();
    if (isApiRequest(req)) return sendApiError(res, 401, 'UNAUTHORIZED', '请先登录');
    return res.redirect(303, '/login');
}

function requireAdmin(req, res, next) {
    if (!req.user) return requireLogin(req, res, next);
    if (req.user.role === 'admin') return next();
    if (isApiRequest(req)) return sendApiError(res, 403, 'FORBIDDEN', '没有管理员权限');
    return res.status(403).render('info', {
        title: '无权访问', activePage: '', message: '只有管理员可以执行此操作。'
    });
}

// 使用服务器密钥对密码哈希生成会话验证标记；密码更新后所有旧 Cookie 的标记失效。
// 标记不是密码哈希本身，且不暴露密码哈希给客户端。
function sessionCredentialMarker(passwordHash) {
    return createHmac('sha256', sessionKeys[0]).update(passwordHash).digest('hex');
}

// scrypt$盐(hex)$哈希(hex)。密码哈希永远不发送给浏览器。
async function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('密码必须为 8–128 个字符');
    }
    const salt = randomBytes(16).toString('hex');
    const key = await scryptAsync(password, salt, 64);
    return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
    if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(storedHash)) return false;
    const [, salt, hash] = storedHash.split('$');
    const saved = Buffer.from(hash, 'hex');
    const derived = await scryptAsync(password, salt, saved.length);
    return timingSafeEqual(saved, derived);
}

function requireCsrf(req, res, next) {
    const supplied = req.get('x-csrf-token') || req.body?._csrf;
    const expected = req.session?.csrfToken;
    if (typeof supplied === 'string' && typeof expected === 'string' &&
        /^[a-f0-9]{64}$/.test(supplied) && /^[a-f0-9]{64}$/.test(expected) &&
        timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) {
        return next();
    }
    if (isApiRequest(req)) {
        return sendApiError(res, 403, 'INVALID_CSRF', '安全验证失败，请刷新后重试');
    }
    if (req.user) {
        return res.status(403).render('info', {
            title: '安全验证失败', activePage: 'profile', message: '请刷新页面后重新提交。'
        });
    }
    return res.status(403).render('login', {
        title: '工作人员登录', activePage: '', username: '',
        error: '安全验证失败，请刷新登录页面后重试。'
    });
}

function loginError(req, res, status, code, message, username = '') {
    if (isApiRequest(req)) return sendApiError(res, status, code, message);
    return res.status(status).render('login', {
        title: '工作人员登录', activePage: '', username, error: message
    });
}

async function loginHandler(req, res, next) {
    const rawUsername = req.body?.username;
    const password = req.body?.password;
    const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
    if (typeof rawUsername !== 'string' || username.length < 3 || username.length > 40 ||
        typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return loginError(req, res, 400, 'VALIDATION_ERROR', '请输入有效的用户名和密码', username);
    }
    if (mongoose.connection.readyState !== 1) {
        return loginError(req, res, 503, 'DATABASE_UNAVAILABLE', '数据库尚未连接，请使用 CONNECT_DB=1 启动', username);
    }
    try {
        const user = await User.findOne({ username }).select('+passwordHash').lean();
        if (!user || !await verifyPassword(password, user.passwordHash)) {
            return loginError(req, res, 401, 'INVALID_CREDENTIALS', '用户名或密码错误', username);
        }
        req.session = {
            userId: String(user._id),
            expiresAt: Date.now() + 8 * 60 * 60 * 1000,
            csrfToken: randomBytes(32).toString('hex'),
            credentialMarker: sessionCredentialMarker(user.passwordHash)
        };
        if (isApiRequest(req)) {
            return res.json({
                success: true,
                data: { _id: user._id, username: user.username, displayName: user.displayName, role: user.role },
                message: '登录成功'
            });
        }
        return res.redirect(303, '/');
    } catch (error) {
        return next(error);
    }
}

function logoutHandler(req, res) {
    req.session = null;
    if (isApiRequest(req)) {
        return res.json({ success: true, data: {}, message: '已退出登录' });
    }
    return res.redirect(303, '/login');
}

app.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, '/');
    return res.render('login', {
        title: '工作人员登录', activePage: '', username: '', error: ''
    });
});
app.post('/login', requireCsrf, loginHandler);
app.post('/logout', requireCsrf, logoutHandler);

app.get('/api/csrf', (req, res) => res.json({
    success: true, data: { csrfToken: req.session.csrfToken }, message: '安全令牌已生成'
}));
app.post('/api/login', requireCsrf, loginHandler);
app.post('/api/logout', requireCsrf, logoutHandler);

// GET 资料页需要读取真实电话（req.user 中不存电话）。
async function loadProfile(req) {
    return User.findById(req.user._id)
        .select('_id username displayName phone role')
        .lean();
}

function profileView(res, profile, options = {}) {
    return res.status(options.status || 200).render('profile', {
        title: '个人资料', activePage: 'profile', profile,
        error: options.error || '',
        success: options.success || ''
    });
}

app.get('/profile', requireLogin, async (req, res, next) => {
    try {
        const profile = await loadProfile(req);
        if (!profile) return res.status(404).render('info', {
            title: '账号不存在', activePage: '', message: '用户账号不存在，请重新登录。'
        });
        return profileView(res, profile, {
            success: req.query.updated === '1' ? '个人资料已保存' : ''
        });
    } catch (error) {
        return next(error);
    }
});

// 资料修改仅允许 displayName 和 phone；username、role 只能由管理员管理。
async function updateProfile(req, res, next) {
    try {
        const current = await loadProfile(req);
        if (!current) {
            if (isApiRequest(req)) return sendApiError(res, 404, 'NOT_FOUND', '账号不存在');
            return res.status(404).render('info', {
                title: '账号不存在', activePage: '', message: '用户账号不存在，请重新登录。'
            });
        }
        const allowed = isApiRequest(req)
            ? new Set(['displayName', 'phone'])
            : new Set(['displayName', 'phone', '_csrf']);
        const body = req.body || {};
        const rawName = body.displayName;
        const rawPhone = body.phone === undefined ? '' : body.phone;
        const displayName = typeof rawName === 'string' ? rawName.trim() : '';
        const phone = typeof rawPhone === 'string' ? rawPhone.trim() : '';
        const invalid = Object.keys(body).some(key => !allowed.has(key)) ||
            typeof rawName !== 'string' || displayName.length < 1 || displayName.length > 80 ||
            typeof rawPhone !== 'string' || phone.length > 30;
        if (invalid) {
            const message = '显示姓名需为 1–80 字符，电话不超过 30 字符，且不能修改用户名或角色';
            if (isApiRequest(req)) return sendApiError(res, 400, 'VALIDATION_ERROR', message);
            return profileView(res, { ...current, displayName, phone }, {
                status: 400, error: message
            });
        }
        const updated = await User.findByIdAndUpdate(
            req.user._id,
            { $set: { displayName, phone } },
            { returnDocument: 'after', runValidators: true }
        ).select('_id username displayName phone role').lean();
        if (!updated) {
            if (isApiRequest(req)) return sendApiError(res, 404, 'NOT_FOUND', '账号不存在');
            return res.redirect(303, '/login');
        }
        if (isApiRequest(req)) {
            return res.json({ success: true, data: updated, message: '个人资料已保存' });
        }
        return res.redirect(303, '/profile?updated=1');
    } catch (error) {
        return next(error);
    }
}

app.post('/profile', requireLogin, requireCsrf, updateProfile);
app.get('/api/profile', requireLogin, async (req, res, next) => {
    try {
        const profile = await loadProfile(req);
        if (!profile) return sendApiError(res, 404, 'NOT_FOUND', '账号不存在');
        return res.json({ success: true, data: profile, message: '查询成功' });
    } catch (error) { return next(error); }
});
app.put('/api/profile', requireLogin, requireCsrf, updateProfile);

function passwordView(res, status = 200, error = '', success = '') {
    return res.status(status).render('password', {
        title: '修改密码', activePage: 'profile', error, success
    });
}

app.get('/password', requireLogin, (req, res) =>
    passwordView(res, 200, '', req.query.updated === '1' ? '密码已更新，其他设备的旧登录会话已失效。' : '')
);

function passwordError(req, res, status, code, message) {
    if (isApiRequest(req)) return sendApiError(res, status, code, message);
    return passwordView(res, status, message);
}

async function updatePassword(req, res, next) {
    // 明确字段白名单；不接受 username、role 或任何额外字段。
    const allowed = isApiRequest(req)
        ? new Set(['currentPassword', 'newPassword', 'confirmPassword'])
        : new Set(['currentPassword', 'newPassword', 'confirmPassword', '_csrf']);
    const body = req.body || {};
    const { currentPassword, newPassword, confirmPassword } = body;
    if (Object.keys(body).some(key => !allowed.has(key)) ||
        typeof currentPassword !== 'string' ||
        typeof newPassword !== 'string' ||
        typeof confirmPassword !== 'string' ||
        currentPassword.length < 8 || currentPassword.length > 128 ||
        newPassword.length < 8 || newPassword.length > 128 ||
        confirmPassword !== newPassword) {
        return passwordError(req, res, 400, 'VALIDATION_ERROR',
            '请检查当前密码、新密码（8–128 字符）及确认密码');
    }
    if (currentPassword === newPassword) {
        return passwordError(req, res, 400, 'VALIDATION_ERROR', '新密码不能与当前密码相同');
    }
    try {
        const user = await User.findById(req.user._id).select('+passwordHash').lean();
        if (!user) return passwordError(req, res, 404, 'NOT_FOUND', '账号不存在');
        if (!await verifyPassword(currentPassword, user.passwordHash)) {
            return passwordError(req, res, 401, 'INVALID_CREDENTIALS', '当前密码错误');
        }
        const newHash = await hashPassword(newPassword);
        // 条件更新避免并发修改覆盖：密码已被另一请求更新时，返回冲突而不是覆盖。
        const updated = await User.findOneAndUpdate(
            { _id: req.user._id, passwordHash: user.passwordHash },
            { $set: { passwordHash: newHash } },
            { returnDocument: 'after', runValidators: true }
        ).select('+passwordHash').lean();
        if (!updated) {
            return passwordError(req, res, 409, 'CONFLICT', '密码已发生变化，请重新登录');
        }
        // 当前会话发放新的验证标记；其他设备仍持旧标记，下一次请求会被清除。
        req.session = {
            userId: String(user._id),
            expiresAt: Date.now() + 8 * 60 * 60 * 1000,
            csrfToken: randomBytes(32).toString('hex'),
            credentialMarker: sessionCredentialMarker(updated.passwordHash)
        };
        if (isApiRequest(req)) {
            return res.json({ success: true, data: {}, message: '密码修改成功，其他旧会话已失效' });
        }
        return res.redirect(303, '/password?updated=1');
    } catch (error) {
        return next(error);
    }
}

app.post('/password', requireLogin, requireCsrf, updatePassword);
app.put('/api/password', requireLogin, requireCsrf, updatePassword);

// T 后续：退出按钮与统一跨模块权限接入。
// 其他模块仍需在各自写入路由中接入 requireLogin/requireAdmin 与 requireCsrf。

// ============================================================================
// 02 L 区｜动物新增、详情、基本资料编辑
// ============================================================================
// 分支 feature/l-animal；依赖 T 的真实身份加载、requireLogin 和 requireCsrf。
const LAnimal = require('./models/Animal');
const LFollowUp = require('./models/FollowUp');
const LAdoption = require('./models/Adoption');
const lBasicFields = ['animalType', 'appearance', 'foundLocation', 'healthStatus', 'contactName', 'contactPhone'];

function lError(status, code, message) {
    return Object.assign(new Error(message), { lStatus: status, lCode: code });
}
function lDatabase(req, res, next) {
    if (mongoose.connection.readyState === 1) return next();
    const message = '数据库未连接，请使用 CONNECT_DB=1 启动';
    if (isApiRequest(req)) return sendApiError(res, 503, 'DATABASE_UNAVAILABLE', message);
    return res.status(503).render('info', { title: '数据库未连接', activePage: 'list', message });
}
function lId(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) {
        throw lError(400, 'INVALID_ID', '动物 ID 格式不正确');
    }
}
function lInput(body, editing) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw lError(400, 'VALIDATION_ERROR', '请提交动物基本资料');
    }
    const allowed = new Set([...lBasicFields, '_csrf', ...(editing ? ['expectedUpdatedAt'] : [])]);
    if (Object.keys(body).some(key => !allowed.has(key))) {
        throw lError(400, 'VALIDATION_ERROR', '包含不允许修改的字段');
    }
    const limits = { animalType: 10, appearance: 1000, foundLocation: 200,
        healthStatus: 1000, contactName: 80, contactPhone: 30 };
    const values = {};
    for (const key of lBasicFields) {
        if (typeof body[key] !== 'string') throw lError(400, 'VALIDATION_ERROR', `${key} 必须是文本`);
        values[key] = body[key].trim();
        if (!values[key] || values[key].length > limits[key]) {
            throw lError(400, 'VALIDATION_ERROR', `${key} 必填，最多 ${limits[key]} 个字符`);
        }
    }
    if (!Object.hasOwn(labels.animalTypes, values.animalType)) {
        throw lError(400, 'VALIDATION_ERROR', '请选择有效的动物类型');
    }
    return values;
}
function lSafeValues(body) {
    return Object.fromEntries(lBasicFields.map(key => [key,
        typeof body?.[key] === 'string' ? body[key].slice(0, 1001) : '']));
}
function lFailure(error, req, res, next, form) {
    let status = error.lStatus;
    let code = error.lCode;
    let message = error.message;
    if (error.code === 11000) {
        status = 409; code = 'DUPLICATE_CODE'; message = '编号发生冲突，请重新登记';
    } else if (error.name === 'ValidationError') {
        status = 400; code = 'VALIDATION_ERROR'; message = '动物资料不符合字段要求';
    }
    if (!status) return next(error);
    if (isApiRequest(req)) return sendApiError(res, status, code, message);
    if (form && status === 400) return res.status(status).render(form.view, {
        title: form.view === 'create' ? '新增动物' : '编辑动物资料',
        activePage: form.view === 'create' ? 'create' : 'list',
        animal: { ...(form.animal || {}), ...lSafeValues(req.body) },
        expectedUpdatedAt: req.body?.expectedUpdatedAt,
        error: message
    });
    return res.status(status).render('info', { title: '操作未完成', activePage: 'list', message });
}
async function lLoad(id) {
    lId(id);
    const animal = await LAnimal.findById(id).lean();
    if (!animal) throw lError(404, 'NOT_FOUND', '未找到这条动物记录');
    return animal;
}
function lOpen(animal) {
    if (animal.closedAt || animal.adoptionStatus === 'adopted') {
        throw lError(409, 'ANIMAL_CLOSED', '动物已结案，不能编辑基本资料');
    }
}

app.get('/animals/new', requireLogin, lDatabase, (req, res) => res.render('create', {
    title: '新增动物', activePage: 'create', animal: {}, error: ''
}));

async function lCreate(req, res, next) {
    try {
        const values = lInput(req.body, false);
        // UUID 级随机编号加数据库唯一索引，不使用记录数加一。
        const animal = await LAnimal.create({ ...values,
            animalCode: 'A007-' + randomBytes(16).toString('hex').toUpperCase(),
            createdBy: req.user._id,
            rescueStatus: 'pending', assignedTo: null, placementLocation: '',
            adoptionStatus: 'not_open', closedAt: null, closedBy: null
        });
        if (isApiRequest(req)) return res.status(201).json({ success: true, data: animal, message: '已登记' });
        return res.redirect(303, '/animals/' + animal._id);
    } catch (error) { return lFailure(error, req, res, next, { view: 'create' }); }
}
app.post('/animals/new', requireLogin, requireCsrf, lDatabase, lCreate);
app.post('/api/animals', requireLogin, requireCsrf, lDatabase, lCreate);

app.get('/animals/:id/edit', requireLogin, lDatabase, async (req, res, next) => {
    try {
        const animal = await lLoad(req.params.id);
        lOpen(animal);
        return res.render('edit', { title: '编辑动物资料', activePage: 'list', animal,
            expectedUpdatedAt: animal.updatedAt.toISOString(), error: '' });
    } catch (error) { return lFailure(error, req, res, next); }
});
async function lUpdate(req, res, next) {
    let animal;
    try {
        animal = await lLoad(req.params.id);
        lOpen(animal);
        const values = lInput(req.body, true);
        const supplied = req.body.expectedUpdatedAt;
        if (supplied === undefined && !isApiRequest(req)) {
            throw lError(400, 'VALIDATION_ERROR', '页面缺少版本，请重新打开编辑页');
        }
        if (supplied !== undefined && (typeof supplied !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(supplied) ||
            !Number.isFinite(Date.parse(supplied)))) {
            throw lError(400, 'VALIDATION_ERROR', '资料版本格式错误，请重新打开编辑页');
        }
        if (supplied !== undefined && supplied !== animal.updatedAt.toISOString()) {
            throw lError(409, 'STALE_RECORD', '资料已被其他操作更新，请重新打开详情后编辑');
        }
        const updated = await LAnimal.findOneAndUpdate({
            _id: animal._id, closedAt: null, adoptionStatus: { $ne: 'adopted' }, updatedAt: animal.updatedAt
        }, { $set: { ...values, updatedAt: new Date(Math.max(Date.now(), animal.updatedAt.getTime() + 1)) },
            $inc: { __v: 1 } }, { returnDocument: 'after', runValidators: true, timestamps: false }).lean();
        if (!updated) {
            const current = await lLoad(req.params.id);
            lOpen(current);
            throw lError(409, 'STALE_RECORD', '资料已被其他操作更新，请重新打开详情后编辑');
        }
        if (isApiRequest(req)) return res.json({ success: true, data: updated, message: '已保存' });
        return res.redirect(303, '/animals/' + updated._id);
    } catch (error) { return lFailure(error, req, res, next, animal && { view: 'edit', animal }); }
}
app.post('/animals/:id/edit', requireLogin, requireCsrf, lDatabase, lUpdate);
app.put('/api/animals/:id', requireLogin, requireCsrf, lDatabase, lUpdate);

app.get('/api/animals/:id', requireLogin, lDatabase, async (req, res, next) => {
    try { return res.json({ success: true, data: await lLoad(req.params.id), message: '读取成功' }); }
    catch (error) { return lFailure(error, req, res, next); }
});
app.get('/animals/:id', requireLogin, lDatabase, async (req, res, next) => {
    try {
        await lLoad(req.params.id);
        const [animal, followUps, adoptionRecords] = await Promise.all([
            LAnimal.findById(req.params.id).populate('createdBy assignedTo closedBy', 'displayName username').lean(),
            LFollowUp.find({ animalId: req.params.id }).sort({ createdAt: -1, _id: -1 })
                .populate('recordedBy updatedBy', 'displayName username').lean(),
            LAdoption.find({ animalId: req.params.id }).sort({ createdAt: -1, _id: -1 })
                .populate('registeredBy', 'displayName username').lean()
        ]);
        if (!animal) throw lError(404, 'NOT_FOUND', '这条动物记录已被删除');
        const userName = user => !user ? '未指定或账号已删除' :
            typeof user === 'object' && (user.displayName || user.username) || '账号资料不可用';
        return res.render('details', { title: '动物详情', activePage: 'list', animal, followUps,
            adoption: adoptionRecords[0] || null, adoptionRecords, userName });
    } catch (error) { return lFailure(error, req, res, next); }
});

// 手动初始化一个本机虚构 staff 账号；仅显式命令触发，不覆盖任何已有账号。
async function lCreateTestUser() {
    if (production) throw new Error('测试账号初始化不用于生产环境');
    const password = require('node:fs').readFileSync(0, 'utf8');
    const passwordHash = await hashPassword(password);
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/animal_rescue_group007',
            { serverSelectionTimeoutMS: 5000 });
        await User.init();
        if (await User.exists({ username: 'l_demo_staff' })) throw new Error('l_demo_staff 已存在，未覆盖密码或资料');
        await User.create({ username: 'l_demo_staff', displayName: 'L 本机测试工作人员', passwordHash, role: 'staff' });
        console.log('已创建 l_demo_staff（staff），请使用自己设置的密码登录');
    } finally { await mongoose.disconnect(); }
}


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
            console.log('MongoDB 连接成功（T 登录与 L 动物资料已接入；其他模块需联调）');
        }
        const port = process.env.PORT || 8099;
        const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
        const server = app.listen(port, host, () => console.log(`项目地址：http://${host}:${port}（请先登录；首页和列表仍为原型）`));
        server.on('error', error => { console.error('启动失败：', error.message); process.exit(1); });
    } catch (error) {
        console.error('启动失败：', error.message);
        process.exit(1);
    }
}
if (require.main === module) {
    if (process.argv.includes('--l-create-test-user')) {
        lCreateTestUser().catch(error => { console.error(error.message); process.exitCode = 1; });
    } else startServer();
}
module.exports = app;
