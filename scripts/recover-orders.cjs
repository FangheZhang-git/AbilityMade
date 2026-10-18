// Run only from an authenticated administrator shell. No HTTP route.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createPayments } = require('../payments');
const { sessionPattern, createRecovery } = require('../recovery');
async function main(args = process.argv.slice(2), { env = process.env, fetchImpl, report = console.log } = {}) {
  const sessions = []; let target, environment, write = false, discover = false, from, to;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--discover') discover = true;
    else if (args[i] === '--from') from = Number(args[++i]);
    else if (args[i] === '--to') to = Number(args[++i]);
    else if (args[i] === '--session') sessions.push(args[++i]);
    else if (args[i] === '--target') target = args[++i];
    else if (args[i] === '--environment') environment = args[++i];
    else if (args[i] === '--write-reviewed') write = true;
    else throw new Error('invalid_arguments');
  }
  if (!['staging', 'production', 'local'].includes(environment)) throw new Error('invalid_arguments');
  if (discover ? (sessions.length || target || write) : (!sessions.length || sessions.length > 20 || from !== undefined || to !== undefined || sessions.some(s => !sessionPattern.test(s || '')) || !target || !path.isAbsolute(target))) throw new Error('invalid_arguments');
  if (env.RAILWAY_ENVIRONMENT_NAME && env.RAILWAY_ENVIRONMENT_NAME !== environment) throw new Error('environment_mismatch');
  if (environment === 'staging' && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || '')) throw new Error('environment_mismatch');
  if (environment === 'production' && !/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '')) throw new Error('environment_mismatch');
  if (discover) {
    const recovery = createRecovery({ env: { ...env, PAYMENT_ENVIRONMENT: environment }, fetchImpl: fetchImpl || ((...args) => fetch(...args)) });
    const result = await recovery.discover({ from, to });
    report(JSON.stringify({ mode: 'discovery', ...result }));
    return;
  }
  // Require a pre-created, private, empty destination, including for dry runs.
  const actual = await fs.realpath(target), st = await fs.stat(actual);
  const root = path.resolve(__dirname, '..');
  if (actual !== path.resolve(target) || !st.isDirectory() || (st.mode & 0o077) ||
      actual === root || actual.startsWith(root + path.sep) || (await fs.readdir(actual)).length) throw new Error('unsafe_target');
  const payments = createPayments({ env: { ...env, PAYMENT_ENVIRONMENT: environment, ORDER_DATA_DIR: actual }, ...(fetchImpl ? { fetchImpl } : {}) });
  let verified = 0, failed = 0;
  for (const id of new Set(sessions)) {
    try { await payments.recover(id, { write }); verified++; }
    catch { failed++; }
  }
  report(JSON.stringify({ mode: write ? 'write' : 'dry-run', verified, failed, complete: failed === 0 }));
  if (failed) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { console.error('Recovery stopped: check arguments, private empty target, environment and provider access.'); process.exitCode = 1; });
module.exports = { main };
