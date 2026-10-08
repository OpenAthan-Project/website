import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeviceStatus } from '../../installer/protocol';
import type { InstallerService } from '../../installer/service';
import type { UpgradeOffer } from '../../installer/upgrade';

interface HandoffOptions {
  cleanup?: 'reject' | 'pending';
  transfer?: 'failed' | 'uncertain';
  queuedDisconnect?: boolean;
  awaitingPower?: boolean;
  missingCredentials?: boolean;
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
      };
      unexpectedOperations: string[];
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
    const counts = { connect: 0, checkUpdate: 0, update: 0, close: 0, status: 0, firmware: 0 };
    const unexpectedOperations: string[] = [];
    const unexpected = async (operation: string): Promise<never> => {
      unexpectedOperations.push(operation);
      throw new Error(`Unexpected ${operation} operation`);
    };
    const status: DeviceStatus = {
      wifi: options.missingCredentials ? '2' : '4',
      password: options.missingCredentials ? 'absent' : 'ready',
      setup: 'active',
      passwordRevision: 1,
      hostname: 'openathan-test.local',
      storage: 'ready',
      urls: options.missingCredentials
        ? []
        : ['http://openathan-test.local/', 'http://192.168.1.50/'],
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
        return options.awaitingPower
          ? { state: 'busy', action: 'power', detail: 'A verified update awaits speaker power.' }
          : { state: 'available', offer };
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
          result: 'none',
          offered: offer.version,
          received: offer.bytes,
        };
      },
      install: () => unexpected('install'),
      discardUpdate: () => unexpected('discardUpdate'),
      scan: () => unexpected('scan'),
      wifi: () => unexpected('wifi'),
      password: () => unexpected('password'),
    };
    window.usbHandoffFixture = {
      counts,
      unexpectedOperations,
      disconnect: () => service.onDisconnect?.(),
      resolveCleanup: () => resolveCleanup(),
      rejectCleanup: () => rejectCleanup(),
    };
    mountInstaller(root, service);
  }, options);
  await page.getByRole('button', { name: 'Choose USB device' }).click();
  await page.getByRole('button', { name: 'Check for updates' }).click();
}

async function transferUpdate(page: Page) {
  await page.getByRole('button', { name: 'Review update' }).click();
  await page.getByRole('button', { name: 'Install update', exact: true }).click();
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
async function expectOperations(page: Page, update: number, close: number, firmware = 0) {
  expect(await page.evaluate(() => window.usbHandoffFixture.counts)).toEqual({
    connect: 1,
    checkUpdate: 1,
    update,
    close,
    status: 0,
    firmware,
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

for (const missingCredentials of [false, true]) {
  for (const cleanup of [undefined, 'reject'] as const) {
    test(`reconciled awaiting_power retains handoff with credentials ${missingCredentials ? 'missing' : 'ready'} and cleanup ${cleanup ?? 'resolved'}`, async ({
      page,
    }) => {
      await injectHandoffService(page, { awaitingPower: true, missingCredentials, cleanup });
      await page.getByRole('button', { name: 'Finish power handoff' }).click();
      await expectHandoff(page, !missingCredentials);
      if (cleanup === 'reject') await expect(page.getByRole('status')).toHaveText(cleanupNotice);
      await page.evaluate(() => window.usbHandoffFixture.disconnect());
      await expectHandoff(page, !missingCredentials);
      await expectOperations(page, 0, 1);
    });
  }
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
