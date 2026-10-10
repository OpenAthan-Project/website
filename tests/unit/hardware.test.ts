import { expect, it, vi } from 'vitest';
import {
  HARDWARE,
  WAVESHARE,
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

async function waveshareFixture() {
  const f = await fixture();
  f.factory[3] = f.factory[0x10003] = 0x40;
  const manifest = {
    ...f.manifest,
    hardware: WAVESHARE,
    flashBytes: 0x1000000,
    parts: f.manifest.parts.map((part) =>
      part.role === 'factory'
        ? { ...part, file: assetName(WAVESHARE, part.file), sha256: '' }
        : part,
    ),
  };
  manifest.parts[0]!.sha256 = await sha256(f.factory);
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const pin = {
    ...f.pin,
    hardware: WAVESHARE as typeof WAVESHARE,
    manifestSha256: await sha256(bytes),
  };
  const inputs = new Map([
    [assetName(WAVESHARE, 'firmware.factory.bin'), f.factory],
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
