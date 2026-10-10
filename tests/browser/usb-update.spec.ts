import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeviceStatus } from '../../installer/protocol';
import type { InstallerService } from '../../installer/service';
import type { UpgradeCheck, UpgradeOffer } from '../../installer/upgrade';

interface HandoffOptions {
  cleanup?: 'reject' | 'pending';
  transfer?: 'failed' | 'uncertain';
  queuedDisconnect?: boolean;
  awaitingPower?: boolean;
  missingCredentials?: boolean;
  missingWifi?: boolean;
  missingPassword?: boolean;
  checks?: UpgradeCheck[];
  discard?: 'success' | 'failed' | 'uncertain';
  deferCheck?: boolean;
  downloadTimeout?: 'headers' | 'body';
}
declare global {
  interface Window {
    usbHandoffFixture: {
      counts: {
        connect: number;
        checkUpdate: number;
        update: number;
        close: number;
        status: number;
        firmware: number;
        discardUpdate: number;
      };
      unexpectedOperations: string[];
      downloads: { requests: number; aborts: number };
      downloadReaderLocked(): boolean;
      disconnect(): void;
      resolveCleanup(): void;
      rejectCleanup(): void;
    };
  }
}

const cleanupNotice =
  'The browser could not close the USB connection. Unplug the Atom’s USB cable and follow the power steps below.';

