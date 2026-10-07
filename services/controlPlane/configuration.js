'use strict';
const path = require('node:path');
const { PROJECT_REF } = require('./protocol');
/** Explicit opt-in. Invalid cloud settings never prevent local Mongo/login startup. */
function configuration(env = process.env) {
    const flag = env.CV_CONTROL_PLANE_ENABLED;
    if (flag === undefined || flag === '' || flag === 'false') return Object.freeze({ mode: 'disabled' });
    try {
        if (flag !== 'true' || env.CV_CONTROL_PLANE_PROJECT_REF !== PROJECT_REF ||
            env.CV_CONTROL_PLANE_PROJECT_URL !== `https://${PROJECT_REF}.supabase.co` ||
            typeof env.CV_CONTROL_PLANE_PUBLISHABLE_KEY !== 'string' ||
            !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(env.CV_CONTROL_PLANE_PUBLISHABLE_KEY)) throw Error();
        const origin = env.CV_CONTROL_PLANE_ADMIN_ORIGIN;
        const url = new URL(origin);
        if (url.origin !== origin || url.username || url.password ||
            !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw Error();
        const directory = path.resolve(__dirname,'../../runtime/control-plane');
        return Object.freeze({ mode: 'ready', projectRef: PROJECT_REF,
            projectUrl: env.CV_CONTROL_PLANE_PROJECT_URL, publishableKey: env.CV_CONTROL_PLANE_PUBLISHABLE_KEY,
            brokerUrl: `${env.CV_CONTROL_PLANE_PROJECT_URL}/functions/v1/cinevault-control-plane`,
            adminOrigin: origin, directory });
    } catch { return Object.freeze({ mode: 'blocked', reason: 'invalid_control_plane_config' }); }
}
module.exports = { configuration };
