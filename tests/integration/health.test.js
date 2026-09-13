const request = require('supertest');
const { createApp } = require('../../app');

describe('runtime health endpoints', () => {
    let app;

    beforeAll(() => {
        app = createApp();
    });

    it('reports process liveness without exposing configuration', async () => {
        const response = await request(app).get('/health/live');
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('live');
        expect(response.body.version).toBeDefined();
        expect(response.body).not.toHaveProperty('environment');
    });

    it('reports dependency readiness', async () => {
        const response = await request(app).get('/health/ready');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({
            status: 'ready',
            dependencies: expect.objectContaining({ database: 'ready' })
        }));
    });
});
