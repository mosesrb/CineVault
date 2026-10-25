'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateState, validateTransition } = require('./protocol');
const failure = () => new Error('control_plane_recovery_required');
/** Windows NTFS ACL + lock + digest-CAS. Payload only travels over stdin.
 * No arbitrary paths, credential import or automatic repair. Explicit recovery
 * archives original bytes under the native lock before staging a fresh candidate.
 * Ordinary writes follow the exact persisted transition contract. */
function createStore({ directory, projectRef, serverInstanceId }) {
    if (process.platform !== 'win32') throw failure();
    if(typeof directory!=='string' || !/^[A-Za-z]:[\\/]/.test(directory) || directory.includes('..') ||
        directory.includes(':',2) || directory.length>220)throw failure();
    directory=path.resolve(directory);
    const relative=path.relative(path.resolve(__dirname,'../../runtime'),directory);
    if(!relative || relative.startsWith('..') || path.isAbsolute(relative))throw failure();
    let revision, last, busy = false;
    async function invoke(action, payload = null) {
        if (busy) throw failure();
        busy = true;
        try {
            const output = await new Promise((resolve,reject) => {
                const exe = path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
                const child = spawn(exe,['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(__dirname,'protected_state_store.ps1')],
                    {windowsHide:true,stdio:['pipe','pipe','pipe']});
                let result = '', overflow = false;
                const timer = setTimeout(() => { child.kill(); reject(failure()); },15000);
                child.stdout.on('data', chunk => {
                    result += chunk.toString();
                    // Native bytes stay <=16KiB, but JSON escaping of damaged
                    // UTF8/control bytes can expand6x plus envelope metadata.
                    if (Buffer.byteLength(result) > 114688) { overflow = true; child.kill(); }
                });
                child.stderr.resume(); child.stdin.on('error',()=>{});
                child.on('error',()=>{clearTimeout(timer);reject(failure());});
                child.on('close', code=>{clearTimeout(timer);if(code!==0||overflow)reject(failure());else resolve(result);});
                child.stdin.end(JSON.stringify({directory,action,payload,expectedRevision:revision ?? null}));
            });
            const response = JSON.parse(output);
            if (response.ok !== true || !(response.revision === null || /^[a-f0-9]{64}$/.test(response.revision))) throw failure();
            return response;
        } catch { throw failure(); }
        finally { busy = false; }
    }
    return {
        async read() {
            try {
                const response = await invoke('read');
                const state = response.payload === null ? null : JSON.parse(response.payload);
                if (state !== null) validateState(state,projectRef,serverInstanceId);
                revision = response.revision; last = structuredClone(state); return state;
            } catch { revision = undefined; last = undefined; throw failure(); }
        },
        async readForRecovery() {
            // Explicit ADMIN recovery only. Native read still enforces all ACL,
            // link/UTF8/size/orphan guards; only payload schema may be damaged.
            revision=undefined;last=undefined;
            const response=await invoke('read_recovery');revision=response.revision;
            if(response.payload===null){last=null;return null;}
            try {const state=JSON.parse(response.payload);validateState(state,projectRef,serverInstanceId);
                last=structuredClone(state);return state;
            } catch {return null;} // Original bytes preserved natively on recover.
        },
        async writeRecoveryAtomic(value) {
            if(revision===undefined)throw failure();
            const snapshot=structuredClone(value);validateState(snapshot,projectRef,serverInstanceId);
            if(snapshot.status!=='recovering')throw failure();
            const payload=JSON.stringify(snapshot);if(Buffer.byteLength(payload)>16384)throw failure();
            const response=await invoke('recover',payload);revision=response.revision;last=snapshot;
        },
        async writeAtomic(value) {
            if (revision === undefined) throw failure();
            const snapshot = structuredClone(value);
            validateState(snapshot,projectRef,serverInstanceId); validateTransition(last,snapshot);
            const payload = JSON.stringify(snapshot);
            if (Buffer.byteLength(payload) > 16384) throw failure();
            const response = await invoke('write',payload);
            revision = response.revision; last = snapshot;
        }
    };
}
module.exports = { createStore };
