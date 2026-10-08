import { BrowserTransport, requestDevicePort } from './browser-transport';
import { ProvisioningSession } from './session';
import { loadRelease, type ReleasePin } from './release';
import type { InstallerService, Connected } from './service';

export class RealService implements InstallerService {
  readonly simulated = false;
  readonly installAvailable: boolean;
  private port?: SerialPort;
  private session?: ProvisioningSession;
  private installationCandidate = false;
  private reloadRequired = false;
  private connectionLost = false;
  onDisconnect?: () => void;
  constructor(private pin: ReleasePin | null) {
    this.installAvailable = pin !== null;
  }
  private async open(): Promise<ProvisioningSession> {
    if (!this.port) throw new Error('Choose the USB device first.');
    const session = new ProvisioningSession(await BrowserTransport.open(this.port));
    this.connectionLost = false;
    session.onDisconnect = () => {
      this.connectionLost = true;
      this.installationCandidate = false;
      this.onDisconnect?.();
    };
    this.session = session;
    return session;
  }
  async connect(): Promise<Connected> {
    if (this.reloadRequired)
      throw new Error('Reload this page before reconnecting after an interrupted installation.');
    await this.close();
    this.port = await requestDevicePort();
    const session = await this.open();
    const discoveryDeadline = performance.now() + 10_000;
    let recognized = false;
    try {
      // The extension is a second recognition signal if the standard info read fails.
      try {
        await session.identify(5_000);
        recognized = true;
      } catch {
        /* Try read-only extension status below. */
      }
      const remaining = discoveryDeadline - performance.now();
      if (remaining <= 0) throw new Error('Device discovery timed out.');
      const status = await session.status(remaining);
      recognized = true;
      this.installationCandidate = false;
      return { kind: 'existing', status };
    } catch {
      if (recognized || this.connectionLost) {
        await this.close();
        throw new Error(
          this.connectionLost
            ? 'Device disconnected. Reconnect the USB data cable.'
            : 'OpenAthan was recognized, but its status could not be read. Reconnect your speaker; do not reinstall.',
        );
      }
      // Detection failure is not installation authorization. The next screen requires
      // a separate explicit confirmation that this hardware may be fully replaced.
      await session.close();
      this.session = undefined;
      this.installationCandidate = this.installAvailable;
      return { kind: 'unrecognized' };
    }
  }
  async install(confirmed: boolean, progress: (percent: number) => void) {
    if (!confirmed || !this.installationCandidate || !this.port || !this.pin || this.session)
      throw new Error('A confirmed new-device connection is required.');
    this.installationCandidate = false;
    const bundle = await loadRelease(this.pin);
    const { flashBundle, serialProgrammer } = await import('./flasher');
    try {
      await flashBundle(serialProgrammer(this.port), bundle, true, progress);
    } catch (error) {
      // Timed-out driver cleanup may still be pending. Only a page reload can
      // dispose that browser session before another serial owner is created.
      this.reloadRequired = true;
      throw error;
    }
    // Read-only reconnect attempts are bounded; no flash or provisioning write retries.
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const session = await this.open();
        await session.identify();
        return await session.status();
      } catch {
        await this.releaseSession().catch(() => undefined);
      }
    }
    throw new Error(
      'Installation was verified, but setup could not reconnect. Reconnect through USB setup to check the speaker. Do not reinstall.',
    );
  }
  private current() {
    if (!this.session) throw new Error('Connect the device first.');
    return this.session;
  }
  private async releaseSession() {
    const session = this.session;
    this.session = undefined;
    await session?.close();
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
    this.port = undefined;
    this.installationCandidate = false;
    await this.releaseSession();
  }
}
