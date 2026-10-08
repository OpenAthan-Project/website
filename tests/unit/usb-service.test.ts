import { beforeEach, expect, it, vi } from 'vitest';
import { decodeFields, encodeFrame, FrameDecoder, rpcPayload } from '../../installer/protocol';
import type { ByteTransport } from '../../installer/session';
import { UncertainOutcome } from '../../installer/session';
import { UPGRADE } from '../../installer/upgrade';
const hooks = vi.hoisted(() => ({ open: vi.fn(), load: vi.fn(), flash: vi.fn() }));
vi.mock('../../installer/browser-transport', () => ({
  requestDevicePort: async () => ({}),
  BrowserTransport: { open: hooks.open },
}));
vi.mock('../../installer/upgrade', async (original) => ({
  ...(await original<typeof import('../../installer/upgrade')>()),
  loadUpgrade: hooks.load,
}));
vi.mock('../../installer/flasher', () => ({ flashBundle: hooks.flash }));
import { RealService } from '../../installer/real-service';

const offer = {
  version: 'v0.5.0',
  commit: 'a'.repeat(40),
  bytes: 300,
  sha256: 'b'.repeat(64),
  notes: 'https://github.com/OpenAthan-Project/openathan/releases/tag/v0.5.0',
};
const pin = {
  tag: 'v0.5.0',
  manifestSha256: 'c'.repeat(64),
  mediaReviewed: true,
  hardwareQualified: true,
} as const;
class Port implements ByteTransport {
  private bytes?: (bytes: Uint8Array) => void;
  commands: number[] = [];
  chunks = 0;
  selected = false;
  constructor(
    public mode:
      | 'success'
      | 'legacy'
      | 'selection-error'
      | 'bad-readback'
      | 'bad-begin' = 'success',
  ) {}
  listen(bytes: (bytes: Uint8Array) => void) {
    this.bytes = bytes;
    return () => {
      this.bytes = undefined;
    };
  }
  async close() {}
  async write(bytes: Uint8Array) {
    const frame = new FrameDecoder().feed(bytes)[0]!;
    const respond = (command: number, fields: string[]) =>
      this.bytes?.(encodeFrame(frame.extension, 4, rpcPayload(command, fields)));
    if (frame.type === 5) {
      this.chunks++;
      const ack = frame.payload.slice(0, 13),
        view = new DataView(ack.buffer);
      view.setUint32(9, view.getUint32(9, true) + frame.payload.length - 13, true);
      this.bytes?.(encodeFrame(true, 6, ack));
      return;
    }
    const { command } = decodeFields(frame.payload);
    this.commands.push(command);
    if (!frame.extension) respond(command, ['OpenAthan', 'v0.4.0', 'ESP32-S3', 'OpenAthan']);
    else if (command === 1)
      respond(command, ['1', '4', 'ready', 'active', '2', 'openathan-test.local', 'ready']);
    else if (command === UPGRADE.info) {
      if (this.mode === 'legacy') this.bytes?.(encodeFrame(true, 2, new Uint8Array([2])));
      else if (this.selected && this.mode === 'bad-readback') respond(command, ['malformed']);
      else
        respond(command, [
          '1',
          'v0.4.0',
          'd'.repeat(40),
          'supported',
          this.selected ? 'awaiting_power' : 'idle',
          'confirmed',
          '',
          this.selected ? offer.version : '',
          '0',
        ]);
    } else if (command === UPGRADE.begin)
      respond(command, [this.mode === 'bad-begin' ? '0000000000000000' : '0123456789abcdef']);
    else if (command === UPGRADE.verify) respond(command, ['accepted', offer.version]);
    else if (command === UPGRADE.finish) {
      this.selected = true;
      if (this.mode === 'selection-error')
        this.bytes?.(encodeFrame(true, 2, new Uint8Array([255])));
      else respond(command, ['verified', offer.version]);
    }
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  hooks.load.mockResolvedValue({
    offer,
    descriptor: new Uint8Array([1, 2, 3]),
    application: new Uint8Array(300),
  });
});
it.each(['legacy', 'success'] as const)(
  'keeps public USB writes disabled for %s firmware',
  async (mode) => {
    const port = new Port(mode);
    hooks.open.mockResolvedValue(port);
    const service = new RealService(pin);
    await service.connect();
    expect((await service.checkUpdate()).state).toBe(
      mode === 'legacy' ? 'unsupported' : 'disabled',
    );
    await expect(service.update(offer, () => {})).rejects.toThrow('review');
    expect(hooks.load).not.toHaveBeenCalled();
    expect(hooks.flash).not.toHaveBeenCalled();
    expect(port.chunks).toBe(0);
    await service.close();
  },
);
it('streams only the reviewed signed application and confirms handoff without flashing or retry', async () => {
  const port = new Port();
  hooks.open.mockResolvedValue(port);
  const service = new RealService(pin, true);
  await service.connect();
  expect(await service.checkUpdate()).toEqual({ state: 'available', offer });
  const progress = vi.fn();
  await service.update(offer, progress);
  expect(progress).toHaveBeenLastCalledWith(100);
  expect(port.chunks).toBe(3);
  expect(port.commands.filter((c) => c === UPGRADE.finish)).toHaveLength(1);
  expect((await service.firmware()).state).toBe('awaiting_power');
  await expect(service.update(offer, progress)).rejects.toThrow('review');
  expect(hooks.flash).not.toHaveBeenCalled();
  await service.close();
});
it.each(['selection-error', 'bad-readback', 'bad-begin'] as const)(
  'blocks writes after %s and permits status reconciliation',
  async (mode) => {
    const port = new Port(mode);
    hooks.open.mockResolvedValue(port);
    const service = new RealService(pin, true);
    await service.connect();
    await service.checkUpdate();
    await expect(service.update(offer, () => {})).rejects.toBeInstanceOf(UncertainOutcome);
    const before = port.commands.length;
    await expect(service.password('test device password')).rejects.toThrow('Reconnect');
    expect(port.commands).toHaveLength(before);
    expect((await service.status()).wifi).toBe('4');
    expect(port.commands.filter((c) => c === UPGRADE.finish)).toHaveLength(
      mode === 'bad-begin' ? 0 : 1,
    );
    expect(hooks.flash).not.toHaveBeenCalled();
    await service.close();
  },
);
