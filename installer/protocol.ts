import { HARDWARE, isHardware, type Hardware } from './release';
/** Improv Serial v1 and the OpenAthan v1 extension. No transport or browser imports. */
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const headers = ['IMPROV', 'OATHAN'].map((value) => encoder.encode(value));
export interface Frame {
  extension: boolean;
  type: number;
  payload: Uint8Array;
}

export function encodeFrame(extension: boolean, type: number, payload: Uint8Array): Uint8Array {
  if (payload.length > 255) throw new Error('USB frame is too large.');
  const result = new Uint8Array(payload.length + 11);
  result.set(headers[Number(extension)]!);
  result.set([1, type, payload.length], 6);
  result.set(payload, 9);
  result[result.length - 2] = result.slice(0, -2).reduce((sum, byte) => sum + byte, 0) & 255;
  result[result.length - 1] = 10;
  return result;
}

export function rpcPayload(command: number, fields: readonly string[] = []): Uint8Array {
  const values = fields.map((field) => {
    const bytes = encoder.encode(field);
    if (field.includes('\0') || bytes.length > 251) throw new Error('Invalid USB field.');
    return bytes;
  });
  const size = values.reduce((sum, value) => sum + value.length + 1, 2);
  if (size > 255) throw new Error('USB request is too large.');
  const result = new Uint8Array(size);
  result.set([command, size - 2]);
  let offset = 2;
  for (const value of values) {
    result[offset++] = value.length;
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

export function encodeRequest(
  extension: boolean,
  command: number,
  fields: readonly string[] = [],
): Uint8Array {
  return encodeFrame(extension, 3, rpcPayload(command, fields));
}

export function decodeFields(payload: Uint8Array): { command: number; fields: string[] } {
  if (payload.length < 2 || payload[1] !== payload.length - 2)
    throw new Error('Malformed device response.');
  const fields: string[] = [];
  for (let offset = 2; offset < payload.length; ) {
    const size = payload[offset++]!;
    if (offset + size > payload.length) throw new Error('Truncated device response.');
    const field = decoder.decode(payload.slice(offset, offset + size));
    if (field.includes('\0')) throw new Error('Invalid device response.');
    fields.push(field);
    offset += size;
  }
  return { command: payload[0]!, fields };
}

export class FrameDecoder {
  private buffer: number[] = [];
  private last = 0;
  reset(): void {
    this.buffer = [];
    this.last = 0;
  }
  feed(bytes: Uint8Array, now = performance.now()): Frame[] {
    if (now < this.last || now - this.last > 1000) this.buffer = [];
    this.last = now;
    const result: Frame[] = [];
    for (const byte of bytes) {
      this.buffer.push(byte);
      if (this.buffer.length <= 6) {
        while (
          this.buffer.length &&
          !headers.some((header) => this.buffer.every((value, index) => header[index] === value))
        )
          this.buffer.shift();
        continue;
      }
      if (this.buffer[6] !== 1) {
        this.buffer = [];
        continue;
      }
      if (this.buffer.length < 9 || this.buffer.length < this.buffer[8]! + 10) continue;
      const packet = this.buffer;
      this.buffer = [];
      if ((packet.slice(0, -1).reduce((sum, value) => sum + value, 0) & 255) !== packet.at(-1))
        continue;
      result.push({
        extension: packet[0] === 79,
        type: packet[7]!,
        payload: new Uint8Array(packet.slice(9, -1)),
      });
    }
    return result;
  }
}

export function validateWifi(ssid: string, password: string): void {
  const size = encoder.encode(ssid).length,
    secretSize = encoder.encode(password).length;
  if (ssid.includes('\0') || size < 1 || size > 32)
    throw new Error('Use a network name of 1–32 UTF-8 bytes without null characters.');
  if (
    password.includes('\0') ||
    secretSize < 8 ||
    secretSize > 64 ||
    (secretSize === 64 && !/^[0-9a-fA-F]{64}$/.test(password))
  ) {
    throw new Error(
      'Use a Wi-Fi password of 8–63 UTF-8 bytes, or a 64-character hexadecimal key (0–9, A–F).',
    );
  }
}

export function validatePassword(password: string): void {
  if (!/^[\x20-\x7e]{12,128}$/.test(password))
    throw new Error('Use 12–128 characters: English letters, numbers, spaces or punctuation.');
}

export interface DeviceStatus {
  hardware?: Hardware;
  wifi: '2' | '3' | '4';
  password: 'absent' | 'ready' | 'fault';
  setup: 'incomplete' | 'active' | 'storage_fault';
  passwordRevision: number;
  hostname: string;
  storage: 'ready' | 'fault';
  urls: string[];
}

/** Only offer the device's reported .local name or a private LAN IPv4 address. */
export function localDeviceUrls(urls: string[], hostname: string): string[] {
  return urls.filter((value) => {
    try {
      const url = new URL(value),
        octets = url.hostname.split('.').map(Number);
      const ipv4 =
        /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
        octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
      const privateIp =
        ipv4 &&
        (octets[0] === 10 ||
          (octets[0] === 192 && octets[1] === 168) ||
          (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
          (octets[0] === 169 && octets[1] === 254));
      return (
        url.protocol === 'http:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash &&
        (url.hostname === hostname || privateIp)
      );
    } catch {
      return false;
    }
  });
}

export function parseStatus(fields: string[]): DeviceStatus {
  const [version, wifi, password, setup, revision, hostname, storage, ...urls] = fields;
  const hardwareFields = urls.filter((value) => value.startsWith('hardware='));
  const hardware = hardwareFields[0]?.slice(9) ?? HARDWARE;
  if (hardwareFields.length > 1 || !isHardware(hardware))
    throw new Error('Unsupported connected hardware.');
  if (
    version !== '1' ||
    !['2', '3', '4'].includes(wifi ?? '') ||
    !['absent', 'ready', 'fault'].includes(password ?? '') ||
    !['incomplete', 'active', 'storage_fault'].includes(setup ?? '') ||
    !['ready', 'fault'].includes(storage ?? '') ||
    !/^\d+$/.test(revision ?? '') ||
    Number(revision) > 0xffffffff ||
    !/^openathan-[a-z0-9-]+\.local$/.test(hostname ?? '')
  ) {
    throw new Error('This device returned an unsupported OpenAthan status.');
  }
  return {
    hardware,
    wifi,
    password,
    setup,
    passwordRevision: Number(revision),
    hostname,
    storage,
    urls: localDeviceUrls(urls, hostname!),
  } as DeviceStatus;
}
