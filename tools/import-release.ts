/** Import the frozen public release; never builds firmware or accesses hardware. */
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  checkedManifest,
  verifyBundle,
  HARDWARE,
  assetName,
  type ReleasePin,
} from '../installer/release.ts';
import { verifyDescriptor, verifyApplication } from '../installer/upgrade.ts';
import { publishedRelease, readSelection, releaseAsset } from './release-selection.ts';

const root = resolve(import.meta.dirname, '..');
// Local convenience: discover once. CI passes --snapshot to retain its tested selection.
if (!process.argv.includes('--snapshot'))
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', resolve(root, 'tools/select-release.ts')],
    { stdio: 'inherit' },
  );
const selection = await readSelection(root);
const { release: pin } = selection;
const directory = resolve(root, 'public/releases');
if (!pin) {
  await rm(directory, { force: true, recursive: true });
  console.log('Recovery only; generated firmware imports removed.');
} else {
  const pins = [pin, ...Object.values(selection.hardwareReleases ?? {})] as ReleasePin[];
  const verified = new Map<string, Uint8Array>();
  let sourceCommit: string | undefined;
  for (const boardPin of pins) {
    const hardware = boardPin.hardware ?? HARDWARE;
    const release = await publishedRelease(boardPin.tag);
    const manifestBytes = await releaseAsset(release, assetName(hardware, 'manifest.json'), 16_384);
    const manifest = await checkedManifest(manifestBytes, boardPin);
    if (sourceCommit && sourceCommit !== manifest.commit)
      throw new Error('Hardware bundles use different source commits.');
    sourceCommit = manifest.commit;
    const inputs = new Map<string, Uint8Array>();
    for (const part of manifest.parts)
      inputs.set(part.file, await releaseAsset(release, part.file, part.bytes));
    await verifyBundle(manifest, inputs);
    const upgradeAssets = release.assets.filter(
      (asset) =>
        asset &&
        typeof asset === 'object' &&
        [assetName(hardware, 'upgrade.json'), assetName(hardware, 'firmware.ota.bin')].includes(
          (asset as { name: string }).name,
        ),
    );
    if (upgradeAssets.length) {
      if (upgradeAssets.length !== 2) throw new Error('Incomplete upgrade asset pair.');
      const descriptor = await releaseAsset(release, assetName(hardware, 'upgrade.json'), 8192),
        offer = await verifyDescriptor(descriptor, manifest);
      const application = await releaseAsset(
        release,
        assetName(hardware, 'firmware.ota.bin'),
        offer.bytes,
      );
      await verifyApplication(offer, application);
      const factory = inputs.get(assetName(hardware, 'firmware.factory.bin'));
      if (
        !factory ||
        factory.length !== 0x10000 + application.length ||
        !application.every((byte, i) => byte === factory[0x10000 + i])
      )
        throw new Error('Upgrade differs from the selected factory application.');
      inputs.set(assetName(hardware, 'upgrade.json'), descriptor);
      inputs.set(assetName(hardware, 'firmware.ota.bin'), application);
    }
    verified.set(assetName(hardware, 'manifest.json'), manifestBytes);
    for (const [name, bytes] of inputs) {
      const shared = verified.get(name);
      if (
        shared &&
        (shared.length !== bytes.length || !shared.every((byte, i) => byte === bytes[i]))
      )
        throw new Error('Shared hardware asset differs.');
      verified.set(name, bytes);
    }
  }
  const temporary = resolve(root, 'build/release-import');
  await rm(temporary, { force: true, recursive: true });
  try {
    await mkdir(resolve(temporary, pin.tag), { recursive: true });
    for (const [name, bytes] of verified) await writeFile(resolve(temporary, pin.tag, name), bytes);
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
