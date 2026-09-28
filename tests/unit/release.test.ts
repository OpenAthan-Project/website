import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  loadRelease,
  AUDIO_BYTES,
  AUDIO_OFFSET,
  FLASH_BYTES,
  HARDWARE,
  LAYOUT,
  checkedManifest,
  parseManifest,
  parsePin,
  sha256,
  verifyBundle,
  verifyFactory,
  type ReleaseBundle,
  type ReleaseManifest,
  type ReleasePin,
} from '../../installer/release';
import { flashBundle, type Programmer } from '../../installer/flasher';

// In-memory, non-bootable test bytes. Never written to public assets or a serial port.
async function fixture() {
  const factory = new Uint8Array(0x10100).fill(255),
    view = new DataView(factory.buffer);
  factory[0] = factory[0x10000] = 0xe9;
  view.setUint16(12, 9, true);
  view.setUint16(0x1000c, 9, true);
  const records = [
    ['nvs', 1, 2, 0x9000, 0x5000],
    ['otadata', 1, 0, 0xe000, 0x2000],
    ['app0', 0, 0x10, 0x10000, 0x200000],
    ['app1', 0, 0x11, 0x210000, 0x200000],
    ['athan_audio', 1, 0x40, AUDIO_OFFSET, AUDIO_BYTES],
  ] as const;
  for (const [index, [name, type, subtype, offset, size]] of records.entries()) {
    const base = 0x8000 + index * 32;
    factory.fill(0, base, base + 32);
    view.setUint16(base, 0x50aa, true);
    factory[base + 2] = type;
    factory[base + 3] = subtype;
    view.setUint32(base + 4, offset, true);
    view.setUint32(base + 8, size, true);
    factory.set(new TextEncoder().encode(name), base + 12);
  }
  const audio = new Uint8Array(AUDIO_BYTES);
  const manifest: ReleaseManifest = {
    schema: 1,
    repository: 'OpenAthan-Project/openathan',
    tag: 'v0.1.0',
    commit: 'a'.repeat(40),
    hardware: HARDWARE,
    chip: 'ESP32-S3',
    flashBytes: FLASH_BYTES,
    layout: LAYOUT,
    provisioningProtocol: 1,
    media: {
      redistributionApproved: true,
      licenseUrl: `https://github.com/OpenAthan-Project/openathan/blob/${'a'.repeat(40)}/AUDIO-LICENSES.md`,
    },
    parts: [
      {
        role: 'factory',
        file: 'firmware.factory.bin',
        offset: 0,
        bytes: factory.length,
        sha256: await sha256(factory),
      },
      {
        role: 'audio',
        file: 'athan-audio.bin',
        offset: AUDIO_OFFSET,
        bytes: audio.length,
        sha256: await sha256(audio),
      },
    ],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const pin: ReleasePin = {
    tag: manifest.tag,
    manifestSha256: await sha256(bytes),
    mediaReviewed: true,
    hardwareQualified: true,
  };
  const inputs = new Map([
    ['firmware.factory.bin', factory],
    ['athan-audio.bin', audio],
  ]);
  return { manifest, pin, bytes, inputs, factory, audio };
}
describe('release boundary', () => {
  it('keeps the empty catalog closed and rejects unreviewed selections', () => {
    expect(parsePin({ schema: 1, release: null })).toBeNull();
    expect(() =>
      parsePin({ schema: 1, release: { tag: 'v1.0.0', manifestSha256: 'a'.repeat(64) } }),
    ).toThrow();
  });
  it('validates a pinned manifest and both files', async () => {
    const f = await fixture();
    const m = await checkedManifest(f.bytes, f.pin);
    expect((await verifyBundle(m, f.inputs)).parts).toHaveLength(2);
  });
  it.each(['hardware', 'chip', 'layout', 'repository'] as const)(
    'rejects incorrect %s',
    async (key) => {
      const f = await fixture();
      expect(() => parseManifest({ ...f.manifest, [key]: 'wrong' }, f.pin)).toThrow();
    },
  );
  it('rejects missing audio, changed offsets, overlaps and oversized ranges', async () => {
    const f = await fixture();
    for (const parts of [
      f.manifest.parts.slice(0, 1),
      [f.manifest.parts[0], { ...f.manifest.parts[1], offset: 0x10000 }],
      [{ ...f.manifest.parts[0], bytes: AUDIO_OFFSET + 1 }, f.manifest.parts[1]],
      [f.manifest.parts[0], { ...f.manifest.parts[1], bytes: FLASH_BYTES }],
    ]) {
      expect(() => parseManifest({ ...f.manifest, parts }, f.pin)).toThrow();
    }
  });
  it('rejects wrong manifest/image hashes and missing media approval', async () => {
    const f = await fixture();
    await expect(
      checkedManifest(f.bytes, { ...f.pin, manifestSha256: 'b'.repeat(64) }),
    ).rejects.toThrow('verification');
    f.audio[0] = 1;
    await expect(verifyBundle(f.manifest, f.inputs)).rejects.toThrow('audio');
    expect(() =>
      parseManifest(
        { ...f.manifest, media: { ...f.manifest.media, redistributionApproved: false } },
        f.pin,
      ),
    ).toThrow();
    f.inputs.delete('athan-audio.bin');
    await expect(verifyBundle(f.manifest, f.inputs)).rejects.toThrow('audio');
  });
  it('validates the actual factory layout and ESP32-S3 headers', async () => {
    const f = await fixture();
    verifyFactory(f.factory);
    f.factory[0x8004]! ^= 1;
    expect(() => verifyFactory(f.factory)).toThrow('partition');
    const other = await fixture();
    other.factory[12] = 0;
    expect(() => verifyFactory(other.factory)).toThrow('ESP32-S3');
  });
});
function programmer(bundle: ReleaseBundle) {
  return {
    inspect: vi.fn(async () => ({ chip: 'ESP32-S3', flashBytes: FLASH_BYTES, secured: false })),
    write: vi.fn(async () => {}),
    digest: vi.fn(async (offset: number) =>
      bytesToHex(md5(bundle.parts.find((part) => part.metadata.offset === offset)!.bytes)),
    ),
    restart: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } satisfies Programmer;
}
describe('flashing adapter with no physical transport', () => {
  it('requires confirmation and compatible hardware before writing', async () => {
    const f = await fixture(),
      bundle = await verifyBundle(f.manifest, f.inputs),
      p = programmer(bundle);
    await expect(flashBundle(p, bundle, false, () => {})).rejects.toThrow('Confirm');
    expect(p.write).not.toHaveBeenCalled();
    expect(p.close).toHaveBeenCalled();
    p.inspect.mockResolvedValueOnce({ chip: 'ESP32', flashBytes: FLASH_BYTES, secured: false });
    await expect(flashBundle(p, bundle, true, () => {})).rejects.toThrow('hardware');
    expect(p.write).not.toHaveBeenCalled();
  });
  it('requires flash readback digests before restart/success', async () => {
    const f = await fixture(),
      bundle = await verifyBundle(f.manifest, f.inputs),
      p = programmer(bundle);
    await flashBundle(p, bundle, true, () => {});
    expect(p.write).toHaveBeenCalledOnce();
    expect(p.digest).toHaveBeenCalledTimes(2);
    expect(p.restart).toHaveBeenCalledOnce();
    const bad = programmer(bundle);
    bad.digest.mockResolvedValue('wrong');
    await expect(flashBundle(bad, bundle, true, () => {})).rejects.toThrow('verification');
    expect(bad.restart).not.toHaveBeenCalled();
    expect(bad.close).toHaveBeenCalled();
  });
  it('does not retry a failed write', async () => {
    const f = await fixture(),
      bundle = await verifyBundle(f.manifest, f.inputs),
      p = programmer(bundle);
    p.write.mockRejectedValue(new Error('Disconnected'));
    await expect(flashBundle(p, bundle, true, () => {})).rejects.toThrow('Disconnected');
    expect(p.write).toHaveBeenCalledOnce();
    expect(p.restart).not.toHaveBeenCalled();
  });
  it('preserves a write failure when the removed port also rejects cleanup', async () => {
    const f = await fixture(),
      bundle = await verifyBundle(f.manifest, f.inputs),
      p = programmer(bundle);
    p.write.mockRejectedValue(new Error('USB communication failed'));
    p.close.mockRejectedValue(new Error('Port already closed'));
    await expect(flashBundle(p, bundle, true, () => {})).rejects.toThrow(
      'USB communication failed',
    );
    expect(p.write).toHaveBeenCalledOnce();
    expect(p.digest).not.toHaveBeenCalled();
    expect(p.restart).not.toHaveBeenCalled();
    expect(p.close).toHaveBeenCalledOnce();
  });
  it('does not claim success if cleanup fails after verification', async () => {
    const f = await fixture(),
      bundle = await verifyBundle(f.manifest, f.inputs),
      p = programmer(bundle);
    p.close.mockRejectedValue(new Error('Port close failed'));
    await expect(flashBundle(p, bundle, true, () => {})).rejects.toThrow('Port close failed');
  });
  it('keeps simulator dependencies separate from physical transports and release files', async () => {
    for (const name of ['simulator.ts', 'demo-entry.ts', 'ui.ts', 'session.ts', 'protocol.ts']) {
      const source = await readFile(new URL(`../../installer/${name}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(
        /from ['"].*(?:flasher|real-service|browser-transport|esptool|catalog)/,
      );
      expect(source).not.toMatch(/navigator\.serial|requestDevicePort|loadRelease/);
    }
  });
});

describe('bounded browser downloads', () => {
  function stream(chunks: Uint8Array[], length?: string, failure = false) {
    const cancel = vi.fn();
    let index = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (index < chunks.length) controller.enqueue(chunks[index++]!);
          else if (failure) controller.error(new Error('stream failed'));
          else controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    return {
      body,
      cancel,
      response: new Response(body, {
        headers: length === undefined ? {} : { 'content-length': length },
      }),
    };
  }
  it('accepts exact-limit fragmented files with absent or misleading headers', async () => {
    const f = await fixture();
    const padded = new Uint8Array(16384).fill(32);
    padded.set(f.bytes);
    const pin = { ...f.pin, manifestSha256: await sha256(padded) };
    const streams = [
      stream([padded.subarray(0, 100), padded.subarray(100)]),
      stream([f.factory], '1'),
      stream([f.audio.subarray(0, 100), f.audio.subarray(100)]),
    ];
    const fetcher = vi.fn<typeof fetch>();
    for (const item of streams) fetcher.mockResolvedValueOnce(item.response);
    expect((await loadRelease(pin, fetcher)).parts).toHaveLength(2);
    for (const item of streams) expect(item.body.locked).toBe(false);
  });
  for (const fragmented of [false, true]) {
    it(`cancels oversized manifest chunks (fragmented=${fragmented})`, async () => {
      const f = await fixture();
      const item = stream(
        fragmented ? [new Uint8Array(16384), new Uint8Array(1)] : [new Uint8Array(16385)],
        '1',
      );
      await expect(
        loadRelease(f.pin, vi.fn<typeof fetch>().mockResolvedValue(item.response)),
      ).rejects.toThrow('larger');
      expect(item.cancel).toHaveBeenCalledTimes(1);
      expect(item.body.locked).toBe(false);
    });
  }
  it('rejects an oversized declared length before reading and cancels the body', async () => {
    const f = await fixture();
    const item = stream([], '16385');
    await expect(
      loadRelease(f.pin, vi.fn<typeof fetch>().mockResolvedValue(item.response)),
    ).rejects.toThrow('larger');
    expect(item.cancel).toHaveBeenCalledTimes(1);
    expect(item.body.locked).toBe(false);
  });
  for (const kind of ['oversized', 'truncated', 'failure'] as const) {
    it(`rejects ${kind} image downloads and releases the stream`, async () => {
      const f = await fixture();
      const item = stream(
        [kind === 'oversized' ? new Uint8Array(f.factory.length + 1) : f.factory.subarray(0, 100)],
        undefined,
        kind === 'failure',
      );
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(f.bytes))
        .mockResolvedValueOnce(item.response)
        .mockResolvedValueOnce(new Response(f.audio));
      await expect(loadRelease(f.pin, fetcher)).rejects.toThrow(
        kind === 'oversized'
          ? 'larger'
          : kind === 'failure'
            ? 'stream failed'
            : 'verification failed',
      );
      expect(item.body.locked).toBe(false);
      if (kind === 'oversized') expect(item.cancel).toHaveBeenCalledTimes(1);
    });
  }
  it('rejects missing response bodies', async () => {
    const f = await fixture();
    await expect(
      loadRelease(f.pin, vi.fn<typeof fetch>().mockResolvedValue(new Response(null))),
    ).rejects.toThrow('no response body');
  });
});
