import { describe, expect, it, vi } from 'vitest';
import { BrowserTransport } from '../../installer/browser-transport';

function portFixture() {
  const cancel = vi.fn(),
    abort = vi.fn(),
    writes: Uint8Array[] = [];
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      input = controller;
    },
    cancel,
  });
  const writable = new WritableStream<Uint8Array>({
    write(bytes) {
      writes.push(bytes.slice());
    },
    abort,
  });
  const close = vi.fn(async () => {
    if (readable.locked || writable.locked) throw new Error('Streams still locked');
  });
  const port = {
    readable,
    writable,
    open: vi.fn(async () => {}),
    setSignals: vi.fn(async () => {}),
    close,
  };
  return { port: port as unknown as SerialPort, input, cancel, abort, writes, close };
}

describe('browser serial ownership without hardware', () => {
  it('releases both stream locks and closes the port exactly once', async () => {
    const f = portFixture(),
      transport = await BrowserTransport.open(f.port),
      bytes = vi.fn(),
      disconnected = vi.fn();
    transport.listen(bytes, disconnected);
    expect(() => transport.listen(bytes, disconnected)).toThrow('owner');
    f.input.enqueue(new Uint8Array([1, 2]));
    await transport.write(new Uint8Array([3]));
    expect(bytes).toHaveBeenCalledWith(new Uint8Array([1, 2]));
    expect(f.writes).toEqual([new Uint8Array([3])]);
    await Promise.all([transport.close(), transport.close()]);
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.abort).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    expect(disconnected).not.toHaveBeenCalled();
    expect(f.port.readable?.locked).toBe(false);
    expect(f.port.writable?.locked).toBe(false);
  });
  it('also releases acquired streams before listen has begun', async () => {
    const f = portFixture(),
      transport = await BrowserTransport.open(f.port);
    await transport.close();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.cancel).toHaveBeenCalledOnce();
  });
  it('reports an unexpected end once and still releases the port', async () => {
    const f = portFixture(),
      transport = await BrowserTransport.open(f.port),
      disconnected = vi.fn();
    transport.listen(() => {}, disconnected);
    f.input.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(disconnected).toHaveBeenCalledOnce();
    await transport.close();
    expect(f.close).toHaveBeenCalledOnce();
  });
});
