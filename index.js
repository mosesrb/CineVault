// Copyright (c) 2026 mosesrb (Moses Bharshankar). Licensed under GNU GPL-v3.
if (process.env.NODE_ENV !== 'test') require('./startup/environment')();

const os = require('os');
const winston = require('winston');
const { createApp } = require('./app');
const { connectDatabase, disconnectDatabase } = require('./startup/dbconnection');
const { initRedis, closeRedis } = require('./middleware/cache');

let server = null;
let stopping = null;

function networkAddress() {
    const interfaces = os.networkInterfaces();
    for (const devName of Object.keys(interfaces)) {
        for (const iface of interfaces[devName]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

async function startServer() {
    if (server) return server;

    const app = createApp();
    await connectDatabase();
    await initRedis();

    const port = process.env.PORT || 3000;
    server = await new Promise((resolve, reject) => {
        const listener = app.listen(port, () => resolve(listener));
        listener.once('error', reject);
    });

    const boundPort = server.address().port;
    winston.info('CineVault Server is running!');
    winston.info(`  > Local:   http://localhost:${boundPort}`);
    winston.info(`  > Network: http://${networkAddress()}:${boundPort}`);
    return server;
}

async function stopServer(reason = 'shutdown') {
    if (stopping) return stopping;
    stopping = (async () => {
        winston.info(`CineVault stopping: ${reason}.`);
        const listener = server;
        server = null;
        if (listener) {
            await new Promise((resolve, reject) => {
                listener.close(error => error ? reject(error) : resolve());
            });
        }
        await Promise.allSettled([closeRedis(), disconnectDatabase()]);
        winston.info('CineVault stopped.');
    })();
    try {
        await stopping;
    } finally {
        stopping = null;
    }
}

function installShutdownHandlers() {
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            stopServer(signal)
                .then(() => process.exit(0))
                .catch(error => {
                    winston.error(`Graceful shutdown failed: ${error.name || 'error'}`);
                    process.exit(1);
                });
        });
    }
}

if (require.main === module) {
    installShutdownHandlers();
    startServer().catch(error => {
        winston.error(`CineVault startup failed: ${error.name || 'error'}`);
        process.exitCode = 1;
    });
}

module.exports = { startServer, stopServer };
