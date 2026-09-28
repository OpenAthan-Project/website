import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESPLoader } from 'esptool-js';
import { FlashTransport } from '../../installer/flash-transport';
import { serialProgrammer } from '../../installer/flasher';

afterEach(() => vi.restoreAllMocks());

function fixture(write: (bytes: Uint8Array) => void | Promise<void>) {
  const writable = new WritableStream<Uint8Array>({ write });
  const close = vi.fn(async () => {
    if (writable.locked) throw new Error('Output is still locked');
  });
  const port = { readable: null, writable, close };
  return { port, transport: new FlashTransport(port as unknown as SerialPort), close };
}

describe('flash USB ownership without hardware', () => {
  it('preserves SLIP framing and releases the writer after each successful packet', async () => {
    const write = vi.fn(),
      f = fixture(write);
    await f.transport.write(new Uint8Array([0xc0, 0xdb, 1]));
    expect(write.mock.calls[0]![0]).toEqual(
      new Uint8Array([0xc0, 0xdb, 0xdc, 0xdb, 0xdd, 1, 0xc0]),
    );
    expect(f.port.writable.locked).toBe(false);
    await f.transport.write(new Uint8Array([2]));
    expect(write).toHaveBeenCalledTimes(2);
    await f.transport.disconnect();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('unlocks a rejected pending write so disconnect completes and blocks later output', async () => {
    let reject!: (error: Error) => void;
    const write = vi.fn(() => new Promise<void>((_, fail) => (reject = fail))),
      f = fixture(write);
    const pending = f.transport.write(new Uint8Array([1]));
    const rejected = expect(pending).rejects.toThrow('USB communication failed');
    await Promise.resolve();
    expect(f.port.writable.locked).toBe(true);
    reject(new DOMException('The device has been lost.', 'NetworkError'));
    await rejected;
    expect(f.port.writable.locked).toBe(false);
    await f.transport.disconnect();
    expect(f.close).toHaveBeenCalledOnce();

    // A fresh stream on the same port must not let the old loader retry a block.
    f.port.writable = new WritableStream({ write });
    await expect(f.transport.write(new Uint8Array([2]))).rejects.toThrow('start again');
    expect(write).toHaveBeenCalledOnce();
    expect(f.port.writable.locked).toBe(false);
  });

  it('rejects absent USB output instead of silently dropping a packet', async () => {
    const transport = new FlashTransport({ writable: null } as SerialPort);
    await expect(transport.write(new Uint8Array([1]))).rejects.toThrow('USB communication failed');
  });

  it.each([true, false])(
    'closes a lost port only if it acquired ownership (opened=%s)',
    async (opened) => {
      const port = {
        readable: null,
        writable: null,
        getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
        open: vi.fn(async () => {
          if (!opened) throw new Error('Port already in use');
        }),
        close: vi.fn(async () => {}),
      };
      vi.spyOn(ESPLoader.prototype, 'main').mockImplementation(async function (this: ESPLoader) {
        await this.transport.connect();
        throw new Error('The device has been lost.');
      });
      const programmer = serialProgrammer(port as unknown as SerialPort);
      await expect(programmer.inspect()).rejects.toThrow(opened ? 'lost' : 'in use');
      await programmer.close();
      expect(port.close).toHaveBeenCalledTimes(opened ? 1 : 0);
    },
  );
});
