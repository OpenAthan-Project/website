import { appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import {
  deployedMetadata,
  freshSelection,
  metadata,
  needsDeployment,
  parseSelection,
  readPolicy,
  resolveRelease,
  writeSelection,
} from './release-selection.ts';

const { policy, policySha256 } = await readPolicy();
const output = async (name: string, value: string) => {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
if (process.argv.includes('--freshness')) {
  const selection = parseSelection(JSON.parse(process.env.RELEASE_SNAPSHOT ?? 'null'));
  if (selection.policySha256 !== policySha256 || selection.automatic !== policy.automatic)
    throw new Error('Deployment policy differs from the tested snapshot.');
  const fresh = await freshSelection(selection, policy);
  await output('fresh', String(fresh));
  console.log(
    fresh ? 'Tested selection is still current.' : 'Selection superseded; deployment skipped.',
  );
} else {
  const websiteCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const selection = parseSelection({
    schema: 1,
    automatic: policy.automatic,
    ...(policy.usbUpdateEnabled === undefined ? {} : { usbUpdateEnabled: policy.usbUpdateEnabled }),
    policySha256,
    websiteCommit,
    release: await resolveRelease(policy),
  });
  const changed =
    process.argv.includes('--deployed') || process.argv.includes('--poll')
      ? needsDeployment(metadata(selection), await deployedMetadata())
      : true;
  await writeSelection(selection);
  await output('snapshot', JSON.stringify(selection));
  await output('changed', String(changed || !process.argv.includes('--poll')));
  console.log(
    `${selection.release?.tag ?? 'Recovery only'} selected; ${changed ? 'validation required' : 'already deployed'}.`,
  );
}
