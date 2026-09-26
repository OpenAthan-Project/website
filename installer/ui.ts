import { validatePassword, validateWifi, type DeviceStatus } from './protocol';
import { UncertainOutcome } from './session';
import type { InstallerService, Path } from './service';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const button = (label: string, action: string, secondary = false) =>
  `<button class="button ${secondary ? 'secondary' : ''}" type="button" data-action="${action}">${label}</button>`;

/** Shared presentation only. The service is injected by separate real/demo entrypoints. */
export function mountInstaller(
  root: HTMLElement,
  service: InstallerService,
  unsupported: string | null = null,
): void {
  const panel = root.querySelector<HTMLElement>('[data-panel]')!;
  const message = root.querySelector<HTMLElement>('[data-message]')!;
  const steps = root.querySelectorAll<HTMLElement>('[data-step]');
  let path: Path = 'install',
    status: DeviceStatus | undefined,
    busy = false,
    current = 0;
  let notice = '',
    mutationBlocked = false,
    initialized = false;
  const notify = (text: string, error = false) => {
    message.textContent = text;
    message.hidden = !text;
    message.classList.toggle('error', error);
  };
  function render(title: string, body: string, step: number) {
    current = step;
    panel.innerHTML = `<div class="step-kicker">${service.simulated ? 'SIMULATED DEVICE' : 'YOUR OPENATHAN'} / ${path === 'install' ? 'NEW INSTALLATION' : 'USB RECOVERY'}</div><h2 tabindex="-1" class="step-title">${title}</h2>${body}`;
    steps.forEach((item, index) => {
      item.classList.toggle('current', index === step);
      item.classList.toggle('complete', index < step);
      if (index === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    if (initialized) panel.querySelector<HTMLElement>('h2')?.focus();
  }
  function choices() {
    status = undefined;
    mutationBlocked = false;
    notify('');
    render(
      'How can we help?',
      `<p class="muted">Choose what you need today. Your prayer settings live on your device.</p><div class="path-grid"><button class="path-card" data-action="choose-install"><span class="path-icon" aria-hidden="true">＋</span><strong>Install a new device</strong><span>Start with your AtomS3R and Pyramid.</span><span class="card-link">Start installation <span aria-hidden="true">↗</span></span></button><button class="path-card" data-action="choose-recovery"><span class="path-icon" aria-hidden="true">↻</span><strong>Fix Wi-Fi or password</strong><span>Reconnect an existing OpenAthan.</span><span class="card-link">Open recovery <span aria-hidden="true">↗</span></span></button></div>${!service.installAvailable ? '<div class="notice"><strong>Installation release not available yet.</strong><p>First-time installation will open when a tested firmware release and approved recordings are ready. USB recovery is available for compatible devices.</p></div>' : ''}<p class="small muted">Need a hand? <a href="/guides/setup/">Read the setup guide</a>.</p>`,
      0,
    );
  }
  function connect() {
    const blocked =
      unsupported ||
      (path === 'install' && !service.installAvailable
        ? 'Installation release not available yet.'
        : null);
    render(
      'Connect your device',
      `<p>Use a <strong>USB data cable</strong> to connect your computer to the <strong>Atom’s USB-C port</strong>. Leave the Pyramid’s bottom power cable unplugged.</p><div class="connection-diagram" aria-label="Computer connects to Atom USB-C. Pyramid bottom power is unplugged."><span>Computer</span><span class="cable" aria-hidden="true"></span><span>Atom USB-C</span></div><p class="small muted">Close other serial tools first. Choose the USB JTAG/serial device in your browser’s connection window.</p>${blocked ? `<div class="notice"><strong>${escape(blocked)}</strong><p>The guides remain available without connecting hardware.</p></div>` : ''}<div class="actions"><button type="button" class="button" data-action="connect" ${blocked ? 'disabled' : ''}>${service.simulated ? 'Connect simulated device' : 'Choose USB device'}</button>${button('Back', 'start', true)}</div>`,
      0,
    );
  }
  function confirmation() {
    render(
      'Confirm a new installation',
      `<p>${service.simulated ? 'This preview will simulate replacing a new device.' : 'OpenAthan was not recognized. Continue only if this is the supported reference hardware and you intend to replace everything on it.'}</p><div class="notice warning"><strong>This erases the device.</strong><p>Existing firmware, saved Wi-Fi, prayer settings and prayer history will be replaced. This is not an update or a password recovery.</p></div><label class="check-line"><input type="checkbox" id="confirm-install" /> <span>I have an AtomS3R C126 with Pyramid A167 and want to erase it for a new installation.</span></label><div class="actions"><button class="button" type="button" data-action="install" disabled>Install OpenAthan</button>${button('Cancel', 'start', true)}</div>`,
      0,
    );
  }
  function storageFault(): boolean {
    if (
      status &&
      (status.storage === 'fault' ||
        status.password === 'fault' ||
        status.setup === 'storage_fault')
    ) {
      mutationBlocked = true;
      render(
        'The device needs attention',
        '<p>The device reported a storage fault. Keep its current data and follow the recovery guide before making another change.</p><div class="actions"><a class="button" href="/guides/recovery/">Recovery guide</a>' +
          button('Disconnect', 'start', true) +
          '</div>',
        current,
      );
      return true;
    }
    return false;
  }
  function recoveryMenu() {
    if (storageFault()) return;
    render(
      'Your OpenAthan is connected',
      `<p class="device-name">${escape(status?.hostname ?? '')}</p><p>Choose what to repair. Your prayer settings and playback history will stay on the device.</p><div class="actions">${button('Change Wi-Fi', 'wifi-screen')}${button(status?.password === 'absent' ? 'Create device password' : 'Reset device password', 'password-screen', true)}</div><div class="actions">${status?.wifi === '4' && status.password === 'ready' ? button('Open device settings', 'finish', true) : ''}${button('Disconnect', 'start', true)}</div>`,
      1,
    );
  }
  function wifiScreen() {
    if (storageFault()) return;
    render(
      'Connect to your Wi-Fi',
      `<p>Choose your home’s 2.4 GHz network, or enter its name. Your computer and phone will need to be on the same home network.</p>${button('Find networks', 'scan', true)}<div data-networks></div><form data-form="wifi" autocomplete="off"><label for="ssid">Network name</label><input id="ssid" name="ssid" required autocomplete="off" autocapitalize="none" spellcheck="false" /><label for="wifi-password">Wi-Fi password</label><input id="wifi-password" name="password" type="password" required autocomplete="off" /><p class="field-help">WPA2/WPA3 personal networks. Guest portals and enterprise sign-ins are not supported.</p><div class="actions"><button class="button" type="submit">Save Wi-Fi</button>${button('Back', path === 'recovery' ? 'recovery' : 'start', true)}</div></form>`,
      1,
    );
  }
  function passwordScreen() {
    if (storageFault()) return;
    render(
      status?.password === 'ready' ? 'Choose a new device password' : 'Create a device password',
      `<p>This protects the settings page on your home network. You’ll sign in as <strong>admin</strong>.</p><form data-form="password" autocomplete="off"><label for="device-password">Device password</label><input id="device-password" name="password" type="password" required minlength="12" maxlength="128" autocomplete="off" aria-describedby="password-help" /><p id="password-help" class="field-help">12–128 characters. Use English letters, numbers, spaces or punctuation. Choose a long, unique passphrase.</p><label for="confirm-password">Repeat password</label><input id="confirm-password" name="confirmation" type="password" required autocomplete="off" /><div class="actions"><button type="submit" class="button">Save device password</button>${button('Back', path === 'recovery' ? 'recovery' : 'wifi-screen', true)}</div></form><p class="small muted">${status?.password === 'ready' ? 'Resetting signs out existing sessions. Your prayer settings are preserved.' : 'Remember this password. You’ll enter it on the device’s settings page.'}</p>`,
      2,
    );
  }
  async function finish() {
    status = await service.status();
    if (storageFault()) return;
    if (status.wifi !== '4') {
      wifiScreen();
      notify('Connect Wi-Fi to open the device’s settings.');
      return;
    }
    if (status.password !== 'ready') {
      passwordScreen();
      return;
    }
    await service.close();
    const urls = status.urls;
    render(
      'Ready for device setup',
      `<div class="success-mark" aria-hidden="true">✓</div><p>${path === 'install' ? 'Wi-Fi and your device password are saved. Finish your prayer settings on the device.' : 'Your device is ready to open. Its prayer settings and history were not reset.'}</p><ol class="finish-list"><li>Unplug the Atom’s USB cable.</li><li>Connect <strong>only the Pyramid’s bottom USB-C power</strong>.</li><li>Wait for it to reconnect, then open its settings on the same home network.</li></ol><div class="device-links">${urls.map((url, index) => (service.simulated ? `<div class="demo-url"><span>${index === 0 ? 'Device address' : 'IP fallback'}</span><code>${escape(url)}</code><small>Example only · no device will open</small></div>` : `<div class="device-address"><a class="${index === 0 ? 'button' : 'fallback-link'}" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${index === 0 ? 'Open device settings' : 'Try the IP address'} <span aria-hidden="true">↗</span></a><code>${escape(url)}</code></div>`)).join('')}</div><p class="small muted">Sign in as <strong>admin</strong> with the password you chose. Review your location, timezone and timetable, then select <strong>Finish setup</strong>. Announcements wait until the device has synchronized its clock.</p>${!urls.length ? '<p class="notice">A device address was not returned. Reconnect through USB recovery to read it again.</p>' : ''}<div class="actions">${button('Done', 'start', true)}<a href="/guides/setup/">Setup guide</a></div>`,
      3,
    );
  }
  async function attempt(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    notify('');
    const controls = [
      ...panel.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
        'input, button, select',
      ),
    ];
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => {
      control.disabled = true;
    });
    let handledUncertain = false;
    try {
      await action();
    } catch (error) {
      if (error instanceof UncertainOutcome) {
        handledUncertain = true;
        mutationBlocked = true;
        let detail = '';
        try {
          status = await service.status();
          detail = ` Current device status: Wi-Fi ${status.wifi === '4' ? 'connected' : 'not connected'}, password revision ${status.passwordRevision}. This does not confirm the requested change.`;
        } catch {
          detail = ' Status is unavailable.';
        }
        render(
          'Check before trying again',
          `<p>The device may have saved the change before the connection was interrupted. It was <strong>not sent again</strong>.</p><p>${escape(detail)}</p><p>Reconnect and check your device. For an uncertain Wi-Fi change, a connected status may refer to the previous network.</p><div class="actions">${button('Disconnect and start again', 'start')}<a href="/guides/recovery/">Recovery guide</a></div>`,
          current,
        );
        notify('The result is uncertain. No automatic retry was made.', true);
      } else {
        let text =
          error instanceof Error ? error.message : 'Something went wrong. Reconnect and try again.';
        if (error instanceof DOMException)
          text =
            error.name === 'NotFoundError'
              ? 'No device selected. Connect the USB data cable and choose the device when you’re ready.'
              : error.name === 'InvalidStateError' || error.name === 'NetworkError'
                ? 'The USB port may be busy. Close other serial tools or browser tabs, then reconnect.'
                : 'USB access was not granted. Check browser permissions and try again.';
        notify(text, true);
      }
    } finally {
      controls.forEach((control, index) => {
        if (control.isConnected) control.disabled = disabled[index]!;
      });
      busy = false;
      root.removeAttribute('aria-busy');
      if (notice) {
        if (!handledUncertain) {
          render(
            'Connection lost',
            '<p>Your device is no longer connected.</p>' + button('Start again', 'start'),
            current,
          );
          notify(notice, true);
        }
        notice = '';
      }
    }
  }
  service.onDisconnect = () => {
    mutationBlocked = true;
    notice = 'The device disconnected. Reconnect the USB data cable and start again.';
    if (!busy) {
      render(
        'Connection lost',
        '<p>Your device is no longer connected.</p>' + button('Start again', 'start'),
        current,
      );
      notify(notice, true);
      notice = '';
    }
  };
  root.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'confirm-install')
      panel.querySelector<HTMLButtonElement>('[data-action="install"]')!.disabled = !target.checked;
    if (target.id === 'network-choice')
      panel.querySelector<HTMLInputElement>('#ssid')!.value = target.value;
  });
  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset
      .action;
    if (!action || busy) return;
    if (action === 'choose-install' || action === 'choose-recovery') {
      path = action === 'choose-install' ? 'install' : 'recovery';
      notify('');
      connect();
      return;
    }
    void attempt(async () => {
      if (action === 'start') {
        await service.close().catch(() => undefined);
        choices();
      } else if (action === 'connect') {
        notify(
          service.simulated
            ? 'Connecting to the simulated device…'
            : 'Reading the device. This may take a moment…',
        );
        const result = await service.connect(path);
        notify('');
        if (result.kind === 'new') confirmation();
        else {
          status = result.status;
          path = 'recovery';
          recoveryMenu();
        }
      } else if (action === 'install') {
        const confirmed =
          panel.querySelector<HTMLInputElement>('#confirm-install')?.checked === true;
        render(
          'Installing OpenAthan',
          '<p>Keep the cable connected while installation and verification finish.</p><progress max="100" value="0" aria-label="Installation progress"></progress><p data-progress>Preparing installation…</p>',
          0,
        );
        try {
          status = await service.install(confirmed, (percent) => {
            panel.querySelector('progress')!.value = percent;
            panel.querySelector('[data-progress]')!.textContent =
              `${percent}% · ${percent === 100 ? 'Verifying…' : 'Writing firmware…'}`;
          });
          wifiScreen();
        } catch (error) {
          render(
            'Installation needs attention',
            '<p>Review the result below before any further installation. If writing was verified but setup could not reconnect, use USB recovery.</p><div class="actions">' +
              button('Disconnect and start again', 'start') +
              '<a href="/guides/recovery/">Recovery guide</a></div>',
            0,
          );
          throw error;
        }
      } else if (action === 'recovery') recoveryMenu();
      else if (action === 'wifi-screen') wifiScreen();
      else if (action === 'password-screen') passwordScreen();
      else if (action === 'finish') await finish();
      else if (action === 'scan') {
        const networks = await service.scan();
        const container = panel.querySelector<HTMLElement>('[data-networks]')!;
        container.innerHTML = networks.length
          ? `<label for="network-choice">Nearby networks</label><select id="network-choice"><option value="">Select a network or type its name below</option>${networks.map((network) => `<option value="${escape(network.ssid)}" ${network.secured ? '' : 'disabled'}>${escape(network.ssid)}${network.secured ? '' : ' — open networks are unsupported'}</option>`).join('')}</select>`
          : '<p class="small">No networks found. Enter your network name below, including hidden networks.</p>';
        container.querySelector<HTMLElement>('select')?.focus();
      }
    });
  });
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || mutationBlocked) return;
    const form = event.target as HTMLFormElement;
    const kind = form.dataset.form;
    const ssid = form.querySelector<HTMLInputElement>('[name="ssid"]')?.value ?? '';
    let password = form.querySelector<HTMLInputElement>('[name="password"]')?.value ?? '';
    let confirmation = form.querySelector<HTMLInputElement>('[name="confirmation"]')?.value;
    try {
      if (kind === 'wifi') validateWifi(ssid, password);
      else {
        validatePassword(password);
        if (password !== confirmation) throw new Error('The passwords do not match.');
      }
    } catch (error) {
      notify((error as Error).message, true);
      return;
    }
    confirmation = '';
    // Remove secrets from the DOM before any await; never retain form data.
    form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
      input.value = '';
    });
    void attempt(async () => {
      let acknowledged = false;
      try {
        if (kind === 'wifi') {
          await service.wifi(ssid, password);
          acknowledged = true;
          status = await service.status();
          if (storageFault()) return;
          if (status.wifi !== '4' || status.storage !== 'ready')
            throw new Error(
              'Wi-Fi save was acknowledged, but the device is not ready. Read its status before another change.',
            );
          if (path === 'install' && status.password === 'absent') passwordScreen();
          else recoveryMenu();
          notify('Wi-Fi saved.');
        } else {
          const revision = await service.password(password);
          acknowledged = true;
          status = await service.status();
          if (storageFault()) return;
          if (
            status.passwordRevision !== revision ||
            status.password !== 'ready' ||
            status.storage !== 'ready'
          )
            throw new UncertainOutcome();
          if (path === 'install') await finish();
          else {
            recoveryMenu();
            notify('Device password saved. Existing sign-ins have been invalidated.');
          }
        }
      } catch (error) {
        if (acknowledged && !(error instanceof UncertainOutcome)) {
          mutationBlocked = true;
          render(
            'Check the device status',
            '<p>The save was acknowledged, but the device’s current status could not be confirmed. The change was not sent again. Reconnect through recovery to check the device before making another change.</p>' +
              button('Disconnect and start again', 'start'),
            current,
          );
        }
        throw error;
      } finally {
        password = '';
      }
    });
  });
  window.addEventListener('pagehide', () => {
    void service.close().catch(() => undefined);
  });
  choices();
  initialized = true;
}
