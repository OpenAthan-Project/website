import { describe, expect, it, vi } from 'vitest';
import {
  DEPLOYED_METADATA,
  FIRMWARE_API,
  WEBSITE_API,
  deployedMetadata,
  download,
  freshSelection,
  metadata,
  needsDeployment,
  parseMetadata,
  parsePolicy,
  parseSelection,
  resolveRelease,
  readSelection,
  writeSelection,
  readPolicy,
  type Selection,
} from '../../tools/release-selection';
import { fixture } from './fixtures/release';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function source() {
  const f = await fixture();
  const release = {
    draft: false,
    prerelease: false,
    published_at: '2026-10-03T00:00:00Z',
    tag_name: f.pin.tag,
    assets: [
      {
        name: 'manifest.json',
        size: f.bytes.length,
        browser_download_url: `https://github.com/OpenAthan-Project/openathan/releases/download/${f.pin.tag}/manifest.json`,
      },
    ],
  };
  const responses = new Map<string, unknown>([
    [`${FIRMWARE_API}/releases/latest`, release],
    [`${FIRMWARE_API}/releases/tags/${f.pin.tag}`, release],
    [release.assets[0]!.browser_download_url, f.bytes],
    [`${FIRMWARE_API}/commits/${f.pin.tag}`, { sha: f.manifest.commit }],
    [`${WEBSITE_API}/commits/main`, { sha: 'b'.repeat(40) }],
    [DEPLOYED_METADATA, null],
  ]);
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const key = String(url);
    if (!responses.has(key)) throw new Error(`Unexpected request: ${key}`);
    const value = responses.get(key);
    return value === null
      ? new Response(null, { status: 404 })
      : new Response(value instanceof Uint8Array ? value.slice() : JSON.stringify(value));
  }) as unknown as typeof fetch;
  const selection: Selection = {
    schema: 1,
    automatic: true,
    policySha256: 'c'.repeat(64),
    websiteCommit: 'b'.repeat(40),
    release: f.pin,
  };
  return { ...f, release, responses, fetcher, selection };
}
describe('automatic release policy', () => {
  it('defaults to a manual pin, validates the switch, and gives null precedence', async () => {
    const f = await source();
    expect(parsePolicy({ schema: 1, release: f.pin })).toEqual({ automatic: false, pin: f.pin });
    expect(() => parsePolicy({ schema: 1, automatic: 'true', release: f.pin })).toThrow();
    const fetcher = vi.fn();
    expect(
      await resolveRelease(parsePolicy({ schema: 1, automatic: true, release: null }), fetcher),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses approved stable latest automatically and the exact tag manually', async () => {
    const f = await source();
    expect(await resolveRelease({ automatic: true, pin: f.pin }, f.fetcher)).toEqual(f.pin);
    expect(f.fetcher).toHaveBeenCalledWith(`${FIRMWARE_API}/releases/latest`, expect.anything());
    vi.mocked(f.fetcher).mockClear();
    expect(await resolveRelease({ automatic: false, pin: f.pin }, f.fetcher)).toEqual(f.pin);
    expect(f.fetcher).not.toHaveBeenCalledWith(
      `${FIRMWARE_API}/releases/latest`,
      expect.anything(),
    );
  });
  it.each([
    { draft: true },
    { prerelease: true },
    { published_at: '' },
    { tag_name: 'v1.0.0-rc1' },
    { assets: [] },
  ])('rejects ineligible or incomplete releases: %j', async (change) => {
    const f = await source();
    f.responses.set(`${FIRMWARE_API}/releases/latest`, { ...f.release, ...change });
    await expect(resolveRelease({ automatic: true, pin: f.pin }, f.fetcher)).rejects.toThrow();
  });
  it('rejects wrong source commits, wrong manual hashes and unsupported hardware', async () => {
    const f = await source();
    f.responses.set(`${FIRMWARE_API}/commits/${f.pin.tag}`, { sha: 'd'.repeat(40) });
    await expect(resolveRelease({ automatic: true, pin: f.pin }, f.fetcher)).rejects.toThrow(
      'source commit',
    );
    await expect(
      resolveRelease(
        { automatic: false, pin: { ...f.pin, manifestSha256: 'd'.repeat(64) } },
        f.fetcher,
      ),
    ).rejects.toThrow('verification');
    const bytes = new TextEncoder().encode(JSON.stringify({ ...f.manifest, hardware: 'wrong' }));
    f.release.assets[0]!.size = bytes.length;
    f.responses.set(f.release.assets[0]!.browser_download_url, bytes);
    await expect(resolveRelease({ automatic: true, pin: f.pin }, f.fetcher)).rejects.toThrow(
      'Unsupported',
    );
  });
  it('accepts first migration only on 404; network failures and malformed metadata fail', async () => {
    const f = await source();
    expect(await deployedMetadata(f.fetcher)).toBeNull();
    f.responses.set(DEPLOYED_METADATA, {});
    await expect(deployedMetadata(f.fetcher)).rejects.toThrow();
    await expect(
      deployedMetadata(
        vi.fn(async () => {
          throw new Error('offline');
        }),
      ),
    ).rejects.toThrow('offline');
    expect(() =>
      parseMetadata({ schema: 2, websiteCommit: 'b'.repeat(40), release: null }),
    ).toThrow();
    expect(() => parseSelection({ ...f.selection, policySha256: 'wrong' })).toThrow();
  });
  it('skips unchanged releases, retries website-only changes, and rejects changed served tags', async () => {
    const f = await source(),
      m = metadata(f.selection);
    expect(needsDeployment(m, null)).toBe(true);
    expect(needsDeployment(m, m)).toBe(false);
    expect(needsDeployment({ ...m, websiteCommit: 'd'.repeat(40) }, m)).toBe(true);
    expect(needsDeployment({ ...m, release: { ...m.release!, tag: 'v0.2.0' } }, m)).toBe(true);
    expect(needsDeployment({ ...m, release: null }, m)).toBe(true);
    expect(() =>
      needsDeployment({ ...m, release: { ...m.release!, manifestSha256: 'd'.repeat(64) } }, m),
    ).toThrow('changed its manifest');
  });
  it('prevents old source or superseded releases from deploying and propagates lookup failure', async () => {
    const f = await source(),
      policy = { automatic: true, pin: f.pin };
    expect(await freshSelection(f.selection, policy, f.fetcher)).toBe(true);
    expect(
      await freshSelection({ ...f.selection, websiteCommit: 'd'.repeat(40) }, policy, f.fetcher),
    ).toBe(false);
    expect(
      await freshSelection(
        { ...f.selection, release: { ...f.pin, tag: 'v9.0.0' } },
        policy,
        f.fetcher,
      ),
    ).toBe(false);
    await expect(
      freshSelection(
        f.selection,
        policy,
        vi.fn(async () => {
          throw new Error('offline');
        }),
      ),
    ).rejects.toThrow('offline');
    // Persistent rollback does not query latest, even when latest is incomplete.
    f.responses.set(`${FIRMWARE_API}/releases/latest`, {});
    expect(
      await freshSelection(
        { ...f.selection, automatic: false },
        { automatic: false, pin: f.pin },
        f.fetcher,
      ),
    ).toBe(true);
  });
  it('bounds and cancels oversized streams', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(5));
      },
      cancel,
    });
    await expect(
      download(
        'https://example.test',
        4,
        vi.fn(async () => new Response(stream)),
      ),
    ).rejects.toThrow('permitted size');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('requires a snapshot matching the policy and rejects stale local selections', async () => {
    const f = await source(),
      root = await mkdtemp(join(tmpdir(), 'openathan-selection-'));
    try {
      await mkdir(join(root, 'installer'));
      await writeFile(
        join(root, 'installer/catalog.json'),
        JSON.stringify({ schema: 1, automatic: true, release: f.pin }),
      );
      await expect(readSelection(root)).rejects.toThrow();
      const { policySha256 } = await readPolicy(root);
      await writeSelection({ ...f.selection, policySha256 }, root);
      expect((await readSelection(root)).release).toEqual(f.pin);
      await writeFile(
        join(root, 'installer/catalog.json'),
        JSON.stringify({ schema: 1, automatic: true, release: null }),
      );
      await expect(readSelection(root)).rejects.toThrow('policy changed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('release identity and API credentials', () => {
  it('accepts a newer approved latest while rejecting mutation of the known manual tag', async () => {
    const f = await source();
    expect(
      await resolveRelease({ automatic: true, pin: { ...f.pin, tag: 'v0.0.1' } }, f.fetcher),
    ).toEqual(f.pin);
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        ...f.manifest,
        parts: f.manifest.parts.map((p) => ({ ...p, sha256: 'd'.repeat(64) })),
      }),
    );
    f.release.assets[0]!.size = bytes.length;
    f.responses.set(f.release.assets[0]!.browser_download_url, bytes);
    await expect(resolveRelease({ automatic: true, pin: f.pin }, f.fetcher)).rejects.toThrow(
      'changed its manifest',
    );
  });
  it('keeps the built-in token on the fixed public API and off downloads and website requests', async () => {
    const fetcher = vi.fn(async () => new Response('ok'));
    vi.stubEnv('GITHUB_TOKEN', 'test-only-token');
    try {
      await download(`${FIRMWARE_API}/releases/latest`, 4, fetcher);
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-only-token' }),
        }),
      );
      for (const url of [
        DEPLOYED_METADATA,
        'https://github.com/OpenAthan-Project/openathan/releases/download/v0.1.0/manifest.json',
      ]) {
        await download(url, 4, fetcher);
        expect(fetcher).toHaveBeenLastCalledWith(
          url,
          expect.objectContaining({
            headers: { Accept: 'application/vnd.github+json' },
          }),
        );
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
