import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFrame, rpcPayload } from '../../installer/protocol';
import { ProvisioningSession, UncertainOutcome, type ByteTransport } from '../../installer/session';
import { SimulatedTransport } from '../../installer/simulator';

class Port implements ByteTransport {
  writes: Uint8Array[] = [];
  onBytes?: (bytes: Uint8Array) => void;
  onDisconnect?: () => void;
  listen(bytes: (bytes: Uint8Array) => void, disconnect: () => void) {
    this.onBytes = bytes;
    this.onDisconnect = disconnect;
    return () => {
      this.onBytes = undefined;
      this.onDisconnect = undefined;
    };
  }
  async write(bytes: Uint8Array) {
    this.writes.push(bytes.slice());
  }
  async close() {}
  response(extension: boolean, command: number, fields: string[]) {
    this.onBytes?.(encodeFrame(extension, 4, rpcPayload(command, fields)));
  }
}
afterEach(() => vi.useRealTimers());
describe('one owner, no mutation retries', () => {
  it('rejects concurrent commands and ignores unrelated responses', async () => {
    const port = new Port(),
      session = new ProvisioningSession(port);
    const first = session.command(true, 1);
    await expect(session.command(false, 4)).rejects.toThrow('still running');
    port.response(false, 1, ['wrong protocol']);
    port.response(true, 2, ['wrong command']);
    port.response(true, 1, ['right']);
    expect(await first).toEqual([['right']]);
    expect(port.writes).toHaveLength(1);
    await session.close();
  });
  it('does not mistake error-clear messages for acknowledgements', async () => {
    const port = new Port(),
      session = new ProvisioningSession(port);
    const operation = session.password('test password 123');
    port.onBytes?.(encodeFrame(true, 2, new Uint8Array([0])));
    port.response(true, 2, ['saved', '2']);
    expect(await operation).toBe(2);
    await session.close();
  });
  it('never retries a lost write and permits only status reconciliation afterward', async () => {
    vi.useFakeTimers();
    const port = new Port(),
      session = new ProvisioningSession(port, 100);
    const result = session.password('test password 123').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toBeInstanceOf(UncertainOutcome);
    expect(port.writes).toHaveLength(1);
    await expect(session.password('another password')).rejects.toThrow('Reconnect');
    const status = session.status();
    port.response(true, 1, ['1', '4', 'ready', 'active', '2', 'openathan-test.local', 'ready']);
    expect((await status).passwordRevision).toBe(2);
    expect(port.writes).toHaveLength(2);
    await session.close();
  });
  it('treats a disconnect while saving as uncertain', async () => {
    const port = new Port(),
      session = new ProvisioningSession(port);
    const result = session.wifi('home', 'test-password').catch((error: unknown) => error);
    port.onDisconnect?.();
    expect(await result).toBeInstanceOf(UncertainOutcome);
    expect(port.writes).toHaveLength(1);
    await session.close();
  });
  it('does not let a late write failure reject a newer status read', async () => {
    vi.useFakeTimers();
    const port = new Port();
    let rejectWrite!: (error: Error) => void;
    vi.spyOn(port, 'write').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const session = new ProvisioningSession(port, 100);
    const saved = session.password('test password 123').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(101);
    expect(await saved).toBeInstanceOf(UncertainOutcome);
    const status = session.status();
    rejectWrite(new Error('Late write failure'));
    await Promise.resolve();
    await Promise.resolve();
    port.response(true, 1, ['1', '4', 'ready', 'active', '2', 'openathan-test.local', 'ready']);
    expect((await status).passwordRevision).toBe(2);
    await session.close();
  });
  it('handles scan termination and rejects a malformed password acknowledgement', async () => {
    const port = new Port(),
      session = new ProvisioningSession(port);
    const scan = session.scan();
    port.response(false, 4, ['home', '-40', 'YES']);
    port.response(false, 4, []);
    expect(await scan).toEqual([{ ssid: 'home', signal: -40, secured: true }]);
    const saved = session.password('test password 123');
    port.response(true, 2, ['saved']);
    await expect(saved).rejects.toBeInstanceOf(UncertainOutcome);
    expect(session.uncertain).toBe(true);
    await session.close();
  });
  it('preserves the firmware failure reason without retrying rejected Wi-Fi', async () => {
    vi.useFakeTimers();
    const transport = new SimulatedTransport('wifi-failed', true),
      session = new ProvisioningSession(transport);
    const result = session.wifi('home', 'test password').catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toContain('Previous saved credentials were retained');
    expect(transport.requests).toEqual([{ extension: false, command: 1 }]);
    await session.close();
  });
  it('a saved Wi-Fi connection after lost acknowledgement remains uncertain', async () => {
    vi.useFakeTimers();
    const transport = new SimulatedTransport('lost-wifi-ack', true),
      session = new ProvisioningSession(transport, 150);
    const result = session.wifi('new home', 'test password').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(160);
    expect(await result).toBeInstanceOf(UncertainOutcome);
    const status = session.status();
    await vi.advanceTimersByTimeAsync(100);
    expect((await status).wifi).toBe('4');
    expect(session.uncertain).toBe(true);
    expect(
      transport.requests.filter((request) => !request.extension && request.command === 1),
    ).toHaveLength(1);
    await session.close();
  });
});

it('keeps the 40-second Wi-Fi deadline after a short discovery timeout', async () => {
  vi.useFakeTimers();
  const port = new Port(),
    session = new ProvisioningSession(port);
  const identity = session.identify(5000).catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await identity).toBeInstanceOf(Error);
  let settled = false;
  const save = session
    .wifi('home', 'test password')
    .catch((e: unknown) => e)
    .finally(() => {
      settled = true;
    });
  await vi.advanceTimersByTimeAsync(39999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await save).toBeInstanceOf(UncertainOutcome);
  expect(port.writes).toHaveLength(2);
  await expect(session.wifi('home', 'test password')).rejects.toThrow('Reconnect');
  await session.close();
});
