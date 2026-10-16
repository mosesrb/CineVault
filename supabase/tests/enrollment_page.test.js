'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {initialState,pairingRequest,replacementRequest,PROJECT_REF}=require('../../services/controlPlane/protocol');
const modulePromise=import('../../enrollment/protocol.mjs');
const origin='https://cinevault-qa.pages.dev';
const config={projectRef:PROJECT_REF,projectUrl:`https://${PROJECT_REF}.supabase.co`,publishableKey:'sb_publishable_'+'a'.repeat(32),approvedOrigin:origin};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const owner=crypto.randomUUID();
const login=()=>({access_token:'synthetic-owner-access',refresh_token:'synthetic-owner-refresh',token_type:'bearer',expires_in:3600,
    user:{id:owner,is_anonymous:false,user_metadata:{role:'ADMIN'}}});
const challenge=()=>{const state=initialState(PROJECT_REF,crypto.randomUUID(),Date.now());return pairingRequest(state);};
test('owner page validates replacement context and dispatches distinct human-only approval',async()=>{
    const {createOwnerSession,validatePairing}=await modulePromise;
    const pair=initialState(PROJECT_REF,crypto.randomUUID(),Date.now()),previous={...pair,status:'active',mapping:{projectRef:PROJECT_REF,
        serverInstanceId:pair.serverInstanceId,credentialId:pair.credentialId,cloudServerId:crypto.randomUUID(),epoch:1,credentialExpiresAt:Date.now()+86400000},sequence:0,pending:null};
    const {request,approvalProof}=replacementRequest({version:2,status:'replacing',projectRef:PROJECT_REF,serverInstanceId:pair.serverInstanceId,previous,candidate:initialState(PROJECT_REF,pair.serverInstanceId,Date.now())});let body;
    const session=createOwnerSession({config,origin,fetchImpl:async(url,options)=>{if(url.includes('/token?'))return json(login());body=JSON.parse(options.body);return json({approved:true,pairId:request.pairId,expiresAt:request.expiresAt});}});
    for(const replacement of [{...request.replacement,epoch:1.5},{...request.replacement,cloudServerId:'invalid'},{...request.replacement,credentialId:request.credentialId}])
        await assert.rejects(validatePairing(JSON.stringify({...request,replacement}),approvalProof,request.serverInstanceId));
    await session.signIn('owner@example.test','synthetic-password');await session.approve(JSON.stringify(request),approvalProof,request.serverInstanceId);
    assert.equal(body.operation,'approve-replacement');assert.deepEqual(body.request.replacement,request.replacement);session.dispose();
});
test('unconfigured page, preview/foreign/http origins and secret keys deny before Auth',async()=>{
    const {configuration}=await modulePromise;
    for(const [value,url] of [[{...config,publishableKey:''},origin],[{...config,publishableKey:'sb_secret_'+'a'.repeat(32)},origin],
        [config,'https://preview.cinevault-qa.pages.dev'],[config,'http://cinevault-qa.pages.dev'],
        [{...config,projectUrl:'https://evil.example'},origin]])assert.throws(()=>configuration(value,url));
});
test('page checks shape, proof digest, confirmed UUID and expiry; broker must bind the full stored request',async()=>{
    const {validatePairing}=await modulePromise,{request,approvalProof}=challenge();
    assert.deepEqual(await validatePairing(JSON.stringify(request),approvalProof,request.serverInstanceId),request);
    // A proof digest alone cannot authenticate request fields. Hosted approval must
    // compare every field with the stored pairing and verify its full binding.
    const changed={...request,credentialId:crypto.randomUUID(),secretDigest:'a'.repeat(64)};
    assert.deepEqual(await validatePairing(JSON.stringify(changed),approvalProof,request.serverInstanceId),changed);
    for(const [r,proof,id,now] of [[{...request,credentialId:'invalid'},approvalProof,request.serverInstanceId,Date.now()],
        [{...request,ownerId:owner},approvalProof,request.serverInstanceId,Date.now()],
        [request,'0'.repeat(64),request.serverInstanceId,Date.now()],
        [request,approvalProof,crypto.randomUUID(),Date.now()],
        [request,approvalProof,request.serverInstanceId,request.expiresAt]])
        await assert.rejects(validatePairing(JSON.stringify(r),proof,id,now));
});
test('password sign-in and approval use only fixed provider with tokens in headers, never PC or URLs',async()=>{
    const {createOwnerSession}=await modulePromise,{request,approvalProof}=challenge();const calls=[];
    const session=createOwnerSession({config,origin,fetchImpl:async(url,options)=>{
        calls.push({url,options});
        if(url.includes('/token?'))return json(login());
        return json({approved:true,pairId:request.pairId,expiresAt:request.expiresAt});
    }});
    await session.signIn('owner@example.test','synthetic-password');
    await session.approve(JSON.stringify(request),approvalProof,request.serverInstanceId);
    assert.equal(calls.length,2);assert.equal(calls[0].url,config.projectUrl+'/auth/v1/token?grant_type=password');
    assert.deepEqual(JSON.parse(calls[0].options.body),{email:'owner@example.test',password:'synthetic-password'});
    assert.equal(calls[0].options.headers.Authorization,undefined);
    assert.equal(calls[1].options.headers.Authorization,'Bearer synthetic-owner-access');
    for(const {url,options} of calls){assert.ok(url.startsWith(config.projectUrl+'/'));assert.ok(!url.includes('synthetic-'));
        assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');}
    assert.ok(!JSON.stringify(calls).includes('synthetic-owner-refresh'));
});
test('approval requires sign-in and refuses mismatched broker reply',async()=>{
    const {createOwnerSession}=await modulePromise,{request,approvalProof}=challenge();
    const session=createOwnerSession({config,origin,fetchImpl:async url=>url.includes('/token?')?json(login()):json({approved:true,pairId:crypto.randomUUID(),expiresAt:request.expiresAt})});
    await assert.rejects(session.approve(JSON.stringify(request),approvalProof,request.serverInstanceId));
    await session.signIn('owner@example.test','synthetic-password');
    await assert.rejects(session.approve(JSON.stringify(request),approvalProof,request.serverInstanceId));
});
test('five-minute session stops approval without auto refresh or new accounts',async()=>{
    const {createOwnerSession}=await modulePromise,{request,approvalProof}=challenge();let time=Date.now(),calls=0;
    const session=createOwnerSession({config,origin,now:()=>time,fetchImpl:async()=>{calls++;return json(login());}});
    const result=await session.signIn('owner@example.test','synthetic-password');time=result.expiresAt;
    await assert.rejects(session.approve(JSON.stringify(request),approvalProof,request.serverInstanceId));assert.equal(calls,1);
});
test('dispose during late sign-in prevents session adoption',async()=>{
    const {createOwnerSession}=await modulePromise;let resolve;
    const session=createOwnerSession({config,origin,fetchImpl:()=>new Promise(r=>{resolve=r;})});
    const attempt=session.signIn('owner@example.test','synthetic-password');session.dispose();resolve(json(login()));
    await assert.rejects(attempt);await assert.rejects(session.signIn('owner@example.test','synthetic-password'));
});
test('explicit sign-out is scoped, clears state before network and reports unsuccessful revocation honestly',async()=>{
    const {createOwnerSession}=await modulePromise;let last;
    const session=createOwnerSession({config,origin,fetchImpl:async(url,options)=>{
        if(url.includes('/token?'))return json(login());last={url,options};return new Response(null,{status:503});
    }});
    await session.signIn('owner@example.test','synthetic-password');assert.deepEqual(await session.signOut(),{revoked:false});
    assert.equal(last.url,config.projectUrl+'/auth/v1/logout?scope=local');
    assert.equal(last.options.headers.Authorization,'Bearer synthetic-owner-access');
    await assert.rejects(session.signIn('owner@example.test','synthetic-password'));
});
test('HTML/oversize/redirect and anonymous Auth replies fail closed',async()=>{
    const {createOwnerSession}=await modulePromise;
    for(const reply of [new Response('html'),new Response('x'.repeat(16385),{headers:{'content-type':'application/json'}}),
        {ok:true,redirected:true,headers:new Headers()},json({...login(),user:{id:owner,is_anonymous:true}})]){
        const session=createOwnerSession({config,origin,fetchImpl:async()=>reply});await assert.rejects(session.signIn('owner@example.test','synthetic-password'));
    }
});
