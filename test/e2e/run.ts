/**
 * End-to-end tests against REAL MongoDB + Redis and two real server processes.
 *   npm run test:e2e
 * Needs MongoDB and Redis running locally (see helpers.ts for the env vars),
 * and `openssl` on the PATH (for the fake push service's certificate).
 */
import { agentsE2E } from './agents.e2e.js';
import { chatE2E } from './chat.e2e.js';
import { failureCount } from './helpers.js';
import { pushMetricsE2E } from './push-metrics.e2e.js';

void (async () => {
  try {
    const only = process.argv[2]; // e.g. `npm run test:e2e -- push`
    if (!only || only === 'chat') await chatE2E();
    if (!only || only === 'agents') await agentsE2E();
    if (!only || only === 'push') await pushMetricsE2E();
  } catch (error) {
    console.error('E2E crashed:', error);
    process.exit(1);
  }
  const failures = failureCount();
  console.log(failures === 0 ? '\nAll end-to-end checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
