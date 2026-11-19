'use strict';
// Exercise real HTTP authentication against an isolated replica-set database.
const assert = require('node:assert/strict');
const {
    randomBytes,
    scryptSync
} = require('node:crypto');
const mongoose = require('mongoose');
const app = require('./server');
const User = require('./models/User');
const Animal = require('./models/Animal');
const FollowUp = require('./models/FollowUp');
const DeletionLog = require('./models/DeletionLog');

async function main() {
    if (process.env.NODE_ENV !== 'test') throw new Error('Run with NODE_ENV=test.');
    const database = 'group007_app_test_' + randomBytes(10).toString('hex');
    const password = randomBytes(16).toString('hex');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
    let server, count = 0;
    const pass = name => console.log(`PASS ${++count}: ${name}`);
    try {
        await mongoose.connect(process.env.TEST_MONGODB_URI ||
            'mongodb://127.0.0.1:27018/?replicaSet=group007rs', {
                dbName: database
            });
        await app.nModule.prepareDatabase();
        const [staff, admin] = await User.create([{
                username: 'staff01',
                displayName: 'Staff 01',
                passwordHash,
                role: 'staff'
            },
            {
                username: 'admin01',
                displayName: 'Administrator 01',
                passwordHash,
                role: 'admin'
            }
        ]);
        server = await new Promise(resolve => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${server.address().port}`;

        function client() {
            const cookies = new Map();
            let csrf = '';
            return async function request(method, url, body, options = {}) {
                const headers = {
                    cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
                };
                if (csrf && !options.noCsrf) headers['X-CSRF-Token'] = csrf;
                if (body) headers['Content-Type'] = options.form ?
                    'application/x-www-form-urlencoded' : 'application/json';
                const response = await fetch(base + url, {
                    method,
                    headers,
                    redirect: 'manual',
                    body: body ? options.form ? new URLSearchParams(body) : JSON
                        .stringify(body) : undefined
                });
                for (const cookie of response.headers.getSetCookie()) {
                    const pair = cookie.split(';')[0],
                        split = pair.indexOf('=');
                    cookies.set(pair.slice(0, split), pair.slice(split + 1));
                }
                const text = await response.text();
                const json = response.headers.get('content-type')?.includes('application/json') ?
                    JSON.parse(text) : null;
                if (url === '/api/csrf' && json) csrf = json.data.csrfToken;
                return {
                    status: response.status,
                    location: response.headers.get("location"),
                    json,
                    text
                };
            };
        }
        const worker = client(),
            manager = client(),
            anonymous = client();
        for (const [request, username] of [
                [worker, 'staff01'],
                [manager, 'admin01']
            ]) {
            await request('GET', '/api/csrf');
            assert.equal((await request('POST', '/api/login', {
                username,
                password
            })).status, 200);
            await request('GET', '/api/csrf');
        }
        assert.equal((await anonymous('GET', '/api/animals')).status, 401);
        assert.equal((await worker('GET', '/api/users')).status, 403);
        assert.equal((await worker('POST', '/api/users', {
            username: 'forbidden',
            password
        })).status, 403);
        pass('Real sign-in, session and administrator boundaries');
        const createdUser = await manager('POST', '/api/users', {
            username: 'staff02',
            displayName: 'Second Staff',
            phone: '00002',
            password
        });
        assert.equal(createdUser.status, 201);
        assert.equal(createdUser.json.data.role, 'staff');
        assert.ok(!JSON.stringify((await manager('GET', '/api/users')).json).includes('passwordHash'));
        assert.equal((await manager('POST', '/api/users', {
            username: 'staff03',
            displayName: 'Third',
            password,
            role: 'admin'
        })).status, 400);
        pass('Staff creation, role allowlist and safe account responses');
        const fields = {
            animalType: 'cat',
            appearance: 'Milo, orange and white cat',
            foundLocation: 'East entrance',
            healthStatus: 'Under observation',
            contactName: 'Test Contact',
            contactPhone: '00000123'
        };
        assert.equal((await worker('POST', '/api/animals', fields, {
            noCsrf: true
        })).status, 403);
        const created = await worker('POST', '/api/animals', fields);
        assert.equal(created.status, 201);
        assert.match(created.json.data.animalCode, /^AR-\d{4}-\d{4,}$/);
        const id = created.json.data._id,
            api = '/api/animals/' + id,
            web = '/animals/' + id;
        let animal = created.json.data;
        const edited = await worker('PUT', api, {
            ...fields,
            appearance: 'Milo, recovering well',
            expectedUpdatedAt: animal.updatedAt
        });
        assert.equal(edited.status, 200);
        assert.equal((await worker('PUT', api, {
            ...fields,
            expectedUpdatedAt: animal.updatedAt
        })).status, 409);
        animal = edited.json.data;
        pass('Animal creation, editing and stale-form protection');
        const invalid = await worker('POST', web + '/rescue', {
            rescueStatus: 'placed',
            assignedTo: String(staff._id),
            placementLocation: '',
            expectedUpdatedAt: animal.updatedAt
        }, {
            form: true
        });
        assert.equal(invalid.status, 400);
        assert.ok(invalid.text.includes('name="placementLocation"'));
        assert.ok(invalid.text.includes('Enter a placement location'));
        const rescue = {
            rescueStatus: 'placed',
            assignedTo: String(staff._id),
            placementLocation: 'North Shelter',
            expectedUpdatedAt: animal.updatedAt
        };
        const race = await Promise.all([worker('PUT', api + '/rescue', rescue), worker('PUT', api +
            '/rescue', {
                ...rescue,
                placementLocation: 'South Shelter'
            })]);
        assert.deepEqual(race.map(x => x.status).sort(), [200, 409]);
        const rescueResult = race.find(response => response.status === 200).json.data;
        assert.equal(rescueResult.updatedAt, (await Animal.findById(id)).updatedAt.toISOString());
        pass('Rescue errors preserve input and concurrent updates cannot overwrite');
        const before = await Animal.findById(id).lean();
        const follow = await worker('POST', api + '/followups', {
            content: 'Eating well. Continue observation.'
        });
        assert.equal(follow.status, 201);
        const followId = follow.json.data._id;
        assert.ok((await Animal.findById(id)).updatedAt > before.updatedAt);
        const followEdit = await manager('PUT', api + '/followups/' + followId, {
            content: 'Checked by administrator.',
            expectedUpdatedAt: follow.json.data.updatedAt
        });
        assert.equal(followEdit.status, 200);
        assert.equal(followEdit.json.data.updatedBy, String(admin._id));
        const other = await manager('POST', api + '/followups', {
            content: 'Administrator note.'
        });
        assert.equal((await worker('DELETE', api + '/followups/' + other.json.data._id, {
            expectedUpdatedAt: other.json.data.updatedAt
        })).status, 403);
        assert.ok(Array.isArray((await worker('GET', api + '/followups')).json.data));
        const temporary = await worker('POST', api + '/followups', {
            content: 'Temporary entry'
        });
        assert.equal((await worker('DELETE', api + '/followups/' + temporary.json.data._id, {
            expectedUpdatedAt: temporary.json.data.updatedAt
        })).status, 200);
        pass('Follow-up CRUD, ownership and recent-update timestamp');
        const blankNote = await worker('POST', web + '/followups/new', {
            content: '   '
        }, { form: true });
        assert.equal(blankNote.status, 400);
        assert.ok(blankNote.text.includes('Your changes have not been saved.'));
        assert.ok(blankNote.text.includes('name="content"'));
        assert.ok(blankNote.text.includes('Back to Details'));
        const longDraft = '<care>' + 'x'.repeat(2001);
        const invalidEdit = await worker('POST', web + '/followups/' + followId + '/edit', {
            content: longDraft,
            expectedUpdatedAt: followEdit.json.data.updatedAt
        }, { form: true });
        assert.equal(invalidEdit.status, 400);
        assert.ok(invalidEdit.text.includes('&lt;care&gt;'));
        assert.ok(!invalidEdit.text.includes('<care>'));
        assert.ok(invalidEdit.text.includes('x'.repeat(2001)));
        const staleEdit = await worker('POST', web + '/followups/' + followId + '/edit', {
            content: 'Keep this unsaved draft',
            expectedUpdatedAt: follow.json.data.updatedAt
        }, { form: true });
        assert.equal(staleEdit.status, 409);
        assert.ok(staleEdit.text.includes('Keep this unsaved draft'));
        assert.ok(staleEdit.text.includes('Reload and Review'));
        assert.match(staleEdit.text, /type="submit" disabled/);
        const staleDelete = await worker('POST', web + '/followups/' + followId + '/delete', {
            expectedUpdatedAt: follow.json.data.updatedAt
        }, { form: true });
        assert.equal(staleDelete.status, 409);
        assert.ok(staleDelete.text.includes('Reload and Review'));
        assert.equal((await FollowUp.findById(followId)).content, 'Checked by administrator.');
        pass('Follow-up errors preserve escaped drafts, return to the form and protect stale records');
        if (process.env.PREVIEW_DIR) {
            const fs = require('node:fs');
            fs.mkdirSync(process.env.PREVIEW_DIR, { recursive: true });
            for (const [name, url] of Object.entries({
                dashboard: '/', profile: '/profile', rescue: web + '/rescue',
                details: web, followup: web + '/followups/new', list: '/animals', login: '/login'
            })) {
                const response = await (name === 'login' ? anonymous : worker)('GET', url);
                assert.equal(response.status, 200);
                fs.writeFileSync(process.env.PREVIEW_DIR + '/' + name + '.html', response.text);
            }
            fs.writeFileSync(process.env.PREVIEW_DIR + '/followup-error.html', invalidEdit.text);
        }

        assert.equal((await worker('PUT', api + '/adoption-status', {
            adoptionStatus: 'available',
            healthConfirmed: true
        })).status, 200);
        let adoption = (await worker('POST', api + '/adoption', {
            adopterName: 'Test Adopter',
            adopterPhone: '00000099',
            remarks: 'Handover pending'
        })).json.data.adoption;
        const stamp = () => ({
            adoptionId: adoption._id,
            adoptionVersion: adoption.__v || 0
        });
        assert.ok((await worker('GET', web + '/adoption/cancel')).text.includes('Confirm Cancellation'));
        assert.ok(!(await worker('GET', web + '/adoption')).text.includes('name="cancellationReason"'));
        assert.equal((await worker('PUT', api + '/adoption/cancel', {
            ...stamp(),
            confirm: true,
            cancellationReason: 'Adopter withdrew'
        })).status, 200);
        adoption = (await worker('POST', api + '/adoption', {
            adopterName: 'Second Adopter',
            adopterPhone: '00000088',
            remarks: 'Ready for handover'
        })).json.data.adoption;
        pass('Dedicated cancellation page, retained history and new registration');
        for (const url of ['/', '/animals', '/animals/new', web, web + '/edit', web + '/rescue', web +
                '/followups/new', web + '/followups/' + followId + '/edit', web + '/followups/' +
                followId + '/delete', web + '/adoption', web + '/adoption/cancel', web + '/close',
                web + '/delete', '/profile', '/password', '/users', '/users/new'
            ]) {
            const page = await manager('GET', url);
            assert.equal(page.status, 200, `${url}: ${page.status}`);
            assert.ok(!/[\u4e00-\u9fff]/.test(page.text), `${url} contains untranslated text`);
        }
        assert.equal((await worker('GET', '/api/animals?dateFrom=2026-02-30')).status, 400);
        assert.equal((await worker('GET', '/api/animals?dateFrom=2026-12-01&dateTo=2026-01-01')).status,
            400);
        assert.equal((await worker('GET', '/api/animals?page=0')).status, 400);
        assert.equal((await worker('GET', '/api/animals?foundLocation=%5B')).status, 200);
        assert.equal((await worker('GET', '/api/animals?page=999')).json.pagination.page, 1);
        pass('All pages render in English; filtering and pagination boundaries');
        for (const [path, suffix, label] of [
            ['/rescue-management', '?tab=placed&q=Milo', 'Responsible Staff'],
            ['/followup-records', '?tab=all', 'Checked by administrator.'],
            ['/adoption-management', '?tab=processing', 'Second Adopter']
        ]) {
            assert.equal((await anonymous('GET', path)).status, 303);
            const response = await worker('GET', path + suffix);
            assert.equal(response.status, 200);
            assert.ok(response.text.includes(label));
            assert.ok(response.text.includes('action="' + path + '"'));
            if (process.env.PREVIEW_DIR) {
                require('node:fs').writeFileSync(process.env.PREVIEW_DIR + path + '.html', response.text);
            }
        }
        const mine = await worker('GET', '/followup-records?tab=mine');
        assert.ok(!mine.text.includes('Administrator note.'));
        assert.ok(mine.text.includes('Checked by administrator.'));
        const cancelled = await worker('GET', '/adoption-management?tab=cancelled');
        assert.ok(cancelled.text.includes('Test Adopter'));
        assert.ok(cancelled.text.includes('Adopter withdrew'));
        const currentAnimal = await Animal.findById(id);
        const saved = await worker('POST', web + '/rescue', {
            rescueStatus: 'placed', assignedTo: String(staff._id), placementLocation: 'North Shelter',
            expectedUpdatedAt: currentAnimal.updatedAt.toISOString()
        }, { form: true });
        assert.equal(saved.status, 303);
        assert.equal(saved.location, web + '/rescue?saved=1');
        const savedPage = await worker('GET', saved.location);
        assert.ok(savedPage.text.includes('Rescue changes saved.'));
        assert.ok(savedPage.text.includes('/rescue-management?tab=placed&amp;q=Milo'));
        const newNote = await worker('POST', web + '/followups/new', {
            content: 'Workspace return check'
        }, { form: true });
        assert.equal(newNote.status, 303);
        assert.equal(newNote.location, '/followup-records?tab=mine&q=&page=1');
        assert.equal((await worker('GET', '/rescue-management?q=%5B')).status, 200);
        pass('Distinct work areas, ownership filters, cancelled history and contextual return links');

        const closeRace = await Promise.all([worker('PUT', api + '/close', {
            ...stamp(),
            confirm: true
        }), worker('POST', api + '/followups', {
            content: 'Final observation'
        })]);
        assert.equal(closeRace[0].status, 200);
        assert.ok([201, 403, 409].includes(closeRace[1].status));
        for (const request of [worker, manager]) {
            assert.equal((await request('PUT', api, fields)).status, 409);
            assert.equal((await request('POST', api + '/followups', {
                content: 'Forbidden'
            })).status, 403);
            assert.equal((await request('PUT', api + '/rescue', rescue)).status, 403);
            assert.equal((await request('PUT', api + '/adoption/cancel', {
                ...stamp(),
                confirm: true,
                cancellationReason: 'Forbidden'
            })).status, 409);
        }
        assert.equal((await manager('DELETE', api, {
            confirm: true,
            deletionReason: 'Forbidden'
        })).status, 409);
        const closed = await Animal.findById(id).lean();
        assert.ok((await FollowUp.find({
            animalId: id
        })).every(note => note.createdAt <= closed.closedAt));
        const activeCases = await worker('GET', '/rescue-management');
        assert.ok(!activeCases.text.includes(animal.animalCode));
        assert.ok(activeCases.text.includes('No active cases'));
        assert.ok((await worker('GET', '/rescue-management?tab=archived')).text.includes(animal.animalCode));
        const completedWork = await worker('GET', '/adoption-management?tab=completed');
        assert.ok(completedWork.text.includes('Second Adopter'));
        assert.ok(!completedWork.text.includes('Continue Application'));
        const closedJournal = await worker('GET', '/followup-records');
        assert.ok(!closedJournal.text.includes('>Edit Entry</a>'));
        if (process.env.PREVIEW_DIR) {
            require('node:fs').writeFileSync(process.env.PREVIEW_DIR + '/rescue-empty.html', activeCases.text);
        }
        pass('Follow-up/closure race and closed-case restrictions for both roles');
        const disposable = (await worker('POST', '/api/animals', fields)).json.data;
        const disposableApi = '/api/animals/' + disposable._id;
        const deletion = await Promise.all([manager('DELETE', disposableApi, {
            confirm: true,
            deletionReason: 'Duplicate test record'
        }), worker('POST', disposableApi + '/followups', {
            content: 'Concurrent note'
        })]);
        assert.equal(deletion[0].status, 200);
        assert.equal(await FollowUp.countDocuments({
            animalId: disposable._id
        }), 0);
        assert.equal(await DeletionLog.countDocuments({
            animalId: disposable._id
        }), 1);
        pass('Concurrent deletion leaves no orphan notes and preserves an audit');
        assert.equal((await manager('PUT', '/api/users/' + staff._id + '/status', {
            isActive: false
        })).status, 200);
        for (const url of ['/api/profile', '/api/animals', '/api/stats', api + '/followups', api +
                '/adoption'
            ]) assert.equal((await worker('GET', url)).status, 401);
        await worker('GET', '/api/csrf');
        assert.equal((await worker('POST', '/api/login', {
            username: 'staff01',
            password
        })).status, 401);
        assert.ok(await Animal.exists({
            createdBy: staff._id
        }));
        assert.equal((await manager('PUT', '/api/users/' + staff._id + '/status', {
            isActive: true
        })).status, 200);
        pass('Disabled users lose access immediately; historical references survive');
        console.log(`Application integration tests passed: ${count} groups.`);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (mongoose.connection.name === database && /^group007_app_test_[a-f0-9]{20}$/.test(database))
            await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
}
main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
