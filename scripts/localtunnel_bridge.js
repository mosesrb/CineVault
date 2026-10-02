const net = require('net');

/**
 * LocalTunnel pre-opens HTTP connections before a visitor sends any bytes.
 * Delay the upstream connection so Node cannot send an unsolicited idle 408
 * into the tunnel pool. HTTP parsing, authentication and timeouts stay upstream.
 * This test adapter binds loopback only; it is not an endpoint supervisor.
 */
async function createTunnelBridge({ targetPort = 3000, port = 3002, idleTimeout = 60000 } = {}) {
    const sockets = new Set();
    const server = net.createServer(client => {
        sockets.add(client);
        let upstream;
        const idleTimer = setTimeout(() => {
            client.end();
            client.destroySoon();
        }, idleTimeout);
        idleTimer.unref();

        client.once('data', firstChunk => {
            clearTimeout(idleTimer);
            client.pause();
            upstream = net.connect({ host: '127.0.0.1', port: targetPort });
            sockets.add(upstream);
            upstream.once('connect', () => {
                if (client.destroyed) return upstream.destroy();
                upstream.write(firstChunk);
                client.pipe(upstream);
                upstream.pipe(client);
                client.resume();
            });
            upstream.on('error', () => client.destroy());
            upstream.once('close', hadError => {
                sockets.delete(upstream);
                // A clean EOF is piped to client.end(); let queued media flush.
                if (hadError || !upstream.readableEnded) client.destroy();
            });
        });

        client.on('error', () => upstream?.destroy());
        client.once('close', () => {
            clearTimeout(idleTimer);
            sockets.delete(client);
            upstream?.destroy();
        });
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    return {
        port: server.address().port,
        close: () => new Promise((resolve, reject) => {
            for (const socket of sockets) socket.destroy();
            server.close(error => error ? reject(error) : resolve());
        })
    };
}

if (require.main === module) {
    createTunnelBridge().then(bridge => {
        console.log(`CineVault tunnel bridge: 127.0.0.1:${bridge.port} -> 127.0.0.1:3000`);
        console.log(`In another terminal: npx --yes localtunnel@2.0.2 --port ${bridge.port} --local-host 127.0.0.1`);
        for (const signal of ['SIGINT', 'SIGTERM']) {
            process.once(signal, () => bridge.close().then(() => process.exit(0)));
        }
    }).catch(error => {
        console.error(`Tunnel bridge failed: ${error.code || error.name}`);
        process.exitCode = 1;
    });
}

module.exports = { createTunnelBridge };
