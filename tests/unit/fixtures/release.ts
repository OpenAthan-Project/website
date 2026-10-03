import {
  AUDIO_BYTES,
  AUDIO_OFFSET,
  FLASH_BYTES,
  HARDWARE,
  LAYOUT,
  sha256,
  type ReleaseManifest,
  type ReleasePin,
} from '../../../installer/release';

// In-memory, non-bootable test bytes. Never written to public assets or a serial port.
export async function fixture() {
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
