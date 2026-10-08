/** Deliberately has no dependency on Web Serial, release files or the flasher. */
import { decodeFields, encodeFrame, FrameDecoder, rpcPayload } from './protocol';
import { ProvisioningSession, type ByteTransport } from './session';
import type { FirmwareInfo, UpgradeCheck, UpgradeOffer } from './upgrade';
import type { Connected, InstallerService } from './service';
export const scenarios = [
  'success',
  'new-device',
  'unreadable',
  'denied',
  'busy',
  'unknown',
  'disconnect',
  'wifi-failed',
  'storage-fault',
  'lost-wifi-ack',
  'lost-password-ack',
  'flash-failed',
  'update-available',
  'update-current',
  'update-unsupported',
  'update-failed',
  'update-uncertain',
] as const;
export type Scenario = (typeof scenarios)[number];

export class SimulatedTransport implements ByteTransport {
  private onBytes?: (bytes: Uint8Array) => void;
  private onDisconnect?: () => void;
  private decoder = new FrameDecoder();
  private closed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  readonly requests: { extension: boolean; command: number }[] = [];
  passwordRevision = 0;
  connected = false;
  constructor(
    private scenario: Scenario,
    private existing = false,
  ) {
    this.connected = existing;
    this.passwordRevision = existing ? 1 : 0;
  }
  listen(bytes: (bytes: Uint8Array) => void, disconnect: () => void) {
    this.onBytes = bytes;
    this.onDisconnect = disconnect;
    return () => {
      this.onBytes = undefined;
      this.onDisconnect = undefined;
    };
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Disconnected');
    for (const frame of this.decoder.feed(bytes)) {
      const { command } = decodeFields(frame.payload);
      this.requests.push({ extension: frame.extension, command }); // Never retain fields or passwords.
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.reply(frame.extension, command);
      }, 80);
      this.timers.add(timer);
    }
  }
  private send(extension: boolean, command: number, fields: string[]) {
    const packet = encodeFrame(extension, 4, rpcPayload(command, fields));
    // Split a real protocol response to exercise the same decoder as USB.
    this.onBytes?.(packet.slice(0, 5));
    this.onBytes?.(packet.slice(5));
  }
  private reply(extension: boolean, command: number) {
    if (this.closed) return;
    if (!extension && command === 3) {
      this.send(false, 3, [
        this.scenario === 'unknown' ? 'Other firmware' : 'OpenAthan',
        '1-dev',
        'ESP32-S3',
        'openathan-demo.local',
      ]);
      return;
    }
    if (extension && command === 1) {
      this.send(true, 1, [
        '1',
        this.connected ? '4' : '2',
        this.passwordRevision ? 'ready' : 'absent',
        this.existing ? 'active' : 'incomplete',
        String(this.passwordRevision),
        'openathan-demo.local',
        this.scenario === 'storage-fault' ? 'fault' : 'ready',
        ...(this.connected ? ['http://openathan-demo.local/', 'http://192.168.1.42/'] : []),
      ]);
      return;
    }
    if (!extension && command === 4) {
      if (this.scenario === 'disconnect') {
        this.closed = true;
        this.onDisconnect?.();
        return;
      }
      this.send(false, 4, ['Home network', '-42', 'YES']);
      this.send(false, 4, ['Guest network', '-68', 'YES']);
      this.send(false, 4, ['Open network', '-75', 'NO']);
      this.send(false, 4, []);
      return;
    }
    if (!extension && command === 1) {
      if (this.scenario === 'wifi-failed') {
        this.onBytes?.(encodeFrame(false, 2, new Uint8Array([3])));
        return;
      }
      this.connected = true;
      if (this.scenario !== 'lost-wifi-ack')
        this.send(false, 1, ['http://openathan-demo.local/', 'http://192.168.1.42/']);
      return;
    }
    if (extension && command === 2) {
      this.passwordRevision++;
      if (this.scenario !== 'lost-password-ack')
        this.send(true, 2, ['saved', String(this.passwordRevision)]);
    }
  }
  async close() {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

export class SimulatorService implements InstallerService {
  readonly simulated = true;
  readonly installAvailable = true;
  private session?: ProvisioningSession;
  private installationCandidate = false;
  onDisconnect?: () => void;
  constructor(private scenario: Scenario = 'success') {}
  private open(existing: boolean) {
    this.session = new ProvisioningSession(new SimulatedTransport(this.scenario, existing), 500);
    this.session.onDisconnect = () => this.onDisconnect?.();
    return this.session;
  }
  async connect(): Promise<Connected> {
    await this.close();
    if (this.scenario === 'denied') throw new DOMException('Permission dismissed', 'NotFoundError');
    if (this.scenario === 'busy') throw new DOMException('Port busy', 'InvalidStateError');
    if (['new-device', 'unknown', 'flash-failed'].includes(this.scenario)) {
      this.installationCandidate = true;
      return { kind: 'unrecognized' };
    }
    const session = this.open(true);
    await session.identify();
    if (this.scenario === 'unreadable') {
      await this.close();
      throw new Error(
        'OpenAthan was recognized, but its status could not be read. Reconnect your speaker; do not reinstall.',
      );
    }
    return { kind: 'existing', status: await session.status() };
  }
  async install(confirmed: boolean, progress: (percent: number) => void) {
    if (!confirmed || !this.installationCandidate)
      throw new Error('Confirm the simulated installation first.');
    this.installationCandidate = false;
    for (const percent of [15, 40, 75, 100]) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      progress(percent);
      if (percent === 40 && this.scenario === 'flash-failed')
        throw new Error(
          'Simulated installation interrupted. Reconnect and review recovery guidance before retrying.',
        );
    }
    return this.open(false).status();
  }
  async discardUpdate() {}
  async firmware(): Promise<FirmwareInfo> {
    return {
      version: 'v0.4.0',
      commit: 'a'.repeat(40),
      supported: true,
      state: 'idle',
      boot: 'confirmed',
      result: '',
      offered: '',
      received: 0,
    };
  }
  async checkUpdate(): Promise<UpgradeCheck> {
    if (this.scenario === 'update-current')
      return { state: 'current', detail: 'The simulated firmware is current.' };
    if (['update-available', 'update-failed', 'update-uncertain'].includes(this.scenario))
      return {
        state: 'available',
        offer: {
          version: 'v0.5.0',
          commit: 'b'.repeat(40),
          bytes: 256,
          sha256: '0'.repeat(64),
          notes: 'https://github.com/OpenAthan-Project/openathan/releases',
        },
      };
    return {
      state: 'unsupported',
      detail:
        'This simulated firmware needs an initial Wi-Fi or maintainer update before USB updates are supported.',
    };
  }
  async update(_offer: UpgradeOffer, progress: (percent: number) => void) {
    for (const n of [15, 40, 75, 100]) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      progress(n);
      if (n === 40 && this.scenario === 'update-failed')
        throw new Error('Simulated update rejected; reconnect and check.');
      if (n === 75 && this.scenario === 'update-uncertain')
        throw new (await import('./session')).UncertainOutcome();
    }
  }
  private current() {
    if (!this.session) throw new Error('Connect the simulated device first.');
    return this.session;
  }
  status() {
    return this.current().status();
  }
  scan() {
    return this.current().scan();
  }
  wifi(ssid: string, password: string) {
    return this.current().wifi(ssid, password);
  }
  password(password: string) {
    return this.current().password(password);
  }
  async close() {
    this.installationCandidate = false;
    const session = this.session;
    this.session = undefined;
    await session?.close();
  }
}
