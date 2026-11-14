// Real PostgreSQL/WASM (PGlite) + cinevault-account-admin service verification
// with disposable accounts (T4a, T4b, T4c, T4d).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');
const { PROJECT_REF } = require('../../services/controlPlane/protocol');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const uuid = () => crypto.randomUUID();

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
});
const publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'cv-acct-admin-key-1',
    use: 'sig',
    alg: 'ES256'
};

const PUBLISHABLE_KEY = 'sb_publishable_account_admin_fixture_1234567890';
const SERVICE_ROLE_KEY = 'sb_secret_account_admin_service_role_fixture_1234567890';
const ALLOWED_ORIGIN = 'https://cinevault-owner-approval.pages.dev';
const ISSUER = `https://${PROJECT_REF}.supabase.co/auth/v1`;
const ADMIN_USERS_URL = `${ISSUER}/admin/users`;

function signUserJwt({ sub, sessionId, expSeconds, nowMs }) {
    const iat = Math.floor(nowMs / 1000);
    return jwt.sign(
        {
            iss: ISSUER,
            aud: 'authenticated',
            role: 'authenticated',
            sub,
            session_id: sessionId,
            is_anonymous: false,
            iat,
            exp: expSeconds ?? iat + 300
        },
        privateKey,
        { algorithm: 'ES256', keyid: publicJwk.kid }
    );
}

async function createPgliteFixture() {
    const db = await PGlite.create();
    try {
        await db.exec(read('bootstrap.sql'));
        await db.exec(`
            alter table auth.users
                add is_anonymous boolean default false,
                add banned_until timestamptz,
                add deleted_at timestamptz,
                add email text,
                add email_confirmed_at timestamptz,
                add encrypted_password text,
                add raw_user_meta_data jsonb default '{}'::jsonb,
                add raw_app_meta_data jsonb default '{}'::jsonb,
                add last_sign_in_at timestamptz,
                add updated_at timestamptz default clock_timestamp();
            create table auth.sessions (
                id uuid primary key,
                user_id uuid not null,
                not_after timestamptz
            );
        `);
        for (const file of [
            '../migrations/20261004161756_control_plane_foundation.sql',
            '../broker/schema.sql',
            '../broker/admission.sql',
            '../broker/replacement.sql',
            '../broker/restoration.sql',
            '../broker/provisioning.sql',
            '../broker/account_administration.sql'
        ]) {
            await db.exec(read(file));
        }
        return db;
    } catch (error) {
        await db.close();
        throw error;
    }
}

function createPgliteSqlAdapter(db) {
    let txDepth = 0;
    return {
        async begin(callback) {
            const depth = ++txDepth;
            const sp = `sp_acct_${depth}`;
            if (depth === 1) {
                await db.exec('begin');
            } else {
                await db.exec(`savepoint ${sp}`);
            }
            try {
                const tx = {
                    async unsafe(queryText, params = []) {
                        const res = await db.query(queryText, params);
                        return res.rows;
                    },
                    json(value) {
                        return JSON.stringify(value);
                    }
                };
                const result = await callback(tx);
                if (depth === 1) {
                    await db.exec('reset role; commit');
                } else {
                    await db.exec(`release savepoint ${sp}`);
                }
                return result;
            } catch (error) {
                if (depth === 1) {
                    await db.exec('rollback');
                } else {
                    await db.exec(`rollback to savepoint ${sp}; release savepoint ${sp}`);
                }
                throw error;
            } finally {
                txDepth--;
            }
        },
        async end() {}
    };
}