/** Development-only injection: no serial transport, flasher or production scenarios. */
async function injectHandoffService(page: Page, options: HandoffOptions = {}) {
  await page.goto('/preview/installer/');
  await expect(page.getByRole('button', { name: 'Connect simulated device' })).toBeVisible();
  await page.evaluate(async (options) => {
    const uiPath = '/installer/ui.ts';
    const sessionPath = '/installer/session.ts';
    const { mountInstaller } = (await import(uiPath)) as typeof import('../../installer/ui');
    const { UncertainOutcome } = (await import(
      sessionPath
    )) as typeof import('../../installer/session');
    // Release the demo controller's listeners before mounting the injected service.
    const previous = document.querySelector<HTMLElement>('[data-demo-installer]')!;
    const root = previous.cloneNode(true) as HTMLElement;
    previous.replaceWith(root);
    const counts = {
      connect: 0,
      checkUpdate: 0,
      update: 0,
      close: 0,
      status: 0,
      firmware: 0,
      discardUpdate: 0,
    };
    const unexpectedOperations: string[] = [];
    const downloads = { requests: 0, aborts: 0 };
    let downloadBody: ReadableStream<Uint8Array> | undefined;
    let checkDownload: (() => Promise<UpgradeCheck>) | undefined;
    const unexpected = async (operation: string): Promise<never> => {
      unexpectedOperations.push(operation);
      throw new Error(`Unexpected ${operation} operation`);
    };
    const missingWifi = options.missingWifi || options.missingCredentials;
    const status: DeviceStatus = {
      wifi: missingWifi ? '2' : '4',
      password: options.missingPassword || options.missingCredentials ? 'absent' : 'ready',
      setup: 'active',
      passwordRevision: 1,
      hostname: 'openathan-test.local',
      storage: 'ready',
      urls: missingWifi ? [] : ['http://openathan-test.local/', 'http://192.168.1.50/'],
    };
    const offer: UpgradeOffer = {
      version: 'v0.5.0',
      commit: 'b'.repeat(40),
      bytes: 1024,
      sha256: 'c'.repeat(64),
      notes: 'https://github.com/OpenAthan-Project/openathan/releases',
    };
    let resolveCleanup = () => {};
    let rejectCleanup = () => {};
    const cleanupError = () => new DOMException('USB disconnected during cleanup', 'NetworkError');
    const service: InstallerService = {
      simulated: false,
      installAvailable: false,
      async connect() {
        counts.connect++;
        return { kind: 'existing', status };
      },
      async checkUpdate() {
        counts.checkUpdate++;
        if (checkDownload) return checkDownload();
        if (options.checks?.length)
          return options.checks[Math.min(counts.checkUpdate - 1, options.checks.length - 1)]!;
        return options.awaitingPower
          ? {
              state: 'busy',
              action: 'power',
              recoveryBlocked: true,
              detail: 'A verified update awaits speaker power.',
            }
          : { state: 'available', offer, recoveryBlocked: false };
      },
      async update(_offer, progress) {
        counts.update++;
        progress(100);
        if (options.queuedDisconnect) service.onDisconnect?.();
        if (options.transfer === 'failed') throw new Error('The application was rejected.');
        if (options.transfer === 'uncertain') throw new UncertainOutcome();
      },
      async close() {
        counts.close++;
        // Later explicit disconnects remain available after a failed cleanup.
        if (counts.close !== 1) return;
        if (options.cleanup === 'reject') throw cleanupError();
        if (options.cleanup === 'pending')
          await new Promise<void>((resolve, reject) => {
            resolveCleanup = resolve;
            rejectCleanup = () => reject(cleanupError());
          });
      },
      async status() {
        counts.status++;
        return status;
      },
      async firmware() {
        counts.firmware++;
        return {
          version: 'v0.4.0',
          commit: 'a'.repeat(40),
          supported: true,
          state: 'awaiting_power',
          boot: 'confirmed',
          result: '',
          offered: offer.version,
          received: offer.bytes,
        };
      },
      install: () => unexpected('install'),
      async discardUpdate() {
        if (!options.discard) return unexpected('discardUpdate');
        counts.discardUpdate++;
        if (options.discard === 'failed') throw new Error('The discard was rejected.');
        if (options.discard === 'uncertain') throw new UncertainOutcome();
      },
      scan: () => unexpected('scan'),
      wifi: () => unexpected('wifi'),
      password: () => unexpected('password'),
    };
    if (options.downloadTimeout) {
      const servicePath = '/installer/real-service.ts';
      const { RealService } = (await import(
        servicePath
      )) as typeof import('../../installer/real-service');
      const checker = new RealService(
        {
          tag: 'v0.5.0',
          manifestSha256: 'a'.repeat(64),
          mediaReviewed: true,
          hardwareQualified: true,
        },
        true,
      );
      // Exercise real download/error handling with read-only fake firmware INFO.
      checker.firmware = async () => ({ ...(await service.firmware()), state: 'idle' });
      checkDownload = () => checker.checkUpdate();
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        if (String(input) !== '/releases/v0.5.0/manifest.json') return originalFetch(input, init);
        downloads.requests++;
        const signal = init?.signal;
        if (options.downloadTimeout === 'headers')
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                downloads.aborts++;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        downloadBody = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
            controller.enqueue(new Uint8Array([123]));
          },
        });
        signal?.addEventListener(
          'abort',
          () => {
            downloads.aborts++;
            controller.error(signal.reason);
          },
          { once: true },
        );
        return new Response(downloadBody);
      };
    }
    window.usbHandoffFixture = {
      counts,
      unexpectedOperations,
      downloads,
      downloadReaderLocked: () => downloadBody?.locked ?? false,
      disconnect: () => service.onDisconnect?.(),
      resolveCleanup: () => resolveCleanup(),
      rejectCleanup: () => rejectCleanup(),
    };
    mountInstaller(root, service);
  }, options);
  await page.getByRole('button', { name: 'Choose USB device' }).click();
  if (!options.deferCheck) await page.getByRole('button', { name: 'Check for updates' }).click();
}

async function transferUpdate(page: Page) {
  await page.getByRole('button', { name: 'Review update' }).click();
  await page.getByRole('button', { name: 'Install update', exact: true }).click();
}

