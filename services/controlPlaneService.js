'use strict';
const { configuration } = require('./controlPlane/configuration');
const { createStore } = require('./controlPlane/store');
const { createTransport } = require('./controlPlane/transport');
const { createCoordinator } = require('./controlPlane/coordinator');
const { readServerIdentity } = require('./serverIdentityService');
let coordinator = null;
let settings = null;
/** Cloud is optional and disabled by default. No secrets/network/store while off. */
async function initializeControlPlane() {
    if(coordinator)return;
    settings=configuration();
    if(settings.mode!=='ready')return;
    try {
        const identity=await readServerIdentity();
        coordinator=createCoordinator({config:settings,serverInstanceId:identity.serverId,
            store:createStore({...settings,serverInstanceId:identity.serverId}),transport:createTransport({config:settings})});
        coordinator.noteActivity('startup');
    } catch { settings={mode:'blocked',reason:'control_plane_recovery_required'}; }
}
function controlPlaneStatus() {
    return coordinator?.status() || {mode:settings?.mode || 'disabled',enabled:false,guidance:
        settings?.mode==='blocked'?'Invalid control-plane configuration or protected storage; local CineVault remains independent.':null};
}
async function action(name,value) {
    if(!coordinator)throw Error('control_plane_unavailable');
    return coordinator[name](value);
}
async function stopControlPlane() {
    const current=coordinator;coordinator=null;settings=null;
    await current?.stop();
}
module.exports={initializeControlPlane,stopControlPlane,controlPlaneStatus,
    prepare:()=>action('prepare'),redeem:()=>action('redeem'),retry:()=>action('retry'),recover:()=>action('recover'),
    restore:value=>action('restore',value),
    noteActivity:kind=>{try{coordinator?.noteActivity(kind);}catch{ /* No cloud failure may deny local service. */ }} };
