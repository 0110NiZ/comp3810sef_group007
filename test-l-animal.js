// 隔离数据库的真实 HTTP/Session/MongoDB 测试。不会清空数据库。
const assert = require('node:assert/strict');
const { randomBytes, scryptSync } = require('node:crypto');
const mongoose = require('mongoose');
const app = require('./server');
const User = require('./models/User');
const Animal = require('./models/Animal');
const FollowUp = require('./models/FollowUp');
const Adoption = require('./models/Adoption');

async function main() {
    let server, user, count = 0;
    const uri = process.env.L_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/group007_l_test';
    const run = async (name, fn) => { await fn(); console.log(`PASS ${++count}: ${name}`); };
    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        assert.equal(mongoose.connection.name, 'group007_l_test', '仅允许使用 group007_l_test 测试库');
        await Promise.all([User.init(), Animal.init(), FollowUp.init(), Adoption.init()]);
        const password = randomBytes(16).toString('hex');
        const salt = randomBytes(16).toString('hex');
        user = await User.create({ username: 'ltest_' + randomBytes(8).toString('hex'),
            displayName: 'L 集成测试用户', passwordHash: `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`, role: 'staff' });
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        let cookies = new Map(), csrf;
        const request = async (path, { method = 'GET', body, json = true, token = true, auth = true } = {}) => {
            const headers = {};
            if (auth) headers.cookie = [...cookies].map(([k,v]) => `${k}=${v}`).join('; ');
            if (token && csrf) headers['x-csrf-token'] = csrf;
            if (body !== undefined) headers['content-type'] = json ? 'application/json' : 'application/x-www-form-urlencoded';
            const res = await fetch(base + path, { method, headers, redirect: 'manual',
                body: body === undefined ? undefined : json ? JSON.stringify(body) : new URLSearchParams(body) });
            if (auth) for (const cookie of res.headers.getSetCookie()) {
                const pair = cookie.split(';')[0], sep = pair.indexOf('=');
                cookies.set(pair.slice(0, sep), pair.slice(sep + 1));
            }
            const text = await res.text();
            return { status: res.status, headers: res.headers, text,
                data: res.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
        };
        await run('未登录 API 401', async () => assert.equal((await request('/api/animals', {method:'POST',body:{},auth:false})).status,401));
        await run('未登录页面跳转登录', async () => {
            const r = await request('/animals/new', {auth:false}); assert.equal(r.status,303); assert.equal(r.headers.get('location'),'/login');
        });
        csrf = (await request('/api/csrf')).data.data.csrfToken;
        await run('通过 T 的真实密码验证登录', async () => {
            assert.equal((await request('/api/login',{method:'POST',body:{username:user.username,password}})).status,200);
        });
        csrf = (await request('/api/csrf')).data.data.csrfToken;
        const values = { animalType:'cat',appearance:' 橘白小猫 ',foundLocation:' 校园东门 ',healthStatus:'待检查',contactName:'测试联系人',contactPhone:'00000000' };
        let animal;
        await run('缺少 CSRF 被拒绝', async () => assert.equal((await request('/api/animals',{method:'POST',body:values,token:false})).status,403));
        await run('新增入库及服务器初始字段', async () => {
            const r = await request('/api/animals',{method:'POST',body:values}); assert.equal(r.status,201);
            animal = r.data.data; assert.equal(animal.createdBy,String(user._id)); assert.equal(animal.rescueStatus,'pending');
            assert.equal(animal.adoptionStatus,'not_open'); assert.equal(animal.closedAt,null); assert.equal(animal.appearance,'橘白小猫');
            assert.ok(await Animal.exists({_id:animal._id}));
        });
        const endpoint = '/api/animals/' + animal._id;
        await run('真实详情 API 读取', async () => assert.equal((await request(endpoint)).data.data.animalCode,animal.animalCode));
        await run('详情 HTML 与空关联记录', async () => {
            const r = await request('/animals/'+animal._id); assert.equal(r.status,200); assert.ok(r.text.includes('暂无跟进记录')); assert.ok(r.text.includes('L 集成测试用户'));
        });
        await run('非法 ID 400', async () => assert.equal((await request('/api/animals/bad')).status,400));
        await run('不存在 ID 404', async () => assert.equal((await request('/api/animals/'+new mongoose.Types.ObjectId())).status,404));
        await run('必填为空 400', async () => assert.equal((await request('/api/animals',{method:'POST',body:{...values,appearance:'  '}})).status,400));
        await run('字段超长 400', async () => assert.equal((await request('/api/animals',{method:'POST',body:{...values,contactName:'a'.repeat(81)}})).status,400));
        await run('对象输入 400', async () => assert.equal((await request('/api/animals',{method:'POST',body:{...values,contactPhone:{$ne:''}}})).status,400));
        await run('非法枚举 400', async () => assert.equal((await request('/api/animals',{method:'POST',body:{...values,animalType:'bird'}})).status,400));
        await run('伪造登记人被拒绝', async () => assert.equal((await request('/api/animals',{method:'POST',body:{...values,createdBy:String(user._id)}})).status,400));
        await run('禁止修改 M/N 字段', async () => assert.equal((await request(endpoint,{method:'PUT',body:{...values,rescueStatus:'placed'}})).status,400));
        await run('编辑保存且保留 M/N 字段', async () => {
            await Animal.updateOne({_id:animal._id},{$set:{rescueStatus:'placed',assignedTo:user._id,placementLocation:'测试安置点',adoptionStatus:'available'}});
            const r = await request(endpoint,{method:'PUT',body:{...values,healthStatus:'健康稳定'}});
            assert.equal(r.status,200); assert.equal(r.data.data.healthStatus,'健康稳定'); assert.equal(r.data.data.rescueStatus,'placed'); assert.equal(r.data.data.adoptionStatus,'available'); assert.equal(r.data.data.placementLocation,'测试安置点');
        });
        await run('同版本并发编辑只有一次成功', async () => {
            const current = (await request(endpoint)).data.data;
            const rows = await Promise.all(['并发甲','并发乙'].map(contactName =>
                request(endpoint,{method:'PUT',body:{...values,contactName,expectedUpdatedAt:current.updatedAt}})));
            assert.deepEqual(rows.map(r=>r.status).sort(),[200,409]);
        });
        await run('旧版本更新 409', async () => assert.equal((await request(endpoint,{method:'PUT',body:{...values,expectedUpdatedAt:animal.updatedAt}})).status,409));
        await run('错误版本格式 400 且表单保留值', async () => {
            const r = await request('/animals/'+animal._id+'/edit',{method:'POST',json:false,body:{...values,expectedUpdatedAt:'invalid'}});
            assert.equal(r.status,400); assert.ok(r.text.includes('测试联系人'));
        });
        await run('网页新增 303 并跳转真实 ID', async () => {
            const r = await request('/animals/new',{method:'POST',json:false,body:values}); assert.equal(r.status,303); assert.match(r.headers.get('location'),/^\/animals\/[a-f0-9]{24}$/);
        });
        await run('网页编辑 303', async () => {
            const current = (await request(endpoint)).data.data;
            const r = await request('/animals/'+animal._id+'/edit',{method:'POST',json:false,body:{...values,expectedUpdatedAt:current.updatedAt}}); assert.equal(r.status,303);
        });
        await run('重复表单字段被拒绝', async () => {
            const params = new URLSearchParams(values); params.append('contactName','another');
            assert.equal((await request('/animals/new',{method:'POST',json:false,body:params})).status,400);
        });
        await run('关联记录按当前动物显示并转义 HTML', async () => {
            await FollowUp.create({animalId:animal._id,recordedBy:user._id,content:'<script>alert(1)</script>'});
            await FollowUp.create({animalId:new mongoose.Types.ObjectId(),recordedBy:user._id,content:'不应显示的其他动物记录'});
            await Adoption.create({animalId:animal._id,registeredBy:user._id,adopterName:'测试领养人',adopterPhone:'0000'});
            const r = await request('/animals/'+animal._id); assert.equal(r.status,200); assert.ok(r.text.includes('&lt;script&gt;')); assert.ok(!r.text.includes('<script>alert')); assert.ok(!r.text.includes('不应显示的其他动物记录')); assert.ok(r.text.includes('测试领养人'));
        });
        await run('结案后网页和 API 禁止编辑', async () => {
            await Animal.updateOne({_id:animal._id},{$set:{closedAt:new Date(),closedBy:user._id,adoptionStatus:'adopted'}});
            assert.equal((await request(endpoint,{method:'PUT',body:values})).status,409);
            assert.equal((await request('/animals/'+animal._id+'/edit')).status,409);
            assert.equal((await request('/animals/'+animal._id+'/edit',{method:'POST',json:false,body:values})).status,409);
            const r = await request('/animals/'+animal._id); assert.equal(r.status,200); assert.ok(!r.text.includes('>编辑基本资料</a>')); assert.ok(!r.text.includes('>添加跟进</a>'));
        });
        await run('并发新增编号唯一', async () => {
            const rows = await Promise.all(Array.from({length:8},()=>request('/api/animals',{method:'POST',body:values})));
            for(const row of rows) assert.equal(row.status,201);
            assert.equal(new Set(rows.map(row=>row.data.data.animalCode)).size,8);
        });
        await run('数据库唯一索引拒绝重复编号', async () => {
            await assert.rejects(Animal.create({...values,animalCode:animal.animalCode,createdBy:user._id}), error=>error.code===11000);
        });
        await run('退出后拒绝读写', async () => {
            assert.equal((await request('/api/logout',{method:'POST',body:{}})).status,200);
            assert.equal((await request(endpoint)).status,401);
            assert.equal((await request(endpoint,{method:'PUT',body:values})).status,401);
        });
        console.log(`\n${count} 组集成检查全部通过。`);
    } finally {
        if (server) await new Promise(resolve=>server.close(resolve));
        if (user) {
            await FollowUp.deleteMany({recordedBy:user._id});
            await Adoption.deleteMany({registeredBy:user._id});
            await Animal.deleteMany({createdBy:user._id});
            await User.deleteOne({_id:user._id});
        }
        await mongoose.disconnect();
    }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