for (const downloadTimeout of ['headers', 'body'] as const) {
  test(`a stalled download ${downloadTimeout} times out and restores recovery, disconnect and deliberate recheck`, async ({
    page,
  }) => {
    await page.clock.install();
    await injectHandoffService(page, {
      downloadTimeout,
      deferCheck: true,
      missingCredentials: true,
    });
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.getByRole('button', { name: 'Check for updates' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Checking firmware' })).toBeVisible();
    await expect(page.locator('[data-demo-installer]')).toHaveAttribute('aria-busy', 'true');
    if (downloadTimeout === 'body')
      await expect
        .poll(() => page.evaluate(() => window.usbHandoffFixture.downloadReaderLocked()))
        .toBe(true);
    await page.clock.fastForward(59_999);
    await expect(page.locator('[data-demo-installer]')).toHaveAttribute('aria-busy', 'true');
    expect(await page.evaluate(() => window.usbHandoffFixture.downloads)).toEqual({
      requests: 1,
      aborts: 0,
    });
    await page.clock.fastForward(1);
    await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeVisible();
    await expect(page.locator('[data-demo-installer]')).not.toHaveAttribute('aria-busy', 'true');
    await expect(
      page.getByText(
        'The firmware download timed out. Check your internet connection and choose Check for updates again. Installed firmware has not changed.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Create device password' })).toBeEnabled();
    expect(await page.evaluate(() => window.usbHandoffFixture.downloadReaderLocked())).toBe(false);
    await page.getByRole('button', { name: 'Connect Wi-Fi', exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: 'Save Wi-Fi' })).toBeEnabled();
    await page.getByRole('button', { name: 'Back', exact: true }).press('Enter');
    await page.clock.fastForward(60_000);
    expect(await page.evaluate(() => window.usbHandoffFixture.downloads)).toEqual({
      requests: 1,
      aborts: 1,
    });
    await page.getByRole('button', { name: 'Check for updates' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Checking firmware' })).toBeVisible();
    await page.clock.fastForward(60_000);
    await expect(page.locator('[data-demo-installer]')).not.toHaveAttribute('aria-busy', 'true');
    expect(await page.evaluate(() => window.usbHandoffFixture.downloads)).toEqual({
      requests: 2,
      aborts: 2,
    });
    expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
      connect: 1,
      checkUpdate: 2,
      update: 0,
      close: 0,
      firmware: 2,
    });
    expect(await page.evaluate(() => window.usbHandoffFixture.unexpectedOperations)).toEqual([]);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Connect speaker', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.usbHandoffFixture.counts.close)).toBe(1);
  });
}