test('CV-P4-5 Revision 5: cinevault-account-admin boundaries, caller-bound membership, reset proofs, and T4d pending-write escalation', async t => {
    const { createOwnerVerifier } = await import('../broker/owner.mjs');
    const { createAuthAdminClient } = await import('../account-admin/authAdmin.mjs');
    const { createAccountAdminTransactionAdapter, createAccountAdminDatabase } = await import('../account-admin/database.mjs');
    const { createAccountAdminService, createAccountAdminHandler } = await import('../account-admin/service.mjs');
    const { createAccountAdminRuntime } = await import('../account-admin/runtime.mjs');

    const db = await createPgliteFixture();
    let currentNow = Date.now();
    const now = () => currentNow;

    // In-memory mock upstream Supabase Auth store & call log
    const authUsers = new Map();
    const authAdminWriteCalls = [];
    let customPutBehavior = null;

    async function seedAuthUser({
        id = uuid(),
        email,
        password = 'InitialPassword-123!',
        confirmed = true
    }) {
        const record = {
            id,
            email,
            password,
            encrypted_password: `$2a$10$initial_${id.replaceAll('-', '').slice(0, 22)}`,
            is_anonymous: false,
            deleted_at: null,
            banned_until: null,
            email_confirmed_at: confirmed ? new Date(currentNow).toISOString() : null
        };
        authUsers.set(id, record);
        await db.query(
            `insert into auth.users(id, email, email_confirmed_at, is_anonymous, encrypted_password, updated_at)
             values($1, $2, $3, false, $4, clock_timestamp())
             on conflict(id) do update set
                email = excluded.email,
                email_confirmed_at = excluded.email_confirmed_at,
                encrypted_password = excluded.encrypted_password,
                updated_at = clock_timestamp()`,
            [id, email, record.email_confirmed_at, record.encrypted_password]
        );
        return record;
    }

    async function createAuthSession(userId, ttlSeconds = 300) {
        const sessionId = uuid();
        await db.query(
            `insert into auth.sessions(id, user_id, not_after)
             values($1, $2, clock_timestamp() + ($3 || ' seconds')::interval)`,
            [sessionId, userId, String(ttlSeconds)]
        );
        const token = signUserJwt({
            sub: userId,
            sessionId,
            expSeconds: Math.floor(currentNow / 1000) + ttlSeconds,
            nowMs: currentNow
        });
        return { sessionId, token };
    }

    const fetchImpl = async (url, options = {}) => {
        if (url === `${ISSUER}/.well-known/jwks.json`) {
            return new Response(JSON.stringify({ keys: [publicJwk] }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }
        if (url === `${ISSUER}/user`) {
            const bearer = (options.headers?.Authorization || '').replace(/^Bearer /, '');
            const decoded = jwt.decode(bearer);
            const u = authUsers.get(decoded?.sub);
            if (!u || u.deleted_at || u.banned_until) {
                return new Response(JSON.stringify({ error: 'invalid_user' }), {
                    status: 403,
                    headers: { 'content-type': 'application/json' }
                });
            }
            return new Response(
                JSON.stringify({
                    id: u.id,
                    email: u.email,
                    is_anonymous: u.is_anonymous,
                    deleted_at: u.deleted_at,
                    banned_until: u.banned_until
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            );
        }
        if (url === ADMIN_USERS_URL && options.method === 'POST') {
            assert.equal(options.headers?.apikey, SERVICE_ROLE_KEY);
            assert.equal(options.headers?.Authorization, `Bearer ${SERVICE_ROLE_KEY}`);
            const body = JSON.parse(options.body);
            assert.equal(body.email_confirm, true);
            const created = await seedAuthUser({
                id: uuid(),
                email: body.email,
                password: body.password,
                confirmed: true
            });
            return new Response(
                JSON.stringify({
                    id: created.id,
                    email: created.email,
                    is_anonymous: false,
                    email_confirmed_at: created.email_confirmed_at
                }),
                { status: 201, headers: { 'content-type': 'application/json' } }
            );
        }
        if (url.startsWith(`${ADMIN_USERS_URL}/`) && options.method === 'PUT') {
            assert.equal(options.headers?.apikey, SERVICE_ROLE_KEY);
            assert.equal(options.headers?.Authorization, `Bearer ${SERVICE_ROLE_KEY}`);
            const targetId = url.slice(ADMIN_USERS_URL.length + 1);
            const body = JSON.parse(options.body);
            const callEntry = {
                targetId,
                password: body.password,
                calledAt: currentNow
            };
            authAdminWriteCalls.push(callEntry);

            if (customPutBehavior) {
                return await customPutBehavior({ targetId, body, signal: options.signal, callEntry });
            }

            const existing = authUsers.get(targetId);
            if (!existing) {
                return new Response(JSON.stringify({ error: 'not_found' }), {
                    status: 404,
                    headers: { 'content-type': 'application/json' }
                });
            }
            existing.password = body.password;
            existing.encrypted_password = `$2a$10$updated_${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`;
            await db.query(
                `update auth.users
                    set encrypted_password = $2, updated_at = clock_timestamp()
                  where id = $1`,
                [targetId, existing.encrypted_password]
            );
            return new Response(
                JSON.stringify({
                    id: existing.id,
                    email: existing.email,
                    is_anonymous: false
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            );
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const verifyCaller = createOwnerVerifier({
        publishableKey: PUBLISHABLE_KEY,
        fetchImpl,
        now
    });
    const database = createAccountAdminTransactionAdapter(createPgliteSqlAdapter(db), now);
    const authAdmin = createAuthAdminClient({
        serviceRoleKey: SERVICE_ROLE_KEY,
        projectRef: PROJECT_REF,
        fetchImpl,
        now,
        timeoutMs: 200
    });
    const service = createAccountAdminService({
        database,
        verifyCaller,
        authAdmin,
        now
    });
    const handler = createAccountAdminHandler({
        service,
        allowedOrigins: [ALLOWED_ORIGIN]
    });

    async function invokeHttp(body, token, origin = ALLOWED_ORIGIN) {
        const headers = {
            'content-type': 'application/json',
            ...(origin ? { origin } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {})
        };
        const response = await handler(
            new Request(`https://${PROJECT_REF}.supabase.co/functions/v1/cinevault-account-admin`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            })
        );
        return {
            status: response.status,
            body: await response.json()
        };
    }

    try {
        // Seed disposable installation owners and project admin
        const owner1 = await seedAuthUser({ email: 'disp-owner-1@example.invalid' });
        const owner2 = await seedAuthUser({ email: 'disp-owner-2@example.invalid' });
        const projectAdmin = await seedAuthUser({ email: 'disp-proj-admin@example.invalid' });
        const instance1 = uuid();
        const instance2 = uuid();
        const cloudServer1 = uuid();
        const cloudServer2 = uuid();

        // Provision installation 1 (owned by owner1) and installation 2 (owned by owner2)
        await db.query(
            `select cinevault_private.cp_provision_installation($1, $2, $3, 'Disposable Owner 1')`,
            [PROJECT_REF, owner1.id, instance1]
        );
        await db.query(
            `insert into public.servers(id, owner_user_id, server_instance_id, name, status)
             values($1, $2, $3, 'CineVault One', 'OFFLINE')`,
            [cloudServer1, owner1.id, instance1]
        );
        await db.query(
            `insert into cinevault_private.cp_credentials(id, instance_id, server_id, secret_digest, epoch, expires_at)
             values($1, $2, $3, $4, 1, clock_timestamp() + interval '30 days')`,
            [uuid(), instance1, cloudServer1, Buffer.alloc(32, 1)]
        );

        await db.query(
            `select cinevault_private.cp_provision_installation($1, $2, $3, 'Disposable Owner 2')`,
            [PROJECT_REF, owner2.id, instance2]
        );
        await db.query(
            `insert into public.servers(id, owner_user_id, server_instance_id, name, status)
             values($1, $2, $3, 'CineVault Two', 'OFFLINE')`,
            [cloudServer2, owner2.id, instance2]
        );
        await db.query(
            `insert into cinevault_private.cp_credentials(id, instance_id, server_id, secret_digest, epoch, expires_at)
             values($1, $2, $3, $4, 1, clock_timestamp() + interval '30 days')`,
            [uuid(), instance2, cloudServer2, Buffer.alloc(32, 2)]
        );

        // Provision projectAdmin in cinevault_private.cp_project_admins
        const provisionedAdmin = (
            await db.query(
                `select cinevault_private.cp_provision_project_admin($1, $2, 'Disposable Project Admin', true) as result`,
                [PROJECT_REF, projectAdmin.id]
            )
        ).rows[0].result;
        assert.deepEqual(provisionedAdmin, {
            projectRef: PROJECT_REF,
            adminUserId: projectAdmin.id,
            enabled: true
        });

        // =========================================================================
        // T4a — Verified Caller Binding, Service Boundary & Exact SQL Grants
        // =========================================================================
        await t.test('T4a: role attributes, exact SQL function/table grants, and permission separation between installation owner and project admin', async () => {
            // 1. Verify cv_account_admin_login role attributes & narrow SET-only membership
            const roleRow = (
                await db.query(
                    `select rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
                            rolreplication, rolbypassrls, rolconnlimit, rolpassword
                       from pg_authid
                      where rolname = 'cv_account_admin_login'`
                )
            ).rows[0];
            assert.deepEqual(roleRow, {
                rolcanlogin: false,
                rolinherit: false,
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolreplication: false,
                rolbypassrls: false,
                rolconnlimit: 2,
                rolpassword: null
            });

            const memberships = (
                await db.query(
                    `select r.rolname, m.admin_option, m.inherit_option, m.set_option
                       from pg_auth_members m
                       join pg_roles r on r.oid = m.roleid
                       join pg_roles u on u.oid = m.member
                      where u.rolname = 'cv_account_admin_login'`
                )
            ).rows;
            assert.deepEqual(memberships, [
                {
                    rolname: 'cv_account_admin',
                    admin_option: false,
                    inherit_option: false,
                    set_option: true
                }
            ]);

            // Confirm no time-based unlock function exists in cinevault_private
            const unlockFnCount = (
                await db.query(
                    `select count(*)::int n
                       from pg_proc p
                       join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'cinevault_private'
                        and p.proname like '%resolve_uncertain%'`
                )
            ).rows[0].n;
            assert.equal(unlockFnCount, 0);

            // 2. Verify table privileges are revoked from all non-owner roles
            for (const role of [
                'anon',
                'authenticated',
                'service_role',
                'cv_control_broker',
                'cv_control_broker_login',
                'cv_account_admin',
                'cv_account_admin_login'
            ]) {
                for (const table of [
                    'cinevault_private.cp_project_admins',
                    'cinevault_private.cp_password_resets',
                    'cinevault_private.cp_installations'
                ]) {
                    const hasSelect = (
                        await db.query(`select has_table_privilege($1, $2, 'SELECT') v`, [role, table])
                    ).rows[0].v;
                    const hasInsert = (
                        await db.query(`select has_table_privilege($1, $2, 'INSERT') v`, [role, table])
                    ).rows[0].v;
                    assert.equal(hasSelect, false, `${role} must not have SELECT on ${table}`);
                    assert.equal(hasInsert, false, `${role} must not have INSERT on ${table}`);
                }
            }

            // 3. Verify function EXECUTE grants per role
            const accountAdminFunctions = [
                'cinevault_private.cp_verify_project_admin(text,uuid,uuid,timestamptz)',
                'cinevault_private.cp_init_provisioned_user_profile(text,uuid,uuid,timestamptz,uuid,text,uuid)',
                'cinevault_private.cp_begin_password_reset(text,uuid,uuid,timestamptz,uuid,uuid)',
                'cinevault_private.cp_claim_password_write(text,uuid,uuid,uuid,text,uuid,uuid,timestamptz)',
                'cinevault_private.cp_mark_password_write_uncertain(text,uuid,uuid,uuid,text)',
                'cinevault_private.cp_seal_password_reset(text,uuid,uuid,uuid,uuid)',
                'cinevault_private.cp_complete_password_change(text,uuid,uuid,uuid,uuid)'
            ];
            const operatorOnlyFunctions = [
                'cinevault_private.cp_provision_project_admin(text,uuid,text,boolean)',
                'cinevault_private.cp_operator_upsert_server_member(text,uuid,uuid,text,text,boolean,boolean,boolean)',
                'cinevault_private.cp_quarantine_uncertain_account(text,uuid,uuid,uuid)',
                'cinevault_private.cp_set_member_profile_state(text,uuid,boolean,boolean)',
                'cinevault_private.cp_provision_installation(text,uuid,uuid,text)'
            ];
            const memberRpc = 'public.manage_server_member(text,uuid,uuid,text,boolean,boolean,boolean)';

            for (const fn of accountAdminFunctions) {
                assert.equal(
                    (await db.query(`select has_function_privilege('cv_account_admin', $1, 'EXECUTE') v`, [fn])).rows[0].v,
                    true
                );
                for (const deniedRole of [
                    'anon',
                    'authenticated',
                    'service_role',
                    'cv_control_broker',
                    'cv_control_broker_login',
                    'cv_account_admin_login'
                ]) {
                    assert.equal(
                        (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [deniedRole, fn])).rows[0].v,
                        false
                    );
                }
            }

            for (const fn of operatorOnlyFunctions) {
                for (const deniedRole of [
                    'anon',
                    'authenticated',
                    'service_role',
                    'cv_control_broker',
                    'cv_control_broker_login',
                    'cv_account_admin',
                    'cv_account_admin_login'
                ]) {
                    assert.equal(
                        (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [deniedRole, fn])).rows[0].v,
                        false
                    );
                }
            }

            assert.equal(
                (await db.query(`select has_function_privilege('authenticated', $1, 'EXECUTE') v`, [memberRpc])).rows[0].v,
                true
            );
            for (const deniedRole of [
                'anon',
                'service_role',
                'cv_control_broker',
                'cv_control_broker_login',
                'cv_account_admin',
                'cv_account_admin_login'
            ]) {
                assert.equal(
                    (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [deniedRole, memberRpc])).rows[0].v,
                    false
                );
            }

            // 4. Create disposable member_1 via cinevault-account-admin (as projectAdmin)
            const adminSession = await createAuthSession(projectAdmin.id);
            const owner1Session = await createAuthSession(owner1.id);
            const owner2Session = await createAuthSession(owner2.id);

            const createRes = await invokeHttp(
                {
                    operation: 'admin-create-user',
                    projectRef: PROJECT_REF,
                    email: 'disp-member-1@example.invalid',
                    displayName: 'Disposable Member 1',
                    temporaryPassword: 'TempPassword-Member1!',
                    resetId: uuid()
                },
                adminSession.token
            );
            assert.equal(createRes.status, 200);
            const member1Id = createRes.body.userId;
            assert.equal(createRes.body.mustChangePassword, true);
            assert.equal(createRes.body.state, 'AWAITING_USER_CHANGE');

            // 5. Verify installation owner (owner1) cannot call admin-create-user or admin-reset-password
            const ownerCreateAttempt = await invokeHttp(
                {
                    operation: 'admin-create-user',
                    projectRef: PROJECT_REF,
                    email: 'unauthorized-create@example.invalid',
                    displayName: 'Unauthorized',
                    temporaryPassword: 'TempPassword-Unauth!',
                    resetId: uuid()
                },
                owner1Session.token
            );
            assert.equal(ownerCreateAttempt.status, 403);

            const ownerResetAttempt = await invokeHttp(
                {
                    operation: 'admin-reset-password',
                    projectRef: PROJECT_REF,
                    targetUserId: member1Id,
                    resetId: uuid(),
                    operationId: uuid(),
                    temporaryPassword: 'TempPassword-Unauth!'
                },
                owner1Session.token
            );
            assert.equal(ownerResetAttempt.status, 403);

            // 6. Verify projectAdmin cannot call public.manage_server_member on owner1's installation
            async function callManageServerMemberAs({ callerId, sessionId, expSeconds, instanceId, targetUserId, enabled = true, downloadAllowed = false }) {
                await db.exec('begin');
                try {
                    await db.exec('set local role authenticated');
                    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [callerId]);
                    await db.query(
                        `select set_config('request.jwt.claims', $1, true)`,
                        [JSON.stringify({ sub: callerId, session_id: sessionId, exp: expSeconds })]
                    );
                    const res = await db.query(
                        `select public.manage_server_member($1, $2, $3, 'USER', $4, false, $5) as result`,
                        [PROJECT_REF, instanceId, targetUserId, enabled, downloadAllowed]
                    );
                    await db.exec('reset role; commit');
                    return res.rows[0].result;
                } catch (err) {
                    await db.exec('rollback');
                    throw err;
                }
            }

            const expSeconds = Math.floor(currentNow / 1000) + 300;
            // Project admin is NOT owner of instance1 -> rejected with 42501
            await assert.rejects(
                callManageServerMemberAs({
                    callerId: projectAdmin.id,
                    sessionId: adminSession.sessionId,
                    expSeconds,
                    instanceId: instance1,
                    targetUserId: member1Id,
                    enabled: true
                }),
                err => err.code === '42501'
            );

            // Owner 2 is NOT owner of instance1 -> rejected with 42501
            await assert.rejects(
                callManageServerMemberAs({
                    callerId: owner2.id,
                    sessionId: owner2Session.sessionId,
                    expSeconds,
                    instanceId: instance1,
                    targetUserId: member1Id,
                    enabled: true
                }),
                err => err.code === '42501'
            );

            // Ordinary member1 is NOT owner of instance1 -> rejected with 42501
            const member1Session = await createAuthSession(member1Id);
            await assert.rejects(
                callManageServerMemberAs({
                    callerId: member1Id,
                    sessionId: member1Session.sessionId,
                    expSeconds,
                    instanceId: instance1,
                    targetUserId: member1Id,
                    enabled: true
                }),
                err => err.code === '42501'
            );

            // Owner 1 IS authenticated owner of instance1 -> succeeds and enables member1
            const grantRes = await callManageServerMemberAs({
                callerId: owner1.id,
                sessionId: owner1Session.sessionId,
                expSeconds,
                instanceId: instance1,
                targetUserId: member1Id,
                enabled: true,
                downloadAllowed: true
            });
            assert.deepEqual(grantRes, {
                projectRef: PROJECT_REF,
                serverInstanceId: instance1,
                cloudServerId: cloudServer1,
                userId: member1Id,
                role: 'USER',
                enabled: true,
                remoteStreamAllowed: false,
                downloadAllowed: true
            });

            // Project admin cannot reset installation owner's password
            const resetOwnerAttempt = await invokeHttp(
                {
                    operation: 'admin-reset-password',
                    projectRef: PROJECT_REF,
                    targetUserId: owner1.id,
                    resetId: uuid(),
                    operationId: uuid(),
                    temporaryPassword: 'TempPassword-OwnerReset!'
                },
                adminSession.token
            );
            assert.equal(resetOwnerAttempt.status, 403);

            // Runtime fail-closed check when enabled !== 'true'
            const disabledRuntime = createAccountAdminRuntime({
                configuration: { enabled: 'false' },
                postgres: () => {}
            });
            assert.equal(disabledRuntime.configured, false);
            assert.equal((await disabledRuntime.handle(new Request('https://example.invalid'))).status, 503);
            assert.throws(
                () =>
                    createAccountAdminDatabase({
                        postgres: () => {},
                        databaseUrl: `postgresql://cv_control_broker_login.${PROJECT_REF}:${'x'.repeat(32)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`
                    }),
                /account_admin_database_target_invalid/
            );
        });

        // =========================================================================
        // T4b — Normal Sign-In Hash Rewrite, Unrelated Updates & Reset-Bound Proof Checks
        // =========================================================================
        await t.test('T4b: normal sign-in encrypted_password hash rewrite and unrelated updates leave must_change_password=true; only valid USER_CHANGE claim+ticket clears it', async () => {
            const adminSession = await createAuthSession(projectAdmin.id);
            const initResetId = uuid();
            const createRes = await invokeHttp(
                {
                    operation: 'admin-create-user',
                    projectRef: PROJECT_REF,
                    email: 'disp-member-b@example.invalid',
                    displayName: 'Disposable Member B',
                    temporaryPassword: 'InitialTempPassword-B!',
                    resetId: initResetId
                },
                adminSession.token
            );
            assert.equal(createRes.status, 200);
            const memberB = createRes.body.userId;

            // Create a pre-existing session for memberB, then run admin-reset-password (reset_1)
            await createAuthSession(memberB);
            assert.equal(
                (await db.query(`select count(*)::int n from auth.sessions where user_id = $1`, [memberB])).rows[0].n,
                1
            );

            const reset1 = uuid();
            const op1 = uuid();
            const resetRes = await invokeHttp(
                {
                    operation: 'admin-reset-password',
                    projectRef: PROJECT_REF,
                    targetUserId: memberB,
                    resetId: reset1,
                    operationId: op1,
                    temporaryPassword: 'Reset1TempPassword-B!'
                },
                adminSession.token
            );
            assert.equal(resetRes.status, 200);
            assert.equal(resetRes.body.state, 'AWAITING_USER_CHANGE');
            assert.equal(resetRes.body.mustChangePassword, true);
            assert.equal(
                (await db.query(`select count(*)::int n from auth.sessions where user_id = $1`, [memberB])).rows[0].n,
                0
            );

            // 1. Simulate a normal user sign-in (POST /auth/v1/token?grant_type=password) with the temporary password
            // where Supabase Auth rewrites auth.users.encrypted_password and updates last_sign_in_at & updated_at!
            const tempLoginSession = await createAuthSession(memberB);
            await db.query(
                `update auth.users
                    set encrypted_password = '$2a$12$rewrittenOnOrdinarySignInHashValue000000000000000',
                        last_sign_in_at = clock_timestamp() + interval '5 seconds',
                        updated_at = clock_timestamp() + interval '5 seconds'
                  where id = $1`,
                [memberB]
            );

            const profileAfterSignIn = (
                await db.query(`select must_change_password from public.profiles where id = $1`, [memberB])
            ).rows[0];
            const resetRowAfterSignIn = (
                await db.query(`select state, write_ticket_digest from cinevault_private.cp_password_resets where user_id = $1`, [memberB])
            ).rows[0];
            assert.equal(profileAfterSignIn.must_change_password, true);
            assert.equal(resetRowAfterSignIn.state, 'AWAITING_USER_CHANGE');
            assert.equal(resetRowAfterSignIn.write_ticket_digest, null);

            // 2. Unrelated updates to auth.users (metadata, email, updated_at) leave must_change_password = true
            await db.query(
                `update auth.users
                    set raw_user_meta_data = '{"theme":"dark"}'::jsonb,
                        raw_app_meta_data = '{"provider":"email"}'::jsonb,
                        updated_at = clock_timestamp() + interval '10 seconds'
                  where id = $1`,
                [memberB]
            );
            assert.equal(
                (await db.query(`select must_change_password from public.profiles where id = $1`, [memberB])).rows[0]
                    .must_change_password,
                true
            );

            // Attempting cp_complete_password_change without a claimed USER_CHANGE ticket rejects with 42501
            await assert.rejects(
                database.transaction(tx =>
                    tx.call('completePasswordChange', [PROJECT_REF, memberB, reset1, uuid(), uuid()])
                ),
                err => err.code === '42501'
            );
            assert.equal(
                (await db.query(`select must_change_password from public.profiles where id = $1`, [memberB])).rows[0]
                    .must_change_password,
                true
            );

            // 3. Valid self-service complete-password-change via cinevault-account-admin clears must_change_password=false
            const completeRes = await invokeHttp(
                {
                    operation: 'complete-password-change',
                    projectRef: PROJECT_REF,
                    resetId: reset1,
                    operationId: uuid(),
                    newPassword: 'ViewerChosenFinalPass-B!'
                },
                tempLoginSession.token
            );
            assert.equal(completeRes.status, 200);
            assert.equal(completeRes.body.state, 'COMPLETED');
            assert.equal(completeRes.body.mustChangePassword, false);
            assert.equal(authUsers.get(memberB).password, 'ViewerChosenFinalPass-B!');
            assert.equal(
                (await db.query(`select must_change_password from public.profiles where id = $1`, [memberB])).rows[0]
                    .must_change_password,
                false
            );
            assert.equal(
                (await db.query(`select count(*)::int n from auth.sessions where user_id = $1`, [memberB])).rows[0].n,
                0
            );
        });

        // =========================================================================
        // T4c — Pre-Write Protection Against Delayed & Overlapping Resets
        // =========================================================================
        await t.test('T4c: pre-write claim prevents a delayed older reset from calling Auth Admin API and blocks overlapping resets', async () => {
            const adminSession = await createAuthSession(projectAdmin.id);
            const createRes = await invokeHttp(
                {
                    operation: 'admin-create-user',
                    projectRef: PROJECT_REF,
                    email: 'disp-member-c@example.invalid',
                    displayName: 'Disposable Member C',
                    temporaryPassword: 'InitialTempPassword-C!',
                    resetId: uuid()
                },
                adminSession.token
            );
            assert.equal(createRes.status, 200);
            const memberC = createRes.body.userId;
            const callsBefore = authAdminWriteCalls.filter(c => c.targetId === memberC).length;
            assert.equal(callsBefore, 0);

            // Case A: Delayed older reset (reset_1) wakes up after newer reset (reset_2) has written its password
            const reset1 = uuid();
            const reset2 = uuid();

            // 1. reset_1 runs cp_begin_password_reset and pauses before cp_claim_password_write
            const begun1 = await service.beginAdminReset(
                { projectRef: PROJECT_REF, targetUserId: memberC, resetId: reset1 },
                adminSession.token
            );
            assert.equal(begun1.state, 'RESERVED');
            assert.equal(begun1.resetGeneration, 2);

            // 2. Newer reset_2 runs to completion and writes 'TempPassword-Reset2!'
            const reset2Res = await invokeHttp(
                {
                    operation: 'admin-reset-password',
                    projectRef: PROJECT_REF,
                    targetUserId: memberC,
                    resetId: reset2,
                    operationId: uuid(),
                    temporaryPassword: 'TempPassword-Reset2!'
                },
                adminSession.token
            );
            assert.equal(reset2Res.status, 200);
            assert.equal(reset2Res.body.state, 'AWAITING_USER_CHANGE');
            assert.equal(reset2Res.body.resetGeneration, 3);
            assert.equal(authUsers.get(memberC).password, 'TempPassword-Reset2!');
            assert.equal(authAdminWriteCalls.filter(c => c.targetId === memberC).length, 1);

            // 3. Delayed reset_1 resumes and attempts claimAndExecuteAdminReset:
            // Must reject with reset_superseded BEFORE calling Auth Admin PUT!
            await assert.rejects(
                service.claimAndExecuteAdminReset(
                    {
                        projectRef: PROJECT_REF,
                        targetUserId: memberC,
                        resetId: reset1,
                        operationId: uuid(),
                        temporaryPassword: 'TempPassword-Reset1-Stale!'
                    },
                    adminSession.token
                ),
                err => err.kind === 'reset_superseded'
            );

            // Verify Auth Admin API was NOT called by delayed reset_1 and password is still 'TempPassword-Reset2!'
            assert.equal(authAdminWriteCalls.filter(c => c.targetId === memberC).length, 1);
            assert.equal(authUsers.get(memberC).password, 'TempPassword-Reset2!');

            // Case B: Overlapping reset arrives while an Auth Admin PUT is in flight (ADMIN_RESET_CLAIMED)
            let releaseInFlight;
            const inFlightGate = new Promise(resolve => {
                releaseInFlight = resolve;
            });
            let putEnteredResolve;
            const putEntered = new Promise(resolve => {
                putEnteredResolve = resolve;
            });

            customPutBehavior = async ({ targetId }) => {
                putEnteredResolve();
                await inFlightGate;
                const u = authUsers.get(targetId);
                u.password = 'TempPassword-InFlight3!';
                return new Response(
                    JSON.stringify({ id: u.id, email: u.email, is_anonymous: false }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
            };

            try {
                const reset3 = uuid();
                const inFlightPromise = invokeHttp(
                    {
                        operation: 'admin-reset-password',
                        projectRef: PROJECT_REF,
                        targetUserId: memberC,
                        resetId: reset3,
                        operationId: uuid(),
                        temporaryPassword: 'TempPassword-InFlight3!'
                    },
                    adminSession.token
                );
                await putEntered;

                // While reset3 is in flight (state = ADMIN_RESET_CLAIMED), overlapping reset4 arrives
                const overlappingRes = await invokeHttp(
                    {
                        operation: 'admin-reset-password',
                        projectRef: PROJECT_REF,
                        targetUserId: memberC,
                        resetId: uuid(),
                        operationId: uuid(),
                        temporaryPassword: 'TempPassword-Overlap4!'
                    },
                    adminSession.token
                );
                assert.equal(overlappingRes.status, 409);
                assert.equal(overlappingRes.body.error, 'password_reset_unresolved');
                // Only 1 new Auth Admin write was dispatched (for reset3, none for overlapping reset4)
                assert.equal(authAdminWriteCalls.filter(c => c.targetId === memberC).length, 2);

                releaseInFlight();
                const settled3 = await inFlightPromise;
                assert.equal(settled3.status, 200);
                assert.equal(settled3.body.state, 'AWAITING_USER_CHANGE');
            } finally {
                customPutBehavior = null;
            }
        });

        // =========================================================================
        // T4d — Mandatory Test: Client Times Out on reset_1, Second Reset Arrives,
        // Operator Attempts Recovery After 60 Seconds While Original Write Is STILL Pending,
        // and Original Write Applies Late (Verify NO Second Auth Admin Write Is Sent)
        // =========================================================================
        await t.test('T4d: timeout on reset_1 enters durable WRITE_OUTCOME_UNCERTAIN, blocks reset_2 at t=10s, keeps writes blocked at t=61s while op_1 is still pending upstream, and sends no second Auth Admin write even after op_1 applies late at t=75s', async () => {
            const adminSession = await createAuthSession(projectAdmin.id);
            const owner1Session = await createAuthSession(owner1.id);

            const createRes = await invokeHttp(
                {
                    operation: 'admin-create-user',
                    projectRef: PROJECT_REF,
                    email: 'disp-member-d@example.invalid',
                    displayName: 'Disposable Member D',
                    temporaryPassword: 'InitialPassword-MemberD!',
                    resetId: uuid()
                },
                adminSession.token
            );
            assert.equal(createRes.status, 200);
            const memberD = createRes.body.userId;

            // Enable memberD on instance1 as installation owner1 so we can also verify membership quarantine
            await db.exec('begin');
            await db.exec('set local role authenticated');
            await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [owner1.id]);
            await db.query(
                `select set_config('request.jwt.claims', $1, true)`,
                [JSON.stringify({ sub: owner1.id, session_id: owner1Session.sessionId, exp: Math.floor(currentNow / 1000) + 300 })]
            );
            await db.query(
                `select public.manage_server_member($1, $2, $3, 'USER', true, false, false)`,
                [PROJECT_REF, instance1, memberD]
            );
            await db.exec('reset role; commit');

            // Complete initial password change so memberD starts in COMPLETED with must_change_password=false
            const initialTempSession = await createAuthSession(memberD);
            const initialComplete = await invokeHttp(
                {
                    operation: 'complete-password-change',
                    projectRef: PROJECT_REF,
                    resetId: createRes.body.resetId,
                    operationId: uuid(),
                    newPassword: 'ConfirmedPassword-MemberD-0!'
                },
                initialTempSession.token
            );
            assert.equal(initialComplete.status, 200);
            assert.equal(initialComplete.body.mustChangePassword, false);

            // Reset call counter baseline for memberD's admin resets
            const baselineCallCount = authAdminWriteCalls.filter(c => c.targetId === memberD).length;
            assert.equal(baselineCallCount, 1);

            // Configure upstream mock Auth Admin handler so op_1 stalls past the client timeout
            // and remains pending in flight until we explicitly release it at t = 75s!
            let releaseStalledUpstreamWrite;
            const stalledUpstreamGate = new Promise(resolve => {
                releaseStalledUpstreamWrite = resolve;
            });
            let upstreamWriteSettled = false;
            let delayedUpstreamCompletionPromise;

            customPutBehavior = ({ targetId, body }) => {
                delayedUpstreamCompletionPromise = (async () => {
                    await stalledUpstreamGate;
                    const u = authUsers.get(targetId);
                    u.password = body.password;
                    u.encrypted_password = `$2a$10$late_applied_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
                    upstreamWriteSettled = true;
                })();
                // Never resolves before client timeoutMs (200ms) fires!
                return new Promise(() => {});
            };

            try {
                // -----------------------------------------------------------------
                // Step 1 (t = 0s..5s): reset_1 claims write slot, dispatches Call #1,
                // and client times out while op_1 is STILL PENDING upstream.
                // -----------------------------------------------------------------
                const reset1 = uuid();
                const op1 = uuid();
                const reset1Res = await invokeHttp(
                    {
                        operation: 'admin-reset-password',
                        projectRef: PROJECT_REF,
                        targetUserId: memberD,
                        resetId: reset1,
                        operationId: op1,
                        temporaryPassword: 'TempPassword-D-Reset1!'
                    },
                    adminSession.token
                );

                assert.equal(reset1Res.status, 503);
                assert.deepEqual(reset1Res.body, {
                    error: 'password_write_outcome_uncertain',
                    resetId: reset1,
                    operationId: op1
                });

                // Upstream op_1 is STILL pending (has not written yet)
                assert.equal(upstreamWriteSettled, false);
                assert.equal(authUsers.get(memberD).password, 'ConfirmedPassword-MemberD-0!');
                assert.equal(
                    authAdminWriteCalls.filter(c => c.targetId === memberD).length - baselineCallCount,
                    1
                );

                // Verify durable state in PostgreSQL
                const stateAfterTimeout = (
                    await db.query(
                        `select reset_id, state, in_flight_operation_id, claimed_kind,
                                write_ticket_digest, uncertain_reason
                           from cinevault_private.cp_password_resets
                          where user_id = $1`,
                        [memberD]
                    )
                ).rows[0];
                assert.deepEqual(stateAfterTimeout, {
                    reset_id: reset1,
                    state: 'WRITE_OUTCOME_UNCERTAIN',
                    in_flight_operation_id: op1,
                    claimed_kind: 'ADMIN_RESET',
                    write_ticket_digest: null,
                    uncertain_reason: 'timeout'
                });
                assert.equal(
                    (await db.query(`select must_change_password from public.profiles where id = $1`, [memberD]))
                        .rows[0].must_change_password,
                    true
                );

                // -----------------------------------------------------------------
                // Step 2 (t = 10s): Second reset (reset_2) arrives before reset_1 is resolved
                // -----------------------------------------------------------------
                const reset2Res = await invokeHttp(
                    {
                        operation: 'admin-reset-password',
                        projectRef: PROJECT_REF,
                        targetUserId: memberD,
                        resetId: uuid(),
                        operationId: uuid(),
                        temporaryPassword: 'TempPassword-D-Reset2!'
                    },
                    adminSession.token
                );
                assert.equal(reset2Res.status, 409);
                assert.equal(reset2Res.body.error, 'password_reset_unresolved');
                assert.equal(
                    authAdminWriteCalls.filter(c => c.targetId === memberD).length - baselineCallCount,
                    1,
                    'No second Auth Admin write may be sent at t=10s'
                );

                // -----------------------------------------------------------------
                // Step 3 (t = 61s): > 60 seconds elapse while original write op_1 is STILL PENDING!
                // Operator & admin attempt recovery / reset_3 after 60 seconds.
                // -----------------------------------------------------------------
                await db.query(
                    `update cinevault_private.cp_password_resets
                        set claimed_at = clock_timestamp() - interval '61 seconds',
                            uncertain_at = clock_timestamp() - interval '61 seconds',
                            updated_at = clock_timestamp() - interval '61 seconds'
                      where user_id = $1`,
                    [memberD]
                );
                const elapsedSeconds = (
                    await db.query(
                        `select extract(epoch from (clock_timestamp() - claimed_at))::int as elapsed
                           from cinevault_private.cp_password_resets
                          where user_id = $1`,
                        [memberD]
                    )
                ).rows[0].elapsed;
                assert.ok(elapsedSeconds >= 61, `Expected >= 61s elapsed, got ${elapsedSeconds}s`);
                assert.equal(upstreamWriteSettled, false, 'Original write op_1 must STILL be pending at t=61s');
                assert.equal(authUsers.get(memberD).password, 'ConfirmedPassword-MemberD-0!');

                // Attempt recovery reset_3 via cinevault-account-admin HTTP endpoint after 60 seconds
                const reset3 = uuid();
                const reset3Res = await invokeHttp(
                    {
                        operation: 'admin-reset-password',
                        projectRef: PROJECT_REF,
                        targetUserId: memberD,
                        resetId: reset3,
                        operationId: uuid(),
                        temporaryPassword: 'TempPassword-D-Reset3-After60s!'
                    },
                    adminSession.token
                );
                assert.equal(reset3Res.status, 409);
                assert.equal(reset3Res.body.error, 'password_reset_unresolved');

                // Attempt direct SQL cp_begin_password_reset and cp_claim_password_write after 60 seconds
                await assert.rejects(
                    database.transaction(tx =>
                        tx.call('beginPasswordReset', [
                            PROJECT_REF,
                            projectAdmin.id,
                            adminSession.sessionId,
                            new Date(currentNow + 300_000),
                            memberD,
                            reset3
                        ])
                    ),
                    err => err.code === 'P0001' && err.message === 'cp_reset_unresolved'
                );
                await assert.rejects(
                    database.transaction(tx =>
                        tx.call('claimPasswordWrite', [
                            PROJECT_REF,
                            memberD,
                            reset1,
                            uuid(),
                            'ADMIN_RESET',
                            projectAdmin.id,
                            adminSession.sessionId,
                            new Date(currentNow + 300_000)
                        ])
                    ),
                    err => err.code === 'P0001' && err.message === 'cp_reset_unresolved'
                );

                // Verify NO second Auth Admin write was sent after 60s recovery attempt!
                assert.equal(
                    authAdminWriteCalls.filter(c => c.targetId === memberD).length - baselineCallCount,
                    1,
                    'No second Auth Admin write may be sent at t=61s while op_1 is still pending'
                );

                // Operator runs Stage 1 containment: cp_quarantine_uncertain_account
                const quarantineResult = (
                    await db.query(
                        `select cinevault_private.cp_quarantine_uncertain_account($1, $2, $3, $4) as result`,
                        [PROJECT_REF, memberD, reset1, op1]
                    )
                ).rows[0].result;
                assert.deepEqual(quarantineResult, {
                    projectRef: PROJECT_REF,
                    userId: memberD,
                    resetId: reset1,
                    resetGeneration: 2,
                    operationId: op1,
                    state: 'WRITE_OUTCOME_UNCERTAIN',
                    blocked: true,
                    mustChangePassword: true,
                    disabledMemberships: 1,
                    revokedSessions: 0
                });

                // Attempt reset after quarantine at t=61s while op_1 is still pending -> still blocked, zero new writes
                const postQuarantineReset = await invokeHttp(
                    {
                        operation: 'admin-reset-password',
                        projectRef: PROJECT_REF,
                        targetUserId: memberD,
                        resetId: uuid(),
                        operationId: uuid(),
                        temporaryPassword: 'TempPassword-D-PostQuarantine!'
                    },
                    adminSession.token
                );
                assert.equal(postQuarantineReset.status, 409);
                assert.equal(postQuarantineReset.body.error, 'password_reset_unresolved');
                assert.equal(
                    authAdminWriteCalls.filter(c => c.targetId === memberD).length - baselineCallCount,
                    1
                );

                // -----------------------------------------------------------------
                // Step 4 (t = 75s): The still-pending op_1 finally finishes and writes
                // tempPassword_1 in the upstream Auth server after the 60s recovery attempt!
                // -----------------------------------------------------------------
                releaseStalledUpstreamWrite();
                await delayedUpstreamCompletionPromise;
                assert.equal(upstreamWriteSettled, true);
                assert.equal(authUsers.get(memberD).password, 'TempPassword-D-Reset1!');

                // Verify that even after op_1 applies late at t=75s, memberD remains permanently blocked
                const lateReset4 = await invokeHttp(
                    {
                        operation: 'admin-reset-password',
                        projectRef: PROJECT_REF,
                        targetUserId: memberD,
                        resetId: uuid(),
                        operationId: uuid(),
                        temporaryPassword: 'TempPassword-D-Reset4!'
                    },
                    adminSession.token
                );
                assert.equal(lateReset4.status, 409);
                assert.equal(lateReset4.body.error, 'password_reset_unresolved');

                const lateUserSession = await createAuthSession(memberD);
                const lateComplete = await invokeHttp(
                    {
                        operation: 'complete-password-change',
                        projectRef: PROJECT_REF,
                        resetId: reset1,
                        operationId: uuid(),
                        newPassword: 'LateViewerAttemptPassword!'
                    },
                    lateUserSession.token
                );
                assert.equal(lateComplete.status, 409);
                assert.equal(lateComplete.body.error, 'password_reset_unresolved');

                // Total Auth Admin password writes sent for memberD across the entire reset lifecycle is STILL 1!
                assert.equal(
                    authAdminWriteCalls.filter(c => c.targetId === memberD).length - baselineCallCount,
                    1,
                    'Total Auth Admin password writes for memberD must remain 1 across the entire test'
                );

                const finalProfile = (
                    await db.query(
                        `select blocked, must_change_password from public.profiles where id = $1`,
                        [memberD]
                    )
                ).rows[0];
                assert.deepEqual(finalProfile, { blocked: true, must_change_password: true });
                const finalMembership = (
                    await db.query(
                        `select enabled from public.server_users where server_id = $1 and user_id = $2`,
                        [cloudServer1, memberD]
                    )
                ).rows[0];
                assert.deepEqual(finalMembership, { enabled: false });
            } finally {
                customPutBehavior = null;
            }

            // Stage 2 of escalation path: provision clean replacement disposable account for the viewer
            const replacementCreate = await invokeHttp(
                {
                    operation: 'admin-create-user',
                    projectRef: PROJECT_REF,
                    email: 'disp-member-d-replacement@example.invalid',
                    displayName: 'Disposable Member D Replacement',
                    temporaryPassword: 'ReplacementTempPassword-D!',
                    resetId: uuid()
                },
                adminSession.token
            );
            assert.equal(replacementCreate.status, 200);
            const replacementId = replacementCreate.body.userId;
            assert.notEqual(replacementId, memberD);

            const replacementTempSession = await createAuthSession(replacementId);
            const replacementComplete = await invokeHttp(
                {
                    operation: 'complete-password-change',
                    projectRef: PROJECT_REF,
                    resetId: replacementCreate.body.resetId,
                    operationId: uuid(),
                    newPassword: 'ReplacementFinalPassword-D!'
                },
                replacementTempSession.token
            );
            assert.equal(replacementComplete.status, 200);
            assert.equal(replacementComplete.body.mustChangePassword, false);
        });
    } finally {
        await db.close();
    }
});
