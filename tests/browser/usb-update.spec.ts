import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

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