async function expectHandoff(page: Page, links = true) {
  await expect(page.getByRole('heading', { name: 'Update written and verified' })).toBeVisible();
  await expect(page.getByText('Unplug the Atom’s USB cable.', { exact: true })).toBeVisible();
  await expect(page.getByText('only the Pyramid’s bottom USB-C power')).toBeVisible();
  await expect(page.getByText(/Startup success is confirmed there/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Connection lost|Update needs attention/ }),
  ).toHaveCount(0);
  if (links) {
    await expect(page.getByRole('link', { name: /Open device settings/ })).toHaveAttribute(
      'href',
      'http://openathan-test.local/',
    );
    await expect(page.getByRole('link', { name: /Try the IP address/ })).toHaveAttribute(
      'href',
      'http://192.168.1.50/',
    );
  } else await expect(page.locator('.device-links a')).toHaveCount(0);
}
async function expectCredentialHandoff(
  page: Page,
  credentials: { missingWifi: boolean; missingPassword: boolean },
) {
  const needsRecovery = credentials.missingWifi || credentials.missingPassword;
  await expectHandoff(page, !needsRecovery);
  const panel = page.locator('[data-panel]');
  if (needsRecovery) {
    await expect(panel.getByText(/Sign in as admin with the password you chose/)).toHaveCount(0);
    await expect(
      panel.getByText('Let the speaker start and complete its startup checks.', { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText(/unplug the Pyramid’s bottom power cable before connecting/),
    ).toBeVisible();
    await expect(
      panel.getByText(/Select Back to connection, reconnect, then choose Check for updates/),
    ).toBeVisible();
    await expect(
      panel.getByText(
        /Follow any remaining update instructions before changing Wi-Fi or creating a device password/,
      ),
    ).toBeVisible();
    await expect(
      panel.getByText(/After recovery, unplug Atom USB and return to Pyramid bottom-only power/),
    ).toBeVisible();
    await expect(panel.getByText(/A device address was not returned/)).toHaveCount(0);
  } else {
    await expect(panel.getByText(/Sign in as admin with the password you chose/)).toBeVisible();
    await expect(panel.getByText(/Wait for it to reconnect, then open its settings/)).toBeVisible();
    await expect(panel.getByText(/Follow any remaining update instructions/)).toHaveCount(0);
  }
  if (credentials.missingPassword)
    await expect(
      panel.getByText('Your device password still needs to be created through USB setup.', {
        exact: true,
      }),
    ).toBeVisible();
  else
    await expect(panel.getByText(/Your device password still needs to be created/)).toHaveCount(0);
  if (credentials.missingWifi)
    await expect(
      panel.getByText(
        /The speaker may reconnect using its saved Wi-Fi settings. If it stays offline/,
      ),
    ).toBeVisible();
  else
    await expect(
      panel.getByText(/The speaker may reconnect using its saved Wi-Fi settings/),
    ).toHaveCount(0);
  await expect(panel.locator('form')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Update written and verified' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function expectOperations(page: Page, update: number, close: number, firmware = 0) {
  expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toEqual({
    connect: 1,
    checkUpdate: 1,
    update,
    close,
    status: 0,
    firmware,
    discardUpdate: 0,
  });
  expect(await page.evaluate(() => window.usbHandoffFixture.unexpectedOperations)).toEqual([]);
}

test('verified update retains the power handoff when USB cleanup rejects', async ({
  page,
}, testInfo) => {
  await injectHandoffService(page, { cleanup: 'reject' });
  await transferUpdate(page);
  await expectHandoff(page);
  await expect(page.getByRole('status')).toHaveText(cleanupNotice);
  await expect(page.getByRole('status')).not.toHaveClass(/error|uncertain/);
  await expect(page.getByRole('heading', { name: 'Update written and verified' })).toBeFocused();
  await expectOperations(page, 1, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const capture = process.env.OPENATHAN_REVIEW_DIR;
  if (capture && testInfo.project.name !== 'webkit') {
    await mkdir(capture, { recursive: true });
    await page.screenshot({
      path: resolve(capture, `cleanup-notice-${testInfo.project.name}.png`),
      fullPage: true,
    });
  }
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`verified handoff survives disconnects during pending cleanup and after ${outcome}`, async ({
    page,
  }) => {
    await injectHandoffService(page, { cleanup: 'pending' });
    await transferUpdate(page);
    await expectHandoff(page);
    await expect(page.locator('[data-demo-installer]')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('heading', { name: 'Update written and verified' })).toBeFocused();
    await page.evaluate(() => window.usbHandoffFixture.disconnect());
    await expectHandoff(page);
    await page.evaluate((outcome) => {
      if (outcome === 'resolve') window.usbHandoffFixture.resolveCleanup();
      else window.usbHandoffFixture.rejectCleanup();
    }, outcome);
    await expect(page.locator('[data-demo-installer]')).not.toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => window.usbHandoffFixture.disconnect());
    await expectHandoff(page);
    if (outcome === 'reject') await expect(page.getByRole('status')).toHaveText(cleanupNotice);
    else await expect(page.getByRole('status', { includeHidden: true })).toBeHidden();
    await expectOperations(page, 1, 1);
  });
}

test('a disconnect queued before verification cannot overwrite the verified handoff', async ({
  page,
}) => {
  await injectHandoffService(page, { queuedDisconnect: true });
  await transferUpdate(page);
  await expect(page.locator('[data-demo-installer]')).not.toHaveAttribute('aria-busy', 'true');
  await expectHandoff(page);
  await expect(page.getByRole('status', { includeHidden: true })).toBeHidden();
  await expectOperations(page, 1, 1);
});

for (const credentials of [
  { name: 'ready', missingWifi: false, missingPassword: false },
  { name: 'missing Wi-Fi', missingWifi: true, missingPassword: false },
  { name: 'missing password', missingWifi: false, missingPassword: true },
  { name: 'both missing', missingWifi: true, missingPassword: true },
]) {
  for (const awaitingPower of [false, true]) {
    for (const cleanup of [undefined, 'reject'] as const) {
      test(`${awaitingPower ? 'reconciled awaiting_power' : 'completed transfer'} prioritizes handoff with credentials ${credentials.name} and cleanup ${cleanup ?? 'resolved'}`, async ({
        page,
      }, testInfo) => {
        await injectHandoffService(page, { awaitingPower, ...credentials, cleanup });
        if (awaitingPower) {
          await expectBlockedRecovery(page, 'Finish power handoff');
          await page.getByRole('button', { name: 'Finish power handoff' }).click();
        } else await transferUpdate(page);
        await expectCredentialHandoff(page, credentials);
        if (cleanup === 'reject') await expect(page.getByRole('status')).toHaveText(cleanupNotice);
        await page.evaluate(() => window.usbHandoffFixture.disconnect());
        await expectCredentialHandoff(page, credentials);
        await expectOperations(page, awaitingPower ? 0 : 1, 1);
        const capture = process.env.OPENATHAN_REVIEW_DIR;
        if (
          capture &&
          awaitingPower &&
          credentials.missingPassword &&
          cleanup === 'reject' &&
          testInfo.project.name !== 'webkit'
        ) {
          await mkdir(capture, { recursive: true });
          await page.screenshot({
            path: resolve(
              capture,
              `handoff-${credentials.name.replaceAll(' ', '-')}-${testInfo.project.name}.png`,
            ),
            fullPage: true,
          });
        }
      });
    }
  }
}

async function expectBlockedRecovery(page: Page, primary: string) {
  await expect(page.locator('[data-panel] .button:not(.secondary)')).toHaveCount(1);
  await expect(page.locator('[data-panel] .button:not(.secondary)')).toHaveText(primary);
  await expect(page.getByRole('button', { name: primary, exact: true })).toHaveCount(1);
  await expect(
    page
      .locator('.task-row')
      .filter({ has: page.getByRole('heading', { name: 'Firmware', exact: true }) })
      .getByRole('button'),
  ).toHaveCount(0);
  await expect(page.getByText(/Wi-Fi and password recovery must wait/)).toBeVisible();
  const recovery = page.locator('.recovery-disclosure');
  await expect(recovery).not.toHaveAttribute('open');
  await recovery.locator('summary').press('Enter');
  await expect(recovery.getByRole('button', { name: /^(Connect|Change) Wi-Fi$/ })).toBeDisabled();
  await expect(
    recovery.getByRole('button', { name: /^(Create|Reset) device password$/ }),
  ).toBeDisabled();
  await expect(recovery.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
}

async function dispatchAction(page: Page, action: string) {
  await page.evaluate((action) => {
    const control = document.createElement('button');
    control.dataset.action = action;
    document.querySelector('[data-demo-installer]')!.append(control);
    control.click();
    control.remove();
  }, action);
  await expect(page.locator('[data-demo-installer]')).not.toHaveAttribute('aria-busy', 'true');
}

for (const state of [
  'usb_descriptor',
  'usb_receiving',
  'usb_selection_uncertain',
  'usb_interrupted before startup confirmation',
]) {
  test(`${state} prioritizes read-only update status over recovery`, async ({ page }) => {
    await injectHandoffService(page, {
      missingCredentials: true,
      checks: [{ state: 'busy', recoveryBlocked: true, detail: `Pending ${state}.` }],
    });
    await expectBlockedRecovery(page, 'Check update status');
    await expect(page.getByRole('button', { name: 'Discard incomplete transfer' })).toHaveCount(0);
    await expectOperations(page, 0, 0);
  });
}

test('connection alone keeps recovery available without a firmware check', async ({ page }) => {
  await injectHandoffService(page, {
    awaitingPower: true,
    missingCredentials: true,
    deferCheck: true,
  });
  await expect(page.locator('[data-panel] .button:not(.secondary)')).toHaveText('Connect Wi-Fi');
  await expect(page.locator('.recovery-disclosure')).toHaveAttribute('open', '');
  expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
    connect: 1,
    checkUpdate: 0,
    firmware: 0,
    status: 0,
  });
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expectBlockedRecovery(page, 'Finish power handoff');
});

test('returning to connection resets USB ownership for the next connection', async ({ page }) => {
  await injectHandoffService(page, {
    missingCredentials: true,
    checks: [
      { state: 'busy', recoveryBlocked: true, detail: 'USB transfer in progress.' },
      { state: 'failed', detail: 'Firmware INFO is unavailable on this connection.' },
    ],
  });
  await expectBlockedRecovery(page, 'Check update status');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Choose USB device' }).click();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.locator('[data-panel] .button:not(.secondary)')).toHaveText('Connect Wi-Fi');
  await expect(page.getByRole('button', { name: 'Create device password' })).toBeEnabled();
  expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
    connect: 2,
    checkUpdate: 2,
    close: 1,
  });
});

