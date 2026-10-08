import { validatePassword, validateWifi, type DeviceStatus } from './protocol';
import { DeviceError, UncertainOutcome } from './session';
import type { InstallerService } from './service';

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
  const context = root.querySelector<HTMLElement>('[data-context]')!;
  let path: 'install' | 'recovery' = 'recovery',
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
    message.classList.remove('uncertain');
  };
  function render(title: string, body: string, step: number, entry = false) {
    current = step;
    root.dataset.view = 'flow';
    context.hidden = entry;
    context.innerHTML = `<h2>${path === 'recovery' ? 'Connected speaker' : 'New installation'}${service.simulated ? ' · simulated device' : ''}</h2><p>${path === 'recovery' ? 'Prayer settings and playback history are preserved.' : 'Set up Wi-Fi and a password before opening your device’s settings.'}</p>`;
    const heading = entry ? 'h2' : 'h3';
    panel.innerHTML = `<${heading} tabindex="-1" class="step-title">${title}</${heading}>${body}`;
    if (initialized) panel.querySelector<HTMLElement>('.step-title')?.focus();
  }
  function connectionScreen() {
    status = undefined;
    path = 'recovery';
    mutationBlocked = false;
    notify('');
    const unavailable =
      '<div class="notice"><strong>New installation is unavailable.</strong><p>You can still connect an existing OpenAthan to open its settings or fix Wi-Fi and its device password.</p></div>';
    if (unsupported) {
      render(
        'Use a computer for USB setup',
        `<p>${escape(unsupported)}</p><p><a href="/docs/getting-started/">Setup instructions</a> · <a href="/docs/troubleshooting/">Troubleshooting</a></p><p>USB recovery can fix Wi-Fi or your device password without resetting prayer settings or history.</p>${!service.installAvailable ? unavailable : ''}<p class="small">Supported hardware: AtomS3R C126 + Pyramid A167. Use a USB data cable.</p>`,
        0,
        true,
      );
    } else {
      render(
        'Connect speaker',
        `<p>Use a <strong>USB data cable</strong> to connect your computer to the <strong>Atom’s USB-C port</strong>. Leave the Pyramid’s bottom power cable unplugged.</p><div class="connection-diagram" aria-label="Computer connects to Atom USB-C. Pyramid bottom power is unplugged."><span>Computer</span><span class="cable" aria-hidden="true"></span><span>Atom USB-C</span></div><p class="small muted">Use desktop Chrome or Edge. Close other serial tools first. Choose the USB JTAG/serial device in your browser’s connection window.</p><p>We’ll check for OpenAthan, then show settings and recovery options or ask you to confirm a new installation. Connecting does not install or erase firmware.</p>${!service.installAvailable ? unavailable : ''}<div class="actions">${button(service.simulated ? 'Connect simulated device' : 'Choose USB device', 'connect')}<a href="/docs/getting-started/">Setup instructions</a><a href="/docs/troubleshooting/">Troubleshooting</a></div>`,
        0,
        true,
      );
    }
    root.dataset.view = 'connection';
  }
  function confirmation() {
    path = 'install';
    const available = service.installAvailable;
    render(
      available ? 'Confirm a new installation' : 'New installation is unavailable',
      `<p>OpenAthan was not recognized. This does not prove the device is new or empty. If you expected an existing OpenAthan, check the cable and retry before considering installation.</p>${available ? '<div class="notice warning"><strong>This erases the device.</strong><p>Existing firmware, saved Wi-Fi, prayer settings and prayer history will be replaced. This is not an update or a password recovery.</p></div><label class="check-line"><input type="checkbox" id="confirm-install" /> <span>I have an AtomS3R C126 with Pyramid A167 and want to erase it for a new installation.</span></label>' : '<p>No installation release is available. Check the connection or follow the troubleshooting instructions.</p>'}<div class="actions">${available ? '<button class="button" type="button" data-action="install" disabled>Install OpenAthan</button>' : ''}${button('Retry connection', 'start', true)}${button('Cancel', 'start', true)}<a href="/docs/troubleshooting/">Troubleshooting</a></div>`,
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
        '<p>The device reported a storage fault. Keep its current data and follow the troubleshooting instructions before making another change.</p><div class="actions"><a class="button" href="/docs/troubleshooting/">Troubleshooting</a>' +
          button('Disconnect', 'start', true) +
          '</div>',
        current,
      );
      return true;
    }
    return false;
  }
  async function readCurrentStatus(): Promise<boolean> {
    // A failed read must not leave the previous healthy status authorizing changes.
    mutationBlocked = true;
    status = undefined;
    try {
      status = await service.status();
    } catch (error) {
      render(
        'Check the device status',
        '<p>The device’s current status could not be confirmed. Reconnect through USB setup before making another change.</p><div class="actions">' +
          button('Disconnect and start again', 'start') +
          '<a href="/docs/troubleshooting/">Troubleshooting</a></div>',
        current,
      );
      throw error;
    }
    if (storageFault()) return false;
    mutationBlocked = false;
    return true;
  }
  function recoveryMenu() {
    if (storageFault()) return;
    render(
      'Your OpenAthan is connected',
      `<p class="device-name">${escape(status?.hostname ?? '')}</p><p>Open your speaker’s settings or choose a change. Your prayer settings and playback history will stay on the device.</p>${status?.wifi !== '4' ? '<p>Wi-Fi is not connected. If the speaker is reconnecting, wait a moment and select <strong>Refresh status</strong>.</p>' : ''}<div class="actions">${status?.wifi === '4' && status.password === 'ready' ? button('Open device settings', 'finish') : ''}${button('Change Wi-Fi', 'wifi-screen', status?.wifi === '4' && status.password === 'ready')}${button(status?.password === 'absent' ? 'Create device password' : 'Reset device password', 'password-screen', true)}</div><div class="actions">${button('Refresh status', 'refresh-status', true)}${button('Disconnect', 'start', true)}</div>`,
      1,
    );
  }
  function wifiScreen() {
    if (storageFault()) return;
    render(
      'Connect to your Wi-Fi',
      `<p>Choose your home’s 2.4 GHz network, or enter its name. Your computer and phone will need to be on the same home network.</p>${button('Find networks', 'scan', true)}<div data-networks></div><form data-form="wifi" autocomplete="off"><label for="ssid">Network name</label><input id="ssid" name="ssid" required autocomplete="off" autocapitalize="none" spellcheck="false" /><label for="wifi-password">Wi-Fi password</label><input id="wifi-password" name="password" type="password" required autocomplete="off" aria-describedby="wifi-password-help" /><p id="wifi-password-help" class="field-help">Use your router’s Wi-Fi password. A 64-character key must contain only 0–9 and A–F (upper or lower case).</p><p class="field-help">WPA2/WPA3 personal networks. Guest portals and enterprise sign-ins are not supported.</p><div class="actions"><button class="button" type="submit">Save Wi-Fi</button>${button('Back', path === 'recovery' ? 'recovery' : 'start', true)}<a href="/docs/troubleshooting/">Troubleshooting</a></div></form>`,
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
    if (!(await readCurrentStatus()) || !status) return;
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
      `<div class="success-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" stroke="currentColor"/><path d="m9 16 5 5 9-11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p>${path === 'install' ? 'Wi-Fi and your device password are saved. Finish your prayer settings on the device.' : 'Your device is ready to open. Its prayer settings and history were not reset.'}</p><ol class="finish-list"><li>Unplug the Atom’s USB cable.</li><li>Connect <strong>only the Pyramid’s bottom USB-C power</strong>.</li><li>Wait for it to reconnect, then open its settings on the same home network.</li></ol>${urls.length && !service.simulated ? '<p id="device-new-tab" class="small muted">Device links open in a new tab.</p>' : ''}<div class="device-links">${urls.map((url, index) => (service.simulated ? `<div class="demo-url"><span>${index === 0 ? 'Device address' : 'IP fallback'}</span><a class="address-link" href="/preview/device/" target="_blank" rel="noopener noreferrer" aria-describedby="device-link-help-${index}"><code>${escape(url)}</code><span aria-hidden="true">↗</span></a><small id="device-link-help-${index}">Opens a local preview in a new tab</small></div>` : `<div class="device-address"><a class="${index === 0 ? 'button' : 'fallback-link'}" href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-describedby="device-new-tab">${index === 0 ? 'Open device settings' : 'Try the IP address'} <span aria-hidden="true">↗</span></a><a class="address-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-describedby="device-new-tab"><code>${escape(url)}</code><span aria-hidden="true">↗</span></a></div>`)).join('')}</div><p class="small muted">Sign in as <strong>admin</strong> with the password you chose. Review your location, timezone and timetable, then select <strong>Finish setup</strong>. Athan playback waits until the device has synchronized its clock.</p>${!urls.length ? '<p class="notice">A device address was not returned. Reconnect through USB setup to read it again.</p>' : ''}<div class="actions">${button('Done', 'start', true)}<a href="/docs/getting-started/">Setup instructions</a></div>`,
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
          `<p>The device may have saved the change before the connection was interrupted. It was <strong>not sent again</strong>.</p><p>${escape(detail)}</p><p>Reconnect and check your device. For an uncertain Wi-Fi change, a connected status may refer to the previous network.</p><div class="actions">${button('Disconnect and start again', 'start')}<a href="/docs/troubleshooting/">Troubleshooting</a></div>`,
          current,
        );
        notify('The result is uncertain. No automatic retry was made.', true);
        message.classList.add('uncertain');
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
    void attempt(async () => {
      if (action === 'start') {
        await service.close().catch(() => undefined);
        connectionScreen();
      } else if (action === 'connect') {
        notify(
          service.simulated
            ? 'Connecting to the simulated device…'
            : 'Reading the device. This may take a moment…',
        );
        if (unsupported) return;
        status = undefined;
        mutationBlocked = false;
        const result = await service.connect();
        notify('');
        if (result.kind === 'unrecognized') confirmation();
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
            '<p>Review the result below before any further installation. If writing was verified but setup could not reconnect, reconnect through USB setup; do not reinstall.</p><div class="actions">' +
              button('Disconnect and start again', 'start') +
              '<a href="/docs/troubleshooting/">Troubleshooting</a></div>',
            0,
          );
          throw error;
        }
      } else if (action === 'refresh-status') {
        if (await readCurrentStatus()) {
          recoveryMenu();
          notify(
            status?.wifi === '4'
              ? 'Wi-Fi is connected.'
              : 'Wi-Fi is still not connected. Wait a moment and refresh again, or choose Change Wi-Fi.',
          );
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
        if (!acknowledged && error instanceof DeviceError && error.code === 255) {
          if (!(await readCurrentStatus())) return;
        } else if (acknowledged && !(error instanceof UncertainOutcome)) {
          mutationBlocked = true;
          render(
            'Check the device status',
            '<p>The save was acknowledged, but the device’s current status could not be confirmed. The change was not sent again. Reconnect through USB setup to check the device before making another change.</p>' +
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
  connectionScreen();
  initialized = true;
}
