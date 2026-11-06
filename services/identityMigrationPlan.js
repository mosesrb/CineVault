'use strict';

const { createHash } = require('node:crypto');
const MIGRATION_ID = '004_supabase_identity_links';
const MAX_USERS = 50000;
const MAX_LINKS = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/;

function invalid(code) { throw new Error(code); }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys) {
    return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function userId(value) {
    const id = typeof value?.toHexString === 'function' ? value.toHexString() : value;
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) invalid('identity_inventory_invalid');
    return id;
}

function validateManifest(manifest) {
    if (!exactKeys(manifest, ['schemaVersion', 'migrationId', 'serverInstanceId', 'links']) ||
        manifest.schemaVersion !== 1 || manifest.migrationId !== MIGRATION_ID ||
        !UUID.test(manifest.serverInstanceId) || !Array.isArray(manifest.links) || manifest.links.length > MAX_LINKS) {
        invalid('identity_manifest_invalid');
    }
    for (const link of manifest.links) {
        if (!exactKeys(link, ['localUserId', 'supabaseUserId']) ||
            !OBJECT_ID.test(link.localUserId) || !UUID.test(link.supabaseUserId)) invalid('identity_manifest_invalid');
    }
}

/** A proposal is neither cloud ownership proof nor an executable write plan. */
function planIdentityMigration({ identity, users, manifest = null }) {
    if (!record(identity) || identity._id !== 'primary' || identity.schemaVersion !== 1 || !UUID.test(identity.serverId)) {
        invalid('identity_installation_invalid');
    }
    if (!Array.isArray(users) || users.length > MAX_USERS) invalid('identity_inventory_limit');
    if (manifest !== null) validateManifest(manifest);
    const issues = [];
    const issue = (code, ids = []) => issues.push({ code, localUserIds: [...new Set(ids)].sort() });
    const rows = users.map(user => {
        if (!record(user) || typeof user.email !== 'string' || !user.email.trim() || user.email.length > 255) {
            invalid('identity_inventory_invalid');
        }
        const id = userId(user._id);
        const version = user.authSchemaVersion === undefined ? 1 : user.authSchemaVersion;
        const subject = user.supabaseUserId ?? null;
        const migration = user.identityMigration;
        const linked = version === 2 && typeof subject === 'string' && UUID.test(subject) &&
            exactKeys(migration, ['id', 'version', 'serverInstanceId']) && migration.id === MIGRATION_ID &&
            migration.version === 1 && migration.serverInstanceId === identity.serverId;
        const supported = (version === 1 && subject === null && migration === undefined) || linked;
        if (!supported) issue('unsupported_user_state', [id]);
        return { id, email: user.email, version, subject, linked, supported };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const byId = new Map();
    const emails = new Map();
    const owners = new Map();
    for (const row of rows) {
        if (byId.has(row.id)) issue('duplicate_local_id', [row.id]);
        byId.set(row.id, row);
        const email = row.email.trim().toLowerCase();
        if (!emails.has(email)) emails.set(email, []);
        emails.get(email).push(row.id);
        if (row.subject !== null) {
            // Do not stringify an unsupported value supplied by a damaged record.
            if (typeof row.subject !== 'string' || !UUID.test(row.subject)) continue;
            if (!owners.has(row.subject)) owners.set(row.subject, []);
            owners.get(row.subject).push(row.id);
        }
    }
    for (const ids of emails.values()) if (ids.length > 1) issue('duplicate_email', ids);
    for (const ids of owners.values()) if (ids.length > 1) issue('duplicate_existing_subject', ids);
    if (manifest && manifest.serverInstanceId !== identity.serverId) issue('wrong_installation');
    const proposedIds = new Set();
    const proposedSubjects = new Map();
    const proposals = [];
    for (const link of manifest?.links || []) {
        if (proposedIds.has(link.localUserId)) issue('duplicate_proposed_user', [link.localUserId]);
        proposedIds.add(link.localUserId);
        const other = proposedSubjects.get(link.supabaseUserId);
        if (other) issue('duplicate_proposed_subject', [other, link.localUserId]);
        proposedSubjects.set(link.supabaseUserId, link.localUserId);
        const row = byId.get(link.localUserId);
        if (!row) { issue('missing_local_user', [link.localUserId]); continue; }
        if (row.subject !== null && row.subject !== link.supabaseUserId) issue('existing_link_conflict', [row.id]);
        const existingOwners = owners.get(link.supabaseUserId) || [];
        // Multiple existing owners are already a blocking inventory issue. Do
        // not expand that entire group again for every manifest entry.
        if (existingOwners.length === 1 && existingOwners[0] !== row.id) {
            issue('subject_owned_by_another_user', [row.id, existingOwners[0]]);
        }
        proposals.push({ localUserId: row.id, supabaseUserId: link.supabaseUserId,
            action: row.linked && row.subject === link.supabaseUserId ? 'already_linked' : 'propose_link', targetAuthSchemaVersion: 2 });
    }
    // Fingerprint only a bounded, allowlisted identity snapshot; never passwords,
    // sessions, policy, history or arbitrary record metadata. Not a lock/CAS token.
    const inventory = rows.map(row => ({ localUserId: row.id, email: row.email,
        authSchemaVersion: [1, 2].includes(row.version) ? row.version : 'unsupported',
        supabaseUserId: typeof row.subject === 'string' && UUID.test(row.subject) ? row.subject : null,
        supportedState: row.supported }));
    issues.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    proposals.sort((a, b) => a.localUserId.localeCompare(b.localUserId) || a.supabaseUserId.localeCompare(b.supabaseUserId));
    return { schemaVersion: 1, migrationId: MIGRATION_ID, serverInstanceId: identity.serverId,
        mode: 'read_only', status: issues.length ? 'blocked' : manifest ? 'proposal' : 'inventory_only',
        planValid: issues.length === 0, cloudIdentityVerified: false, cutoverReady: false,
        counts: { users: rows.length, linked: rows.filter(row => row.linked).length,
            proposed: proposedIds.size, unmapped: rows.filter(row => !row.linked && !proposedIds.has(row.id)).length },
        snapshotDigest: createHash('sha256').update(JSON.stringify({ serverInstanceId: identity.serverId, inventory })).digest('hex'),
        proposals, issues };
}

module.exports = { planIdentityMigration, validateManifest, MIGRATION_ID, MAX_USERS };
