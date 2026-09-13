const mongoose = require('mongoose');
require('../startup/environment')();

async function createUser(database, user, password, roles) {
    try {
        await database.command({ createUser: user, pwd: password, roles });
    } catch (error) {
        if (error.codeName !== 'DuplicateKey' && error.code !== 51003) throw error;
    }
}

async function run() {
    const rootUser = process.env.MONGO_ROOT_USERNAME;
    const rootPassword = process.env.MONGO_ROOT_PASSWORD;
    const appUser = process.env.MONGO_USERNAME;
    const appPassword = process.env.MONGO_PASSWORD;
    if (![rootUser, rootPassword, appUser, appPassword].every(Boolean)) {
        throw new Error('MongoDB user credentials are incomplete.');
    }

    await mongoose.connect('mongodb://127.0.0.1:27018/admin');
    await createUser(mongoose.connection.client.db('admin'), rootUser, rootPassword, [
        { role: 'root', db: 'admin' }
    ]);
    await createUser(mongoose.connection.client.db('cinevault'), appUser, appPassword, [
        { role: 'readWrite', db: 'cinevault' }
    ]);
    console.log('MongoDB root and least-privilege application users created; no credentials were printed.');
}

run()
    .catch(error => {
        console.error(`MongoDB user creation failed: ${error.name || 'error'}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
