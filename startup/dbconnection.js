const mongoose = require('mongoose');
const config = require('config');
const winston = require('winston');

module.exports = function () {
    // Support both new 'mongoURI' key and old 'host.domain' for back-compat
    let mongoURI;
    try {
        mongoURI = config.get('mongoURI');
    } catch (_) {
        mongoURI = config.get('host.domain');
    }

    mongoose.set('strictQuery', false);
    mongoose.connect(mongoURI)
        .then(function () {
            winston.info(`Build: ${config.get('name')}`);
            winston.info(`MongoDB connected → ${mongoURI}`);
        })
        .catch(function (err) {
            winston.error('MongoDB connection error:', err.message);
            process.exit(1);
        });
};