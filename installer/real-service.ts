import { BrowserTransport, requestDevicePort } from './browser-transport';
import { ProvisioningSession } from './session';
import { loadRelease, type ReleasePin } from './release';
import type { InstallerService, Path, Connected } from './service';

export class RealService implements InstallerService {
  readonly simulated = false;
  readonly installAvailable: boolean;
  private port?: SerialPort;
  private session?: ProvisioningSession;
  private newDeviceConfirmedPath = false;
  private reloadRequired = false;
  onDisconnect?: () => void;
  constructor(private pin: ReleasePin | null) {
    this.installAvailable = pin !== null;
  }
  private async open(): Promise<ProvisioningSession> {
    if (!this.port) throw new Error('Choose the USB device first.');
    const session = new ProvisioningSession(await BrowserTransport.open(this.port));
    session.onDisconnect = () => this.onDisconnect?.();
    this.session = session;
    return session;
  }
  async connect(path: Path): Promise<Connected> {
    if (this.reloadRequired)
      throw new Error('Reload this page before reconnecting after an interrupted installation.');
    if (path === 'install' && !this.pin) throw new Error('Installation release not available yet.');
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
      this.newDeviceConfirmedPath = false;
      return { kind: 'existing', status };
    } catch {
      if (recognized || path === 'recovery') {
        await this.close();
        throw new Error(
          recognized
            ? 'OpenAthan was recognized, but its status could not be read. Reconnect and use recovery; do not reinstall.'
            : 'OpenAthan firmware was not recognized. Check the cable, close other USB tools and reconnect. Recovery will not install or erase firmware.',
        );
      }
      // Detection failure is not installation authorization. The next screen requires
      // a separate explicit confirmation that this hardware may be fully replaced.
      await session.close();
      this.session = undefined;
      this.newDeviceConfirmedPath = true;
      return { kind: 'new' };
    }
  }
  async install(confirmed: boolean, progress: (percent: number) => void) {
    if (!confirmed || !this.newDeviceConfirmedPath || !this.port || !this.pin || this.session)
      throw new Error('A confirmed new-device connection is required.');
    this.newDeviceConfirmedPath = false;
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
      'Installation was verified, but setup could not reconnect. Reconnect the cable and choose Fix Wi-Fi or password. Do not reinstall.',
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
    this.newDeviceConfirmedPath = false;
    await this.releaseSession();
  }
}
