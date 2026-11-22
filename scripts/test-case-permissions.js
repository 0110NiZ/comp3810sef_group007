'use strict';

const assert = require('node:assert/strict');

module.exports = async function testCasePermissions({ request, animal, Animal, staff, colleague, admin, passed }) {
    const record = await animal({ assignedTo: null, rescueStatus: 'pending', placementLocation: '' });
    const api = '/api/animals/' + record._id;
    const web = '/animals/' + record._id;
    const version = async () => ({ expectedUpdatedAt: (await Animal.findById(record._id)).updatedAt.toISOString() });
    const initial = await version();
    const users = { staff, colleague };
    async function page(path, role) {
        const result = await request('GET', path, undefined, role);
        assert.equal(result.status, 200, role + ' GET ' + path);
        return result.text;
    }
    const unclaimed = await page(web + '/rescue', 'staff');
    assert.match(unclaimed, />Take case</);
    assert.doesNotMatch(unclaimed, /name="rescueStatus"|name="assignedTo"/);
    assert.equal((await request('PUT', api + '/claim', { ...initial, assignedTo: String(colleague._id) })).status, 400);
    assert.equal((await request('PUT', api + '/assign', { ...initial, assignedTo: String(staff._id) })).status, 403);
    const roles = Object.keys(users);
    const claims = await Promise.all(roles.map(role => request('PUT', api + '/claim', initial, role)));
    assert.deepEqual(claims.map(r => r.status).sort(), [200, 409], JSON.stringify(claims.map(r => r.json)));
    const owner = roles[claims.findIndex(r => r.status === 200)];
    const other = roles.find(role => role !== owner);
    assert.equal(String((await Animal.findById(record._id)).assignedTo), String(users[owner]._id));
    const beforeHandover = await version();
    assert.match(await page(web + '/rescue', owner), /name="rescueStatus"/);
    assert.doesNotMatch(await page(web + '/rescue', owner), /name="assignedTo"/);
    assert.match(await page(web + '/rescue', 'admin'), /Hand over case/);
    assert.equal((await request('PUT', api + '/rescue', { ...beforeHandover, rescueStatus: 'rescuing',
        assignedTo: String(users[other]._id) }, owner)).status, 403);
    assert.equal((await request('PUT', api + '/assign', { ...initial, assignedTo: String(users[other]._id) }, 'admin')).status, 409);
    const handover = await request('POST', web + '/assign', { ...beforeHandover, assignedTo: String(admin._id) }, 'admin', { form: true });
    assert.equal(handover.status, 303);
    const handed = await Animal.findById(record._id);
    assert.equal(String(handed.assignedTo), String(admin._id));
    assert.equal(String(handed.updatedBy), String(admin._id));
    const readOnly = await page(web + '/rescue', owner);
    assert.match(readOnly, /Rescue coordinator:\s*<strong>Test Administrator</);
    assert.match(readOnly, /Add Follow-up/);
    assert.doesNotMatch(readOnly, /name="rescueStatus"|name="placementLocation"|name="assignedTo"|>Take case</);
    const profileList = '/rescue-management?assignedTo=me';
    assert.ok(!(await page(profileList, owner)).includes(record.animalCode));
    assert.ok((await page(profileList, 'admin')).includes(record.animalCode));
    assert.equal((await request('POST', web + '/rescue', { ...beforeHandover, rescueStatus: 'placed',
        placementLocation: 'Clinic' }, owner, { form: true })).status, 403);
    passed('Claiming is exclusive and admin handover immediately updates forms and personal assignments');

    for (const [method, suffix] of [['PUT', ''], ['PUT', '/rescue'], ['PUT', '/adoption-status'],
        ['POST', '/adoption'], ['PUT', '/adoption'], ['PUT', '/adoption/cancel'], ['PUT', '/close']]) {
        assert.equal((await request(method, api + suffix, {}, other)).status, 403, method + ' ' + suffix);
    }
    for (const suffix of ['/edit', '/adoption', '/close', '/adoption/cancel']) {
        assert.equal((await request('GET', web + suffix, undefined, other)).status, 403, suffix);
    }
    assert.equal((await request('PUT', api + '/rescue', { ...await version(), rescueStatus: 'rescuing' }, 'admin')).status, 200);
    assert.equal((await request('PUT', api + '/assign', { ...await version(), assignedTo: String(users[other]._id) }, 'admin')).status, 200);
    const placement = await request('PUT', api + '/rescue', {
        ...await version(), rescueStatus: 'placed', placementLocation: 'Test Clinic'
    }, other);
    assert.equal(placement.status, 200);
    assert.equal(placement.json.data.updatedBy, String(users[other]._id));
    assert.equal((await request('PUT', api + '/adoption-status', { adoptionStatus: 'available', healthConfirmed: true }, 'admin')).status, 200);
    const advanced = await Animal.findById(record._id);
    assert.equal(String(advanced.updatedBy), String(admin._id));
    assert.equal(String(advanced.assignedTo), String(users[other]._id));
    passed('Case changes enforce ownership on web and API and record the actual administrator acting');

    const entry = await request('POST', api + '/followups', { content: 'Overnight care', recordedBy: String(admin._id) }, owner);
    assert.equal(entry.status, 201);
    assert.equal(entry.json.data.recordedBy, String(users[owner]._id));
    const entryPath = api + '/followups/' + entry.json.data._id;
    const edit = { expectedUpdatedAt: entry.json.data.updatedAt, content: 'Updated overnight care' };
    assert.equal((await request('PUT', entryPath, edit, other)).status, 403);
    assert.equal((await request('DELETE', entryPath, edit, owner)).status, 403);
    const corrected = await request('PUT', entryPath, edit, owner);
    assert.equal(corrected.status, 200);
    assert.equal((await request('PUT', entryPath, { ...edit, expectedUpdatedAt: corrected.json.data.updatedAt }, 'admin')).status, 200);
    passed('Any staff can log care with trusted authorship and only the author or admin can edit it');

    const archived = await animal({ closedAt: new Date(), adoptionStatus: 'adopted' });
    for (const role of ['staff', 'admin']) {
        const path = '/api/animals/' + archived._id;
        for (const action of ['claim', 'assign', 'rescue']) {
            const blocked = await request('PUT', path + '/' + action, {
                expectedUpdatedAt: archived.updatedAt.toISOString(), assignedTo: String(admin._id), rescueStatus: 'placed'
            }, role);
            assert.equal(blocked.status, 403);
        }
        assert.equal((await request('POST', path + '/followups', { content: 'Late entry' }, role)).status, 403);
        assert.doesNotMatch(await page('/animals/' + archived._id + '/rescue', role), /name="rescueStatus"|>Take case<|>Add Follow-up/);
    }
    passed('Archived cases reject claims, reassignments, rescue edits and new care records for both roles');
};
