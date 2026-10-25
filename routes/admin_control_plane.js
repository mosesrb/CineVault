'use strict';
const express = require('express');
const crypto = require('node:crypto');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const cloud = require('../services/controlPlaneService');
const { configuration } = require('../services/controlPlane/configuration');
const { exact, HEX, matches } = require('../services/controlPlane/protocol');
const router = express.Router();
const csrfKey = crypto.randomBytes(32);
const CSRF_TTL = 120000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const sign = value => crypto.createHmac('sha256',csrfKey).update(value).digest('hex');
function tokenBinding(req) {
    const token = req.get('x-auth-token') || req.get('authorization')?.replace(/^Bearer /,'');
    if(typeof token!=='string' || req.auth?.kind!=='access-token')throw Error();
    return digest(token);
}
function packet(req) {
    const settings = configuration();
    if(settings.mode!=='ready' || req.get('origin')!==settings.adminOrigin ||
        req.get('host')!==new URL(settings.adminOrigin).host || req.get('sec-fetch-site')!=='same-origin' ||
        req.get('content-type')!=='application/json')throw Error();
    return tokenBinding(req);
}
function validateCsrf(req) {
    const binding=packet(req), value=req.get('x-cinevault-csrf');
    if(typeof value!=='string' || value.length>1024)throw Error();
    const parts=value.split('.');
    if(parts.length!==2 || !matches(HEX,parts[1]) ||
        !crypto.timingSafeEqual(Buffer.from(parts[1],'hex'),Buffer.from(sign(parts[0]),'hex')))throw Error();
    const body=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    exact(body,['binding','nonce','issuedAt']);
    if(body.binding!==binding || !matches(HEX,body.nonce) || !Number.isSafeInteger(body.issuedAt) ||
        body.issuedAt>Date.now() || Date.now()>=body.issuedAt+CSRF_TTL)throw Error();
}
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use(auth,admin);
router.get('/',(req,res)=>res.json(cloud.controlPlaneStatus()));
router.post('/csrf',(req,res)=>{
    try {
        exact(req.body,[]);
        const body=Buffer.from(JSON.stringify({binding:packet(req),nonce:crypto.randomBytes(32).toString('hex'),issuedAt:Date.now()})).toString('base64url');
        res.json({csrfToken:body+'.'+sign(body)});
    } catch {res.status(403).json({error:'Cloud administration requires the configured same-origin PC browser.'});}
});
for(const operation of ['prepare','redeem','retry','recover'])router.post('/'+operation,async(req,res)=>{
    try {exact(req.body,[]);validateCsrf(req);}catch{return res.status(403).json({error:'Cloud administration denied.'});}
    try {const result=await cloud[operation]();res.json(result || cloud.controlPlaneStatus());}
    catch {res.status(503).json({error:'Control plane unavailable; check cloud status for owner recovery guidance.'});}
});
router.post('/restore',async(req,res)=>{
    try {exact(req.body,['confirmedInstanceId','cloudServerId']);validateCsrf(req);}catch{return res.status(403).json({error:'Cloud administration denied.'});}
    try {res.json(await cloud.restore(req.body));}
    catch {res.status(503).json({error:'Restore unavailable. Preserve protected state and verify both server identifiers with the owner.'});}
});
module.exports=router;
