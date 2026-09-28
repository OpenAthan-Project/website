/** Versioned contract consumed from the firmware repository; no device access. */
export const HARDWARE = 'atoms3r-c126-pyramid-a167';
export const LAYOUT = 'dual-2m-audio-3_5m-v1';
export const FLASH_BYTES = 0x800000;
export const AUDIO_OFFSET = 0x410000;
export const AUDIO_BYTES = 0x380000;
export interface ReleasePin {
  tag: string;
  manifestSha256: string;
  mediaReviewed: true;
  hardwareQualified: true;
}
export interface ReleasePart {
  role: 'factory' | 'audio';
  file: string;
  offset: number;
  bytes: number;
  sha256: string;
}
export interface ReleaseManifest {
  schema: 1;
  repository: 'OpenAthan-Project/openathan';
  tag: string;
  commit: string;
  hardware: typeof HARDWARE;
  chip: 'ESP32-S3';
  flashBytes: number;
  layout: typeof LAYOUT;
  provisioningProtocol: 1;
  media: { redistributionApproved: true; licenseUrl: string };
  parts: ReleasePart[];
}
export interface ReleaseBundle {
  manifest: ReleaseManifest;
  parts: { metadata: ReleasePart; bytes: Uint8Array }[];
}
const digestPattern = /^[a-f0-9]{64}$/;
const tagPattern = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid release metadata.');
  return value as Record<string, unknown>;
}
export function parsePin(value: unknown): ReleasePin | null {
  const catalog = object(value);
  if (catalog.schema !== 1) throw new Error('Unsupported release catalog.');
  if (catalog.release === null) return null;
  const pin = object(catalog.release);
  if (
    typeof pin.tag !== 'string' ||
    !tagPattern.test(pin.tag) ||
    typeof pin.manifestSha256 !== 'string' ||
    !digestPattern.test(pin.manifestSha256) ||
    pin.mediaReviewed !== true ||
    pin.hardwareQualified !== true
  )
    throw new Error('The release has not passed review.');
  return pin as unknown as ReleasePin;
}
export function parseManifest(value: unknown, pin: ReleasePin): ReleaseManifest {
  const m = object(value),
    media = object(m.media);
  if (
    m.schema !== 1 ||
    m.repository !== 'OpenAthan-Project/openathan' ||
    m.tag !== pin.tag ||
    !tagPattern.test(pin.tag) ||
    typeof m.commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(m.commit) ||
    m.hardware !== HARDWARE ||
    m.chip !== 'ESP32-S3' ||
    m.flashBytes !== FLASH_BYTES ||
    m.layout !== LAYOUT ||
    m.provisioningProtocol !== 1 ||
    media.redistributionApproved !== true ||
    typeof media.licenseUrl !== 'string' ||
    !media.licenseUrl.startsWith(
      `https://github.com/OpenAthan-Project/openathan/blob/${m.commit}/`,
    ) ||
    !Array.isArray(m.parts) ||
    m.parts.length !== 2
  )
    throw new Error('Unsupported or unapproved firmware release.');
  const parts = m.parts
    .map((value) => {
      const p = object(value);
      if (
        !['factory', 'audio'].includes(String(p.role)) ||
        typeof p.file !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.bin$/.test(p.file) ||
        !Number.isSafeInteger(p.offset) ||
        !Number.isSafeInteger(p.bytes) ||
        Number(p.bytes) <= 0 ||
        Number(p.offset) < 0 ||
        Number(p.offset) + Number(p.bytes) > FLASH_BYTES ||
        typeof p.sha256 !== 'string' ||
        !digestPattern.test(p.sha256)
      )
        throw new Error('Invalid release image.');
      return p as unknown as ReleasePart;
    })
    .sort((a, b) => a.offset - b.offset);
  const [factory, audio] = parts;
  if (
    !factory ||
    !audio ||
    factory.role !== 'factory' ||
    factory.offset !== 0 ||
    factory.bytes < 0x10020 ||
    factory.bytes > AUDIO_OFFSET ||
    audio.role !== 'audio' ||
    audio.offset !== AUDIO_OFFSET ||
    audio.bytes !== AUDIO_BYTES ||
    factory.file === audio.file ||
    factory.offset + factory.bytes > audio.offset
  )
    throw new Error('Images do not match the shared-audio partition layout.');
  return { ...m, parts } as unknown as ReleaseManifest;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function checkedManifest(
  bytes: Uint8Array,
  pin: ReleasePin,
): Promise<ReleaseManifest> {
  if (bytes.length > 16_384 || (await sha256(bytes)) !== pin.manifestSha256)
    throw new Error('Release manifest verification failed.');
  return parseManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), pin);
}
/** Check the real factory partition table and app header, not just manifest claims. */
export function verifyFactory(bytes: Uint8Array): void {
  const expected = [
    ['nvs', 1, 2, 0x9000, 0x5000],
    ['otadata', 1, 0, 0xe000, 0x2000],
    ['app0', 0, 0x10, 0x10000, 0x200000],
    ['app1', 0, 0x11, 0x210000, 0x200000],
    ['athan_audio', 1, 0x40, AUDIO_OFFSET, AUDIO_BYTES],
  ];
  if (bytes.length < 0x10020 || bytes[0] !== 0xe9 || bytes[0x10000] !== 0xe9)
    throw new Error('Invalid factory image header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(12, true) !== 9 || view.getUint16(0x1000c, true) !== 9)
    throw new Error('Factory image is not for ESP32-S3.');
  for (const [index, [name, type, subtype, offset, size]] of expected.entries()) {
    const base = 0x8000 + index * 32;
    const label = new TextDecoder().decode(bytes.slice(base + 12, base + 28)).replace(/\0.*$/, '');
    if (
      view.getUint16(base, true) !== 0x50aa ||
      bytes[base + 2] !== type ||
      bytes[base + 3] !== subtype ||
      view.getUint32(base + 4, true) !== offset ||
      view.getUint32(base + 8, true) !== size ||
      label !== name ||
      view.getUint32(base + 28, true) !== 0
    )
      throw new Error('Factory partition table does not match the supported layout.');
  }
  const next = view.getUint16(0x8000 + expected.length * 32, true);
  if (next !== 0xebeb && next !== 0xffff) throw new Error('Unexpected extra factory partition.');
}
export async function verifyBundle(
  manifest: ReleaseManifest,
  inputs: Map<string, Uint8Array>,
): Promise<ReleaseBundle> {
  const parts: ReleaseBundle['parts'] = [];
  for (const metadata of manifest.parts) {
    const bytes = inputs.get(metadata.file);
    if (!bytes || bytes.length !== metadata.bytes || (await sha256(bytes)) !== metadata.sha256)
      throw new Error(`Image verification failed: ${metadata.role}.`);
    if (metadata.role === 'factory') verifyFactory(bytes);
    parts.push({ metadata, bytes });
  }
  return { manifest, parts };
}
export async function loadRelease(
  pin: ReleasePin,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseBundle> {
  const base = `/releases/${pin.tag}/`;
  const get = async (name: string, maximum: number): Promise<Uint8Array> => {
    const response = await fetcher(base + name, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error('The reviewed release files are unavailable. Nothing was installed.');
    if (!response.body) throw new Error('Release download has no response body.');
    const reader = response.body.getReader();
    try {
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) > maximum)
        throw new Error('Release file is larger than expected.');
      // Allocate only the permitted size; never retain an oversized response chunk.
      const bytes = new Uint8Array(maximum);
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return bytes.subarray(0, size);
        if (value.byteLength > maximum - size)
          throw new Error('Release file is larger than expected.');
        bytes.set(value, size);
        size += value.byteLength;
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  };
  const manifest = await checkedManifest(await get('manifest.json', 16_384), pin);
  const inputs = new Map<string, Uint8Array>();
  for (const part of manifest.parts) inputs.set(part.file, await get(part.file, part.bytes));
  return verifyBundle(manifest, inputs);
}
