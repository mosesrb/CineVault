const http = require('http');
const net = require('net');
const { once } = require('events');
const { createTunnelBridge } = require('../scripts/localtunnel_bridge');

describe('lazy loopback tunnel bridge', () => {
    let server;
    let bridge;
    const clients = [];

    async function start() {
        server = http.createServer({ headersTimeout: 100, requestTimeout: 300, connectionsCheckingInterval: 25 }, (req, res) => {
            res.writeHead(req.url === '/protected' ? 401 : 200);
            res.end(req.url === '/protected' ? 'denied' : 'ready');
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        bridge = await createTunnelBridge({ targetPort: server.address().port, port: 0, idleTimeout: 1000 });
        const socket = net.connect(bridge.port, '127.0.0.1');
        clients.push(socket);
        await once(socket, 'connect');
        return socket;
    }

    afterEach(async () => {
        for (const client of clients.splice(0)) client.destroy();
        if (bridge) await bridge.close();
        bridge = null;
        if (server) {
            server.closeAllConnections?.();
            await new Promise(resolve => server.close(resolve));
        }
        server = null;
    });

    it('does not connect idle tunnel sockets to HTTP, and serves a later request', async () => {
        const client = await start();
        const connection = jest.fn();
        server.on('connection', connection);
        let response = '';
        client.on('data', chunk => { response += chunk; });
        // Beyond upstream headersTimeout: a direct pre-opened socket gets 408.
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(connection).not.toHaveBeenCalled();
        expect(response).toBe('');
        const end = once(client, 'end');
        client.write('GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
        await end;
        expect(connection).toHaveBeenCalledTimes(1);
        expect(response).toContain('HTTP/1.1 200');
        expect(response).toContain('ready');
    });

    it('preserves authorization failures rather than treating them as healthy content', async () => {
        await start();
        const response = await new Promise((resolve, reject) => {
            http.get({ hostname: '127.0.0.1', port: bridge.port, path: '/protected' }, res => {
                res.resume();
                res.on('end', () => resolve(res.statusCode));
            }).on('error', reject);
        });
        expect(response).toBe(401);
    });

    it('retains the upstream timeout for a partial HTTP request', async () => {
        const client = await start();
        let response = '';
        client.on('data', chunk => { response += chunk; });
        const end = once(client, 'end');
        client.write('GET /health HTTP/1.1\r\nHost:');
        await end;
        expect(response).toContain('HTTP/1.1 408');
    });

    it('flushes a complete streaming body before closing a slow reader', async () => {
        await start();
        const body = Buffer.alloc(512 * 1024, 'q');
        server.removeAllListeners('request');
        server.on('request', (_, res) => {
            res.writeHead(206, { 'Content-Length': body.length, 'Content-Range': `bytes 0-${body.length - 1}/${body.length}` });
            res.end(body);
        });
        const result = await new Promise((resolve, reject) => {
            http.get({ hostname: '127.0.0.1', port: bridge.port, agent: false }, res => {
                const chunks = [];
                res.pause();
                setTimeout(() => res.resume(), 30);
                res.on('data', chunk => chunks.push(chunk));
                res.on('error', reject);
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
            }).on('error', reject);
        });
        expect(result.status).toBe(206);
        expect(result.body).toEqual(body);
    });

    it('closes unused idle sockets silently and shuts down all open sockets', async () => {
        server = net.createServer();
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        bridge = await createTunnelBridge({ targetPort: server.address().port, port: 0, idleTimeout: 30 });
        const client = net.connect(bridge.port, '127.0.0.1');
        clients.push(client);
        let response = '';
        client.on('data', chunk => { response += chunk; });
        await once(client, 'end');
        expect(response).toBe('');
    });
});
