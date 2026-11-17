'use strict';

const { Resolver } = require('node:dns/promises');
const https = require('node:https');
const { isIP } = require('node:net');
const { networkInterfaces } = require('node:os');
const { checkServerIdentity } = require('node:tls');
const cloud = require('./controlPlaneService');
const { configuration } = require('./controlPlane/configuration');
const { cloudExchangeHttpsOrigin } = require('./cloudIdentityLink');
const { readReadiness } = require('../startup/health');

const probeTimeout = 3500;
const certificateWarningMs = 14 * 24 * 60 * 60 * 1000;

async function checkDns(hostname) {
    const local = new Set(Object.values(networkInterfaces()).flat().filter(address => !address.internal)
        .map(address => address.address));
    const resolver = new Resolver({ timeout: 1500, tries: 1 });
    const results = isIP(hostname) ? [{ status: 'fulfilled', value: [hostname] }] :
        await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    const answers = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    if (answers.length === 0) return 'unavailable';
    if (results.some(result => result.status === 'rejected' && !['ENODATA', 'ENOTFOUND'].includes(result.reason?.code))) {
        return 'partial_lookup';
    }
    const matches = answers.filter(address => local.has(address)).length;
    if (matches === answers.length) return 'ready';
    return matches > 0 ? 'mixed_addresses' : 'address_mismatch';
}

function checkHttps(origin) {
    return new Promise(resolve => {
        const hostname = origin.hostname.replace(/^\[|\]$/g, '');
        const request = https.request({
            host: '127.0.0.1', port: Number(origin.port || 443), path: '/health/live',
            headers: { host: origin.host }, agent: false, servername: isIP(hostname) ? '' : hostname,
            checkServerIdentity: (_, certificate) => checkServerIdentity(hostname, certificate),
            signal: AbortSignal.timeout(probeTimeout)
        }, response => {
            const expiry = Date.parse(response.socket.getPeerCertificate()?.valid_to);
            const expiresAt = Number.isFinite(expiry) ? expiry : null;
            const trusted = expiresAt !== null && response.statusCode === 200 && /^application\/json\b/i.test(response.headers['content-type'] || '');
            response.destroy();
            const status = !trusted ? 'unavailable' : (expiresAt - Date.now() < certificateWarningMs ? 'expiring' : 'ready');
            resolve({ status, expiresAt });
        });
        request.once('error', error => {
            const status = {
                CERT_HAS_EXPIRED: 'expired', CERT_NOT_YET_VALID: 'not_yet_valid',
                ERR_TLS_CERT_ALTNAME_INVALID: 'wrong_hostname', DEPTH_ZERO_SELF_SIGNED_CERT: 'untrusted',
                SELF_SIGNED_CERT_IN_CHAIN: 'untrusted', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'untrusted',
                UNABLE_TO_GET_ISSUER_CERT: 'untrusted', UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'untrusted'
            }[error.code] || 'unavailable';
            resolve({ status, expiresAt: null });
        });
        request.end();
    });
}

async function checkSupabase() {
    const settings = configuration();
    if (settings.mode !== 'ready') return { status: settings.mode };
    const state = cloud.diagnostics();
    let status;
    try {
        const response = await fetch(`${settings.projectUrl}/auth/v1/health`, {
            headers: { apikey: settings.publishableKey }, redirect: 'error', signal: AbortSignal.timeout(probeTimeout)
        });
        const type = response.headers.get('content-type') || '';
        status = response.status === 200 && /^application\/json\b/i.test(type) ? 'reachable' : 'unavailable';
        await response.body?.cancel();
    } catch { status = 'unavailable'; }
    return { status, enrollment: state.mode, lastHeartbeatAt: state.lastHeartbeatAt ?? null,
        credentialExpiresAt: state.credentialExpiresAt ?? null };
}

let pending;
function readDiagnostics(httpsListening) {
    if (pending) return pending;
    const origin = cloudExchangeHttpsOrigin();
    const exchangeEnabled = process.env.CV_AUTH_EXCHANGE_ENABLED === 'true';
    const originStatus = exchangeEnabled && process.env.CV_AUTH_EXCHANGE_HTTPS_ORIGIN ? 'invalid' : 'not_configured';
    const readiness = readReadiness();
    const timeout = AbortSignal.timeout(probeTimeout);
    const boundedReadiness = Promise.race([readiness, new Promise(resolve => timeout.addEventListener('abort', () => {
        resolve({ status: 'unknown', dependencies: { database: 'unknown', redis: 'unknown' } });
    }, { once: true }))]);
    pending = Promise.all([
        boundedReadiness, checkSupabase(), origin ? checkDns(origin.hostname.replace(/^\[|\]$/g, '')) : originStatus,
        origin && httpsListening ? checkHttps(origin) : { status: origin ? 'not_listening' : originStatus }
    ]).then(([server, supabase, dnsStatus, tls]) => ({
        checkedAt: Date.now(), server, supabase,
        network: { origin: origin?.origin ?? null, dnsStatus, tls, otherDevice: 'not_tested' }
    })).finally(() => { pending = null; });
    return pending;
}

module.exports = { readDiagnostics };
