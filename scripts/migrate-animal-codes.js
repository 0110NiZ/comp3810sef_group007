const mongoose = require('mongoose');
const { migrateAnimalCodes } = require('../services/animal-codes');

(async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI);
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
