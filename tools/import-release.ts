/** Explicit, pinned public-release import. Does not build firmware or touch hardware. */
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkedManifest, parsePin, verifyBundle } from '../installer/release.ts';

const root = resolve(import.meta.dirname, '..');
const pin = parsePin(JSON.parse(await readFile(resolve(root, 'installer/catalog.json'), 'utf8')));
if (!pin) {
  console.log('No reviewed release is selected. No artifacts downloaded.');
} else {
  const api = 'https://api.github.com/repos/OpenAthan-Project/openathan';
  const get = async (url: string, maximum: number) => {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Release download failed (${response.status}).`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maximum) throw new Error('Release download exceeds its permitted size.');
      chunks.push(chunk);
    }
    return new Uint8Array(Buffer.concat(chunks));
  };
  const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
  const release = parse(await get(`${api}/releases/tags/${pin.tag}`, 1_000_000));
  if (
    release.draft !== false ||
    release.prerelease !== false ||
    release.tag_name !== pin.tag ||
    !release.published_at ||
    !Array.isArray(release.assets)
  )
    throw new Error('Only a published stable release can be imported.');
  const asset = async (name: string, maximum: number) => {
    const found = release.assets.filter((item: { name: string }) => item.name === name);
    const expected = `https://github.com/OpenAthan-Project/openathan/releases/download/${pin.tag}/${name}`;
    if (
      found.length !== 1 ||
      found[0].browser_download_url !== expected ||
      !Number.isSafeInteger(found[0].size) ||
      found[0].size > maximum ||
      found[0].size < 1
    )
      throw new Error(`Missing or invalid release asset: ${name}`);
    return get(expected, maximum);
  };
  const manifestBytes = await asset('manifest.json', 16_384);
  const manifest = await checkedManifest(manifestBytes, pin);
  const commit = parse(await get(`${api}/commits/${pin.tag}`, 1_000_000));
  if (commit.sha !== manifest.commit)
    throw new Error('The release tag does not match the reviewed source commit.');
  const inputs = new Map<string, Uint8Array>();
  for (const part of manifest.parts) inputs.set(part.file, await asset(part.file, part.bytes));
  await verifyBundle(manifest, inputs);
  const directory = resolve(root, 'public/releases', pin.tag);
  const temporary = `${directory}.importing`;
  await rm(temporary, { force: true, recursive: true });
  try {
    await mkdir(temporary, { recursive: true });
    await writeFile(resolve(temporary, 'manifest.json'), manifestBytes);
    for (const [name, bytes] of inputs) await writeFile(resolve(temporary, name), bytes);
    await rm(directory, { force: true, recursive: true });
    await rename(temporary, directory);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
  console.log(
    `Imported and verified ${pin.tag}. Hardware qualification remains a separate recorded release requirement.`,
  );
}
