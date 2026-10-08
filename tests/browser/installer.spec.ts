import { expect, test, type Page } from '@playwright/test';

async function demo(page: Page, scenario = 'success') {
  // A demo must work even if hardware APIs would fail catastrophically.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort() {
          throw new Error('Simulator attempted physical USB access');
        },
      },
    });
  });
  await page.goto('/preview/installer/');
  await expect(page.getByRole('heading', { name: 'Connect speaker' })).toBeVisible();
  if (scenario !== 'success') await page.getByLabel('Preview scenario').selectOption(scenario);
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect simulated device' }).click();
}
async function install(page: Page) {
  await connect(page);
  await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toBeDisabled();
  await page.getByLabel(/I have an AtomS3R/).check();
  await page.getByRole('button', { name: 'Install OpenAthan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect to your Wi-Fi' })).toBeVisible();
}
async function saveWifi(page: Page) {
  await page.getByLabel('Network name', { exact: true }).fill('Home network');
  await page.getByLabel('Wi-Fi password', { exact: true }).fill('made-up wifi secret');
  await page.getByRole('button', { name: 'Save Wi-Fi', exact: true }).click();
}

test('full new-device simulator completes with clickable local handoff previews', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await demo(page, 'new-device');
  await install(page);
  await page.getByRole('button', { name: 'Find networks' }).click();
  await page.getByLabel('Nearby networks').selectOption('Home network');
  await expect(page.getByLabel('Network name', { exact: true })).toHaveValue('Home network');
  await saveWifi(page);
  await expect(page.getByRole('heading', { name: 'Create a device password' })).toBeVisible();
  await page.getByLabel('Device password', { exact: true }).fill('made-up device secret');
  await page.getByLabel('Repeat password').fill('made-up device secret');
  await page.getByRole('button', { name: 'Save device password' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for device setup' })).toBeVisible();
  await expect(page.getByText('http://openathan-demo.local/', { exact: true })).toBeVisible();
  expect(await page.locator('a[href^="http://openathan"], a[href^="http://192."]').count()).toBe(0);
  expect(await page.locator('input[type="password"]').count()).toBe(0);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  for (const address of ['http://openathan-demo.local/', 'http://192.168.1.42/']) {
    const link = page.getByRole('link', { name: address, exact: true });
    await expect(link).toHaveAttribute('href', '/preview/device/');
    await expect(link).toHaveAccessibleDescription('Opens a local preview in a new tab');
    const popupPromise = page.waitForEvent('popup');
    // Verify both pointer and keyboard activation of the two addresses.
    if (address.includes('.local')) await link.click();
    else await link.press('Enter');
    const popup = await popupPromise;
    await expect(popup).toHaveURL(new URL('/preview/device/', page.url()).href);
    await expect(popup.getByRole('heading', { name: 'Device settings preview' })).toBeVisible();
    await expect(popup.getByText('Simulator · no hardware access')).toBeVisible();
    expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(popup.locator('form, input')).toHaveCount(0);
    await popup.close();
    await expect(page.getByRole('heading', { name: 'Ready for device setup' })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('recovery changes Wi-Fi and password without showing install or erase actions', async ({
  page,
}) => {
  await demo(page);
  await connect(page);
  await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change Wi-Fi' }).click();
  await saveWifi(page);
  await expect(page.getByRole('status')).toHaveText('Wi-Fi saved.');
  await page.getByRole('button', { name: 'Reset device password' }).click();
  await page.getByLabel('Device password', { exact: true }).fill('another made-up password');
  await page.getByLabel('Repeat password').fill('another made-up password');
  await page.getByRole('button', { name: 'Save device password' }).click();
  await expect(page.getByRole('status')).toContainText('Device password saved.');
  await page.getByRole('button', { name: 'Open device settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for device setup' })).toBeVisible();
});

for (const [scenario, message] of [
  ['denied', 'No device selected.'],
  ['busy', 'The USB port may be busy.'],
  ['unreadable', 'OpenAthan was recognized, but its status could not be read.'],
] as const) {
  test(`recovery explains ${scenario} without offering automatic installation`, async ({
    page,
  }) => {
    await demo(page, scenario);
    await connect(page);
    await expect(page.getByRole('status')).toContainText(message);
    await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Connect simulated device' })).toBeEnabled();
  });
}
test('wrong Wi-Fi password shows retained credentials and clears entered secret', async ({
  page,
}) => {
  await demo(page, 'wifi-failed');
  await connect(page);
  await page.getByRole('button', { name: 'Change Wi-Fi' }).click();
  await saveWifi(page);
  await expect(page.getByRole('status')).toContainText('Previous saved credentials were retained');
  await expect(page.getByLabel('Wi-Fi password', { exact: true })).toHaveValue('');
});
test('disconnect leaves actionable guidance and no further mutation', async ({ page }) => {
  await demo(page, 'disconnect');
  await connect(page);
  await page.getByRole('button', { name: 'Change Wi-Fi' }).click();
  await page.getByRole('button', { name: 'Find networks' }).click();
  await expect(page.getByRole('status')).toContainText('device disconnected');
  await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(0);
});
test('storage faults stop credential changes', async ({ page }) => {
  await demo(page, 'storage-fault');
  await connect(page);
  await expect(page.getByRole('heading', { name: 'The device needs attention' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset device password' })).toHaveCount(0);
});
test('lost Wi-Fi acknowledgement remains unconfirmed despite connected status', async ({
  page,
}) => {
  await demo(page, 'lost-wifi-ack');
  await connect(page);
  await page.getByRole('button', { name: 'Change Wi-Fi' }).click();
  await saveWifi(page);
  await expect(page.getByRole('heading', { name: 'Check before trying again' })).toBeVisible();
  await expect(page.getByText(/This does not confirm the requested change/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Wi-Fi', exact: true })).toHaveCount(0);
});
test('password validation and lost acknowledgement do not silently repeat writes', async ({
  page,
}) => {
  await demo(page, 'lost-password-ack');
  await connect(page);
  await page.getByRole('button', { name: 'Reset device password' }).click();
  await page.getByLabel('Device password', { exact: true }).fill('long demo password');
  await page.getByLabel('Repeat password').fill('mismatched password');
  await page.getByRole('button', { name: 'Save device password' }).click();
  await expect(page.getByRole('status')).toContainText('passwords do not match');
  await page.getByLabel('Repeat password').fill('long demo password');
  await page.getByRole('button', { name: 'Save device password' }).click();
  await expect(page.getByRole('heading', { name: 'Check before trying again' })).toBeVisible();
  await expect(page.getByText(/password revision 2/)).toBeVisible();
});
test('interrupted flashing gives a recovery exit', async ({ page }) => {
  await demo(page, 'flash-failed');
  await connect(page);
  await page.getByLabel(/I have an AtomS3R/).check();
  await page.getByRole('button', { name: 'Install OpenAthan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Installation needs attention' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect and start again' })).toBeEnabled();
});
test('unsupported browsers retain usable documentation and keyboard navigation', async ({
  page,
  browserName,
}) => {
  await page.addInitScript(() => {
    let object: object | null = navigator;
    while (object) {
      Reflect.deleteProperty(object, 'serial');
      object = Object.getPrototypeOf(object) as object | null;
    }
  });
  await page.goto('/install/');
  await expect(page.getByRole('heading', { name: 'Use a computer for USB setup' })).toBeVisible();
  await expect(page.getByText(/For USB setup, open this page on a computer/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose USB device/ })).toHaveCount(0);
  await page.goto('/docs/getting-started/');
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  // WebKit follows macOS's default: Option-Tab includes links in keyboard navigation.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
test('installer layout fits the viewport and moves focus with the step', async ({ page }) => {
  await demo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Connect simulated device' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const action of ['Cancel', 'Retry connection']) {
  test(`unrecognized firmware requires explicit erasure and supports ${action.toLowerCase()}`, async ({
    page,
  }) => {
    await demo(page, 'unknown');
    await connect(page);
    await expect(page.getByRole('heading', { name: 'Confirm a new installation' })).toBeFocused();
    await expect(page.getByText(/does not prove the device is new or empty/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Install OpenAthan', exact: true }),
    ).toBeDisabled();
    await expect(
      page.locator('[data-panel]').getByRole('link', { name: 'Troubleshooting', exact: true }),
    ).toBeVisible();
    await page.getByLabel(/I have an AtomS3R/).check();
    await expect(
      page.getByRole('button', { name: 'Install OpenAthan', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect speaker' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(
      0,
    );
    await connect(page);
    await expect(
      page.getByRole('button', { name: 'Install OpenAthan', exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
