// Validate the application database before opening a connection or creating indexes.
function applicationDatabaseName(uri) {
    const match = typeof uri === 'string'
        ? uri.match(/^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^/?#]+)(?:\?|$)/)
        : null;
    if (!match) {
        throw new Error('MONGODB_URI must explicitly include the application database name.');
    }
    let databaseName;
    try {
        databaseName = decodeURIComponent(match[1]);
    } catch {
        throw new Error('MONGODB_URI contains an invalid database name.');
    }
    if (!databaseName.trim()) {
        throw new Error('MONGODB_URI must explicitly include the application database name.');
    }
    if (databaseName.trim().toLowerCase() === 'test') {
        throw new Error('The test database is not allowed. Use the configured application database.');
    }
    return databaseName;
}

module.exports = { applicationDatabaseName };
