import { afterEach, describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fixture } from './fixtures/release';
import {
  verifyDescriptor,
  signatureBytes,
  newerVersion,
  parseFirmware,
  chunkPayload,
  loadUpgrade,
} from '../../installer/upgrade';
import {
  ProvisioningSession,
  DeviceError,
  UncertainOutcome,
  type ByteTransport,
} from '../../installer/session';
import { encodeFrame, rpcPayload } from '../../installer/protocol';

describe('USB update download deadlines', () => {
  const pin = {
    tag: 'v0.5.0',
    manifestSha256: 'a'.repeat(64),
    mediaReviewed: true,
    hardwareQualified: true,
  } as const;
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('aborts a stalled response header once at 60 seconds without retrying', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const abort = vi.fn();
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            abort();
            reject(signal!.reason);
          },
          { once: true },
        );
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = loadUpgrade(pin).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(await result).toMatchObject({ name: 'UpgradeDownloadTimeout' });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  for (const slow of [false, true]) {
    it(`aborts a ${slow ? 'slow' : 'stalled'} body at the original deadline and releases its reader`, async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          controller.enqueue(new Uint8Array([123]));
        },
      });
      const abort = vi.fn();
      const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined;
        signal?.addEventListener(
          'abort',
          () => {
            abort();
            controller.error(signal!.reason);
          },
          { once: true },
        );
        return new Response(body);
      });
      vi.stubGlobal('fetch', fetcher);
      const result = loadUpgrade(pin).catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(20_000);
      if (slow) controller.enqueue(new Uint8Array([32]));
      await vi.advanceTimersByTimeAsync(20_000);
      if (slow) controller.enqueue(new Uint8Array([32]));
      await vi.advanceTimersByTimeAsync(19_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      expect(await result).toMatchObject({ name: 'UpgradeDownloadTimeout' });
      expect(body.locked).toBe(false);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  }
  it('starts a fresh deadline for the next asset after a slow successful download', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    let requested!: () => void;
    const nextAsset = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      const signal = options.signal!;
      signals.push(signal);
      if (signals.length === 1)
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response(f.bytes)), 59_000);
        });
      requested();
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = loadUpgrade(f.pin).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(59_000);
    await nextAsset;
    expect(fetcher).toHaveBeenLastCalledWith('/releases/v0.1.0/upgrade.json', expect.anything());
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'UpgradeDownloadTimeout' });
    expect(signals[0]!.aborted).toBe(false);
    expect(signals[1]!.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears deadlines and releases readers after completed downloads, retaining descriptor validation', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const bodies = [f.bytes, new TextEncoder().encode('{}')].map(
      (bytes) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
    );
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      signals.push(options.signal!);
      return new Response(bodies[signals.length - 1]);
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(loadUpgrade(f.pin)).rejects.toThrow('Invalid update descriptor');
    expect(bodies.every((body) => !body.locked)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('cancels an oversized body without waiting for stalled cleanup and releases its reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16_385));
      },
      cancel,
    });
    const fetcher = vi.fn(async () => new Response(body));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadUpgrade(pin)).rejects.toThrow('Oversized update download');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['fetch failure', 'HTTP failure', 'missing body', 'body failure'] as const)(
    'clears the deadline after %s without retrying',
    async (failure) => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      let body: ReadableStream<Uint8Array> | undefined;
      const cancel = vi.fn();
      const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined;
        if (failure === 'fetch failure') throw new Error('Network unavailable.');
        if (failure === 'missing body') return new Response(null);
        body = new ReadableStream<Uint8Array>({
          start(controller) {
            if (failure === 'body failure') controller.error(new Error('Stream failed.'));
          },
          cancel,
        });
        return new Response(body, { status: failure === 'HTTP failure' ? 503 : 200 });
      });
      vi.stubGlobal('fetch', fetcher);
      await expect(loadUpgrade(pin)).rejects.toThrow(
        failure === 'fetch failure'
          ? 'Network unavailable'
          : failure === 'body failure'
            ? 'Stream failed'
            : 'Could not load',
      );
      expect(body?.locked ?? false).toBe(false);
      if (failure === 'HTTP failure') expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(signal?.aborted).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});

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
  for (const kind of [0, 1]) {
    it.each([
      ['extra error byte', [255, 99]],
      ['empty error', []],
      ['extra error-clear byte', [0, 99]],
    ] as const)(
      `locks writes after a malformed %s response to chunk kind ${kind}`,
      async (_name, payload) => {
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
        const session = new ProvisioningSession(transport, 1000);
        const transfer = session.writeChunk('0123456789abcdef', kind, 0, new Uint8Array([42]));
        const rejected = expect(transfer).rejects.toBeInstanceOf(UncertainOutcome);
        receive(encodeFrame(true, 2, new Uint8Array(payload)));
        expect(session.uncertain).toBe(true);
        await rejected;
        // A delayed acknowledgement cannot clear the uncertainty lock.
        const ack = chunkPayload('0123456789abcdef', kind, 1, new Uint8Array([42])).slice(0, 13);
        receive(encodeFrame(true, 6, ack));
        await expect(
          session.writeChunk('0123456789abcdef', kind, 1, new Uint8Array([43])),
        ).rejects.toThrow('Reconnect');
        await expect(session.wifi('Test network', 'test wifi password')).rejects.toThrow(
          'Reconnect',
        );
        await expect(session.password('test device password')).rejects.toThrow('Reconnect');
        expect(writes).toBe(1);
        const status = session.status();
        receive(
          encodeFrame(
            true,
            4,
            rpcPayload(1, ['1', '4', 'ready', 'active', '2', 'openathan-test.local', 'ready']),
          ),
        );
        expect((await status).wifi).toBe('4');
        expect(session.uncertain).toBe(true);
        expect(writes).toBe(2);
        await session.close();
      },
    );
  }
  it.each([1, 2, 255])(
    'retains valid one-byte chunk error %i as a definite rejection',
    async (code) => {
      let receive!: (bytes: Uint8Array) => void;
      const transport: ByteTransport = {
        listen(fn) {
          receive = fn;
          return () => {};
        },
        async close() {},
        async write() {},
      };
      const session = new ProvisioningSession(transport, 1000);
      const transfer = session.writeChunk('0123456789abcdef', 1, 0, new Uint8Array([42]));
      const rejected = expect(transfer).rejects.toBeInstanceOf(DeviceError);
      receive(encodeFrame(true, 2, new Uint8Array([code])));
      await rejected;
      expect(session.uncertain).toBe(false);
      await session.close();
    },
  );
  it('waits through a one-byte error clear for the exact chunk acknowledgement', async () => {
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
    const session = new ProvisioningSession(transport, 1000);
    let settled = false;
    const transfer = session.writeChunk('0123456789abcdef', 1, 0, new Uint8Array([42])).then(() => {
      settled = true;
    });
    receive(encodeFrame(true, 2, new Uint8Array([0])));
    await Promise.resolve();
    expect(settled).toBe(false);
    const ack = chunkPayload('0123456789abcdef', 1, 1, new Uint8Array([42])).slice(0, 13);
    receive(encodeFrame(true, 6, ack));
    await transfer;
    expect(session.uncertain).toBe(false);
    expect(writes).toBe(1);
    await session.close();
  });
  it('rejects oversized chunks and zero transaction tokens before transport', () => {
    expect(() => chunkPayload('0000000000000000', 1, 0, new Uint8Array(1))).toThrow();
    expect(() => chunkPayload('0123456789abcdef', 1, 0, new Uint8Array(243))).toThrow();
  });
});