test('healthy provisioning refresh cannot release known USB ownership or allow forged recovery handlers', async ({
  page,
}) => {
  await injectHandoffService(page, { awaitingPower: true });
  await expectBlockedRecovery(page, 'Finish power handoff');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expectBlockedRecovery(page, 'Finish power handoff');
  // Dispatch stale/forged events to exercise handlers independently of disabled buttons.
  for (const action of ['wifi-screen', 'password-screen', 'scan', 'finish']) {
    await dispatchAction(page, action);
    await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeVisible();
    await expect(page.locator('[data-panel] form')).toHaveCount(0);
  }
  for (const kind of ['wifi', 'password']) {
    await page.evaluate((kind) => {
      const root = document.querySelector('[data-demo-installer]')!;
      const form = document.createElement('form');
      form.dataset.form = kind;
      form.innerHTML =
        '<input name="ssid" value="Home"><input name="password" type="password" value="test recovery password"><input name="confirmation" type="password" value="test recovery password">';
      root.append(form);
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.remove();
    }, kind);
    await expect(page.locator('[data-demo-installer]')).not.toHaveAttribute('aria-busy', 'true');
  }
  expect(await page.evaluate(() => window.usbHandoffFixture.unexpectedOperations)).toEqual([]);
  expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
    status: 1,
    checkUpdate: 1,
    close: 0,
    update: 0,
  });
});

