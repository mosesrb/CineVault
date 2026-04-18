// Copyright (c) 2026 mosesrb (Moses Bharshankar). Licensed under GNU GPL-v3.
const Joi = require('joi'); 
Joi.objectId = require('joi-objectid')(Joi) //this package is used in more validation function.
const winston = require('winston');
const express = require('express');
const app = express();

require('./startup/logging')(); // all the error handling and logging.
require('./startup/routes')(app); // handles api routes
require('./startup/dbconnection')(); // db conections
require('./startup/config')();
require('./startup/validation')();
//throw new Error('Something went Wrong');

// set the port
/* 
    for powershell
    $env:NODE_ENV="production"
    $env:PORT=4000 
    for CMD
    set NODE_ENV=production 
*/

const port = process.env.PORT || 3000; // get env variable or set it default 3000
const server = app.listen(port, () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let networkIp = 'localhost';
    
    for (const devName in interfaces) {
        for (const iface of interfaces[devName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                networkIp = iface.address;
            }
        }
    }

    winston.info(`CineVault Server is running!`);
    winston.info(`  > Local:   http://localhost:${port}`);
    winston.info(`  > Network: http://${networkIp}:${port}`);
});

module.exports = server;