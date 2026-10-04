const mongoose = require('mongoose');
const request = require('supertest');
const { spawnSync } = require('node:child_process');
const { createApp } = require('../../app');
const { ServerIdentity } = require('../../models/serverIdentity');
const { ensureServerIdentity, readServerIdentity } = require('../../services/serverIdentityService');

describe('persistent server identity', () => {
    let app;
    beforeAll(() => {
        if (mongoose.connection.name !== 'cinevault_test') throw Error('Identity tests require isolated cinevault_test');
        app = createApp();
    });
    beforeEach(async () => { await ServerIdentity.deleteMany({}); });
    afterAll(async () => { await ServerIdentity.deleteMany({}); });

    it('initializes one UUID and preserves it through repeated and competing starts', async () => {
        const values = await Promise.all(Array.from({ length: 12 }, () => ensureServerIdentity()));
        expect(new Set(values.map(v => v.serverId)).size).toBe(1);
        expect(await ServerIdentity.countDocuments()).toBe(1);
        expect(await readServerIdentity()).toEqual(values[0]);
    });

    it('keeps the same persisted identity across a separate Node process', async () => {
        const first = await ensureServerIdentity();
        const result = spawnSync(process.execPath, ['-e', `
            const {connectDatabase,disconnectDatabase}=require('./startup/dbconnection');
            const {ensureServerIdentity}=require('./services/serverIdentityService');
            (async()=>{try{await connectDatabase();const v=await ensureServerIdentity();
            console.log('IDENTITY_RESULT:'+JSON.stringify(v));}catch{process.exitCode=1;}
            finally{await disconnectDatabase();}})();
        `], { cwd: require('node:path').resolve(__dirname, '../..'), env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 20000 });
        expect(result.status).toBe(0);
        const match = result.stdout.match(/IDENTITY_RESULT:(.+)/);
        expect(match).not.toBeNull();
        expect(JSON.parse(match[1])).toEqual(first);
    });

    it('does not initialize metadata in a public request', async () => {
        const response = await request(app).get('/api/v1/identity');
        expect(response.status).toBe(503);
        expect(response.body).toEqual({ error: 'Server identity unavailable.' });
        expect(await ServerIdentity.countDocuments()).toBe(0);
    });

    it('read-only migration does not implicitly create an absent collection', async () => {
        const collections = await mongoose.connection.db.listCollections({ name: 'server_identity' }).toArray();
        if (collections.length) await mongoose.connection.db.dropCollection('server_identity');
        const result = spawnSync(process.execPath, ['scripts/migrations/003_initialize_server_identity.js'], {
            cwd: require('node:path').resolve(__dirname, '../..'), env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 20000
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('no changes made');
        expect(await mongoose.connection.db.listCollections({ name: 'server_identity' }).toArray()).toHaveLength(0);
    });

    it.each(['/api/v1/identity', '/api/identity'])('exposes only public identity at %s without session credentials', async path => {
        const identity = await ensureServerIdentity();
        const response = await request(app).get(path);
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).toEqual(identity);
        expect(Object.keys(response.body).sort()).toEqual(['schemaVersion', 'serverId']);
    });

    it('never replaces a malformed existing identity', async () => {
        await ServerIdentity.collection.insertOne({ _id: 'primary', serverId: 'invalid', schemaVersion: 1, createdAt: new Date() });
        await expect(ensureServerIdentity()).rejects.toThrow('Server identity unavailable.');
        expect((await ServerIdentity.collection.findOne({ _id: 'primary' })).serverId).toBe('invalid');
    });

    it('fails closed on unknown installation version', async () => {
        await ensureServerIdentity();
        await ServerIdentity.collection.updateOne({ _id: 'primary' }, { $set: { schemaVersion: 2 } });
        await expect(readServerIdentity()).rejects.toThrow('Server identity unavailable.');
        expect((await request(app).get('/api/v1/identity')).status).toBe(503);
    });

    it('does not accept client identity replacement', async () => {
        const identity = await ensureServerIdentity();
        expect((await request(app).post('/api/v1/identity').send({ serverId: 'attacker' })).status).toBe(404);
        expect((await request(app).patch('/api/v1/identity').send({ schemaVersion: 2 })).status).toBe(404);
        expect(await readServerIdentity()).toEqual(identity);
    });

    it('sanitizes datastore failures without exposing raw messages', async () => {
        const spy = jest.spyOn(ServerIdentity, 'findById').mockImplementation(() => { throw Error('private credential or database details'); });
        try {
            const response = await request(app).get('/api/v1/identity');
            expect(response.status).toBe(503);
            expect(response.body).toEqual({ error: 'Server identity unavailable.' });
        } finally { spy.mockRestore(); }
    });

    it('closes startup dependencies if persisted identity is invalid, without rotating it', async () => {
        const { startServer } = require('../../index');
        const { connectDatabase } = require('../../startup/dbconnection');
        await ServerIdentity.collection.insertOne({ _id: 'primary', serverId: 'invalid', schemaVersion: 1, createdAt: new Date() });
        const oldPort = process.env.PORT;
        process.env.PORT = '0';
        try {
            await expect(startServer()).rejects.toThrow('Server identity unavailable.');
            expect(mongoose.connection.readyState).toBe(0);
        } finally {
            if (oldPort === undefined) delete process.env.PORT;
            else process.env.PORT = oldPort;
            await connectDatabase();
        }
        expect((await ServerIdentity.collection.findOne({ _id: 'primary' })).serverId).toBe('invalid');
    });
});
