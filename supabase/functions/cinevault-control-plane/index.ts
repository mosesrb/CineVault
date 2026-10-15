// PREPARED, not deployed. No automatic owner or broad Supabase key provisioning.
import postgres from 'postgres'
import {createRuntime} from '../../broker/runtime.mjs'

const configuration={
  enabled:Deno.env.get('CV_BROKER_ENABLED')??'false',
  projectRef:Deno.env.get('CV_BROKER_PROJECT_REF')??'',
  databaseUrl:Deno.env.get('CV_BROKER_DATABASE_URL')??'',
  approvalOrigin:Deno.env.get('CV_BROKER_APPROVAL_ORIGIN')??'',
  publishableKey:Deno.env.get('CV_BROKER_PUBLISHABLE_KEY')??''
}
const runtime=createRuntime({configuration,postgres})
// Only foreground handlers; no waitUntil/timer/idle keepalive or secret logs.
Deno.serve(request=>runtime.handle(request))
