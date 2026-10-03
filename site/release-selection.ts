/** Server/build only. The browser receives this selection in the rendered installer. */
import { execFileSync } from 'node:child_process';
import { readPolicy, readSelection, metadata, type Selection } from '../tools/release-selection.ts';

export async function siteSelection(): Promise<Selection> {
  try {
    return await readSelection();
  } catch (error) {
    // Preview without an import remains useful. A stale or invalid snapshot never falls back.
    if (!import.meta.env.DEV || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const { policy, policySha256 } = await readPolicy();
    return {
      schema: 1,
      automatic: policy.automatic,
      policySha256,
      websiteCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      release: policy.pin,
    };
  }
}
export { metadata };
