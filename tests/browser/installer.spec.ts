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
  await page.getByLabel('Speaker model').selectOption('atoms3r-c126-pyramid-a167');
  await page.getByLabel(/I have an? AtomS3R/).check();
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
  if (!(await page.locator('.recovery-disclosure').evaluate((el) => el.hasAttribute('open'))))
    await page.locator('.recovery-disclosure summary').click();
  await page.getByRole('button', { name: 'Change Wi-Fi' }).click();
  await saveWifi(page);
  await expect(page.getByRole('status')).toHaveText('Wi-Fi saved.');
  if (!(await page.locator('.recovery-disclosure').evaluate((el) => el.hasAttribute('open'))))
    await page.locator('.recovery-disclosure summary').click();
  await page.getByRole('button', { name: 'Reset device password' }).click();
  await page.getByLabel('Device password', { exact: true }).fill('another made-up password');
  await page.getByLabel('Repeat password').fill('another made-up password');
  await page.getByRole('button', { name: 'Save device password' }).click();
  await expect(page.getByRole('status')).toContainText('Device password saved.');
  await page.getByRole('button', { name: 'Continue to device settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Continue on speaker power' })).toBeVisible();
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
  if (!(await page.locator('.recovery-disclosure').evaluate((el) => el.hasAttribute('open'))))
    await page.locator('.recovery-disclosure summary').click();
  await page.getByRole('button', { name: 'Change Wi-Fi' }).click();
  await saveWifi(page);
  await expect(page.getByRole('status')).toContainText('Previous saved credentials were retained');
  await expect(page.getByLabel('Wi-Fi password', { exact: true })).toHaveValue('');
});
test('disconnect leaves actionable guidance and no further mutation', async ({ page }) => {
  await demo(page, 'disconnect');
  await connect(page);
  if (!(await page.locator('.recovery-disclosure').evaluate((el) => el.hasAttribute('open'))))
    await page.locator('.recovery-disclosure summary').click();
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
  if (!(await page.locator('.recovery-disclosure').evaluate((el) => el.hasAttribute('open'))))
    await page.locator('.recovery-disclosure summary').click();
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
  if (!(await page.locator('.recovery-disclosure').evaluate((el) => el.hasAttribute('open'))))
    await page.locator('.recovery-disclosure summary').click();
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
  await page.getByLabel('Speaker model').selectOption('atoms3r-c126-pyramid-a167');
  await page.getByLabel(/I have an? AtomS3R/).check();
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

for (const action of ['Back to connection']) {
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
    await page.getByLabel('Speaker model').selectOption('atoms3r-c126-pyramid-a167');
    await page.getByLabel(/I have an? AtomS3R/).check();
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

test('Waveshare fresh installation requires model selection and a renewed erase confirmation', async ({
  page,
}) => {
  await demo(page, 'waveshare-new');
  await connect(page);
  const installButton = page.getByRole('button', { name: 'Install OpenAthan', exact: true });
  await expect(installButton).toBeDisabled();
  await page.getByLabel('Speaker model').selectOption('waveshare-esp32-s3-touch-lcd-1_85c-box-v2');
  await page.getByLabel(/I have a Waveshare Box V2/).check();
  await expect(installButton).toBeEnabled();
  await page.getByLabel('Speaker model').selectOption('atoms3r-c126-pyramid-a167');
  await expect(installButton).toBeDisabled();
  await page.getByLabel('Speaker model').selectOption('waveshare-esp32-s3-touch-lcd-1_85c-box-v2');
  await page.getByLabel(/I have a Waveshare Box V2/).check();
  await installButton.click();
  await expect(page.getByRole('heading', { name: 'Connect to your Wi-Fi' })).toBeVisible();
  await saveWifi(page);
  await page.getByLabel('Device password', { exact: true }).fill('made-up device secret');
  await page.getByLabel('Repeat password').fill('made-up device secret');
  await page.getByRole('button', { name: 'Save device password' }).click();
  await expect(page.getByText('Use the Waveshare rear USB-C port for normal power.')).toBeVisible();
  await expect(page.getByText(/Pyramid’s bottom USB-C power/)).toHaveCount(0);
});

test('recognized Waveshare uses its identity without fresh-install choices', async ({ page }) => {
  await demo(page, 'waveshare');
  await connect(page);
  await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeVisible();
  await expect(
    page.locator('[data-panel]').getByText('Waveshare Box V2', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Speaker model')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(0);
});

type StatusFailure = 'storage' | 'password' | 'setup' | 'read';

declare global {
  interface Window {
    setupHandoffTest: {
      writes: string[];
      disconnect(): void;
      failClose(): void;
      configureElsewhere(): void;
      failStatus(failure: StatusFailure): void;
      deferStatus(): void;
      releaseStatus(): void;
      statusPending: boolean;
    };
  }
}

async function phonePreview(page: Page, waveshare = false, disconnectAtCompletion = false) {
  await demo(page);
  // Mount the actual UI and simulator, with test-only failure controls. No serial API.
  await page.evaluate(
    async ({ waveshare, disconnectAtCompletion }) => {
      const uiPath = '/installer/ui.ts';
      const simulatorPath = '/installer/simulator.ts';
      const { mountInstaller } = await import(/* @vite-ignore */ uiPath);
      const { SimulatorService } = await import(/* @vite-ignore */ simulatorPath);
      const service = new SimulatorService(waveshare ? 'phone-waveshare-new' : 'phone-new');
      const install = service.install.bind(service);
      service.install = async (...args: unknown[]) => {
        const result = await install(...args);
        if (disconnectAtCompletion) service.onDisconnect?.();
        return result;
      };
      const root = document.querySelector<HTMLElement>('[data-demo-installer]')!;
      const next = root.cloneNode(true) as HTMLElement;
      root.replaceWith(next);
      const writes: string[] = [];
      const readStatus = service.status.bind(service);
      let configuredElsewhere = false;
      let statusFailure: StatusFailure | undefined;
      let statusGate: Promise<void> | undefined;
      let releaseStatus: (() => void) | undefined;
      service.status = async () => {
        const status = await readStatus();
        if (statusGate) {
          window.setupHandoffTest.statusPending = true;
          await statusGate;
          window.setupHandoffTest.statusPending = false;
          statusGate = undefined;
        }
        if (statusFailure === 'read') throw new Error('Test status read failure');
        if (statusFailure === 'storage') return { ...status, storage: 'fault' };
        if (statusFailure === 'password') return { ...status, password: 'fault' };
        if (statusFailure === 'setup') return { ...status, setup: 'storage_fault' };
        return configuredElsewhere
          ? { ...status, wifi: '4', password: 'ready', passwordRevision: 1 }
          : status;
      };
      for (const kind of ['wifi', 'password'] as const) {
        const original = service[kind].bind(service);
        service[kind] = (...args: string[]) => {
          writes.push(kind);
          return original(...args);
        };
      }
      const close = service.close.bind(service);
      let failClose = false;
      service.close = async () => {
        await close();
        if (failClose) {
          service.onDisconnect?.();
          throw new Error('Test cleanup failure');
        }
      };
      window.setupHandoffTest = {
        writes,
        disconnect: () => service.onDisconnect?.(),
        failClose: () => {
          failClose = true;
        },
        configureElsewhere: () => {
          configuredElsewhere = true;
        },
        failStatus: (failure) => {
          statusFailure = failure;
        },
        deferStatus: () => {
          statusGate = new Promise((resolve) => {
            releaseStatus = resolve;
          });
        },
        releaseStatus: () => releaseStatus!(),
        statusPending: false,
      };
      mountInstaller(next, service);
    },
    { waveshare, disconnectAtCompletion },
  );
  await connect(page);
  await page
    .getByLabel('Speaker model')
    .selectOption(
      waveshare ? 'waveshare-esp32-s3-touch-lcd-1_85c-box-v2' : 'atoms3r-c126-pyramid-a167',
    );
  await page.getByLabel(/I have an? /).check();
  await page.getByRole('button', { name: 'Install OpenAthan', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: disconnectAtCompletion ? 'Set up with your phone' : 'OpenAthan installed',
      exact: true,
    }),
  ).toBeFocused();
}

test('disconnect queued with a completed install keeps the verified phone handoff', async ({
  page,
}) => {
  await phonePreview(page, false, true);
  await expect(page.getByText(/only the Pyramid’s bottom USB-C power/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connection lost' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Continue on this computer', exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
});

for (const action of ['Set up with your phone', 'Continue on this computer', 'Back']) {
  test(`${action} observes external enrollment and revokes deferred AP setup`, async ({ page }) => {
    await phonePreview(page);
    if (action === 'Back') {
      await page.getByRole('button', { name: 'Continue on this computer', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Connect to your Wi-Fi', exact: true }),
      ).toBeVisible();
    }
    await page.evaluate(() => window.setupHandoffTest.configureElsewhere());
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your OpenAthan is connected', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Set up with your phone', exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
    await page.evaluate(() => window.setupHandoffTest.disconnect());
    await expect(page.getByRole('heading', { name: 'Connection lost', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Set up with your phone', exact: true }),
    ).toHaveCount(0);
  });
}

for (const waveshare of [false, true]) {
  for (const action of ['Set up with your phone', 'Continue on this computer', 'Back']) {
    for (const failure of ['storage', 'password', 'setup', 'read'] as const) {
      test(`${waveshare ? 'Waveshare' : 'Atom'} ${action} preserves ${failure} status guidance after unplug`, async ({
        page,
      }) => {
        await phonePreview(page, waveshare);
        if (action === 'Back') {
          await page
            .getByRole('button', { name: 'Continue on this computer', exact: true })
            .click();
          await expect(
            page.getByRole('heading', { name: 'Connect to your Wi-Fi', exact: true }),
          ).toBeVisible();
        }
        await page.evaluate((failure) => window.setupHandoffTest.failStatus(failure), failure);
        await page.getByRole('button', { name: action, exact: true }).click();
        const heading = page.getByRole('heading', {
          name: failure === 'read' ? 'Check the device status' : 'The device needs attention',
          exact: true,
        });
        await expect(heading).toBeFocused();
        await expect(page.locator('[data-demo-installer]')).not.toHaveAttribute(
          'aria-busy',
          'true',
        );
        const guidance = await page.locator('[data-panel]').innerText();
        await page.evaluate(() => window.setupHandoffTest.disconnect());
        await expect(page.locator('[data-panel]')).toHaveText(guidance, { useInnerText: true });
        await expect(heading).toBeFocused();
        await expect(
          page.getByRole('heading', { name: 'Set up with your phone', exact: true }),
        ).toHaveCount(0);
        await expect(page.locator('[data-panel] input')).toHaveCount(0);
        expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
      });
    }
  }

  for (const outcome of [
    'healthy',
    'read',
    'configured',
    'storage',
    'password',
    'setup',
  ] as const) {
    test(`${waveshare ? 'Waveshare' : 'Atom'} pending phone handoff resolves ${outcome} status after unplug`, async ({
      page,
    }) => {
      await phonePreview(page, waveshare);
      await page.evaluate((outcome) => {
        window.setupHandoffTest.deferStatus();
        if (outcome === 'configured') window.setupHandoffTest.configureElsewhere();
        else if (outcome !== 'healthy') window.setupHandoffTest.failStatus(outcome);
      }, outcome);
      await page.getByRole('button', { name: 'Set up with your phone', exact: true }).click();
      await page.waitForFunction(() => window.setupHandoffTest.statusPending);
      await page.evaluate(() => window.setupHandoffTest.disconnect());
      await expect(
        page.getByRole('heading', { name: 'Set up with your phone', exact: true }),
      ).toBeFocused();
      await page.evaluate(() => window.setupHandoffTest.releaseStatus());
      await expect(page.locator('[data-demo-installer]')).not.toHaveAttribute('aria-busy', 'true');
      const heading = page.getByRole('heading', {
        name:
          outcome === 'healthy' || outcome === 'read'
            ? 'Set up with your phone'
            : outcome === 'configured'
              ? 'Connection lost'
              : 'The device needs attention',
        exact: true,
      });
      await expect(heading).toBeFocused();
      await page.evaluate(() => window.setupHandoffTest.disconnect());
      await expect(heading).toBeVisible();
      if (outcome !== 'healthy' && outcome !== 'read') {
        await expect(
          page.getByRole('heading', { name: 'Set up with your phone', exact: true }),
        ).toHaveCount(0);
      }
      expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
    });
  }
}

test('leaving a status error clears its disconnect protection for the next connection', async ({
  page,
}) => {
  await phonePreview(page);
  await page.evaluate(() => window.setupHandoffTest.failStatus('read'));
  await page.getByRole('button', { name: 'Set up with your phone', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Check the device status', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Disconnect and start again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect speaker', exact: true })).toBeFocused();
  await page.evaluate(() => window.setupHandoffTest.disconnect());
  await expect(page.getByRole('heading', { name: 'Connection lost', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
});

for (const waveshare of [false, true]) {
  test(`verified ${waveshare ? 'Waveshare' : 'Atom'} installation can defer all credentials and hand off to phone`, async ({
    page,
  }) => {
    await phonePreview(page, waveshare);
    await expect(page.getByText(/unplug the speaker now and set it up whenever/)).toBeVisible();
    await expect(page.locator('[data-panel] input')).toHaveCount(0);
    expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
    await page.getByRole('button', { name: 'Set up with your phone', exact: true }).press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Set up with your phone', exact: true }),
    ).toBeFocused();
    await expect(page.getByText('http://192.168.4.1/setup/', { exact: true })).toBeVisible();
    await expect(page.locator('[data-panel] a[href^="http:"]')).toHaveCount(0);
    await expect(page.getByText(/current IP address on the speaker’s screen/)).toBeVisible();
    if (waveshare) {
      await expect(
        page.getByText('Power the Waveshare through its rear USB-C port.'),
      ).toBeVisible();
      await expect(page.getByText(/Pyramid’s bottom USB-C power/)).toHaveCount(0);
    } else await expect(page.getByText(/only the Pyramid’s bottom USB-C power/)).toBeVisible();
    await page.evaluate(() => window.setupHandoffTest.disconnect());
    await expect(
      page.getByRole('heading', { name: 'Set up with your phone', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
    expect(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    ).toEqual({ local: 0, session: 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('unplugging at install completion keeps later phone setup available', async ({ page }) => {
  await phonePreview(page);
  await page.evaluate(() => window.setupHandoffTest.disconnect());
  await expect(
    page.getByRole('heading', { name: 'Set up with your phone', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connection lost' })).toHaveCount(0);
  expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
  await page.getByRole('button', { name: 'Back to connection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect speaker', exact: true })).toBeVisible();
  await page.evaluate(() => window.setupHandoffTest.disconnect());
  await expect(page.getByRole('heading', { name: 'Connection lost', exact: true })).toBeVisible();
});

test('cleanup failure and its queued disconnect preserve the phone power instructions', async ({
  page,
}) => {
  await phonePreview(page);
  await page.evaluate(() => window.setupHandoffTest.failClose());
  await page.getByRole('button', { name: 'Set up with your phone', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Set up with your phone', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('could not close the USB connection');
  await expect(page.getByText(/only the Pyramid’s bottom USB-C power/)).toBeVisible();
  expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
});

test('computer continuation keeps USB setup and removes phone deferral after Wi-Fi writes', async ({
  page,
}) => {
  await phonePreview(page);
  await page.getByRole('button', { name: 'Continue on this computer', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect to your Wi-Fi', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'OpenAthan installed', exact: true }),
  ).toBeFocused();
  expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual([]);
  await page.getByRole('button', { name: 'Continue on this computer', exact: true }).click();
  await saveWifi(page);
  await expect(page.getByRole('heading', { name: 'Create a device password' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your OpenAthan is connected' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Set up with your phone', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Create device password', exact: true }).click();
  await page.getByLabel('Device password', { exact: true }).fill('made-up device secret');
  await page.getByLabel('Repeat password').fill('made-up device secret');
  await page.getByRole('button', { name: 'Save device password' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for device setup' })).toBeVisible();
  await expect(page.getByText(/To find this page again/)).toBeVisible();
  expect(await page.evaluate(() => window.setupHandoffTest.writes)).toEqual(['wifi', 'password']);
});

test('AUDIO-Board requires explicit model confirmation and offers screenless phone setup', async ({
  page,
}, testInfo) => {
  await demo(page, 'phone-audio-board-new');
  await connect(page);
  const install = page.getByRole('button', { name: 'Install OpenAthan', exact: true });
  await expect(install).toBeDisabled();
  await page.getByLabel('Speaker model').selectOption('waveshare-esp32-s3-audio-board');
  await page.getByLabel(/I have a Waveshare AUDIO-Board/).check();
  await install.click();
  await page.getByRole('button', { name: 'Set up with your phone', exact: true }).click();
  await expect(page.getByText('http://192.168.4.1/setup/', { exact: true })).toBeVisible();
  await expect(page.getByText(/Bookmark the speaker’s address/)).toBeVisible();
  await expect(page.locator('[data-panel]')).not.toContainText(
    /QR|bottom power|front button|rear USB/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (['chromium', 'mobile'].includes(testInfo.project.name))
    await page.screenshot({
      path: `/private/tmp/openathan-audio-board-20261021/installer-${testInfo.project.name}.png`,
      fullPage: true,
    });
});
test('recognized AUDIO-Board preserves the existing-device path', async ({ page }) => {
  await demo(page, 'audio-board');
  await connect(page);
  await expect(
    page.locator('[data-panel]').getByText('Waveshare AUDIO-Board (no screen)', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Speaker model')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(0);
});
