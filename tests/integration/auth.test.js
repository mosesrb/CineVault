const request = require('supertest');
const { User } = require('../../models/user');
let app;

describe('/api/v1/auth', () => {
    beforeEach(async () => { 
        app = require('../../index'); 
        await User.deleteMany({});
    });
    afterEach(async () => {
        await User.deleteMany({});
    });

    describe('POST /', () => {
        it('should return 400 if invalid email or password is provided', async () => {
            const res = await request(app)
                .post('/api/v1/auth')
                .send({ email: 'invalid', password: '123' });

            expect(res.status).toBe(400);
        });

        it('should return 401 if user does not exist', async () => {
            const res = await request(app)
                .post('/api/v1/auth')
                .send({ email: 'test@example.com', password: 'password123' });

            expect(res.status).toBe(401);
        });
    });
});
