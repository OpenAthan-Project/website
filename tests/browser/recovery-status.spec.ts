import { expect, test, type Page } from '@playwright/test';
import { fakeSerialDevice } from './fixtures/serial-device';

async function connect(page: Page) {
  await page.goto('/install/');
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
  await expect(page.locator('.device-links a')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Change Wi-Fi|Reset device password|Open device settings/ }),
  ).toHaveCount(0);
}

for (const kind of ['wifi', 'password'] as const) {
  for (const outcome of ['storage', 'password', 'setup', 'unreadable', 'healthy'] as const) {
    test(`${kind} error 255 checks ${outcome} status before allowing more changes`, async ({
      page,
    }) => {
      await fakeSerialDevice(page, { save: { reply: 'error255', status: outcome } });
      await connect(page);
      await save(page, kind);
      if (outcome === 'storage' || outcome === 'password' || outcome === 'setup') {
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

for (const action of ['Refresh status', 'Open device settings']) {
  for (const fault of ['storage', 'password', 'setup', 'unreadable'] as const) {
    test(`${action} blocks changes when current ${fault} status is unsafe`, async ({ page }) => {
      await fakeSerialDevice(page);
      await connect(page);
      await page.evaluate((fault) => {
        if (fault === 'unreadable') window.recoveryDevice.unreadable = true;
        else window.recoveryDevice[fault] = fault === 'setup' ? 'storage_fault' : 'fault';
      }, fault);
      await page.getByRole('button', { name: action, exact: true }).press('Enter');
      await expect(
        page.getByRole('heading', {
          name: fault === 'unreadable' ? 'Check the device status' : 'The device needs attention',
        }),
      ).toBeFocused();
      await expectNoChanges(page);
      expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
        identify,
        status,
        status,
      ]);
      await page.getByRole('button', { name: /Disconnect/ }).press('Enter');
      await expect(
        page.getByRole('button', { name: 'Choose USB device', exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => window.recoveryDevice.closes)).toBe(1);
    });
  }
}

test('invalid Wi-Fi keys stay in the browser and corrected input can be submitted', async ({
  page,
}) => {
  await fakeSerialDevice(page, { save: { reply: 'error255', status: 'healthy' } });
  await connect(page);
  await page.getByRole('button', { name: 'Change Wi-Fi' }).click();
  await page.getByLabel('Network name', { exact: true }).fill('Test network');
  for (const password of ['x'.repeat(64), 'é'.repeat(32)]) {
    await page.getByLabel('Wi-Fi password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Save Wi-Fi', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('hexadecimal');
    expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([identify, status]);
  }
  await page.getByLabel('Wi-Fi password', { exact: true }).fill('aBcDeF09'.repeat(8));
  await page.getByRole('button', { name: 'Save Wi-Fi', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('storage is unavailable');
  expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
    identify,
    status,
    write('wifi'),
    status,
  ]);
  await expect(page.getByLabel('Wi-Fi password', { exact: true })).toHaveValue('');
});

for (const [name, fields] of [
  ['empty', []],
  ['incomplete', ['http://openathan-test.local/']],
  ['invalid', ['saved', '2']],
] as const) {
  test(`${name} Wi-Fi acknowledgement stays uncertain despite connected status`, async ({
    page,
  }) => {
    await fakeSerialDevice(page, {
      save: { reply: 'acknowledged', status: 'healthy', wifiAcknowledgement: [...fields] },
    });
    await connect(page);
    await save(page, 'wifi');
    await expect(page.getByRole('heading', { name: 'Check before trying again' })).toBeFocused();
    await expect(
      page.getByText(/Wi-Fi connected.*This does not confirm the requested change/),
    ).toBeVisible();
    await expectNoChanges(page);
    await expect(page.getByRole('status')).not.toContainText('Wi-Fi saved');
    await expect(page.getByRole('status')).toContainText('No automatic retry');
    expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
      identify,
      status,
      write('wifi'),
      status,
    ]);
    expect(await page.evaluate(() => window.recoveryDevice.opens)).toBe(1);
    await page
      .getByRole('button', { name: 'Disconnect and start again', exact: true })
      .press('Enter');
    await expect(
      page.getByRole('button', { name: 'Choose USB device', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.recoveryDevice.closes)).toBe(1);
  });
}

for (const kind of ['wifi', 'password'] as const) {
  for (const outcome of ['storage', 'password', 'setup', 'unreadable', 'healthy'] as const) {
    test(`acknowledged ${kind} save checks ${outcome} status before continuing`, async ({
      page,
    }) => {
      await fakeSerialDevice(page, { save: { reply: 'acknowledged', status: outcome } });
      await connect(page);
      await save(page, kind);
      if (outcome === 'healthy') {
        await expect(
          page.getByRole('heading', { name: 'Your OpenAthan is connected' }),
        ).toBeFocused();
        await expect(page.getByRole('status')).toContainText(
          kind === 'wifi' ? 'Wi-Fi saved.' : 'Device password saved.',
        );
      } else {
        await expect(
          page.getByRole('heading', {
            name:
              outcome === 'unreadable' ? 'Check the device status' : 'The device needs attention',
          }),
        ).toBeFocused();
        await expectNoChanges(page);
        await expect(page.getByRole('status', { includeHidden: true })).not.toContainText('saved.');
      }
      expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
        identify,
        status,
        write(kind),
        status,
      ]);
    });
  }
  for (const outcome of ['healthy', 'unreadable', 'storage'] as const) {
    test(`lost ${kind} acknowledgement stays blocked after ${outcome} status`, async ({ page }) => {
      await fakeSerialDevice(page, { save: { reply: 'lost', status: outcome } });
      await connect(page);
      // Advance the real adapter's deadline without making the suite wait 40 seconds.
      await page.clock.install();
      await save(page, kind);
      await expect.poll(() => page.evaluate(() => window.recoveryDevice.requests.length)).toBe(3);
      await page.clock.runFor(40_001);
      await expect(page.getByRole('heading', { name: 'Check before trying again' })).toBeFocused();
      await expectNoChanges(page);
      await expect(page.getByRole('status')).toContainText('No automatic retry');
      await expect(page.getByRole('status')).not.toContainText('saved.');
      if (outcome === 'unreadable')
        await expect(page.getByText('Status is unavailable.')).toBeVisible();
      else await expect(page.getByText(/This does not confirm the requested change/)).toBeVisible();
      expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
        identify,
        status,
        write(kind),
        status,
      ]);
    });
  }
}

