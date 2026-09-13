const { connectDatabase, disconnectDatabase } = require('../startup/dbconnection');

beforeAll(async () => {
    require('../startup/logging')();
    await connectDatabase();
});

afterAll(async () => {
    await disconnectDatabase();
});