test('failed INFO retains known ownership, replaces resolution with reconnect, and fresh INFO clears it', async ({
  page,
}) => {
  await injectHandoffService(page, {
    missingCredentials: true,
    checks: [
      { state: 'busy', recoveryBlocked: true, detail: 'USB transfer in progress.' },
      { state: 'failed', detail: 'Firmware status could not be read. Reconnect and check again.' },
      {
        state: 'disabled',
        recoveryBlocked: false,
        detail: 'USB updates are awaiting physical qualification.',
      },
    ],
  });
  await page.getByRole('button', { name: 'Check update status', exact: true }).click();
  await expectBlockedRecovery(page, 'Reconnect and check');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expectBlockedRecovery(page, 'Reconnect and check');
  // A later successful INFO result is the only authority that can clear the lock.
  await dispatchAction(page, 'check-update');
  await expect(page.locator('[data-panel] .button:not(.secondary)')).toHaveText('Connect Wi-Fi');
  await expect(page.getByRole('button', { name: 'Create device password' })).toBeEnabled();
  expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
    checkUpdate: 3,
    status: 1,
    close: 0,
  });
});

for (const action of ['power', 'discard'] as const) {
  test(`failed INFO removes stale ${action} resolution without unlocking recovery`, async ({
    page,
  }) => {
    await injectHandoffService(page, {
      checks: [
        { state: 'busy', action, recoveryBlocked: true, detail: 'A USB update needs resolution.' },
        {
          state: 'failed',
          detail: 'Firmware status could not be read. Reconnect and check again.',
        },
      ],
    });
    await dispatchAction(page, 'check-update');
    await expectBlockedRecovery(page, 'Reconnect and check');
    await dispatchAction(page, action === 'power' ? 'update-handoff' : 'discard-update');
    await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeVisible();
    expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
      close: 0,
      discardUpdate: 0,
      update: 0,
      checkUpdate: 2,
    });
    expect(await page.evaluate(() => window.usbHandoffFixture.unexpectedOperations)).toEqual([]);
  });
}

test('successful discard cannot unlock recovery when its fresh INFO read fails', async ({
  page,
}) => {
  await injectHandoffService(page, {
    missingCredentials: true,
    discard: 'success',
    checks: [
      {
        state: 'busy',
        action: 'discard',
        recoveryBlocked: true,
        detail: 'An incomplete transfer can be discarded.',
      },
      { state: 'failed', detail: 'Firmware status could not be read. Reconnect and check again.' },
    ],
  });
  await page.getByRole('button', { name: 'Discard incomplete transfer' }).click();
  await expectBlockedRecovery(page, 'Reconnect and check');
  expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
    checkUpdate: 2,
    discardUpdate: 1,
  });
});

