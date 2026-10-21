import { expect, it, vi } from 'vitest';
import {
  HARDWARE,
  WAVESHARE,
  AUDIO_BOARD,
  type Hardware,
  type ReleasePin,
  type ReleaseManifest,
  HARDWARE_PROFILES,
  assetName,
  checkedManifest,
  parseManifest,
  parseHardwareReleases,
  sha256,
  verifyBundle,
} from '../../installer/release';
import { parseFirmware } from '../../installer/upgrade';
import { flashBundle } from '../../installer/flasher';
import { fixture } from './fixtures/release';
import {
  needsDeployment,
  parsePolicy,
  parseSelection,
  resolveHardwareReleases,
} from '../../tools/release-selection';

async function waveshareFixture(hardware: Hardware = WAVESHARE) {
  const f = await fixture();
  f.factory[3] = f.factory[0x10003] = 0x40;
  const manifest: ReleaseManifest = {
    ...f.manifest,
    hardware,
    flashBytes: 0x1000000,
    parts: f.manifest.parts.map((part) =>
      part.role === 'factory'
        ? { ...part, file: assetName(hardware, part.file), sha256: '' }
        : part,
    ),
  };
  manifest.parts[0]!.sha256 = await sha256(f.factory);
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const pin: ReleasePin & { hardware: Hardware } = {
    ...f.pin,
    hardware,
    manifestSha256: await sha256(bytes),
  };
  const inputs = new Map([
    [assetName(hardware, 'firmware.factory.bin'), f.factory],
    ['athan-audio.bin', f.audio],
  ]);
  return { ...f, manifest, bytes, pin, inputs };
}
it('binds a Waveshare manifest and factory to 16 MiB hardware', async () => {
  const f = await waveshareFixture();
  const manifest = await checkedManifest(f.bytes, f.pin);
  const bundle = await verifyBundle(manifest, f.inputs);
  expect(() => parseManifest(f.manifest, { ...f.pin, hardware: HARDWARE })).toThrow();
  const programmer = {
    inspect: vi.fn(async () => ({ chip: 'ESP32-S3', flashBytes: 0x800000, secured: false })),
    write: vi.fn(),
    digest: vi.fn(),
    restart: vi.fn(),
    close: vi.fn(),
  };
  await expect(flashBundle(programmer, bundle, true, () => {})).rejects.toThrow('hardware');
  expect(programmer.write).not.toHaveBeenCalled();
  f.factory[0x10003] = 0x30;
  manifest.parts[0]!.sha256 = await sha256(f.factory);
  await expect(verifyBundle(manifest, f.inputs)).rejects.toThrow('capacity');
});
it('recognizes hardware in new INFO and preserves legacy Atom compatibility', () => {
  const fields = ['1', 'v0.4.0', 'a'.repeat(40), 'supported', 'idle', 'confirmed', '', '', '0'];
  expect(parseFirmware(fields).hardware).toBe(HARDWARE);
  expect(parseFirmware([...fields, WAVESHARE]).hardware).toBe(WAVESHARE);
  expect(() => parseFirmware([...fields, 'waveshare-v1'])).toThrow();
});
it('validates hardware pins and includes them in deployment decisions', () => {
  const pin = {
    tag: 'v0.5.0',
    manifestSha256: 'a'.repeat(64),
    mediaReviewed: true as const,
    hardwareQualified: true as const,
  };
  expect(() => parseHardwareReleases({ other: pin })).toThrow();
  expect(() => parsePolicy({ schema: 1, release: { ...pin, hardware: WAVESHARE } })).toThrow(
    'Atom',
  );
  const additional = parseHardwareReleases({ [WAVESHARE]: pin });
  expect(additional[WAVESHARE]?.hardware).toBe(WAVESHARE);
  expect(() =>
    parseSelection({
      schema: 1,
      automatic: true,
      policySha256: 'a'.repeat(64),
      websiteCommit: 'b'.repeat(40),
      release: pin,
      hardwareReleases: { [WAVESHARE]: { ...pin, tag: 'v0.4.0' } },
    }),
  ).toThrow();
  const deployed = { schema: 1 as const, websiteCommit: 'b'.repeat(40), release: pin };
  expect(needsDeployment({ ...deployed, hardwareReleases: additional }, deployed)).toBe(true);
  expect(HARDWARE_PROFILES[WAVESHARE].flashBytes).toBe(0x1000000);
});
it('automatically selects a same-source Waveshare manifest and rejects mismatched source', async () => {
  const atom = await fixture(),
    wave = await waveshareFixture();
  const release = {
    draft: false,
    prerelease: false,
    tag_name: atom.pin.tag,
    published_at: '2026-10-10T00:00:00Z',
    assets: [
      {
        name: 'manifest.json',
        size: atom.bytes.length,
        browser_download_url: `https://github.com/OpenAthan-Project/openathan/releases/download/${atom.pin.tag}/manifest.json`,
      },
      {
        name: assetName(WAVESHARE, 'manifest.json'),
        size: wave.bytes.length,
        browser_download_url: `https://github.com/OpenAthan-Project/openathan/releases/download/${atom.pin.tag}/${assetName(WAVESHARE, 'manifest.json')}`,
      },
    ],
  };
  const fetcher = vi.fn(
    async (url: string | URL | Request) =>
      new Response(
        String(url).endsWith('waveshare-box-v2.manifest.json')
          ? wave.bytes
          : String(url).endsWith('/manifest.json')
            ? atom.bytes
            : JSON.stringify(release),
      ),
  ) as unknown as typeof fetch;
  expect(
    (await resolveHardwareReleases({ automatic: true, pin: atom.pin }, atom.pin, fetcher))[
      WAVESHARE
    ]?.hardware,
  ).toBe(WAVESHARE);
  wave.bytes = new TextEncoder().encode(
    JSON.stringify({
      ...wave.manifest,
      commit: 'b'.repeat(40),
      media: {
        ...wave.manifest.media,
        licenseUrl: `https://github.com/OpenAthan-Project/openathan/blob/${'b'.repeat(40)}/AUDIO-LICENSES.md`,
      },
    }),
  );
  release.assets[1]!.size = wave.bytes.length;
  await expect(
    resolveHardwareReleases({ automatic: true, pin: atom.pin }, atom.pin, fetcher),
  ).rejects.toThrow('different source');
});

