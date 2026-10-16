import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulatedTransport, SimulatorService } from '../../installer/simulator';
import { HARDWARE, WAVESHARE } from '../../installer/release';
import type { InstallationResult } from '../../installer/service';
const hooks = vi.hoisted(() => ({
  requestPort: vi.fn(),
  open: vi.fn(),
  flash: vi.fn(),
  programmer: vi.fn(),
  bundle: vi.fn(),
}));
vi.mock('../../installer/browser-transport', () => ({
  requestDevicePort: hooks.requestPort,
  BrowserTransport: { open: hooks.open },
}));
vi.mock('../../installer/flasher', () => ({
  flashBundle: hooks.flash,
  serialProgrammer: hooks.programmer,
}));
vi.mock('../../installer/release', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../installer/release')>()),
  loadRelease: hooks.bundle,
}));
import { RealService } from '../../installer/real-service';

const pin = {
  tag: 'v1.0.0',
  manifestSha256: 'a'.repeat(64),
  mediaReviewed: true,
  hardwareQualified: true,
} as const;
beforeEach(() => {
  vi.clearAllMocks();
  hooks.requestPort.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe('unified connection and recovery boundary', () => {
  it('can change credentials with no release, without loading a programmer or flashing', async () => {
    const port = new SimulatedTransport('success', true);
    hooks.open.mockResolvedValue(port);
    const service = new RealService(null);
    expect(await service.connect()).toMatchObject({ kind: 'existing' });
    await service.wifi('home', 'test wifi password');
    await service.password('test device password');
    await expect(service.install(true, () => {})).rejects.toThrow('confirmed new-device');
    expect(hooks.flash).not.toHaveBeenCalled();
    expect(hooks.programmer).not.toHaveBeenCalled();
    expect(
      port.requests.every((r) =>
        r.extension ? [1, 2].includes(r.command) : [1, 3].includes(r.command),
      ),
    ).toBe(true);
    await service.close();
  });
  it('refuses factory replacement of recognized existing firmware even when a release is available', async () => {
    hooks.open.mockResolvedValue(new SimulatedTransport('success', true));
    const service = new RealService(pin);
    expect(await service.connect()).toMatchObject({ kind: 'existing' });
    await expect(service.install(true, () => {})).rejects.toThrow('confirmed new-device');
    expect(hooks.flash).not.toHaveBeenCalled();
    await service.close();
  });
  for (const release of [pin, null]) {
    it(`bounds silent discovery and requires confirmation${release ? '' : ' and an available release'}`, async () => {
      vi.useFakeTimers();
      const port = new SimulatedTransport('success', true);
      const write = vi.spyOn(port, 'write').mockResolvedValue();
      const close = vi.spyOn(port, 'close');
      hooks.open.mockResolvedValue(port);
      const service = new RealService(release);
      let settled = false;
      const result = service.connect().finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(4999);
      expect(write).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(write).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual({ kind: 'unrecognized' });
      expect(hooks.requestPort).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await expect(service.install(false, () => {})).rejects.toThrow('confirmed');
      if (!release) await expect(service.install(true, () => {})).rejects.toThrow('confirmed');
      expect(hooks.bundle).not.toHaveBeenCalled();
      expect(hooks.flash).not.toHaveBeenCalled();
      await service.close();
      await expect(service.install(true, () => {})).rejects.toThrow('confirmed');
    });
  }
  it('recognizes status after a silent identity probe without reopening USB', async () => {
    vi.useFakeTimers();
    const port = new SimulatedTransport('success', true);
    vi.spyOn(port, 'write').mockResolvedValueOnce();
    hooks.open.mockResolvedValue(port);
    const service = new RealService(pin);
    const result = service.connect();
    await vi.advanceTimersByTimeAsync(5080);
    expect(await result).toMatchObject({ kind: 'existing' });
    expect(hooks.open).toHaveBeenCalledTimes(1);
    await expect(service.install(true, () => {})).rejects.toThrow('confirmed');
    await service.close();
  });
  it('blocks replacement when identity succeeds but status stays silent', async () => {
    vi.useFakeTimers();
    const port = new SimulatedTransport('success', true);
    const original = port.write.bind(port);
    vi.spyOn(port, 'write').mockImplementationOnce(original).mockResolvedValue();
    const close = vi.spyOn(port, 'close');
    hooks.open.mockResolvedValue(port);
    const service = new RealService(pin);
    const result = service.connect().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10000);
    expect(String(await result)).toContain('recognized, but its status');
    expect(close).toHaveBeenCalledTimes(1);
    await expect(service.install(true, () => {})).rejects.toThrow('confirmed');
    expect(hooks.flash).not.toHaveBeenCalled();
  });
  it('does not classify a disconnected device as an installation candidate', async () => {
    const port = new SimulatedTransport('success', true);
    const listen = port.listen.bind(port);
    let disconnect: () => void;
    vi.spyOn(port, 'listen').mockImplementation((bytes, callback) => {
      disconnect = callback;
      return listen(bytes, callback);
    });
    vi.spyOn(port, 'write').mockImplementation(async () => {
      disconnect();
    });
    hooks.open.mockResolvedValue(port);
    const service = new RealService(pin);
    await expect(service.connect()).rejects.toThrow('disconnected');
    await expect(service.install(true, () => {})).rejects.toThrow('confirmed');
    expect(hooks.flash).not.toHaveBeenCalled();
  });
  it('requires a reload before another USB owner after failed installation cleanup', async () => {
    vi.useFakeTimers();
    const port = new SimulatedTransport('success', true);
    vi.spyOn(port, 'write').mockResolvedValue();
    hooks.open.mockResolvedValue(port);
    hooks.bundle.mockResolvedValue({});
    hooks.flash.mockRejectedValue(new Error('USB communication failed'));
    const service = new RealService(pin);
    const connected = service.connect();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await connected).toEqual({ kind: 'unrecognized' });
    await expect(service.install(true, () => {})).rejects.toThrow('USB communication failed');
    await service.close();
    await expect(service.connect()).rejects.toThrow('Reload this page');
    expect(hooks.requestPort).toHaveBeenCalledOnce();
    expect(hooks.open).toHaveBeenCalledOnce();
    expect(hooks.flash).toHaveBeenCalledOnce();
  });
});

