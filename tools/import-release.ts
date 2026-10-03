/** Import the frozen public release; never builds firmware or accesses hardware. */
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { checkedManifest, verifyBundle } from '../installer/release.ts';
import { publishedRelease, readSelection, releaseAsset } from './release-selection.ts';

const root = resolve(import.meta.dirname, '..');
// Local convenience: discover once. CI passes --snapshot to retain its tested selection.
if (!process.argv.includes('--snapshot'))
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', resolve(root, 'tools/select-release.ts')],
    { stdio: 'inherit' },
  );
const { release: pin } = await readSelection(root);
const directory = resolve(root, 'public/releases');
if (!pin) {
  await rm(directory, { force: true, recursive: true });
  console.log('Recovery only; generated firmware imports removed.');
} else {
  const release = await publishedRelease(pin.tag);
  const manifestBytes = await releaseAsset(release, 'manifest.json', 16_384);
  const manifest = await checkedManifest(manifestBytes, pin);
  const inputs = new Map<string, Uint8Array>();
  for (const part of manifest.parts)
    inputs.set(part.file, await releaseAsset(release, part.file, part.bytes));
  await verifyBundle(manifest, inputs);
  const temporary = resolve(root, 'build/release-import');
  await rm(temporary, { force: true, recursive: true });
  try {
    await mkdir(resolve(temporary, pin.tag), { recursive: true });
    await writeFile(resolve(temporary, pin.tag, 'manifest.json'), manifestBytes);
    for (const [name, bytes] of inputs) await writeFile(resolve(temporary, pin.tag, name), bytes);
    // Remove only generated imports, after every candidate byte has passed validation.
    await rm(directory, { force: true, recursive: true });
    await rename(temporary, directory);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
  console.log(
    `Imported and verified ${pin.tag}. Physical qualification remains recorded release evidence.`,
  );
}
