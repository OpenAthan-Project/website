import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { checkedManifest, verifyBundle, HARDWARE, assetName } from '../installer/release.ts';
import { verifyDescriptor, verifyApplication } from '../installer/upgrade.ts';
import { readSelection, metadata, parseMetadata } from './release-selection.ts';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
async function files(directory) {
  return (
    await Promise.all(
      (await readdir(directory)).map(async (name) => {
        const path = join(directory, name);
        return (await stat(path)).isDirectory() ? files(path) : path;
      }),
    )
  ).flat();
}
const output = await files(dist);
if (output.some((path) => path.startsWith(resolve(dist, 'preview') + '/')))
  throw new Error('Simulator routes must not ship in the static site.');
for (const path of output.filter((name) => name.endsWith('.js'))) {
  const script = await readFile(path, 'utf8');
  if (script.includes('lost-wifi-ack') || script.includes('data-demo-installer'))
    throw new Error('Simulator code leaked into the static site.');
}
for (const path of output.filter((name) => name.endsWith('.html'))) {
  const html = await readFile(path, 'utf8');
  if (html.includes('data-demo-installer'))
    throw new Error('Simulator markup leaked into the static site.');
  for (const [, href] of html.matchAll(/href="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    if (/^(?:https?:|mailto:|data:)/.test(href)) continue;
    let target = href.startsWith('/') ? resolve(dist, '.' + href) : resolve(dirname(path), href);
    const info = await stat(target).catch(() => null);
    if (info?.isDirectory()) target = join(target, 'index.html');
    if (!(await stat(target).catch(() => null))?.isFile())
      throw new Error(`Broken local link: ${href}`);
  }
}
const selection = await readSelection(root);
const pin = selection.release;
const served = parseMetadata(JSON.parse(await readFile(resolve(dist, 'release.json'), 'utf8')));
if (JSON.stringify(served) !== JSON.stringify(metadata(selection)))
  throw new Error('Static metadata differs from the selected release.');
const installer = await readFile(resolve(dist, 'install/index.html'), 'utf8');
const attribute = installer.match(/data-release-selection="([^"]*)"/)?.[1];
const decoded = attribute
  ?.replace(/&quot;/g, '"')
  .replace(/&#(?:39|x27);/g, "'")
  .replace(/&amp;/g, '&');
if (!decoded || JSON.stringify(JSON.parse(decoded)) !== JSON.stringify(selection))
  throw new Error('Installer selection differs from the selected release.');
const binaries = output.filter((path) => path.endsWith('.bin'));
if (!pin && binaries.length)
  throw new Error(
    'No release is selected, but firmware binaries are present. Remove stale generated release files.',
  );
if (pin) {
  const expectedBinaries = new Set();
  for (const boardPin of [pin, ...Object.values(selection.hardwareReleases ?? {})]) {
    const hardware = boardPin.hardware ?? HARDWARE;
    const directory = resolve(dist, 'releases', pin.tag);
    const manifest = await checkedManifest(
      new Uint8Array(await readFile(join(directory, assetName(hardware, 'manifest.json')))),
      boardPin,
    );
    const inputs = new Map();
    for (const part of manifest.parts)
      inputs.set(part.file, new Uint8Array(await readFile(join(directory, part.file))));
    await verifyBundle(manifest, inputs);
    const otaPath = join(directory, assetName(hardware, 'firmware.ota.bin'));
    const descriptorPath = join(directory, assetName(hardware, 'upgrade.json'));
    const hasOta = output.includes(otaPath),
      hasDescriptor = output.includes(descriptorPath);
    if (hasOta !== hasDescriptor || (selection.usbUpdateEnabled && !hasOta))
      throw new Error('Selected USB update artifacts are incomplete.');
    if (hasOta) {
      const offer = await verifyDescriptor(
        new Uint8Array(await readFile(descriptorPath)),
        manifest,
      );
      const application = new Uint8Array(await readFile(otaPath));
      await verifyApplication(offer, application);
      const factory = inputs.get(manifest.parts.find((part) => part.role === 'factory').file);
      if (
        factory.length !== 0x10000 + application.length ||
        !application.every((byte, i) => byte === factory[0x10000 + i])
      )
        throw new Error('USB application differs from the verified factory image.');
    }
    for (const part of manifest.parts) expectedBinaries.add(join(directory, part.file));
    if (hasOta) expectedBinaries.add(otaPath);
  }
  if (
    binaries.length !== expectedBinaries.size ||
    binaries.some((path) => !expectedBinaries.has(path))
  )
    throw new Error('Unexpected release binaries in static output.');
}
console.log(
  `Static output verified: ${output.filter((name) => name.endsWith('.html')).length} pages; simulator excluded; ${pin ? pin.tag : 'no firmware binaries'}.`,
);
