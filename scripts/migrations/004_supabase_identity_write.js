const { loadManifest, withConfiguredDatabase } = require('./004_supabase_identity_preflight');
const { applyIdentityLink, rollbackIdentityLink, readIdentityLinkReceipt } = require('../../services/identityMigrationApply');
const { verifyCloudMembership } = require('../../services/supabaseExchangeAuthority');
const { configuration } = require('../../services/controlPlane/configuration');
const { HEX, UUID, matches } = require('../../services/controlPlane/protocol');

async function readToken(input) {
    if (input.isTTY) throw Error('piped_token_required');
    let size = 0;
    const chunks = [];
    for await (const chunk of input) {
        size += chunk.length;
        if (size > 8194) throw Error('invalid_token_size');
        chunks.push(chunk);
    }
    const token = Buffer.concat(chunks).toString('utf8').trim();
    if (!token || token.length > 8192) throw Error('invalid_token_size');
    return token;
}

async function run(argv = process.argv.slice(2), input = process.stdin) {
    const [mode, first, second, operationId, generation] = argv;
    if (mode === 'receipt' && argv.length === 4 && matches(UUID, operationId) &&
        matches(UUID, first) && matches(/^[a-f0-9]{24}$/, second)) {
        return withConfiguredDatabase(db => readIdentityLinkReceipt({
            db, serverInstanceId: first, localUserId: second, operationId
        }));
    }
    if (mode === 'rollback' && argv.length === 5 && matches(UUID, operationId) && matches(UUID, generation) &&
        matches(UUID, first) && matches(/^[a-f0-9]{24}$/, second)) {
        return withConfiguredDatabase(db => rollbackIdentityLink({
            db, serverInstanceId: first, localUserId: second, operationId, generation
        }));
    }
    if (mode !== 'apply' || argv.length !== 4 || !matches(UUID, operationId) ||
        !first || first.startsWith('-') || !matches(HEX, second)) throw Error('invalid_arguments');
    const manifest = await loadManifest(first);
    if (manifest.links.length !== 1) throw Error('one_link_required');
    const token = await readToken(input);
    return withConfiguredDatabase(db => {
        const settings = configuration();
        if (settings.mode !== 'ready') throw Error('cloud_configuration_required');
        return applyIdentityLink({
            db, manifest, expectedDigest: second, operationId,
            verifyMembership: serverInstanceId => verifyCloudMembership({
                token, serverInstanceId, publishableKey: settings.publishableKey
            })
        });
    });
}

if (require.main === module) {
    run().then(result => console.log(JSON.stringify(result))).catch(() => {
        console.error('Identity link operation could not be confirmed. Run the read-only preflight before retrying or rolling back.');
        process.exitCode = 1;
    });
}

module.exports = { run };
