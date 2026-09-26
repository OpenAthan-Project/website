import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { checkedManifest, parsePin, verifyBundle } from '../installer/release.ts';

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
const pin = parsePin(JSON.parse(await readFile(resolve(root, 'installer/catalog.json'), 'utf8')));
const binaries = output.filter((path) => path.endsWith('.bin'));
if (!pin && binaries.length)
  throw new Error(
    'No release is selected, but firmware binaries are present. Remove stale generated release files.',
  );
if (pin) {
  const directory = resolve(dist, 'releases', pin.tag);
  const manifest = await checkedManifest(
    new Uint8Array(await readFile(join(directory, 'manifest.json'))),
    pin,
  );
  const inputs = new Map();
  for (const part of manifest.parts)
    inputs.set(part.file, new Uint8Array(await readFile(join(directory, part.file))));
  await verifyBundle(manifest, inputs);
  if (binaries.length !== manifest.parts.length)
    throw new Error('Unexpected release binaries in static output.');
}
console.log(
  `Static output verified: ${output.filter((name) => name.endsWith('.html')).length} pages; simulator excluded; ${pin ? pin.tag : 'no firmware binaries'}.`,
);