for (const state of ['offline', 'password-absent'] as const) {
  test(`handoff redirects to setup when the device becomes ${state}`, async ({ page }) => {
    await fakeSerialDevice(page);
    await connect(page);
    await page.evaluate((state) => {
      if (state === 'offline') window.recoveryDevice.wifi = '2';
      else window.recoveryDevice.password = 'absent';
    }, state);
    await page.getByRole('button', { name: 'Open device settings', exact: true }).press('Enter');
    await expect(
      page.getByRole('heading', {
        name: state === 'offline' ? 'Connect to your Wi-Fi' : 'Create a device password',
      }),
    ).toBeFocused();
    await expect(
      page.getByRole('button', {
        name: state === 'offline' ? 'Save Wi-Fi' : 'Save device password',
        exact: true,
      }),
    ).toBeEnabled();
    await expect(page.locator('.device-links a')).toHaveCount(0);
    expect(await page.evaluate(() => window.recoveryDevice.requests)).toEqual([
      identify,
      status,
      status,
    ]);
    expect(await page.evaluate(() => window.recoveryDevice.closes)).toBe(0);
  });
}

for (const discovery of ['existing', 'unrecognized', 'unreadable', 'status-only'] as const) {
  test(`connection remains available without a release for ${discovery} firmware`, async ({
    page,
  }) => {
    await fakeSerialDevice(page, discovery === 'existing' ? {} : { discovery });
    await page.route('**/install/', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /data-release-selection="[^"]*"/,
        'data-release-selection="{&quot;schema&quot;:1,&quot;release&quot;:null}"',
      );
      await route.fulfill({ response, body });
    });
    await page.goto('/install/');
    await expect(page.getByRole('button', { name: 'Choose USB device' })).toBeEnabled();
    await expect(page.getByText('New installation is unavailable.', { exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.recoveryDevice)).opens).toBe(0);
    await page.getByRole('button', { name: 'Choose USB device' }).click();
    if (discovery === 'existing' || discovery === 'status-only') {
      await expect(
        page.getByRole('heading', { name: 'Your OpenAthan is connected' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Open device settings', exact: true }),
      ).toBeVisible();
    } else if (discovery === 'unrecognized') {
      await expect(
        page.getByRole('heading', { name: 'New installation is unavailable' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Retry connection', exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole('status')).toContainText(
        'recognized, but its status could not be read',
      );
    }
    await expect(page.getByLabel(/I have an AtomS3R/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(
      0,
    );
    expect((await page.evaluate(() => window.recoveryDevice)).requests).toEqual([identify, status]);
  });
}
