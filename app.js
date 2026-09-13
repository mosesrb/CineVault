const Joi = require('joi');
const express = require('express');

Joi.objectId = Joi.objectId || require('joi-objectid')(Joi);
let initialized = false;

function createApp() {
    const app = express();

    // Security-critical configuration is validated before routes or external
    // dependencies are initialized.
    if (!initialized) {
        require('./startup/config')();
        require('./startup/logging')();
        initialized = true;
    }
    require('./startup/routes')(app);

    return app;
}

module.exports = { createApp };
