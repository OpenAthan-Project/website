import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// Keep development/build telemetry disabled without writing global user settings.
const result = spawnSync(
  process.execPath,
  [resolve(import.meta.dirname, '../node_modules/astro/bin/astro.mjs'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  },
);
process.exit(result.status ?? 1);
