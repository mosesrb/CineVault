
const request = require('supertest');
const { Genres } = require('../../models/genre');
const { Users } = require('../../models/user');

let server;

describe('/api/genres', () => {
    beforeEach( () => { server = require('../../index'); }) 

    afterEach( async () => {
        server.close();
        await Genres.remove();
    });

    describe('GET /', () => {
     
        it('should return all genres', async () => {
            await Genres.collection.insertMany([
                { name: 'genre1' },
                { name: 'genre2' },
            ]);
            const response = await request(server).get('/api/genres');
            expect(response.status).toBe(200);
            expect(response.body.length).toBe(2);
            expect(response.body.some(u => u.name === 'genre1')).toBeTruthy();
            expect(response.body.some(u => u.name === 'genre2')).toBeTruthy();
        });
    });

//     describe('GET /:id', () =>{
//         it('should return a genre if a valid Id is passed', async() => {

//             const response = await request(server).get('/api/genres/1');
//             expect(response.status).toBe(404);
            
//         });
//     });


//     describe('POST /', () => {
//         it('should return 401 if client is not logged in', async() => {
//             const response = await request(server)
//             .post('/api/genres')
//             .send({ name: 'genre1'});
//             expect(response.status).toBe(401);
//         })
//     });

    
//    /*  describe('POST /', () => {
//         it('should return 403 if admin resource is accessed without being logged in', async() => {
//             const response = await request(server)
//             .post('/api/genres')
//             .send({name: 'genre1'});
//             expect(response.status).toBe(403);
//         })
//     }); */

//     describe('POST /', () => {
//         it('should return 400 if genre is is less then 5 character.', async() => {

//             const token = new Users().generateAuthToken()
//             const response = await request(server)
//             .post('/api/genres')
//             .set('x-auth-token', token)
//             .send({ name: '1234'});
//             expect(response.status).toBe(400);
//         })
//     });

//     describe('POST /', () => {
//         it('should return 400 if genre is is more then 50 character.', async() => {
//             const name = new Array(257).join('a');
//             const token = new Users().generateAuthToken()
//             const response = await request(server)
//             .post('/api/genres')
//             .set('x-auth-token', token)
//             .send({ name: name});
//             expect(response.status).toBe(400);
//         })
//     });
});