describe('fresh-install phone-setup capability', () => {
  async function candidate() {
    const silent = new SimulatedTransport('success');
    vi.spyOn(silent, 'write').mockResolvedValue();
    hooks.open.mockResolvedValueOnce(silent);
    const service = new RealService(pin);
    const discovery = service.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await discovery).toEqual({ kind: 'unrecognized' });
    return service;
  }

  it.each([false, true])(
    'returns phoneSetup=%s only from the verified installed bundle after successful status',
    async (phoneSetup) => {
      vi.useFakeTimers();
      const service = await candidate();
      const bundle = { manifest: phoneSetup ? { phoneSetup: 1 } : {} };
      hooks.bundle.mockResolvedValue(bundle);
      hooks.flash.mockResolvedValue(undefined);
      hooks.open.mockResolvedValueOnce(new SimulatedTransport('success'));
      const completed = vi.fn<(result: InstallationResult) => void>();
      const installation = service
        .install(true, () => {})
        .then((result) => {
          completed(result);
          return result;
        });
      await vi.advanceTimersByTimeAsync(2_079);
      expect(completed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(81);
      const result = await installation;
      expect(result).toMatchObject({ phoneSetup, status: { password: 'absent', wifi: '2' } });
      expect(completed).toHaveBeenCalledOnce();
      expect(hooks.bundle).toHaveBeenCalledWith(pin);
      expect(hooks.flash).toHaveBeenCalledWith(undefined, bundle, true, expect.any(Function));
      expect(hooks.flash).toHaveBeenCalledOnce();
      const refreshed = service.status();
      await vi.advanceTimersByTimeAsync(80);
      expect(await refreshed).not.toHaveProperty('phoneSetup');
      await service.close();
    },
  );

  it('does not complete a capable installation after a failed flash', async () => {
    vi.useFakeTimers();
    const service = await candidate();
    hooks.bundle.mockResolvedValue({ manifest: { phoneSetup: 1 } });
    hooks.flash.mockRejectedValue(new Error('Flash readback failed'));
    const completed = vi.fn();
    await expect(service.install(true, () => {}).then(completed)).rejects.toThrow(
      'Flash readback failed',
    );
    expect(completed).not.toHaveBeenCalled();
    expect(hooks.open).toHaveBeenCalledOnce();
    expect(hooks.flash).toHaveBeenCalledOnce();
    await service.close();
  });

  it('does not flash or return capability when release verification fails', async () => {
    vi.useFakeTimers();
    const service = await candidate();
    hooks.bundle.mockRejectedValue(new Error('Release manifest verification failed'));
    const completed = vi.fn();
    await expect(service.install(true, () => {}).then(completed)).rejects.toThrow(
      'Release manifest verification failed',
    );
    expect(completed).not.toHaveBeenCalled();
    expect(hooks.open).toHaveBeenCalledOnce();
    expect(hooks.flash).not.toHaveBeenCalled();
    await service.close();
  });

  it('does not complete or expose capability when verified flashing cannot read status', async () => {
    vi.useFakeTimers();
    const service = await candidate();
    hooks.bundle.mockResolvedValue({ manifest: { phoneSetup: 1 } });
    hooks.flash.mockResolvedValue(undefined);
    hooks.open.mockImplementation(async () => {
      const port = new SimulatedTransport('success');
      const write = port.write.bind(port);
      vi.spyOn(port, 'write')
        .mockImplementationOnce(write)
        .mockRejectedValue(new Error('Status unavailable'));
      return port;
    });
    const completed = vi.fn();
    const installation = service
      .install(true, () => {})
      .then(completed)
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(12_480);
    expect(String(await installation)).toContain(
      'Installation was verified, but setup could not reconnect',
    );
    expect(completed).not.toHaveBeenCalled();
    expect(hooks.open).toHaveBeenCalledTimes(7);
    expect(hooks.flash).toHaveBeenCalledOnce();
    await service.close();
  });

  it('does not infer phone-setup readiness from an existing connection or firmware version', async () => {
    hooks.open.mockResolvedValue(new SimulatedTransport('success', true));
    const service = new RealService(pin);
    const connected = await service.connect();
    expect(connected).toMatchObject({ kind: 'existing' });
    expect(connected).not.toHaveProperty('phoneSetup');
    expect(await service.status()).not.toHaveProperty('phoneSetup');
    expect(hooks.bundle).not.toHaveBeenCalled();
    expect(hooks.flash).not.toHaveBeenCalled();
    await service.close();
  });

  it.each([
    ['new-device', HARDWARE, false],
    ['waveshare-new', WAVESHARE, false],
    ['phone-new', HARDWARE, true],
    ['phone-waveshare-new', WAVESHARE, true],
  ] as const)('keeps simulator %s capability explicit', async (scenario, hardware, phoneSetup) => {
    vi.useFakeTimers();
    const service = new SimulatorService(scenario);
    expect(await service.connect()).toEqual({ kind: 'unrecognized' });
    const installation = service.install(true, () => {}, hardware);
    await vi.advanceTimersByTimeAsync(480);
    expect(await installation).toMatchObject({ phoneSetup, status: { password: 'absent' } });
    expect(hooks.bundle).not.toHaveBeenCalled();
    expect(hooks.flash).not.toHaveBeenCalled();
    await service.close();
  });
});
