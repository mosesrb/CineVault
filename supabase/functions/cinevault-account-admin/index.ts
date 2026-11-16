// PREPARED, not deployed before PCC review & explicit operator approval.
// Reads its Auth Admin key and dedicated DB URL from project-wide Edge Function
// secrets. Other functions in the same Supabase project share that secret scope.
import postgres from 'postgres'
import { createAccountAdminRuntime } from '../../account-admin/runtime.mjs'

const configuration = {
  enabled: Deno.env.get('CV_ACCOUNT_ADMIN_ENABLED') ?? 'false',
  projectRef: Deno.env.get('CV_ACCOUNT_ADMIN_PROJECT_REF') ?? '',
  databaseUrl: Deno.env.get('CV_ACCOUNT_ADMIN_DATABASE_URL') ?? '',
  allowedOrigins: Deno.env.get('CV_ACCOUNT_ADMIN_ALLOWED_ORIGINS') ?? '',
  publishableKey: Deno.env.get('CV_ACCOUNT_ADMIN_PUBLISHABLE_KEY') ?? '',
  serviceRoleKey: Deno.env.get('CV_ACCOUNT_ADMIN_SERVICE_ROLE_KEY') ?? ''
}

const runtime = createAccountAdminRuntime({ configuration, postgres })
Deno.serve(request => runtime.handle(request))
