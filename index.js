// Copyright (c) 2026 mosesrb (Moses Bharshankar). Licensed under GNU GPL-v3.
if (process.env.NODE_ENV !== 'test') require('./startup/environment')();

const os = require('os');
const http = require('node:http');
const https = require('node:https');
const { readFile } = require('node:fs/promises');
const winston = require('winston');
const { createApp } = require('./app');
const { connectDatabase, disconnectDatabase } = require('./startup/dbconnection');
const { initRedis, closeRedis } = require('./middleware/cache');
const { ensureServerIdentity } = require('./services/serverIdentityService');
const { initializeControlPlane, stopControlPlane } = require('./services/controlPlaneService');
const { cloudExchangeHttpsOrigin } = require('./services/cloudIdentityLink');

let server = null;
let httpsServer = null;
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

function listen(listener, port, host) {
    return new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(port, host, () => {
            listener.removeListener('error', reject);
            resolve(listener);
        });
    });
}

function close(listener) {
    if (!listener?.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
        listener.close(error => error ? reject(error) : resolve());
    });
}

async function startServer() {
    if (server) return server;

    const app = createApp();
    try {
        const port = process.env.PORT || 3000;
        const loopbackPilot = process.env.CV_AUTH_EXCHANGE_ENABLED === 'true';
        const httpsRequested = loopbackPilot && Boolean(process.env.CV_AUTH_EXCHANGE_HTTPS_ORIGIN);
        await connectDatabase();
        await ensureServerIdentity();
        await initRedis();
        await initializeControlPlane();

        const host = loopbackPilot && !httpsRequested ? '127.0.0.1' : undefined;
        server = await listen(http.createServer(app), port, host);
        if (httpsRequested) {
            try {
                const httpsOrigin = cloudExchangeHttpsOrigin();
                if (!httpsOrigin) throw Error('Invalid cloud sign-in HTTPS origin');
                const httpsPort = Number(httpsOrigin.port || 443);
                if (Number(port) === httpsPort) throw Error('Conflicting listener ports');
                const [cert, key] = await Promise.all([
                    readFile(process.env.CV_AUTH_EXCHANGE_TLS_CERT_FILE),
                    readFile(process.env.CV_AUTH_EXCHANGE_TLS_KEY_FILE)
                ]);
                httpsServer = await listen(https.createServer({ cert, key, minVersion: 'TLSv1.2' }, app), httpsPort);
                app.locals.cloudHttpsListening = true;
                winston.info(`  > Cloud sign-in HTTPS: ${httpsOrigin.origin}`);
            } catch {
                winston.error('Cloud sign-in HTTPS did not start. Check the configured origin, certificate, key, and port.');
            }
        }
    } catch (error) {
        // Identity validation must not leave a failed startup holding dependencies.
        await Promise.allSettled([close(server), close(httpsServer), stopControlPlane(), closeRedis(), disconnectDatabase()]);
        server = null;
        httpsServer = null;
        throw error;
    }

    const { address, port: boundPort } = server.address();
    winston.info('CineVault Server is running!');
    winston.info(`  > Local:   http://localhost:${boundPort}`);
    if (address !== '127.0.0.1') {
        winston.info(`  > Network: http://${networkAddress()}:${boundPort}`);
    }
    return server;
}

async function stopServer(reason = 'shutdown') {
    if (stopping) return stopping;
    stopping = (async () => {
        winston.info(`CineVault stopping: ${reason}.`);
        const listener = server;
        const tlsListener = httpsServer;
        server = null;
        httpsServer = null;
        try {
            await Promise.all([close(listener), close(tlsListener)]);
        } finally {
            await Promise.allSettled([stopControlPlane(), closeRedis(), disconnectDatabase()]);
        }
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
