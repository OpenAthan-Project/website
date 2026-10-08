import { beforeEach, expect, it, vi } from 'vitest';
import { decodeFields, encodeFrame, FrameDecoder, rpcPayload } from '../../installer/protocol';
import type { ByteTransport } from '../../installer/session';
import { UncertainOutcome } from '../../installer/session';
import { UPGRADE, UpgradeDownloadTimeout } from '../../installer/upgrade';
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
  firmwareState = 'idle';
  boot: 'pending' | 'confirmed' = 'confirmed';
  supported = true;
  infoFailure?: 'malformed' | 'rejected';
  discardReply: 'success' | 'rejected' | 'malformed' = 'success';
  malformedChunkKind?: 0 | 1;
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
      if (frame.payload[8] === this.malformedChunkKind) {
        this.bytes?.(encodeFrame(true, 2, new Uint8Array([255, 99])));
        return;
      }
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
      else if (this.infoFailure === 'rejected')
        this.bytes?.(encodeFrame(true, 2, new Uint8Array([255])));
      else if (this.infoFailure === 'malformed') respond(command, ['malformed']);
      else if (this.selected && this.mode === 'bad-readback') respond(command, ['malformed']);
      else
        respond(command, [
          '1',
          'v0.4.0',
          'd'.repeat(40),
          this.supported ? 'supported' : 'unsupported',
          this.selected ? 'awaiting_power' : this.firmwareState,
          this.boot,
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
    } else if (command === UPGRADE.abort) {
      if (this.discardReply === 'rejected')
        this.bytes?.(encodeFrame(true, 2, new Uint8Array([255])));
      else if (this.discardReply === 'malformed') respond(command, ['malformed']);
      else {
        this.firmwareState = 'idle';
        respond(command, ['aborted']);
      }
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
  expect(await service.checkUpdate()).toEqual({
    state: 'available',
    offer,
    recoveryBlocked: false,
  });
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
it.each([0, 1] as const)(
  'stops a malformed chunk error in transfer kind %i before further update writes',
  async (kind) => {
    const port = new Port();
    port.malformedChunkKind = kind;
    hooks.open.mockResolvedValue(port);
    const service = new RealService(pin, true);
    await service.connect();
    await service.checkUpdate();
    await expect(service.update(offer, () => {})).rejects.toBeInstanceOf(UncertainOutcome);
    expect(port.chunks).toBe(kind === 0 ? 1 : 2);
    expect(port.commands.filter((command) => command === UPGRADE.verify)).toHaveLength(kind);
    expect(port.commands).not.toContain(UPGRADE.finish);
    expect(port.selected).toBe(false);
    const before = port.commands.length;
    await expect(service.password('test device password')).rejects.toThrow('Reconnect');
    await expect(service.wifi('Test network', 'test wifi password')).rejects.toThrow('Reconnect');
    expect(port.commands).toHaveLength(before);
    expect((await service.status()).wifi).toBe('4');
    expect((await service.firmware()).state).toBe('idle');
    expect(port.chunks).toBe(kind === 0 ? 1 : 2);
    expect(hooks.flash).not.toHaveBeenCalled();
    await service.close();
  },
);
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

for (const state of [
  'usb_descriptor',
  'usb_receiving',
  'usb_interrupted',
  'usb_selection_uncertain',
  'awaiting_power',
]) {
  it.each(['pending', 'confirmed'] as const)(
    `blocks recovery for ${state} with %s startup`,
    async (boot) => {
      const port = new Port();
      port.firmwareState = state;
      port.boot = boot;
      hooks.open.mockResolvedValue(port);
      const service = new RealService(pin);
      await service.connect();
      expect(port.commands).toEqual([3, 1]);
      expect(await service.checkUpdate()).toMatchObject({
        state: 'busy',
        recoveryBlocked: true,
        action:
          state === 'awaiting_power'
            ? 'power'
            : state === 'usb_interrupted' && boot === 'confirmed'
              ? 'discard'
              : undefined,
      });
      expect(port.commands).toEqual([3, 1, UPGRADE.info]);
      expect(hooks.load).not.toHaveBeenCalled();
      await service.close();
    },
  );
}

it.each([
  'idle',
  'current',
  'available',
  'success',
  'rolled_back',
  'failed',
  'checking',
  'queued',
  'downloading',
  'verifying',
  'restarting',
  'storage_fault',
])('does not infer USB ownership from ordinary %s activity', async (state) => {
  const port = new Port();
  port.firmwareState = state;
  hooks.open.mockResolvedValue(port);
  const service = new RealService(pin);
  await service.connect();
  expect((await service.checkUpdate()).recoveryBlocked).toBe(false);
  expect(hooks.load).not.toHaveBeenCalled();
  await service.close();
});

it('does not infer USB ownership from ordinary pending startup or legacy firmware', async () => {
  const port = new Port();
  port.boot = 'pending';
  hooks.open.mockResolvedValue(port);
  const service = new RealService(pin);
  await service.connect();
  expect(await service.checkUpdate()).toMatchObject({ state: 'busy', recoveryBlocked: false });
  port.mode = 'legacy';
  expect(await service.checkUpdate()).toMatchObject({
    state: 'unsupported',
    recoveryBlocked: false,
  });
  await service.close();
});

it.each(['malformed', 'rejected'] as const)(
  'leaves ownership unknown after %s INFO',
  async (failure) => {
    const port = new Port();
    port.infoFailure = failure;
    hooks.open.mockResolvedValue(port);
    const service = new RealService(pin);
    await service.connect();
    const result = await service.checkUpdate();
    expect(result.state).toBe('failed');
    expect(result).not.toHaveProperty('recoveryBlocked');
    await service.close();
  },
);

it('retains successful INFO ownership metadata when release verification fails', async () => {
  const port = new Port();
  hooks.open.mockResolvedValue(port);
  hooks.load.mockRejectedValue(new Error('Invalid signature'));
  const service = new RealService(pin, true);
  await service.connect();
  expect(await service.checkUpdate()).toMatchObject({ state: 'failed', recoveryBlocked: false });
  await service.close();
});

it('reports a download timeout without mutation or retry and permits a deliberate fresh check', async () => {
  const port = new Port();
  hooks.open.mockResolvedValue(port);
  hooks.load.mockRejectedValueOnce(new UpgradeDownloadTimeout());
  const service = new RealService(pin, true);
  await service.connect();
  expect(await service.checkUpdate()).toEqual({
    state: 'failed',
    recoveryBlocked: false,
    detail:
      'The firmware download timed out. Check your internet connection and choose Check for updates again. Installed firmware has not changed.',
  });
  await expect(service.update(offer, () => {})).rejects.toThrow('review');
  expect(hooks.load).toHaveBeenCalledTimes(1);
  expect(port.commands).toEqual([3, 1, UPGRADE.info]);
  expect(port.chunks).toBe(0);
  expect(hooks.flash).not.toHaveBeenCalled();
  expect(await service.checkUpdate()).toMatchObject({ state: 'available', recoveryBlocked: false });
  expect(hooks.load).toHaveBeenCalledTimes(2);
  expect(port.commands).toEqual([3, 1, UPGRADE.info, UPGRADE.info]);
  await service.close();
});

it('keeps USB ownership ahead of bootloader capability reporting', async () => {
  const port = new Port();
  port.supported = false;
  hooks.open.mockResolvedValue(port);
  const service = new RealService(pin);
  await service.connect();
  expect(await service.checkUpdate()).toMatchObject({
    state: 'unsupported',
    recoveryBlocked: false,
  });
  port.firmwareState = 'awaiting_power';
  expect(await service.checkUpdate()).toMatchObject({
    state: 'busy',
    action: 'power',
    recoveryBlocked: true,
  });
  await service.close();
});

it('requires fresh confirmed startup health before discarding and reads cleared ownership afterward', async () => {
  const port = new Port();
  port.firmwareState = 'usb_interrupted';
  port.boot = 'pending';
  hooks.open.mockResolvedValue(port);
  const service = new RealService(pin);
  await service.connect();
  await expect(service.discardUpdate()).rejects.toThrow('Read update status');
  expect(port.commands).not.toContain(UPGRADE.abort);
  port.boot = 'confirmed';
  await service.discardUpdate();
  expect(port.commands.filter((c) => c === UPGRADE.abort)).toHaveLength(1);
  expect(await service.checkUpdate()).toMatchObject({ state: 'disabled', recoveryBlocked: false });
  expect(hooks.flash).not.toHaveBeenCalled();
  await service.close();
});

it.each(['rejected', 'malformed'] as const)(
  'does not retry a %s discard or claim cleared ownership',
  async (reply) => {
    const port = new Port();
    port.firmwareState = 'usb_interrupted';
    port.discardReply = reply;
    hooks.open.mockResolvedValue(port);
    const service = new RealService(pin);
    await service.connect();
    await expect(service.discardUpdate()).rejects.toThrow();
    expect(port.commands.filter((c) => c === UPGRADE.abort)).toHaveLength(1);
    expect(await service.checkUpdate()).toMatchObject({
      state: 'busy',
      action: 'discard',
      recoveryBlocked: true,
    });
    if (reply === 'malformed') {
      await expect(service.discardUpdate()).rejects.toThrow('Reconnect');
      expect(port.commands.filter((c) => c === UPGRADE.abort)).toHaveLength(1);
    }
    await service.close();
  },
);
