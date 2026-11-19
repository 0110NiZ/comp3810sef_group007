'use strict';
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomBytes } = require('node:crypto');
const { nextAnimalCode, migrateAnimalCodes, registrationYear } = require('./services/animal-codes');

(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Run with NODE_ENV=test.');
    const database = 'group007_codes_test_' + randomBytes(10).toString('hex');
    await mongoose.connect('mongodb://127.0.0.1:27018/?replicaSet=group007rs', { dbName: database });
    try {
        const db = mongoose.connection.db;
        const id = new mongoose.Types.ObjectId();
        const deletedId = new mongoose.Types.ObjectId('6955b9000000000000000001');
        const date = new Date('2026-02-01T00:00:00Z');
        await db.collection('animals').insertMany([
            { _id: id, animalCode: 'A007-OLD', createdAt: date, updatedAt: date, __v: 4 },
            { animalCode: 'AR-2026-0007', createdAt: date },
            { animalCode: 'OLD-2025', createdAt: new Date('2025-06-01') }
        ]);
        await db.collection('animals').createIndex({ animalCode: 1 }, { unique: true });
        await db.collection('deletionlogs').insertOne({ animalId: deletedId, animalCode: 'DELETED-OLD' });
        await db.collection('followups').insertOne({ animalId: id, content: 'Preserve this note' });
        await db.collection('adoptions').insertOne({ animalId: id, remarks: 'Preserve adoption' });
        assert.equal((await migrateAnimalCodes()).changed, 3);
        assert.equal((await migrateAnimalCodes()).changed, 0);
        const animal = await db.collection('animals').findOne({ _id: id });
        assert.match(animal.animalCode, /^AR-2026-\d{4}$/);
        assert.equal(animal.updatedAt.getTime(), date.getTime());
        assert.equal(animal.__v, 4);
        assert.equal(await db.collection('followups').countDocuments({ animalId: id }), 1);
        assert.equal(await db.collection('adoptions').countDocuments({ animalId: id }), 1);
        assert.equal(await db.collection('animal_code_migrations').countDocuments(), 3);
        const codes = await Promise.all(Array.from({ length: 40 }, () => nextAnimalCode(date)));
        assert.equal(new Set(codes).size, 40);
        assert.ok(codes.every(code => Number(code.split('-')[2]) > 7));
        assert.equal(registrationYear('2025-12-31T16:00:00Z'), 2026);
        assert.equal(await nextAnimalCode(new Date('2030-01-01')), 'AR-2030-0001');
        console.log('PASS: legacy migration, deleted history, idempotence, unchanged references/timestamps, concurrent allocation and year rollover');
    } finally {
        if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
