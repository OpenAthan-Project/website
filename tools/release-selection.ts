/** Build-only release discovery. Publication as stable latest is the human approval gate. */
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkedManifest, parsePin, sha256, type ReleasePin } from '../installer/release.ts';

export const FIRMWARE_API = 'https://api.github.com/repos/OpenAthan-Project/openathan';
export const WEBSITE_API = 'https://api.github.com/repos/OpenAthan-Project/website';
export const DEPLOYED_METADATA = 'https://openathan.com/release.json';
export interface Policy {
  automatic: boolean;
  pin: ReleasePin | null;
}
export interface Selection {
  schema: 1;
  automatic: boolean;
  policySha256: string;
  websiteCommit: string;
  release: ReleasePin | null;
}
export interface Metadata {
  schema: 1;
  websiteCommit: string;
  release: { tag: string; manifestSha256: string } | null;
}
export function parsePolicy(value: unknown): Policy {
  const pin = parsePin(value);
  const automatic = (value as { automatic?: unknown }).automatic;
  if (automatic !== undefined && typeof automatic !== 'boolean')
    throw new Error('Invalid automatic release policy.');
  return { automatic: automatic === true, pin };
}
export function parseSelection(value: unknown): Selection {
  const pin = parsePin(value);
  const s = value as Selection;
  if (
    typeof s.automatic !== 'boolean' ||
    typeof s.policySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(s.policySha256) ||
    typeof s.websiteCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(s.websiteCommit)
  )
    throw new Error('Invalid build release selection.');
  return { ...s, release: pin };
}
export function metadata(selection: Selection): Metadata {
  return {
    schema: 1,
    websiteCommit: selection.websiteCommit,
    release: selection.release && {
      tag: selection.release.tag,
      manifestSha256: selection.release.manifestSha256,
    },
  };
}
export function parseMetadata(value: unknown): Metadata {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid deployed release metadata.');
  const m = value as Metadata;
  const s = parseSelection({
    ...m,
    automatic: false,
    policySha256: '0'.repeat(64),
    release:
      m.release === null ? null : { ...m.release, mediaReviewed: true, hardwareQualified: true },
  });
  return metadata(s);
}
export function sameRelease(a: Metadata['release'], b: Metadata['release']): boolean {
  return a?.tag === b?.tag && a?.manifestSha256 === b?.manifestSha256;
}
export function needsDeployment(candidate: Metadata, deployed: Metadata | null): boolean {
  if (
    candidate.release &&
    deployed?.release &&
    candidate.release.tag === deployed.release.tag &&
    candidate.release.manifestSha256 !== deployed.release.manifestSha256
  )
    throw new Error('A served release tag has changed its manifest. Publish a new release tag.');
  return (
    !deployed ||
    !sameRelease(candidate.release, deployed.release) ||
    candidate.websiteCommit !== deployed.websiteCommit
  );
}
/** Bound streamed bytes even when Content-Length is absent or incorrect. */
export async function download(
  url: string,
  maximum: number,
  fetcher: typeof fetch = fetch,
  allowMissing = false,
): Promise<Uint8Array | null> {
  // Use only the workflow's existing read token, and only for the fixed public GitHub APIs.
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com/repos/OpenAthan-Project/'))
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetcher(url, {
    headers,
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
    credentials: 'omit',
  });
  if (allowMissing && response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Release download failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maximum);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes.subarray(0, size);
      if (value.length > maximum - size)
        throw new Error('Release download exceeds its permitted size.');
      bytes.set(value, size);
      size += value.length;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export const parseBytes = (bytes: Uint8Array) =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;

export async function publishedRelease(tag: string | null, fetcher: typeof fetch = fetch) {
  const release = parseBytes(
    (await download(
      `${FIRMWARE_API}/releases/${tag ? `tags/${tag}` : 'latest'}`,
      1_000_000,
      fetcher,
    ))!,
  ) as {
    draft: boolean;
    prerelease: boolean;
    tag_name: string;
    published_at: string;
    assets: unknown[];
  };
  if (
    !release ||
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== 'string' ||
    !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(release.tag_name) ||
    (tag && release.tag_name !== tag) ||
    !release.published_at ||
    !Array.isArray(release.assets)
  )
    throw new Error('Only a published stable release can be imported.');
  return release;
}
export async function releaseAsset(
  release: Awaited<ReturnType<typeof publishedRelease>>,
  name: string,
  maximum: number,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const found = release.assets.filter(
    (item) => !!item && typeof item === 'object' && (item as { name?: string }).name === name,
  ) as { browser_download_url: string; size: number }[];
  const expected = `https://github.com/OpenAthan-Project/openathan/releases/download/${release.tag_name}/${name}`;
  if (
    found.length !== 1 ||
    found[0]!.browser_download_url !== expected ||
    !Number.isSafeInteger(found[0]!.size) ||
    found[0]!.size < 1 ||
    found[0]!.size > maximum
  )
    throw new Error(`Missing or invalid release asset: ${name}`);
  const bytes = (await download(expected, maximum, fetcher))!;
  if (bytes.length !== found[0]!.size) throw new Error(`Release asset size changed: ${name}`);
  return bytes;
}
export async function resolveRelease(
  policy: Policy,
  fetcher: typeof fetch = fetch,
): Promise<ReleasePin | null> {
  // Null takes precedence over automatic discovery and never queries firmware.
  if (!policy.pin) return null;
  const release = await publishedRelease(policy.automatic ? null : policy.pin.tag, fetcher);
  const bytes = await releaseAsset(release, 'manifest.json', 16_384, fetcher);
  const pin: ReleasePin = policy.automatic
    ? {
        tag: release.tag_name,
        manifestSha256: await sha256(bytes),
        mediaReviewed: true,
        hardwareQualified: true,
      }
    : policy.pin;
  const manifest = await checkedManifest(bytes, pin);
  if (pin.tag === policy.pin.tag && pin.manifestSha256 !== policy.pin.manifestSha256)
    throw new Error(
      'The approved manual release tag has changed its manifest. Publish a new release tag.',
    );
  const commit = parseBytes(
    (await download(`${FIRMWARE_API}/commits/${pin.tag}`, 1_000_000, fetcher))!,
  ) as { sha: string };
  if (commit?.sha !== manifest.commit)
    throw new Error('Release tag does not match its source commit.');
  return pin;
}
export async function deployedMetadata(fetcher: typeof fetch = fetch): Promise<Metadata | null> {
  const bytes = await download(DEPLOYED_METADATA, 4096, fetcher, true);
  return bytes === null ? null : parseMetadata(parseBytes(bytes));
}
export async function freshSelection(
  selection: Selection,
  policy: Policy,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const head = parseBytes((await download(`${WEBSITE_API}/commits/main`, 1_000_000, fetcher))!) as {
    sha: string;
  };
  if (typeof head?.sha !== 'string' || !/^[a-f0-9]{40}$/.test(head.sha))
    throw new Error('Invalid website main commit.');
  if (head.sha !== selection.websiteCommit) return false;
  const release = await resolveRelease(policy, fetcher);
  // Also detect tag mutation against the currently served release at deployment time.
  needsDeployment(metadata({ ...selection, release }), await deployedMetadata(fetcher));
  return sameRelease(release, selection.release);
}
export async function readPolicy(root = process.cwd()) {
  const bytes = new Uint8Array(await readFile(resolve(root, 'installer/catalog.json')));
  return { policy: parsePolicy(parseBytes(bytes)), policySha256: await sha256(bytes) };
}
export async function readSelection(root = process.cwd()): Promise<Selection> {
  const selection = parseSelection(
    JSON.parse(await readFile(resolve(root, 'build/release-selection.json'), 'utf8')),
  );
  const { policy, policySha256 } = await readPolicy(root);
  if (
    selection.policySha256 !== policySha256 ||
    selection.automatic !== policy.automatic ||
    (!policy.automatic && !sameRelease(selection.release, policy.pin)) ||
    (!policy.pin && selection.release)
  )
    throw new Error('Release policy changed. Run npm run release:select again.');
  return selection;
}
export async function writeSelection(selection: Selection, root = process.cwd()) {
  const directory = resolve(root, 'build');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, 'release-selection.json');
  await writeFile(`${path}.tmp`, JSON.stringify(selection) + '\n');
  await rename(`${path}.tmp`, path);
}
