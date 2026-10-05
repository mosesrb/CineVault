'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateState } = require('./pairing');
const MAX_BYTES = 16384;
const failure = () => new Error('credential_store_recovery_required');

/** Windows-only isolated adapter. State travels over stdin, never command args.
 * PowerShell/native helper errors are deliberately not returned or logged.
 */
function createStore({ directory, projectRef, serverInstanceId }) {
    if (process.platform !== 'win32') throw new Error('credential_store_windows_required');
    if (typeof directory !== 'string' || !/^[A-Za-z]:[\\/]/.test(directory) ||
        directory.includes('..') || directory.includes(':', 2) || directory.length > 220) throw failure();
    directory = path.resolve(directory);
    const runtimeRoot = path.resolve(__dirname, '../../runtime');
    const relative = path.relative(runtimeRoot, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure();
    let revision;
    let lastState;
    let busy = false;
    async function invoke(action, payload = null) {
        if (busy) throw new Error('credential_store_busy');
        busy = true;
        try {
            const request = JSON.stringify({ directory, action, payload, expectedRevision: revision ?? null });
            if (Buffer.byteLength(request) > MAX_BYTES * 2) throw failure();
            const output = await new Promise((resolve, reject) => {
                const executable = path.join(process.env.SystemRoot || 'C:/Windows',
                    'System32/WindowsPowerShell/v1.0/powershell.exe');
                const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive',
                    '-File', path.join(__dirname, 'protected_state_store.ps1')], {
                    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
                });
                let result = ''; let overflow = false;
                const timer = setTimeout(() => { child.kill(); reject(failure()); }, 15000);
                child.stdout.on('data', chunk => {
                    result += chunk.toString();
                    if (Buffer.byteLength(result) > MAX_BYTES * 2) { overflow = true; child.kill(); }
                });
                // Drain, but never expose native diagnostics that could contain paths/state.
                child.stderr.resume();
                child.stdin.on('error', () => {});
                child.on('error', () => { clearTimeout(timer); reject(failure()); });
                child.on('close', code => {
                    clearTimeout(timer);
                    if (code !== 0 || overflow) reject(failure()); else resolve(result);
                });
                child.stdin.end(request);
            });
            const response = JSON.parse(output);
            if (response.ok !== true || (response.revision !== null &&
                !/^[a-f0-9]{64}$/.test(response.revision))) throw failure();
            return response;
        } catch { throw failure(); }
        finally { busy = false; }
    }
    return {
        async read() {
            try {
                const result = await invoke('read');
                const state = result.payload === null ? null : JSON.parse(result.payload);
                if (state !== null) validateState(state, projectRef, serverInstanceId);
                revision = result.revision;
                lastState = structuredClone(state);
                return state;
            } catch { revision = undefined; lastState = undefined; throw failure(); }
        },
        async writeAtomic(state) {
            if (revision === undefined) throw failure();
            let payload;
            let snapshot;
            try {
                // Retain the same detached input that is validated and persisted.
                // Caller mutation while awaiting the native write must not alter
                // the transition baseline for a subsequent write.
                snapshot = structuredClone(state);
                validateState(snapshot, projectRef, serverInstanceId);
                if (lastState) {
                    // This adapter cannot rotate or roll back credentials. Those need
                    // a separate owner-approved protocol, not arbitrary valid JSON.
                    for (const key of Object.keys(lastState).filter(k => !['status', 'mapping'].includes(k))) {
                        if (snapshot[key] !== lastState[key]) throw failure();
                    }
                    if (lastState.status === 'active' && (snapshot.status !== 'active' ||
                        JSON.stringify(snapshot.mapping) !== JSON.stringify(lastState.mapping))) throw failure();
                }
                payload = JSON.stringify(snapshot);
                if (Buffer.byteLength(payload) > MAX_BYTES) throw failure();
            } catch { throw failure(); }
            const result = await invoke('write', payload);
            revision = result.revision;
            lastState = snapshot;
        }
    };
}
module.exports = { createStore };
