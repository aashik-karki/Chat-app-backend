/**
 * End-to-end tests against REAL MongoDB + Redis and two real server processes.
 *   npm run test:e2e
 * Needs MongoDB and Redis running locally (see helpers.ts for the env vars).
 */
import { agentsE2E } from './agents.e2e.js';
import { chatE2E } from './chat.e2e.js';
import { failureCount } from './helpers.js';

void (async () => {
  try {
    await chatE2E();
    await agentsE2E();
  } catch (error) {
    console.error('E2E crashed:', error);
    process.exit(1);
  }
  const failures = failureCount();
  console.log(failures === 0 ? '\nAll end-to-end checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
