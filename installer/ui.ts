import { HARDWARE, WAVESHARE, HARDWARE_PROFILES, isHardware, type Hardware } from './release';
import { validatePassword, validateWifi, type DeviceStatus } from './protocol';
import { DeviceError, UncertainOutcome } from './session';
import type { InstallerService } from './service';
import type { UpgradeCheck, UpgradeOffer } from './upgrade';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const button = (label: string, action: string, secondary = false, disabled = false) =>
  `<button class="button ${secondary ? 'secondary' : ''}" type="button" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;

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
  let upgradeCheck: UpgradeCheck | undefined,
    offered: UpgradeOffer | undefined,
    installed = false,
    updateWritten = false;
  let hardware: Hardware = HARDWARE;
  let phoneSetupCapable = false,
    phoneSetupAvailable = false;
  let handoff: 'choice' | 'phone' | 'settings' | undefined;
  let usbDisconnected = false;
  let statusErrorVisible = false;
  let operation: 'wifi' | 'password' | 'update' | 'none' = 'none';
  let notice = '',
    mutationBlocked = false,
    recoveryBlocked = false,
    initialized = false;
  const notify = (text: string, error = false) => {
    message.textContent = text;
    message.hidden = !text;
    message.classList.toggle('error', error);
    message.classList.remove('uncertain');
  };
  function render(title: string, body: string, step: number, _entry = false) {
    statusErrorVisible = false;
    current = step;
    root.dataset.view = 'flow';
    context.hidden = true;
    context.innerHTML = `<h2>${path === 'recovery' ? 'Connected speaker' : 'New installation'}${service.simulated ? ' · simulated device' : ''}</h2><p>${path === 'recovery' ? 'Prayer settings and playback history are preserved.' : 'Set up Wi-Fi and a password before opening your device’s settings.'}</p>`;
    const heading = 'h2';
    panel.innerHTML = `<${heading} tabindex="-1" class="step-title">${title}</${heading}>${body}`;
    if (initialized) panel.querySelector<HTMLElement>('.step-title')?.focus();
  }
  function connectionScreen() {
    status = undefined;
    upgradeCheck = undefined;
    offered = undefined;
    installed = false;
    updateWritten = false;
    phoneSetupCapable = false;
    phoneSetupAvailable = false;
    handoff = undefined;
    usbDisconnected = false;
    path = 'recovery';
    mutationBlocked = false;
    recoveryBlocked = false;
    notify('');
    const unavailable =
      '<div class="notice"><strong>New installation is unavailable.</strong><p>You can still connect an existing OpenAthan to open its settings or fix Wi-Fi and its device password.</p></div>';
    if (unsupported) {
      render(
        'Use a computer for USB setup',
        `<p>${escape(unsupported)}</p><p><a href="/docs/getting-started/">Setup instructions</a> · <a href="/docs/troubleshooting/">Troubleshooting</a></p><p>USB recovery can fix Wi-Fi or your device password without resetting prayer settings or history.</p>${!service.installAvailable ? unavailable : ''}<p class="small">Supported hardware: AtomS3R C126 + Pyramid A167 and Waveshare Box V2. Use a USB data cable.</p>`,
        0,
        true,
      );
    } else {
      render(
        'Connect speaker',
        `<p>Use a <strong>USB data cable</strong> to connect your computer to the <strong>speaker’s USB-C port</strong>. For Atom, use its USB-C port and leave the Pyramid’s bottom power cable unplugged. For Waveshare Box V2, use the rear USB-C port.</p><div class="connection-diagram" aria-label="Computer connects to the speaker USB-C port."><span>Computer</span><span class="cable" aria-hidden="true"></span><span>Speaker USB-C</span></div><p class="small muted">Use desktop Chrome or Edge. Close other serial tools first. Choose the USB JTAG/serial device in your browser’s connection window.</p><p>We’ll check for OpenAthan, then show settings and recovery options or ask you to confirm a new installation. Connecting does not install or erase firmware.</p>${!service.installAvailable ? unavailable : ''}<div class="actions">${button(service.simulated ? 'Connect simulated device' : 'Choose USB device', 'connect')}<a href="/docs/getting-started/">Setup instructions</a><a href="/docs/troubleshooting/">Troubleshooting</a></div>`,
        0,
        true,
      );
    }
    root.dataset.view = 'connection';
  }
  function confirmation() {
    path = 'install';
    const available = service.installAvailable;
    const choices = service.installHardware ?? [HARDWARE];
    hardware = choices[0] ?? HARDWARE;
    const modelChoice =
      choices.length > 1
        ? `<label for="hardware-choice">Speaker model</label><select id="hardware-choice"><option value="">Choose your model</option>${choices.map((board) => `<option value="${board}">${HARDWARE_PROFILES[board].label}</option>`).join('')}</select><p class="small muted">Check the model printed on your device. Waveshare V1 is not supported.</p>`
        : '';
    render(
      available ? 'Confirm a new installation' : 'New installation is unavailable',
      `<p>OpenAthan was not recognized. This does not prove the device is new or empty. If you expected an existing OpenAthan, check the cable and retry before considering installation.</p>${available ? `${modelChoice}<div class="notice warning"><strong>This erases the device.</strong><p>Existing firmware, saved Wi-Fi, prayer settings and prayer history will be replaced. This is not an update or a password recovery.</p></div><label class="check-line"><input type="checkbox" id="confirm-install" ${choices.length > 1 ? 'disabled' : ''} /> <span id="model-confirmation">${choices.length > 1 ? 'Choose a model, then confirm that you want to erase it for a new installation.' : 'I have an AtomS3R C126 with Pyramid A167 and want to erase it for a new installation.'}</span></label>` : '<p>No installation release is available. Check the connection or follow the troubleshooting instructions.</p>'}<div class="actions">${available ? '<button class="button" type="button" data-action="install" disabled>Install OpenAthan</button>' : ''}${button('Back to connection', 'start', true)}<a href="/docs/troubleshooting/">Troubleshooting</a></div>`,
      0,
    );
  }
  function revokePhoneSetup() {
    phoneSetupAvailable = false;
    if (handoff === 'choice' || handoff === 'phone') handoff = undefined;
  }
  function renderStatusError(title: string, body: string) {
    revokePhoneSetup();
    mutationBlocked = true;
    notice = '';
    render(title, body, current);
    statusErrorVisible = true;
  }
  function storageFault(): boolean {
    if (
      status &&
      (status.storage === 'fault' ||
        status.password === 'fault' ||
        status.setup === 'storage_fault')
    ) {
      renderStatusError(
        'The device needs attention',
        '<p>The device reported a storage fault. Keep its current data and follow the troubleshooting instructions before making another change.</p><div class="actions"><a class="button" href="/docs/troubleshooting/">Troubleshooting</a>' +
          button('Disconnect', 'start', true) +
          '</div>',
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
      // Another client may have enrolled the speaker since installation.
      // Once observed, configured state cannot become an AP promise again.
      phoneSetupAvailable =
        phoneSetupAvailable &&
        status.setup === 'incomplete' &&
        status.wifi === '2' &&
        status.password === 'absent' &&
        status.storage === 'ready';
      if (!phoneSetupAvailable) revokePhoneSetup();
    } catch (error) {
      if (handoff === 'phone' && usbDisconnected) return false;
      renderStatusError(
        'Check the device status',
        '<p>The device’s current status could not be confirmed. Reconnect through USB setup before making another change.</p><div class="actions">' +
          button('Disconnect and start again', 'start') +
          '<a href="/docs/troubleshooting/">Troubleshooting</a></div>',
      );
      throw error;
    }
    if (storageFault()) return false;
    if (usbDisconnected) {
      if (handoff !== 'phone') connectionLost();
      return false;
    }
    mutationBlocked = false;
    return true;
  }
  function recoveryMenu() {
    if (storageFault()) return;
    const wifiMissing = status?.wifi !== '4',
      passwordMissing = status?.password === 'absent';
    const row = (title: string, detail: string, label = '', action = '', disabled = false) =>
      `<div class="task-row"><div><h3>${title}</h3><p class="small muted">${detail}</p></div>${action ? button(label, action, true, disabled) : ''}</div>`;
    const firmwareText =
      upgradeCheck?.state === 'available'
        ? `${escape(upgradeCheck.offer.version)} is available.`
        : ((upgradeCheck && 'detail' in upgradeCheck ? upgradeCheck.detail : undefined) ??
          'Check for a compatible firmware update.');
    const resolution = upgradeCheck?.state === 'busy' ? upgradeCheck.action : undefined;
    const primary = recoveryBlocked
      ? upgradeCheck?.state === 'failed'
        ? button('Reconnect and check', 'start')
        : resolution === 'power'
          ? button('Finish power handoff', 'update-handoff')
          : resolution === 'discard'
            ? button('Discard incomplete transfer', 'discard-update')
            : button('Check update status', 'check-update')
      : wifiMissing
        ? button('Connect Wi-Fi', 'wifi-screen')
        : passwordMissing
          ? button('Create device password', 'password-screen')
          : button('Continue to device settings', 'finish');
    render(
      'Your OpenAthan is connected',
      `<p class="device-name">${escape(status?.hostname ?? '')}</p><p class="small muted">${HARDWARE_PROFILES[hardware].label}</p><p>${wifiMissing ? 'Wi-Fi is not connected.' : 'Wi-Fi is connected.'} ${passwordMissing ? 'A device password is needed.' : 'Your device password is set.'}</p>
      <p class="small muted">Compatible firmware updates preserve settings, prayer history and recordings. Recovery changes only the Wi-Fi or password you choose.</p>
      <div class="actions">${primary}${!recoveryBlocked && wifiMissing ? button('Refresh status', 'refresh-status', true) : ''}</div>
      ${recoveryBlocked ? row('Firmware', firmwareText) : row('Firmware', firmwareText, upgradeCheck?.state === 'available' ? 'Review update' : 'Check for updates', upgradeCheck?.state === 'available' ? 'review-update' : 'check-update')}
      ${recoveryBlocked ? '<p class="small muted">Wi-Fi and password recovery must wait until the pending USB update is resolved. Check update status again after the device starts.</p>' : ''}
      <details class="recovery-disclosure" ${!recoveryBlocked && (wifiMissing || passwordMissing) ? 'open' : ''}><summary>Wi-Fi and password recovery</summary><div class="recovery-tasks">
      ${recoveryBlocked || !wifiMissing ? row('Wi-Fi', 'Connect to a different home network.', wifiMissing ? 'Connect Wi-Fi' : 'Change Wi-Fi', 'wifi-screen', recoveryBlocked) : ''}
      ${recoveryBlocked || !passwordMissing || wifiMissing ? row('Device password', 'Recover access to your speaker’s settings.', passwordMissing ? 'Create device password' : 'Reset device password', 'password-screen', recoveryBlocked) : ''}
      ${recoveryBlocked || !wifiMissing ? row('Connection status', 'Read the speaker’s latest connection status.', 'Refresh status', 'refresh-status') : ''}</div></details>
      <div class="actions quiet-actions">${button('Disconnect', 'start', true)}<a href="/docs/troubleshooting/">Connection help</a></div>`,
      1,
    );
  }
  async function checkUpdate() {
    render(
      'Checking firmware',
      '<p>Reading the speaker’s update support and the selected release. Installed firmware is unchanged.</p>',
      1,
    );
    upgradeCheck = await service.checkUpdate();
    // Provisioning status and unreadable INFO cannot release known USB ownership.
    if (upgradeCheck.recoveryBlocked !== undefined) recoveryBlocked = upgradeCheck.recoveryBlocked;
    offered = upgradeCheck.state === 'available' ? upgradeCheck.offer : undefined;
    recoveryMenu();
  }
  function reviewUpdate() {
    if (!offered || mutationBlocked || recoveryBlocked) return;
    const powerInstructions =
      hardware === WAVESHARE
        ? 'Keep the Waveshare rear USB-C cable connected during transfer. After verification, press RESET to restart and complete startup checks.'
        : 'Keep Atom USB connected during transfer. After verification, you’ll switch to Pyramid bottom power.';
    render(
      'Review firmware update',
      `<p>Install <strong>${escape(offered.version)}</strong> over USB.</p><p>Your Wi-Fi, device password, prayer settings, playback history and recordings stay on the speaker. The current application is retained for startup rollback.</p><p><a href="${escape(offered.notes)}" target="_blank" rel="noopener noreferrer">Read the release notes</a></p><p>${powerInstructions}</p><div class="actions">${button('Install update', 'update')}${button('Back', 'recovery', true)}</div>`,
      1,
    );
  }
  function wifiScreen() {
    if (storageFault()) return;
    if (blockRecovery()) return;
    render(
      'Connect to your Wi-Fi',
      `<p>Choose your home’s 2.4 GHz network, or enter its name. Your computer and phone will need to be on the same home network.</p><div data-networks></div><form data-form="wifi" autocomplete="off"><div class="field-heading"><label for="ssid">Network name</label>${button('Find networks', 'scan', true)}</div><input id="ssid" name="ssid" required autocomplete="off" autocapitalize="none" spellcheck="false" /><label for="wifi-password">Wi-Fi password</label><input id="wifi-password" name="password" type="password" required autocomplete="off" aria-describedby="wifi-password-help" /><p id="wifi-password-help" class="field-help">Use your router’s Wi-Fi password. A 64-character key must contain only 0–9 and A–F (upper or lower case).</p><p class="field-help">WPA2/WPA3 personal networks. Guest portals and enterprise sign-ins are not supported.</p><div class="actions"><button class="button" type="submit">Save Wi-Fi</button>${button('Back', phoneSetupAvailable ? 'setup-choice' : installed || path === 'recovery' ? 'recovery' : 'start', true)}<a href="/docs/troubleshooting/">Troubleshooting</a></div></form>`,
      1,
    );
  }
  function passwordScreen() {
    if (storageFault()) return;
    if (blockRecovery()) return;
    render(
      status?.password === 'ready' ? 'Choose a new device password' : 'Create a device password',
      `<p>This protects the settings page on your home network. You’ll sign in as <strong>admin</strong>.</p><form data-form="password" autocomplete="off"><label for="device-password">Device password</label><input id="device-password" name="password" type="password" required minlength="12" maxlength="128" autocomplete="off" aria-describedby="password-help" /><p id="password-help" class="field-help">12–128 characters. Use English letters, numbers, spaces or punctuation. Choose a long, unique passphrase.</p><label for="confirm-password">Repeat password</label><input id="confirm-password" name="confirmation" type="password" required autocomplete="off" /><div class="actions"><button type="submit" class="button">Save device password</button>${button('Back', path === 'recovery' ? 'recovery' : 'wifi-screen', true)}</div></form><p class="small muted">${status?.password === 'ready' ? 'Resetting signs out existing sessions. Your prayer settings are preserved.' : 'Remember this password. You’ll enter it on the device’s settings page.'}</p>`,
      2,
    );
  }
  function blockRecovery(): boolean {
    if (!recoveryBlocked) return false;
    recoveryMenu();
    notify('Resolve the pending USB update before changing Wi-Fi or the device password.');
    return true;
  }
  function setupChoice() {
    if (!phoneSetupAvailable || mutationBlocked) return;
    handoff = 'choice';
    render(
      'OpenAthan installed',
      `<p>Installation is complete. You can unplug the speaker now and set it up whenever you’re ready.</p><p>Setup connects it to home Wi-Fi, creates a speaker password and lets you choose prayer settings.</p><div class="actions">${button('Set up with your phone', 'phone-setup')}${button('Continue on this computer', 'computer-setup', true)}</div><p class="small muted">Keep USB connected if you want to continue on this computer.</p>`,
      1,
    );
  }
  function phoneHandoff() {
    handoff = 'phone';
    notice = '';
    render(
      'Set up with your phone',
      `<p>You can do this now or the next time you plug in the speaker.</p><ol class="finish-list">${hardware === WAVESHARE ? '<li>Power the Waveshare through its rear USB-C port.</li>' : '<li>Unplug the Atom’s USB cable. For setup, connect <strong>only the Pyramid’s bottom USB-C power</strong>.</li>'}<li>Scan the Wi-Fi QR on the speaker’s screen, or join the <strong>OpenAthan-Setup-</strong> network whose name matches the screen. ${hardware === WAVESHARE ? 'Use the BOOT button' : 'Short-press the Atom’s front button'} to show the QR. Stay connected if your phone warns there is no internet.</li><li>Open the automatic setup page. If it does not open, enter <code>http://192.168.4.1/setup/</code> in your browser while connected to the speaker’s setup Wi-Fi.</li><li>Choose a speaker password, select home Wi-Fi and enter its password. Read the speaker’s permanent address before connecting.</li><li>Rejoin home Wi-Fi. Scan the speaker’s webpage QR or open its displayed address, then sign in as <strong>admin</strong> with your speaker password. Review your location and timetable, then choose <strong>Finish setup</strong>.</li></ol><p>If the <code>.local</code> address does not open, use the current IP address on the speaker’s screen. On Atom, short-press again to see the addresses. Keep your phone on the same home network.</p><p class="small muted">After setup, a short button press while audio is idle shows the page information again. If audio is playing, the button stops it.</p><div class="actions">${button('Back to connection', 'start', true)}<a href="/docs/getting-started/#phone-setup">Phone setup instructions</a></div>`,
      3,
    );
  }
  async function closeForHandoff() {
    try {
      await service.close();
    } catch {
      notify(
        'The browser could not close the USB connection. Unplug the data cable and follow the power instructions below.',
      );
    }
  }
  function renderHandoff(device: DeviceStatus) {
    const passwordAbsent = updateWritten && device.password === 'absent';
    const wifiDisconnected = updateWritten && device.wifi !== '4';
    const needsRecovery = passwordAbsent || wifiDisconnected;
    const urls = needsRecovery ? [] : device.urls;
    const recoveryGuidance = needsRecovery
      ? hardware === WAVESHARE
        ? `<div class="notice"><p>After restarting, connect the rear USB-C port to your computer and reconnect through USB setup. Check firmware status before changing Wi-Fi or the device password. Keep your saved prayer settings and history.</p></div>`
        : `<div class="notice">${passwordAbsent ? '<p>Your device password still needs to be created through USB setup.</p>' : ''}${wifiDisconnected ? '<p>The speaker may reconnect using its saved Wi-Fi settings. If it stays offline, check or change Wi-Fi through USB setup.</p>' : ''}<p><strong>For USB recovery after startup:</strong></p><ol class="finish-list"><li>After the speaker starts, unplug the Pyramid’s bottom power cable before connecting the Atom’s USB-C port to your computer.</li><li>Select <strong>Back to connection</strong>, reconnect, then choose <strong>Check for updates</strong>.</li><li>Follow any remaining update instructions before changing Wi-Fi or creating a device password.</li><li>After recovery, unplug Atom USB and return to Pyramid bottom-only power, then open the device’s settings.</li></ol></div>`
      : '';
    render(
      updateWritten
        ? 'Update written and verified'
        : path === 'install'
          ? 'Ready for device setup'
          : 'Continue on speaker power',
      `<div class="success-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" stroke="currentColor"/><path d="m9 16 5 5 9-11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p>${updateWritten ? 'The signed application was verified and selected. Switch to normal speaker power so it can start and complete its health checks.' : path === 'install' ? 'Wi-Fi and your device password are saved. Finish your prayer settings on the device.' : 'Your device is ready to open. Its prayer settings and history were not reset.'}</p>${hardware === WAVESHARE ? '<ol class="finish-list"><li>Use the Waveshare rear USB-C port for normal power.</li><li>Press RESET to restart after a verified update.</li>' : '<ol class="finish-list"><li>Unplug the Atom’s USB cable.</li><li>Connect <strong>only the Pyramid’s bottom USB-C power</strong>.</li>'}<li>${needsRecovery ? 'Let the speaker start and complete its startup checks.' : 'Wait for it to reconnect, then open its settings on the same home network.'}</li></ol>${recoveryGuidance}${urls.length && !service.simulated ? '<p id="device-new-tab" class="small muted">Device links open in a new tab.</p>' : ''}<div class="device-links">${urls.map((url, index) => (service.simulated ? `<div class="demo-url"><span>${index === 0 ? 'Device address' : 'IP fallback'}</span><a class="address-link" href="/preview/device/" target="_blank" rel="noopener noreferrer" aria-describedby="device-link-help-${index}"><code>${escape(url)}</code><span aria-hidden="true">↗</span></a><small id="device-link-help-${index}">Opens a local preview in a new tab</small></div>` : `<div class="device-address"><a class="${index === 0 ? 'button' : 'fallback-link'}" href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-describedby="device-new-tab">${index === 0 ? 'Open device settings' : 'Try the IP address'} <span aria-hidden="true">↗</span></a><a class="address-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-describedby="device-new-tab"><code>${escape(url)}</code><span aria-hidden="true">↗</span></a></div>`)).join('')}</div><p class="small muted">${needsRecovery ? '' : 'Sign in as <strong>admin</strong> with the password you chose. '}${path === 'install' && !updateWritten ? 'Review your location, timezone and timetable, then select <strong>Finish setup</strong>.' : updateWritten ? 'Check the firmware version and update result on the device’s settings page. Startup success is confirmed there; an interrupted connection alone cannot establish success or rollback.' : 'Continue with your saved prayer settings.'} Athan playback waits until the device has synchronized its clock.</p>${!urls.length && !needsRecovery ? '<p class="notice">A device address was not returned. Reconnect through USB setup to read it again.</p>' : ''}<div class="actions">${button('Back to connection', 'start', true)}<a href="/docs/getting-started/">Setup instructions</a></div>`,
      3,
    );
    if (phoneSetupCapable && !needsRecovery && !updateWritten) {
      panel
        .querySelector('.device-links')
        ?.insertAdjacentHTML(
          'afterend',
          `<p>To find this page again, ${hardware === WAVESHARE ? 'briefly press BOOT to show the webpage QR and addresses' : 'short-press the front button for the webpage QR, then press again for the addresses'} while audio is idle. If <code>.local</code> does not open, use the current IP address on the screen.</p>`,
        );
    }
  }
  async function finish() {
    if (!updateWritten && blockRecovery()) return;
    // A verified boot selection already requires power handoff. Credential
    // readback must not hide that instruction or imply the transfer failed.
    if ((!updateWritten && !(await readCurrentStatus())) || !status) return;
    if (!updateWritten && status.wifi !== '4') {
      wifiScreen();
      notify('Connect Wi-Fi to open the device’s settings.');
      return;
    }
    if (!updateWritten && status.password !== 'ready') {
      passwordScreen();
      return;
    }
    if (updateWritten) {
      // Verification has completed; cleanup and queued disconnects cannot undo it.
      notice = '';
      renderHandoff(status);
      try {
        await service.close();
      } catch {
        notify(
          hardware === WAVESHARE
            ? 'The browser could not close the USB connection. Disconnect the data cable, then follow the restart and power steps below.'
            : 'The browser could not close the USB connection. Unplug the Atom’s USB cable and follow the power steps below.',
        );
      }
    } else {
      handoff = 'settings';
      notice = '';
      renderHandoff(status);
      await closeForHandoff();
    }
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
          if (operation === 'update') {
            const info = await service.firmware();
            detail = ` Current firmware: ${info.version}; update state: ${info.state}. Startup success still requires the device’s health checks.`;
          } else {
            status = await service.status();
            detail = ` Current device status: Wi-Fi ${status.wifi === '4' ? 'connected' : 'not connected'}, password revision ${status.passwordRevision}. This does not confirm the requested change.`;
          }
        } catch {
          detail = ' Status is unavailable.';
        }
        render(
          'Check before trying again',
          `<p>The device may have completed the requested operation before the connection was interrupted. It was <strong>not sent again</strong>.</p><p>${escape(detail)}</p><p>${operation === 'update' ? 'Reconnect and read firmware status before another transfer. Switch to speaker power only when the device reports a verified handoff.' : operation === 'wifi' ? 'Reconnect and check your device. A connected status may refer to the previous network.' : 'Reconnect and read the password revision before another change.'}</p><div class="actions">${button('Disconnect and start again', 'start')}<a href="/docs/troubleshooting/">Troubleshooting</a></div>`,
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
        if (!handledUncertain && !updateWritten && !handoff && !statusErrorVisible) {
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
  function connectionLost() {
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
  }
  service.onDisconnect = () => {
    usbDisconnected = true;
    if (statusErrorVisible) {
      notice = '';
      return;
    }
    if (handoff === 'choice' && phoneSetupAvailable) {
      mutationBlocked = true;
      phoneHandoff();
      return;
    }
    if (updateWritten || handoff === 'phone' || handoff === 'settings') {
      notice = '';
      return;
    }
    connectionLost();
  };
  root.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'hardware-choice') {
      const valid =
        isHardware(target.value) && (service.installHardware ?? [HARDWARE]).includes(target.value);
      const checkbox = panel.querySelector<HTMLInputElement>('#confirm-install')!;
      checkbox.checked = false;
      checkbox.disabled = !valid;
      panel.querySelector<HTMLButtonElement>('[data-action="install"]')!.disabled = true;
      if (valid) {
        hardware = target.value as Hardware;
        panel.querySelector('#model-confirmation')!.textContent =
          `I have ${hardware === HARDWARE ? 'an' : 'a'} ${HARDWARE_PROFILES[hardware].label} and want to erase it for a new installation.`;
      }
    }
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
          hardware = result.hardware ?? HARDWARE;
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
          const result = await service.install(
            confirmed,
            (percent) => {
              panel.querySelector('progress')!.value = percent;
              panel.querySelector('[data-progress]')!.textContent =
                `${percent}% · ${percent === 100 ? 'Verifying…' : 'Writing firmware…'}`;
            },
            hardware,
          );
          status = result.status;
          installed = true;
          phoneSetupCapable = result.phoneSetup;
          phoneSetupAvailable =
            phoneSetupCapable &&
            status.setup === 'incomplete' &&
            status.wifi === '2' &&
            status.password === 'absent' &&
            status.storage === 'ready';
          if (storageFault()) return;
          if (phoneSetupAvailable && usbDisconnected) phoneHandoff();
          else if (phoneSetupAvailable) setupChoice();
          else wifiScreen();
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
      } else if (action === 'setup-choice') {
        if (await readCurrentStatus()) {
          if (phoneSetupAvailable) setupChoice();
          else recoveryMenu();
        }
      } else if (action === 'phone-setup' && phoneSetupAvailable) {
        if (await readCurrentStatus()) {
          if (phoneSetupAvailable) {
            phoneHandoff();
            await closeForHandoff();
          } else {
            handoff = undefined;
            recoveryMenu();
          }
        }
      } else if (action === 'computer-setup' && phoneSetupAvailable && !mutationBlocked) {
        handoff = undefined;
        if (await readCurrentStatus()) {
          if (phoneSetupAvailable) wifiScreen();
          else recoveryMenu();
        }
      } else if (action === 'refresh-status') {
        if (await readCurrentStatus()) {
          recoveryMenu();
          notify(
            status?.wifi === '4'
              ? 'Wi-Fi is connected.'
              : recoveryBlocked
                ? 'Wi-Fi is still not connected. Resolve the pending USB update before changing Wi-Fi.'
                : 'Wi-Fi is still not connected. Wait a moment and refresh again, or choose Change Wi-Fi.',
          );
        }
      } else if (action === 'recovery') recoveryMenu();
      else if (action === 'wifi-screen') wifiScreen();
      else if (action === 'password-screen') passwordScreen();
      else if (action === 'finish') await finish();
      else if (action === 'check-update') await checkUpdate();
      else if (action === 'review-update') reviewUpdate();
      else if (action === 'update-handoff') {
        if (mutationBlocked || upgradeCheck?.state !== 'busy' || upgradeCheck.action !== 'power')
          return;
        updateWritten = true;
        await finish();
      } else if (action === 'discard-update') {
        if (mutationBlocked || upgradeCheck?.state !== 'busy' || upgradeCheck.action !== 'discard')
          return;
        operation = 'update';
        try {
          await service.discardUpdate();
        } catch (error) {
          if (!(error instanceof UncertainOutcome))
            render(
              'Update needs attention',
              '<p>The incomplete transfer could not be discarded. Reconnect and read firmware status before another attempt.</p>' +
                button('Reconnect and check', 'start') +
                '<p><a href="/docs/troubleshooting/">Update help</a></p>',
              1,
            );
          throw error;
        }
        await checkUpdate();
      } else if (action === 'update' && offered && !mutationBlocked && !recoveryBlocked) {
        operation = 'update';
        const selected = offered;
        render(
          'Updating firmware',
          `<p>Keep ${hardware === WAVESHARE ? 'Waveshare USB' : 'Atom USB'} connected while the application is written and verified. You will switch to speaker power afterwards.</p><progress max="100" value="0" aria-label="Firmware update progress"></progress><p data-progress>Preparing signed update…</p>`,
          1,
        );
        try {
          await service.update(selected, (percent) => {
            panel.querySelector('progress')!.value = percent;
            panel.querySelector('[data-progress]')!.textContent =
              `${percent}% · ${percent === 100 ? 'Verifying…' : 'Writing application…'}`;
          });
        } catch (error) {
          if (!(error instanceof UncertainOutcome))
            render(
              'Update needs attention',
              '<p>The update did not complete. Reconnect and read firmware status before another attempt.</p>' +
                button('Reconnect and check', 'start') +
                '<p><a href="/docs/troubleshooting/">Update help</a></p>',
              1,
            );
          throw error;
        }
        updateWritten = true;
        await finish();
      } else if (action === 'scan') {
        if (mutationBlocked || blockRecovery()) return;
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
    if (blockRecovery()) return;
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
    operation = kind === 'wifi' ? 'wifi' : 'password';
    void attempt(async () => {
      let acknowledged = false;
      try {
        if (kind === 'wifi') {
          // A saved or uncertain USB Wi-Fi write may end AP eligibility.
          phoneSetupAvailable = false;
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
