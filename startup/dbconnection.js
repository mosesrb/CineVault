const mongoose = require('mongoose');
const config = require('config');
const winston = require('winston');

function describeMongoTarget(mongoURI) {
    try {
        const parsed = new URL(mongoURI);
        const database = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
        return `${parsed.protocol}//${parsed.host}${database}`;
    } catch (_) {
        return '[configured MongoDB target]';
    }
}

async function connectDatabase() {
    // Support both new 'mongoURI' key and old 'host.domain' for back-compat
    let mongoURI;
    try {
        mongoURI = config.get('mongoURI');
    } catch (_) {
        mongoURI = config.get('host.domain');
    }

    mongoose.set('strictQuery', false);
    if (mongoose.connection.readyState === 0) {
        try {
            await mongoose.connect(mongoURI);
            winston.info(`Build: ${config.get('name')}`);
            winston.info(`MongoDB connected → ${describeMongoTarget(mongoURI)}`);
        } catch (error) {
            winston.error(`MongoDB connection failed for ${describeMongoTarget(mongoURI)}: ${error.name || 'connection error'}`);
            throw error;
        }
    }
    return mongoose.connection;
}

async function disconnectDatabase() {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

module.exports = connectDatabase;
module.exports.connectDatabase = connectDatabase;
module.exports.disconnectDatabase = disconnectDatabase;
module.exports.describeMongoTarget = describeMongoTarget;
