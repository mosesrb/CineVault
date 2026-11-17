const mongoose=require('mongoose');
const request=require('supertest');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const cloud=require('../../services/controlPlaneService');
const diagnostics=require('../../services/serverSetupDiagnostics');
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
        jest.spyOn(cloud,'restore').mockResolvedValue({alreadyEnrolled:false});
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
    it('restricts diagnostic probes to administrators and sanitizes failures', async () => {
        const probe = jest.spyOn(diagnostics, 'readDiagnostics').mockResolvedValue({ checkedAt: 123, server: { status: 'ready' } });
        const route = url + '/diagnostics';
        expect((await request(app).get(route)).status).toBe(401);
        await User.updateOne({ _id: user._id }, { $set: { isAdmin: false } });
        expect((await request(app).get(route).set('x-auth-token', token)).status).toBe(403);
        expect(probe).not.toHaveBeenCalled();
        await User.updateOne({ _id: user._id }, { $set: { isAdmin: true } });
        const result = await request(app).get(route).set('x-auth-token', token);
        expect(result.status).toBe(200);
        expect(result.headers['cache-control']).toBe('no-store');
        expect(result.body).toEqual({ checkedAt: 123, server: { status: 'ready', port: expect.any(Number) } });
        expect(probe).toHaveBeenCalledWith(false);
        expect(cloud.retry).not.toHaveBeenCalled();
        probe.mockRejectedValueOnce(Error('private credential details'));
        const denied = await request(app).get(route).set('x-auth-token', token);
        expect(denied.status).toBe(503);
        expect(denied.text).not.toContain('private credential details');
    });
    it('reports independent Auth, DNS and TLS outcomes without disclosing provider credentials', async () => {
        const original = { enabled: process.env.CV_AUTH_EXCHANGE_ENABLED, origin: process.env.CV_AUTH_EXCHANGE_HTTPS_ORIGIN };
        process.env.CV_AUTH_EXCHANGE_ENABLED = 'true';
        process.env.CV_AUTH_EXCHANGE_HTTPS_ORIGIN = 'https://192.0.2.42:8443';
        const fetchAuth = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', {
            status: 503, headers: { 'content-type': 'application/json' }
        }));
        const tlsProbe = jest.spyOn(https, 'request').mockImplementation(() => {
            const probe = new EventEmitter();
            probe.end = () => queueMicrotask(() => probe.emit('error', { code: 'CERT_HAS_EXPIRED' }));
            return probe;
        });
        try {
            const result = await diagnostics.readDiagnostics(true);
            expect(result.server.dependencies.database).toBe('ready');
            expect(result.supabase).toMatchObject({ status: 'unavailable', lastHeartbeatAt: null });
            expect(result.network).toEqual({ origin: 'https://192.0.2.42:8443', dnsStatus: 'address_mismatch',
                tls: { status: 'expired', expiresAt: null }, otherDevice: 'not_tested' });
            expect(fetchAuth).toHaveBeenCalledWith(`https://${PROJECT_REF}.supabase.co/auth/v1/health`,
                expect.objectContaining({ redirect: 'error' }));
            expect(tlsProbe).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 8443 }), expect.any(Function));
            expect(JSON.stringify(result)).not.toContain(process.env.CV_CONTROL_PLANE_PUBLISHABLE_KEY);
        } finally {
            for (const [key, value] of Object.entries({ CV_AUTH_EXCHANGE_ENABLED: original.enabled, CV_AUTH_EXCHANGE_HTTPS_ORIGIN: original.origin })) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
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
    it('disaster restore requires exact body and current same-origin CSRF/admin session',async()=>{
        const body={confirmedInstanceId:'11111111-1111-4111-8111-111111111111',cloudServerId:'22222222-2222-4222-8222-222222222222'};
        const issued=(await post('/csrf')).body.csrfToken;
        expect((await post('/restore',issued)).status).toBe(403);
        const send=()=>request(app).post(url+'/restore').set(headers).set('x-auth-token',token).set('x-cinevault-csrf',issued).send(body);
        expect((await send()).status).toBe(200);expect(cloud.restore).toHaveBeenCalledWith(body);
        await Session.deleteMany({userId:user._id});expect((await send()).status).toBe(401);
    });
});
