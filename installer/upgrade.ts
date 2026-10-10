/** Signed application-only updates. Does not import the destructive flasher. */
import {
  HARDWARE,
  assetName,
  isHardware,
  type Hardware,
  LAYOUT,
  checkedManifest,
  sha256,
  type ReleasePin,
  type ReleaseManifest,
} from './release.ts';
export interface FirmwareInfo {
  hardware?: Hardware;
  version: string;
  commit: string;
  supported: boolean;
  state: string;
  boot: 'pending' | 'confirmed';
  result: string;
  offered: string;
  received: number;
}
export interface UpgradeOffer {
  hardware?: Hardware;
  version: string;
  commit: string;
  bytes: number;
  sha256: string;
  notes: string;
}
export interface UpgradeBundle {
  offer: UpgradeOffer;
  descriptor: Uint8Array;
  application: Uint8Array;
}
export type UpgradeCheck = (
  | { state: 'available'; offer: UpgradeOffer }
  | {
      state: 'current' | 'unsupported' | 'disabled' | 'busy' | 'failed';
      detail: string;
      action?: 'power' | 'discard';
    }
) & {
  /** USB ownership from firmware INFO; omitted when that read failed. */
  recoveryBlocked?: boolean;
};
export const UPGRADE = {
  info: 0x10,
  begin: 0x11,
  verify: 0x12,
  finish: 0x13,
  abort: 0x14,
} as const;
export const CHUNK_BYTES = 242;
export class UpgradeDownloadTimeout extends Error {
  constructor() {
    super(
      'The firmware download timed out. Check your internet connection and choose Check for updates again. Installed firmware has not changed.',
    );
    this.name = 'UpgradeDownloadTimeout';
  }
}
// Matches openathan release/upgrade-public-key.pem. Rotation requires coordinated review.
const PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVwaZCDVSDHpSxg6B7l0MolCO54GMIWd8IwsVIXiHphmRuegj7AM2UHZyfwDFYwh3KChTzIOh1QvpjPZtfb8siw==';
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function newerVersion(offered: string, installed: string): boolean {
  if (!stable.test(offered) || !stable.test(installed))
    throw new Error('Unsupported firmware version.');
  const a = offered.slice(1).split('.').map(BigInt),
    b = installed.slice(1).split('.').map(BigInt);
  if ([...a, ...b].some((n) => n > 0xffffffffn)) throw new Error('Unsupported firmware version.');
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}
export function parseFirmware(fields: string[]): FirmwareInfo {
  const [protocol, version, commit, support, state, boot, result, offered, received, hardware] =
    fields;
  if (
    ![9, 10].includes(fields.length) ||
    (fields.length === 10 && !isHardware(hardware)) ||
    protocol !== '1' ||
    !stable.test(version ?? '') ||
    !/^(?:[a-f0-9]{40}|development)$/.test(commit ?? '') ||
    !['supported', 'unsupported'].includes(support ?? '') ||
    ![
      'idle',
      'checking',
      'available',
      'current',
      'queued',
      'downloading',
      'verifying',
      'restarting',
      'failed',
      'storage_fault',
      'success',
      'rolled_back',
      'usb_descriptor',
      'usb_receiving',
      'usb_interrupted',
      'usb_selection_uncertain',
      'awaiting_power',
    ].includes(state ?? '') ||
    !['pending', 'confirmed'].includes(boot ?? '') ||
    !['', 'success', 'superseded', 'rolled_back'].includes(result ?? '') ||
    (offered !== '' && !stable.test(offered ?? '')) ||
    !/^\d+$/.test(received ?? '') ||
    Number(received) > 1572864
  )
    throw new Error('Unsupported USB firmware information.');
  return {
    version: version!,
    commit: commit!,
    supported: support === 'supported',
    state: state!,
    boot: boot as FirmwareInfo['boot'],
    result: result!,
    offered: offered!,
    received: Number(received),
    hardware: (hardware ?? HARDWARE) as Hardware,
  };
}
/** Strict DER ECDSA to WebCrypto's fixed-width P-256 r || s representation. */
export function signatureBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]{128,144}$/.test(hex) || hex.length % 2)
    throw new Error('Invalid update signature.');
  const der = Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
  if (der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error('Invalid update signature.');
  const out = new Uint8Array(64);
  let at = 2;
  for (let i = 0; i < 2; i++) {
    if (der[at++] !== 2) throw new Error('Invalid update signature.');
    const length = der[at++]!;
    let part = der.slice(at, at + length);
    at += length;
    if (
      !length ||
      length > 33 ||
      part.length !== length ||
      part[0]! & 128 ||
      (length > 1 && part[0] === 0 && !(part[1]! & 128))
    )
      throw new Error('Invalid update signature.');
    if (part[0] === 0) part = part.slice(1);
    if (part.length > 32) throw new Error('Invalid update signature.');
    out.set(part, (i + 1) * 32 - part.length);
  }
  if (at !== der.length) throw new Error('Invalid update signature.');
  return out;
}
export async function verifyDescriptor(
  bytes: Uint8Array,
  manifest: ReleaseManifest,
  keyBase64 = PUBLIC_KEY,
): Promise<UpgradeOffer> {
  if (!bytes.length || bytes.length > 8192) throw new Error('Invalid update descriptor.');
  const wrapper = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !wrapper ||
    Object.keys(wrapper).sort().join() !== 'payload,signature' ||
    typeof wrapper.payload !== 'string' ||
    typeof wrapper.signature !== 'string'
  )
    throw new Error('Invalid update descriptor.');
  const payload = new TextEncoder().encode(wrapper.payload);
  if (!payload.length || payload.length > 4096) throw new Error('Invalid update payload.');
  const key = await crypto.subtle.importKey(
    'spki',
    Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  if (
    !(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(signatureBytes(wrapper.signature)),
      payload,
    ))
  )
    throw new Error('Update signature verification failed.');
  const p = JSON.parse(wrapper.payload);
  if (
    !p ||
    Object.keys(p).length !== 10 ||
    p.schema !== 1 ||
    p.version !== manifest.tag ||
    p.commit !== manifest.commit ||
    !stable.test(p.version) ||
    p.hardware !== manifest.hardware ||
    p.layout !== LAYOUT ||
    p.storageFormat !== 1 ||
    p.audioFormat !== 1 ||
    p.rollback !== true ||
    !Number.isInteger(p.bytes) ||
    p.bytes < 256 ||
    p.bytes > 1572864 ||
    !/^[a-f0-9]{64}$/.test(p.sha256)
  )
    throw new Error('Incompatible firmware update.');
  newerVersion(p.version, p.version);
  return {
    hardware: manifest.hardware,
    version: p.version,
    commit: p.commit,
    bytes: p.bytes,
    sha256: p.sha256,
    notes: `https://github.com/OpenAthan-Project/openathan/releases/tag/${p.version}`,
  };
}
export async function verifyApplication(
  offer: UpgradeOffer,
  application: Uint8Array,
): Promise<void> {
  if (
    application.length !== offer.bytes ||
    (await sha256(application)) !== offer.sha256 ||
    application[0] !== 0xe9 ||
    new DataView(application.buffer, application.byteOffset, application.byteLength).getUint16(
      12,
      true,
    ) !== 9 ||
    new TextDecoder().decode(application.slice(48, 80)).replace(/\0.*$/, '') !== offer.version
  )
    throw new Error('Firmware image verification failed.');
}
async function bounded(url: string, maximum: number): Promise<Uint8Array> {
  const controller = new AbortController();
  // One deadline includes response headers and the entire body, regardless of progress.
  const timer = setTimeout(() => controller.abort(new UpgradeDownloadTimeout()), 60_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error('Could not load the approved update.');
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error('Oversized update download.');
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } catch (error) {
    // Cancellation closes the reader immediately; pending network cleanup must not
    // prevent the installer from restoring recovery controls after a timeout.
    void reader?.cancel().catch(() => undefined);
    if (controller.signal.aborted) throw new UpgradeDownloadTimeout();
    throw error;
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
  }
}
export async function loadUpgrade(pin: ReleasePin): Promise<UpgradeBundle> {
  const base = `/releases/${pin.tag}/`;
  const manifest = await checkedManifest(
    await bounded(base + assetName(pin.hardware ?? HARDWARE, 'manifest.json'), 16384),
    pin,
  );
  const descriptor = await bounded(
      base + assetName(pin.hardware ?? HARDWARE, 'upgrade.json'),
      8192,
    ),
    offer = await verifyDescriptor(descriptor, manifest);
  const application = await bounded(
    base + assetName(pin.hardware ?? HARDWARE, 'firmware.ota.bin'),
    offer.bytes,
  );
  await verifyApplication(offer, application);
  return { offer, descriptor, application };
}
export function chunkPayload(
  token: string,
  kind: number,
  offset: number,
  bytes: Uint8Array,
): Uint8Array {
  if (
    !/^[a-f0-9]{16}$/.test(token) ||
    BigInt('0x' + token) === 0n ||
    ![0, 1].includes(kind) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 1572864 ||
    !bytes.length ||
    bytes.length > CHUNK_BYTES
  )
    throw new Error('Invalid update chunk.');
  const out = new Uint8Array(13 + bytes.length),
    view = new DataView(out.buffer);
  view.setBigUint64(0, BigInt('0x' + token), true);
  out[8] = kind;
  view.setUint32(9, offset, true);
  out.set(bytes, 13);
  return out;
}