test('successful discard reads fresh INFO and restores missing-credential recovery', async ({
  page,
}) => {
  await injectHandoffService(page, {
    missingCredentials: true,
    discard: 'success',
    checks: [
      {
        state: 'busy',
        action: 'discard',
        recoveryBlocked: true,
        detail: 'An incomplete transfer can be discarded.',
      },
      {
        state: 'disabled',
        recoveryBlocked: false,
        detail: 'USB updates are awaiting physical qualification.',
      },
    ],
  });
  await expectBlockedRecovery(page, 'Discard incomplete transfer');
  await page.getByRole('button', { name: 'Discard incomplete transfer' }).click();
  await expect(page.locator('[data-panel] .button:not(.secondary)')).toHaveText('Connect Wi-Fi');
  await expect(page.locator('.recovery-disclosure')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Create device password' })).toBeEnabled();
  await page.getByRole('button', { name: 'Connect Wi-Fi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find networks' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save Wi-Fi' })).toBeEnabled();
  expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
    checkUpdate: 2,
    discardUpdate: 1,
    close: 0,
  });
  expect(await page.evaluate(() => window.usbHandoffFixture.unexpectedOperations)).toEqual([]);
});

for (const discard of ['failed', 'uncertain'] as const) {
  test(`${discard} discard retains reconnect guidance without retry or unlocked recovery`, async ({
    page,
  }) => {
    await injectHandoffService(page, {
      discard,
      checks: [
        {
          state: 'busy',
          action: 'discard',
          recoveryBlocked: true,
          detail: 'An incomplete transfer can be discarded.',
        },
      ],
    });
    await page.getByRole('button', { name: 'Discard incomplete transfer' }).click();
    await expect(
      page.getByRole('heading', {
        name: discard === 'failed' ? 'Update needs attention' : 'Check before trying again',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Reconnect and check|Disconnect and start again/ }),
    ).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^(Change|Connect) Wi-Fi$/ })).toHaveCount(0);
    expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toMatchObject({
      discardUpdate: 1,
      checkUpdate: 1,
      close: 0,
      update: 0,
    });
  });
}

