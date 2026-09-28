import { expect, test, type Page } from '@playwright/test';
import { fakeSerialDevice } from './fixtures/serial-device';

async function connect(page: Page) {
  await page.goto('/install/');
  await page.getByRole('button', { name: 'Open recovery', exact: true }).click();
  await page.getByRole('button', { name: 'Choose USB device' }).click();
  await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeVisible();
}
async function save(page: Page, kind: 'wifi' | 'password') {
  if (kind === 'wifi') {
    await page.getByRole('button', { name: 'Change Wi-Fi' }).click();
    await page.getByLabel('Network name', { exact: true }).fill('Test network');
    await page.getByLabel('Wi-Fi password', { exact: true }).fill('made-up wifi password');
    await page.getByRole('button', { name: 'Save Wi-Fi', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Reset device password' }).click();
    await page.getByLabel('Device password', { exact: true }).fill('made-up device password');
    await page.getByLabel('Repeat password').fill('made-up device password');
    await page.getByRole('button', { name: 'Save device password' }).click();
  }
}
const identify = { extension: false, command: 3 };
const status = { extension: true, command: 1 };
const write = (kind: 'wifi' | 'password') => ({
  extension: kind === 'password',
  command: kind === 'password' ? 2 : 1,
});
async function expectNoChanges(page: Page) {
  await expect(page.locator('[data-panel] form')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Change Wi-Fi|Reset device password|Open device settings/ }),
  ).toHaveCount(0);
}

for (const kind of ['wifi', 'password'] as const) {
  for (const outcome of ['storage', 'unreadable', 'healthy'] as const) {
    test(`${kind} error 255 checks ${outcome} status before allowing more changes`, async ({
      page,
    }) => {
      await fakeSerialDevice(page, { saveErrorStatus: outcome });
      await connect(page);
      await save(page, kind);
      if (outcome === 'storage') {
        await expect(
          page.getByRole('heading', { name: 'The device needs attention' }),
        ).toBeVisible();
        await expectNoChanges(page);
      } else if (outcome === 'unreadable') {
        await expect(page.getByRole('heading', { name: 'Check the device status' })).toBeVisible();
        await expectNoChanges(page);
      } else {
        await expect(page.getByRole('status')).toContainText('storage is unavailable');
        await expect(page.locator('input[type="password"]').first()).toHaveValue('');
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Change Wi-Fi' })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Reset device password' })).toBeEnabled();
      }
      expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
        identify,
        status,
        write(kind),
        status,
      ]);
      expect(await page.evaluate(() => window.recoveryDevice.opens)).toBe(1);
      await expect(page.getByRole('status', { includeHidden: true })).not.toContainText('saved.');
      if (outcome === 'healthy') {
        // A second write is permitted only after another deliberate submission.
        await save(page, kind);
        await expect(page.getByRole('status')).toContainText('storage is unavailable');
        expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
          identify,
          status,
          write(kind),
          status,
          write(kind),
          status,
        ]);
      }
    });
  }
}

test('recovery refreshes Wi-Fi and device links without reopening USB or writing credentials', async ({
  page,
}) => {
  await fakeSerialDevice(page, { offline: true });
  await connect(page);
  await expect(page.getByRole('button', { name: 'Open device settings', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Refresh status', exact: true }).press('Enter');
  await expect(page.getByRole('status')).toContainText('Wi-Fi is still not connected');
  await page.evaluate(() => {
    window.recoveryDevice.wifi = '4';
  });
  await page.getByRole('button', { name: 'Refresh status', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeFocused();
  await page.getByRole('button', { name: 'Open device settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for device setup' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open device settings/ })).toHaveAttribute(
    'href',
    'http://openathan-test.local/',
  );
  expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
    identify,
    status,
    status,
    status,
    status,
  ]);
  expect(
    await page.evaluate(() => [window.recoveryDevice.opens, window.recoveryDevice.closes]),
  ).toEqual([1, 1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const fault of ['password', 'setup', 'unreadable'] as const) {
  test(`refresh blocks changes when current ${fault} status is unsafe`, async ({ page }) => {
    await fakeSerialDevice(page);
    await connect(page);
    await page.evaluate((fault) => {
      if (fault === 'unreadable') window.recoveryDevice.unreadable = true;
      else window.recoveryDevice[fault] = fault === 'setup' ? 'storage_fault' : 'fault';
    }, fault);
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: fault === 'unreadable' ? 'Check the device status' : 'The device needs attention',
      }),
    ).toBeVisible();
    await expectNoChanges(page);
    expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
      identify,
      status,
      status,
    ]);
  });
}
