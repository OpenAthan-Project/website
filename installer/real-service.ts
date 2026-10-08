import { BrowserTransport, requestDevicePort } from './browser-transport';
import { ProvisioningSession, DeviceError, UncertainOutcome } from './session';
import {
  loadUpgrade,
  newerVersion,
  UPGRADE,
  CHUNK_BYTES,
  type UpgradeBundle,
  type UpgradeOffer,
  type UpgradeCheck,
} from './upgrade';
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
  private updateBundle?: UpgradeBundle;
  onDisconnect?: () => void;
  constructor(
    private pin: ReleasePin | null,
    private usbUpdateEnabled = false,
  ) {
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
  async discardUpdate() {
    const info = await this.firmware();
    if (info.state !== 'usb_interrupted')
      throw new Error('Read update status before discarding an incomplete transfer.');
    const [reply] = await this.current().command(true, UPGRADE.abort, ['interrupted'], {
      mutation: true,
    });
    if (reply?.length !== 1 || reply[0] !== 'aborted') {
      this.current().uncertain = true;
      throw new UncertainOutcome();
    }
  }
  firmware() {
    return this.current().firmware();
  }
  async checkUpdate(): Promise<UpgradeCheck> {
    this.updateBundle = undefined;
    let info;
    try {
      info = await this.firmware();
    } catch (error) {
      if (error instanceof DeviceError && error.code === 2)
        return {
          state: 'unsupported',
          detail:
            'This firmware needs an initial Wi-Fi or maintainer update before USB updates are supported.',
        };
      return {
        state: 'failed',
        detail: 'Firmware status could not be read. Reconnect and check again.',
      };
    }
    if (!info.supported)
      return {
        state: 'unsupported',
        detail: 'This speaker needs a maintainer bootloader transition before preserving updates.',
      };
    if (
      info.boot !== 'confirmed' ||
      !['idle', 'current', 'available', 'success', 'rolled_back', 'failed'].includes(info.state)
    )
      return {
        state: 'busy',
        action:
          info.state === 'awaiting_power'
            ? 'power'
            : info.state === 'usb_interrupted'
              ? 'discard'
              : undefined,
        detail:
          info.state === 'awaiting_power'
            ? 'An update is verified. Switch to Pyramid bottom power to finish.'
            : 'The device has an update or startup check in progress. Check its status before another update.',
      };
    if (!this.usbUpdateEnabled || !this.pin)
      return {
        state: 'disabled',
        detail:
          'USB updating is awaiting physical qualification. Use firmware updates on the device’s settings page.',
      };
    try {
      const bundle = await loadUpgrade(this.pin);
      if (!newerVersion(bundle.offer.version, info.version))
        return {
          state: 'current',
          detail: `Firmware ${info.version} is current for this website’s selected release.`,
        };
      this.updateBundle = bundle;
      return { state: 'available', offer: bundle.offer };
    } catch {
      return {
        state: 'failed',
        detail: 'The selected update could not be verified. Installed firmware has not changed.',
      };
    }
  }
  async update(offer: UpgradeOffer, progress: (percent: number) => void): Promise<void> {
    const bundle = this.updateBundle;
    this.updateBundle = undefined;
    if (!this.usbUpdateEnabled || !bundle || JSON.stringify(offer) !== JSON.stringify(bundle.offer))
      throw new Error('Check for updates and review the offered version first.');
    const session = this.current(),
      info = await session.firmware();
    if (
      !info.supported ||
      info.boot !== 'confirmed' ||
      !['idle', 'current', 'available', 'success', 'rolled_back', 'failed'].includes(info.state) ||
      !newerVersion(offer.version, info.version)
    )
      throw new Error('The speaker is not ready for this update. Check its status.');
    const [begin] = await session.command(true, UPGRADE.begin, [String(bundle.descriptor.length)], {
      mutation: true,
    });
    const token = begin?.[0];
    const uncertain = () => {
      session.uncertain = true;
      return new UncertainOutcome();
    };
    if (begin?.length !== 1 || !/^[a-f0-9]{16}$/.test(token ?? '') || token === '0000000000000000')
      throw uncertain();
    const send = async (kind: number, bytes: Uint8Array) => {
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        await session.writeChunk(token!, kind, offset, bytes.slice(offset, offset + CHUNK_BYTES));
        if (kind === 1)
          progress(Math.floor((Math.min(offset + CHUNK_BYTES, bytes.length) * 100) / bytes.length));
      }
    };
    await send(0, bundle.descriptor);
    const [accepted] = await session.command(true, UPGRADE.verify, [token!], { mutation: true });
    if (accepted?.length !== 2 || accepted[0] !== 'accepted' || accepted[1] !== offer.version)
      throw uncertain();
    await send(1, bundle.application);
    try {
      const [finished] = await session.command(true, UPGRADE.finish, [token!], { mutation: true });
      if (finished?.length !== 2 || finished[0] !== 'verified' || finished[1] !== offer.version)
        throw uncertain();
      const after = await session.firmware();
      if (after.state !== 'awaiting_power' || after.offered !== offer.version) throw uncertain();
    } catch {
      // Selection may have succeeded even when the reply or status read failed.
      throw uncertain();
    }
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
    this.updateBundle = undefined;
    this.port = undefined;
    this.installationCandidate = false;
    await this.releaseSession();
  }
}
