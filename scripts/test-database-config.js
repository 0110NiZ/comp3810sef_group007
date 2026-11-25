const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { applicationDatabaseName } = require('../services/database-config');

const projectRoot = path.join(__dirname, '..');

test('application connections require an explicit, non-test database', () => {
    for (const uri of [undefined, '', 'mongodb://localhost:27017',
        'mongodb://localhost:27017/', 'mongodb+srv://example.invalid/?retryWrites=true',
        'mongodb://localhost:27017/test', 'mongodb://localhost:27017/TEST',
        'mongodb://localhost:27017/%74%65%73%74', 'mongodb://localhost:27017/%20',
        'mongodb://localhost:27017/%invalid']) {
        assert.throws(() => applicationDatabaseName(uri));
    }
    for (const uri of [
        'mongodb://localhost:27017/animal_rescue_group007',
        'mongodb+srv://user:password@example.invalid/animal_rescue_group007?retryWrites=true',
        'mongodb://host1:27017,host2:27017/animal_rescue_group007?replicaSet=group007rs',
        'mongodb://[::1]:27017/animal_rescue_group007'
    ]) {
        assert.equal(applicationDatabaseName(uri), 'animal_rescue_group007');
    }
});

test('startup, administrator creation and migration reject unsafe configuration before connecting', () => {
    const secret = 'database-config-check-secret';
    for (const suffix of ['', '/', '/test', '/%74%65%73%74']) {
        for (const args of [['server.js'], ['server.js', '--create-admin'],
            ['scripts/migrate-animal-codes.js']]) {
            const result = spawnSync(process.execPath, args, {
                cwd: projectRoot,
                env: {
                    ...process.env,
                    NODE_ENV: 'test', CONNECT_DB: '1',
                    MONGODB_URI: 'mongodb://user:' + secret + '@127.0.0.1:1' + suffix
                },
                input: 'Only-Local-Config-QA-007', encoding: 'utf8', timeout: 3000
            });
            assert.ifError(result.error);
            assert.equal(result.status, 1, args.join(' ') + ' ' + suffix);
            assert.doesNotMatch(result.stdout, /MongoDB connected|Administrator created/);
            assert.ok(!result.stderr.includes(secret), 'credentials must not appear in errors');
            assert.match(result.stderr, /database name|test database is not allowed|migration failed/);
        }
    }
});
