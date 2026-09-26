import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulatedTransport } from '../../installer/simulator';
const hooks = vi.hoisted(() => ({
  requestPort: vi.fn(),
  open: vi.fn(),
  flash: vi.fn(),
  programmer: vi.fn(),
}));
vi.mock('../../installer/browser-transport', () => ({
  requestDevicePort: hooks.requestPort,
  BrowserTransport: { open: hooks.open },
}));
vi.mock('../../installer/flasher', () => ({
  flashBundle: hooks.flash,
  serialProgrammer: hooks.programmer,
}));
import { RealService } from '../../installer/real-service';

beforeEach(() => {
  vi.clearAllMocks();
  hooks.requestPort.mockResolvedValue({});
});
describe('real recovery boundary using fake byte transport', () => {
  it('can change credentials with no release, without loading a programmer or flashing', async () => {
    const port = new SimulatedTransport('success', true);
    hooks.open.mockResolvedValue(port);
    const service = new RealService(null);
    expect(await service.connect('recovery')).toMatchObject({ kind: 'existing' });
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
  it('blocks unavailable new installs before the browser device picker', async () => {
    const service = new RealService(null);
    await expect(service.connect('install')).rejects.toThrow('not available');
    expect(hooks.requestPort).not.toHaveBeenCalled();
    expect(hooks.flash).not.toHaveBeenCalled();
  });
  it('recognizes existing firmware on the install path and refuses factory replacement', async () => {
    hooks.open.mockResolvedValue(new SimulatedTransport('success', true));
    const service = new RealService({
      tag: 'v1.0.0',
      manifestSha256: 'a'.repeat(64),
      mediaReviewed: true,
      hardwareQualified: true,
    });
    expect(await service.connect('install')).toMatchObject({ kind: 'existing' });
    await expect(service.install(true, () => {})).rejects.toThrow('confirmed new-device');
    expect(hooks.flash).not.toHaveBeenCalled();
    await service.close();
  });
});