it('recognizes AUDIO-Board identity without treating it as Box V2', async () => {
  const f = await waveshareFixture(AUDIO_BOARD);
  expect((await checkedManifest(f.bytes, f.pin)).hardware).toBe(AUDIO_BOARD);
  await verifyBundle(f.manifest, f.inputs);
  expect(() => parseManifest(f.manifest, { ...f.pin, hardware: WAVESHARE })).toThrow();
  const fields = ['1', 'v0.8.0', 'a'.repeat(40), 'supported', 'idle', 'confirmed', '', '', '0'];
  expect(parseFirmware([...fields, AUDIO_BOARD]).hardware).toBe(AUDIO_BOARD);
  expect(assetName(AUDIO_BOARD, 'upgrade.json')).toBe('waveshare-audio-board.upgrade.json');
  expect(assetName(AUDIO_BOARD, 'athan-audio.bin')).toBe('athan-audio.bin');
  f.factory[0x10003] = 0x30;
  f.manifest.parts[0]!.sha256 = await sha256(f.factory);
  await expect(verifyBundle(f.manifest, f.inputs)).rejects.toThrow('capacity');
});
it('selects all three same-source boards and detects AUDIO-Board asset changes', async () => {
  const atom = await fixture();
  const other = await Promise.all([waveshareFixture(), waveshareFixture(AUDIO_BOARD)]);
  const release = {
    draft: false,
    prerelease: false,
    tag_name: atom.pin.tag,
    published_at: '2026-10-21T00:00:00Z',
    assets: [
      {
        name: 'manifest.json',
        size: atom.bytes.length,
        browser_download_url: `https://github.com/OpenAthan-Project/openathan/releases/download/${atom.pin.tag}/manifest.json`,
      },
      ...other.map((f) => ({
        name: assetName(f.pin.hardware, 'manifest.json'),
        size: f.bytes.length,
        browser_download_url: `https://github.com/OpenAthan-Project/openathan/releases/download/${atom.pin.tag}/${assetName(f.pin.hardware, 'manifest.json')}`,
      })),
    ],
  };
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const selected = other.find((f) =>
      String(url).endsWith(assetName(f.pin.hardware, 'manifest.json')),
    );
    return new Response(
      selected
        ? selected.bytes
        : String(url).endsWith('/manifest.json')
          ? atom.bytes
          : JSON.stringify(release),
    );
  }) as unknown as typeof fetch;
  const releases = await resolveHardwareReleases(
    { automatic: true, pin: atom.pin },
    atom.pin,
    fetcher,
  );
  expect(Object.keys(releases)).toEqual([WAVESHARE, AUDIO_BOARD]);
  expect(parseHardwareReleases(releases)[AUDIO_BOARD]?.hardware).toBe(AUDIO_BOARD);
  const metadata = {
    schema: 1 as const,
    websiteCommit: 'b'.repeat(40),
    release: atom.pin,
    hardwareReleases: releases,
  };
  expect(() =>
    needsDeployment(
      {
        ...metadata,
        hardwareReleases: {
          ...releases,
          [AUDIO_BOARD]: { ...releases[AUDIO_BOARD]!, manifestSha256: 'c'.repeat(64) },
        },
      },
      metadata,
    ),
  ).toThrow('manifest changed');
  release.assets.pop();
  expect(
    Object.keys(
      await resolveHardwareReleases({ automatic: true, pin: atom.pin }, atom.pin, fetcher),
    ),
  ).toEqual([WAVESHARE]);
});
