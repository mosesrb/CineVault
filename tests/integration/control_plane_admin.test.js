const mongoose=require('mongoose');
const request=require('supertest');
const cloud=require('../../services/controlPlaneService');
const {createApp}=require('../../app');
const {User}=require('../../models/user');
const {Session}=require('../../models/session');
const {PROJECT_REF}=require('../../services/controlPlane/protocol');
describe('control-plane local administrator boundary',()=>{
    let app,user,token,saved;
    const url='/api/v1/admin/control-plane';
    const headers={'Host':'localhost:3000','Origin':'http://localhost:3000','Sec-Fetch-Site':'same-origin','Content-Type':'application/json'};
    const post=(path,csrf)=>{
        let r=request(app).post(url+path).set(headers).set('x-auth-token',token);
        if(csrf)r=r.set('x-cinevault-csrf',csrf);
        return r.send({});
    };
    beforeAll(()=>{
        if(mongoose.connection.name!=='cinevault_test')throw Error('Isolated test database required');
        app=createApp();saved={};
        const values={CV_CONTROL_PLANE_ENABLED:'true',CV_CONTROL_PLANE_PROJECT_REF:PROJECT_REF,
            CV_CONTROL_PLANE_PROJECT_URL:`https://${PROJECT_REF}.supabase.co`,CV_CONTROL_PLANE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(32),
            CV_CONTROL_PLANE_ADMIN_ORIGIN:'http://localhost:3000'};
        for(const [key,value] of Object.entries(values)){saved[key]=process.env[key];process.env[key]=value;}
    });
    beforeEach(async()=>{
        user=await User.create({name:'Cloud QA',email:'cloud-qa@example.test',password:'synthetic-password',isAdmin:true,isApproved:true});
        token=user.generateAuthToken();await Session.create({userId:user._id,token});
        jest.spyOn(cloud,'prepare').mockResolvedValue({alreadyEnrolled:true});
        jest.spyOn(cloud,'redeem').mockResolvedValue({enrolled:true});
        jest.spyOn(cloud,'retry').mockResolvedValue(undefined);
        jest.spyOn(cloud,'recover').mockResolvedValue({alreadyEnrolled:false});
    });
    afterEach(async()=>{jest.restoreAllMocks();await Session.deleteMany({userId:user._id});await User.deleteOne({_id:user._id});});
    afterAll(()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
    it('protects status and setup against anonymous, ordinary users and revoked sessions',async()=>{
        expect((await request(app).get(url)).status).toBe(401);
        await User.updateOne({_id:user._id},{$set:{isAdmin:false}});expect((await post('/csrf')).status).toBe(403);
        await User.updateOne({_id:user._id},{$set:{isAdmin:true}});await Session.deleteMany({userId:user._id});
        expect((await post('/csrf')).status).toBe(401);expect(cloud.prepare).not.toHaveBeenCalled();
    });
    it('returns safe live no-store status without credential material',async()=>{
        const r=await request(app).get(url).set('x-auth-token',token);
        expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(Object.keys(r.body).sort()).toEqual(['enabled','guidance','mode']);
    });
    it.each(['prepare','redeem','retry','recover'])('requires current session-bound CSRF for %s',async operation=>{
        expect((await post('/'+operation)).status).toBe(403);
        const issued=await post('/csrf');expect(issued.status).toBe(200);
        expect((await post('/'+operation,issued.body.csrfToken)).status).toBe(200);expect(cloud[operation]).toHaveBeenCalledTimes(1);
    });
    it.each([['Origin','https://other.example'],['Host','other.example'],['Sec-Fetch-Site','cross-site'],['Content-Type','text/plain']])('rejects altered %s on token issuance',async(key,value)=>{
            const r=await request(app).post(url+'/csrf').set({...headers,[key]:value}).set('x-auth-token',token).send('{}');
            expect(r.status).toBe(403);
        });
    it('does not treat cross-origin, expired/tampered or another session token as CSRF authority',async()=>{
        const issued=(await post('/csrf')).body.csrfToken;
        expect((await post('/prepare',issued.slice(0,-1)+'x')).status).toBe(403);
        expect((await request(app).post(url+'/prepare').set({...headers,Origin:'https://other.example'})
            .set('x-auth-token',token).set('x-cinevault-csrf',issued).send({})).status).toBe(403);
        await Session.deleteMany({userId:user._id});expect((await post('/prepare',issued)).status).toBe(401);
        expect(cloud.prepare).not.toHaveBeenCalled();
    });
    it('rechecks current administrator approval/ban before an authorized setup action',async()=>{
        const issued=(await post('/csrf')).body.csrfToken;
        await User.updateOne({_id:user._id},{$set:{isBanned:true}});
        expect((await post('/prepare',issued)).status).toBe(403);expect(cloud.prepare).not.toHaveBeenCalled();
    });
    it('rejects unexpected body fields and sanitizes downstream errors',async()=>{
        const issued=(await post('/csrf')).body.csrfToken;
        expect((await request(app).post(url+'/prepare').set(headers).set('x-auth-token',token)
            .set('x-cinevault-csrf',issued).send({ownerId:'spoofed'})).status).toBe(403);
        cloud.prepare.mockRejectedValue(Error('private secret details'));
        const r=await post('/prepare',issued);expect(r.status).toBe(503);expect(r.text).not.toContain('private secret');
    });
    it('activity hook excludes cloud administration, anonymous and unsuccessful requests',async()=>{
        const spy=jest.spyOn(cloud,'noteActivity').mockImplementation(()=>{});
        await request(app).get(url).set('x-auth-token',token);await request(app).get('/health/live');
        await request(app).get('/api/v1/users/me');expect(spy).not.toHaveBeenCalled();
        await request(app).get('/api/v1/users/me').set('x-auth-token',token);expect(spy).toHaveBeenCalledWith('authenticated-request');
    });
});
