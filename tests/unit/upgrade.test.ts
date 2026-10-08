import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fixture } from './fixtures/release';
import {
  verifyDescriptor,
  signatureBytes,
  newerVersion,
  parseFirmware,
  chunkPayload,
} from '../../installer/upgrade';
import { ProvisioningSession, UncertainOutcome, type ByteTransport } from '../../installer/session';
import { encodeFrame } from '../../installer/protocol';

async function signed() {
  const { manifest } = await fixture();
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const payload = JSON.stringify({
    schema: 1,
    version: manifest.tag,
    commit: manifest.commit,
    hardware: manifest.hardware,
    layout: manifest.layout,
    storageFormat: 1,
    audioFormat: 1,
    rollback: true,
    bytes: 256,
    sha256: 'a'.repeat(64),
  });
  const signature = sign('sha256', Buffer.from(payload), privateKey).toString('hex');
  const bytes = new TextEncoder().encode(JSON.stringify({ payload, signature }));
  return {
    manifest,
    bytes,
    key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}
describe('signed USB upgrade contract', () => {
  it('verifies the exact signed payload and binds version and source to the selected manifest', async () => {
    const f = await signed();
    expect((await verifyDescriptor(f.bytes, f.manifest, f.key)).version).toBe(f.manifest.tag);
    await expect(
      verifyDescriptor(f.bytes, { ...f.manifest, commit: 'b'.repeat(40) }, f.key),
    ).rejects.toThrow('Incompatible');
    const altered = JSON.parse(new TextDecoder().decode(f.bytes));
    altered.payload = altered.payload.replace('256', '257');
    await expect(
      verifyDescriptor(new TextEncoder().encode(JSON.stringify(altered)), f.manifest, f.key),
    ).rejects.toThrow('signature');
  });
  it('rejects malformed DER and unsupported firmware information', () => {
    expect(() => signatureBytes('00'.repeat(64))).toThrow();
    expect(() =>
      parseFirmware(['1', '1-dev', 'development', 'supported', 'idle', 'confirmed', '', '', '0']),
    ).toThrow();
    expect(() =>
      parseFirmware([
        '1',
        'v0.5.0',
        'a'.repeat(40),
        'supported',
        'unexpected',
        'confirmed',
        '',
        '',
        '0',
      ]),
    ).toThrow();
  });
  it('compares numeric versions and rejects overflow and downgrades', () => {
    expect(newerVersion('v0.10.0', 'v0.9.0')).toBe(true);
    expect(newerVersion('v0.4.0', 'v0.5.0')).toBe(false);
    expect(() => newerVersion('v4294967296.0.0', 'v0.1.0')).toThrow();
  });
  it('sends one bounded chunk and accepts only its exact next-offset acknowledgement', async () => {
    let receive!: (bytes: Uint8Array) => void;
    let writes = 0;
    const transport: ByteTransport = {
      listen(fn) {
        receive = fn;
        return () => {};
      },
      async close() {},
      async write(packet) {
        writes++;
        const ack = packet.slice(9, 22);
        new DataView(ack.buffer, ack.byteOffset).setUint32(9, 242, true);
        receive(encodeFrame(true, 6, ack));
      },
    };
    const session = new ProvisioningSession(transport, 10);
    await session.writeChunk('0123456789abcdef', 1, 0, new Uint8Array(242));
    expect(writes).toBe(1);
    await session.close();
  });
  it('never repeats a lost chunk and blocks later writes while allowing a status read', async () => {
    let receive!: (bytes: Uint8Array) => void;
    let writes = 0;
    const transport: ByteTransport = {
      listen(fn) {
        receive = fn;
        return () => {};
      },
      async close() {},
      async write() {
        writes++;
      },
    };
    const session = new ProvisioningSession(transport, 10);
    await expect(
      session.writeChunk('0123456789abcdef', 1, 0, new Uint8Array(1)),
    ).rejects.toBeInstanceOf(UncertainOutcome);
    await expect(session.writeChunk('0123456789abcdef', 1, 0, new Uint8Array(1))).rejects.toThrow(
      'Reconnect',
    );
    expect(writes).toBe(1);
    const read = session.command(true, 0x10, [], { timeoutMs: 10 });
    receive(encodeFrame(true, 2, new Uint8Array([2])));
    await expect(read).rejects.toThrow('support');
    await session.close();
  });
  it('rejects oversized chunks and zero transaction tokens before transport', () => {
    expect(() => chunkPayload('0000000000000000', 1, 0, new Uint8Array(1))).toThrow();
    expect(() => chunkPayload('0123456789abcdef', 1, 0, new Uint8Array(243))).toThrow();
  });
});
