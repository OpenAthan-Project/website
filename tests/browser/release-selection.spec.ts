import { expect, test } from '@playwright/test';

test('published installation requires an explicit USB request', async ({ page, request }) => {
  let requests = 0;
  await page.exposeFunction('recordUsbRequest', () => {
    requests++;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: async () => {
          await (window as unknown as { recordUsbRequest: () => Promise<void> }).recordUsbRequest();
          throw new DOMException('No device selected', 'NotFoundError');
        },
      },
    });
  });
  await page.goto('/install/');
  const install = page.getByRole('button', {
    name: /^(Install a new device|Installation unavailable)$/,
  });
  const served = await (await request.get('/release.json')).json();
  if (served.release) await expect(install).toBeEnabled();
  else await expect(install).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Choose USB device' })).toHaveCount(0);
  expect(requests).toBe(0);
  if (served.release) await install.click();
  else await page.getByRole('button', { name: 'Open recovery', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect your device' })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Choose USB device' }).click();
  await expect(page.getByRole('status')).toContainText('No device selected.');
  expect(requests).toBe(1);
  await expect(page.getByRole('button', { name: 'Install OpenAthan', exact: true })).toHaveCount(0);
});

test('served metadata, version labels, release links and installer use one selection', async ({
  page,
  request,
}) => {
  const response = await request.get('/release.json');
  expect(response.ok()).toBe(true);
  const served = await response.json();
  expect(served.schema).toBe(1);
  expect(served.websiteCommit).toMatch(/^[a-f0-9]{40}$/);
  for (const path of ['/', '/docs/', '/docs/getting-started/']) {
    await page.goto(path);
    await expect(page.locator('.notice strong').first()).toContainText(
      served.release ? served.release.tag : 'unavailable',
    );
    if (path !== '/' && served.release)
      await expect(
        page.locator(
          `a[href="https://github.com/OpenAthan-Project/openathan/releases/tag/${served.release.tag}"]`,
        ),
      ).toBeVisible();
  }
  await page.goto('/install/');
  const selected = JSON.parse(
    (await page.locator('[data-real-installer]').getAttribute('data-release-selection'))!,
  );
  expect(selected.release?.tag).toBe(served.release?.tag);
  expect(selected.release?.manifestSha256).toBe(served.release?.manifestSha256);
  expect(selected.websiteCommit).toBe(served.websiteCommit);
  if (!served.release) return;
  const manifest = await request.get(`/releases/${served.release.tag}/manifest.json`);
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).tag).toBe(served.release.tag);
});

test('existing-owner update guidance is reachable by keyboard and retains the location helper', async ({
  page,
}) => {
  await page.goto('/docs/');
  await page.getByRole('link', { name: 'Update an existing speaker' }).press('Enter');
  await expect(page).toHaveURL(/#firmware-updates$/);
  await expect(page.locator('#firmware-updates')).toBeInViewport();
  await expect(page.getByText(/The update waits until playback finishes/)).toBeVisible();
  await expect(page.getByText(/On v0.2.0, update checks may fail/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'preserving upgrade guide' })).toHaveAttribute(
    'href',
    'https://github.com/OpenAthan-Project/openathan/blob/v0.2.1/docs/development/firmware-upgrades.md#startup-recovery-and-existing-devices',
  );
  await expect(page.getByRole('link', { name: 'location helper', exact: true })).toHaveAttribute(
    'href',
    '/location/',
  );
  await page.goto('/docs/troubleshooting/');
  await page.getByRole('link', { name: 'firmware update instructions' }).press('Enter');
  await expect(page).toHaveURL(/#firmware-updates$/);
});

test('production preview excludes simulator routes', async ({ request }) => {
  test.skip(process.env.OPENATHAN_BROWSER_TEST_BUILT !== '1');
  expect((await request.get('/preview/installer/')).status()).toBe(404);
});