for (const check of [
  {
    state: 'unsupported',
    recoveryBlocked: false,
    detail: 'Legacy firmware needs an initial Wi-Fi update.',
  },
  { state: 'busy', recoveryBlocked: false, detail: 'Ordinary startup checks are pending.' },
  { state: 'busy', recoveryBlocked: false, detail: 'A network update is downloading.' },
  { state: 'failed', detail: 'Firmware INFO is unavailable.' },
] satisfies UpgradeCheck[]) {
  test(`${check.detail} does not establish USB ownership`, async ({ page }) => {
    await injectHandoffService(page, { missingCredentials: true, checks: [check] });
    await expect(page.locator('[data-panel] .button:not(.secondary)')).toHaveText('Connect Wi-Fi');
    await expect(page.getByRole('button', { name: 'Create device password' })).toBeEnabled();
    await page.getByRole('button', { name: 'Connect Wi-Fi', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save Wi-Fi' })).toBeEnabled();
    await expectOperations(page, 0, 0);
  });
}

for (const width of [1440, 390]) {
  test(`blocked recovery keyboard behavior and layout at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await injectHandoffService(page, { awaitingPower: true, missingCredentials: true });
    await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeFocused();
    await expectBlockedRecovery(page, 'Finish power handoff');
    await expect(page.locator('.recovery-disclosure summary')).toBeFocused();
    // WebKit's default tab mode skips buttons; Option-Tab visits all native controls.
    await page.keyboard.press(testInfo.project.name === 'chromium' ? 'Tab' : 'Alt+Tab');
    await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const capture = process.env.OPENATHAN_REVIEW_DIR;
    if (capture && testInfo.project.name === 'chromium') {
      await mkdir(capture, { recursive: true });
      await page.screenshot({
        path: resolve(capture, `blocked-recovery-${width}.png`),
        fullPage: true,
      });
    }
  });
}

for (const transfer of ['failed', 'uncertain'] as const) {
  test(`${transfer} transfer retains its guidance without cleanup or automatic resend`, async ({
    page,
  }) => {
    await injectHandoffService(page, { transfer, queuedDisconnect: transfer === 'uncertain' });
    await transferUpdate(page);
    await expect(
      page.getByRole('heading', {
        name: transfer === 'failed' ? 'Update needs attention' : 'Check before trying again',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        transfer === 'failed'
          ? /Reconnect and read firmware status before another attempt/
          : /read firmware status before another transfer/,
      ),
    ).toBeVisible();
    if (transfer === 'uncertain') {
      await expect(page.getByRole('status')).toHaveText(
        'The result is uncertain. No automatic retry was made.',
      );
      await expect(page.getByText(/update state: awaiting_power/)).toBeVisible();
    } else await expect(page.getByRole('status')).toHaveText('The application was rejected.');
    await expect(page.getByRole('heading', { name: 'Update written and verified' })).toHaveCount(0);
    await expect(page.locator('.finish-list, .device-links a')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Install update', exact: true })).toHaveCount(0);
    await expectOperations(page, 1, 0, transfer === 'uncertain' ? 1 : 0);
  });
}

test('returning to connection resets verified handoff disconnect protection', async ({ page }) => {
  await injectHandoffService(page);
  await transferUpdate(page);
  await expectHandoff(page);
  await page.getByRole('button', { name: 'Back to connection' }).click();
  await expect(page.getByRole('heading', { name: 'Connect speaker' })).toBeVisible();
  await page.evaluate(() => window.usbHandoffFixture.disconnect());
  await expect(page.getByRole('heading', { name: 'Connection lost' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Reconnect the USB data cable');
  await expectOperations(page, 1, 2);
});

for (const width of [1440, 390]) {
  test(`approved USB summary and update handoff at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/preview/installer/');
    await page.getByLabel('Preview scenario').selectOption('update-available');
    await page.getByRole('button', { name: 'Connect simulated device' }).click();
    const recovery = page.locator('.recovery-disclosure');
    await expect(recovery).not.toHaveAttribute('open');
    await expect(page.getByRole('button', { name: 'Continue to device settings' })).toBeVisible();
    await expect(page.locator('[data-panel] .button:not(.secondary)')).toHaveCount(1);
    await expect(page.locator('[data-context]')).toBeHidden();
    await page.locator('.recovery-disclosure summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Change Wi-Fi' })).toBeVisible();
    await page.locator('.recovery-disclosure summary').click();
    const capture = process.env.OPENATHAN_REVIEW_DIR;
    if (capture && testInfo.project.name === 'chromium') {
      await mkdir(capture, { recursive: true });
      await page.screenshot({
        path: resolve(capture, width === 1440 ? 'desktop.png' : 'mobile.png'),
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await page.getByRole('button', { name: 'Review update' }).click();
    await expect(page.getByRole('heading', { name: 'Review firmware update' })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Read the release notes' })).toHaveAttribute(
      'href',
      'https://github.com/OpenAthan-Project/openathan/releases',
    );
    await page.getByRole('button', { name: 'Install update', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Update written and verified' })).toBeVisible();
    await expect(page.getByText(/Startup success is confirmed there/)).toBeVisible();
    await expect(page.getByText('Finish setup', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (capture && testInfo.project.name === 'chromium')
      await page.screenshot({ path: resolve(capture, `handoff-${width}.png`), fullPage: true });
  });
}
test('post-install Back preserves installation and cannot return to erase confirmation', async ({
  page,
}) => {
  await page.goto('/preview/installer/');
  await page.getByLabel('Preview scenario').selectOption('new-device');
  await page.getByRole('button', { name: 'Connect simulated device' }).click();
  await page.getByLabel('Speaker model').selectOption('atoms3r-c126-pyramid-a167');
  await page.getByLabel(/I have an AtomS3R/).check();
  await page.getByRole('button', { name: 'Install OpenAthan', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Wi-Fi', exact: true })).toBeVisible();
  await expect(page.getByLabel(/I have an AtomS3R/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(0);
});
test('uncertain firmware transfer stays uncertain and offers one reconnect action', async ({
  page,
}) => {
  await page.goto('/preview/installer/');
  await page.getByLabel('Preview scenario').selectOption('update-uncertain');
  await page.getByRole('button', { name: 'Connect simulated device' }).click();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await page.getByRole('button', { name: 'Review update' }).click();
  await page.getByRole('button', { name: 'Install update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check before trying again' })).toBeVisible();
  await expect(page.getByText(/read firmware status before another transfer/)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('uncertain');
  await expect(page.getByRole('button', { name: 'Install update', exact: true })).toHaveCount(0);
});
