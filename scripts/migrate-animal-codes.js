const mongoose = require('mongoose');
const { applicationDatabaseName } = require('../services/database-config');
const { migrateAnimalCodes } = require('../services/animal-codes');

(async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    const dbName = applicationDatabaseName(process.env.MONGODB_URI);
    await mongoose.connect(process.env.MONGODB_URI, { dbName });
    try {
        const result = await migrateAnimalCodes();
        console.log(JSON.stringify(result));
    } finally {
        await mongoose.disconnect();
    }
})().catch(() => {
    console.error('Animal code migration failed; no partial transaction was saved.');
    process.exitCode = 1;
});
