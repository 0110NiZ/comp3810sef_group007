const mongoose = require('mongoose');

const animalCodePattern = /^AR-(\d{4})-(\d{4,})$/;

function registrationYear(date) {
    return Number(
        new Intl.DateTimeFormat('en', {
            year: 'numeric',
            timeZone: 'Asia/Hong_Kong'
        }).format(new Date(date))
    );
}

async function nextAnimalCode(date = new Date(), session = null) {
    const year = registrationYear(date);
    const counters = mongoose.connection.db.collection('animal_code_counters');
    // The year is the unique primary key; increments are atomic across servers.
    let counter;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            counter = await counters.findOneAndUpdate(
                { _id: year },
                {
                    $inc: { sequence: 1 }
                },
                { upsert: true, returnDocument: 'after', session }
            );
            break;
        } catch (error) {
            if (error.code !== 11000 || session || attempt === 2) throw error;
        }
    }
    return `AR-${year}-${String(counter.sequence).padStart(4, '0')}`;
}

async function migrateAnimalCodes() {
    const db = mongoose.connection.db;
    const counters = db.collection('animal_code_counters');
    const history = db.collection('animal_code_migrations');
    await history.createIndex({ animalId: 1 }, { unique: true });
    // Create collections before entering a transaction on Atlas.
    await counters.updateOne(
        { _id: registrationYear(new Date()) },
        {
            $setOnInsert: { sequence: 0 }
        },
        { upsert: true }
    );
    return mongoose.connection.transaction(async (session) => {
        const animals = await db.collection('animals').find({}, { session }).toArray();
        const deleted = await db.collection('deletionlogs').find({}, { session }).toArray();
        const records = new Map();
        for (const row of [...animals, ...deleted]) {
            const id = row.animalId || row._id;
            if (!records.has(String(id)))
                records.set(String(id), {
                    id,
                    code: row.animalCode,
                    date: row.animalId
                        ? id.getTimestamp()
                        : row.createdAt || id.getTimestamp()
                });
        }
        const ordered = [...records.values()].sort(
            (a, b) =>
                new Date(a.date) - new Date(b.date) ||
                String(a.id).localeCompare(String(b.id))
        );
        // Reserve all existing short codes, including deleted animals: never reuse them.
        for (const row of ordered) {
            const match = animalCodePattern.exec(row.code || '');
            if (match)
                await counters.updateOne(
                    { _id: Number(match[1]) },
                    {
                        $max: { sequence: Number(match[2]) }
                    },
                    { session, upsert: true }
                );
        }
        let changed = 0;
        for (const row of ordered) {
            if (animalCodePattern.test(row.code || '')) continue;
            const code = await nextAnimalCode(row.date, session);
            await history.updateOne(
                { animalId: row.id },
                {
                    $setOnInsert: {
                        oldCode: row.code,
                        newCode: code,
                        migratedAt: new Date()
                    }
                },
                { session, upsert: true }
            );
            // Direct collection updates preserve timestamps and record versions.
            await db.collection('animals').updateOne(
                { _id: row.id },
                {
                    $set: { animalCode: code }
                },
                { session }
            );
            await db.collection('deletionlogs').updateMany(
                { animalId: row.id },
                {
                    $set: { animalCode: code }
                },
                { session }
            );
            changed++;
        }
        return { changed, total: ordered.length };
    });
}

module.exports = { animalCodePattern, nextAnimalCode, migrateAnimalCodes, registrationYear };
