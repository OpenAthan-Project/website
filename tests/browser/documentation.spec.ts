import { expect, test } from '@playwright/test';

for (const [legacy, current, title] of [
  ['/guides/setup/', '/docs/getting-started/', 'Getting started'],
  ['/guides/recovery/', '/docs/troubleshooting/', 'Troubleshooting'],
] as const) {
  test(`legacy ${legacy} redirects with a static fallback`, async ({ page, request }) => {
    const response = await request.get(legacy);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain(`content="0;url=${current}"`);
    expect(html).toContain(`href="https://openathan.com${current}"`);
    expect(html).toContain(`href="${current}">${title}</a>`);
    await page.goto(legacy);
    await expect(page).toHaveURL(new RegExp(`${current}$`));
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  });
}

test('documentation and project navigation work with the keyboard on every viewport', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const name of ['Documentation', 'GitHub', 'USB setup']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  const documentation = nav.getByRole('link', { name: 'Documentation' });
  await documentation.focus();
  await documentation.press('Enter');
  await expect(page).toHaveURL(/\/docs\/$/);
  const troubleshooting = page.getByRole('link', { name: /^Troubleshooting/ });
  await troubleshooting.focus();
  await troubleshooting.press('Enter');
  await expect(page).toHaveURL(/\/docs\/troubleshooting\/$/);
  await page.getByRole('link', { name: 'Reset your password', exact: true }).press('Enter');
  await expect(page).toHaveURL(/#reset-password$/);
  await expect(page.locator('#reset-password')).toBeInViewport();
  for (const [label, anchor] of [
    ['Contributing', 'contributing'],
    ['Report an issue', 'report-an-issue'],
    ['License', 'licenses'],
  ]) {
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: label, exact: true })
      .press('Enter');
    await expect(page).toHaveURL(new RegExp(`/docs/#${anchor}$`));
    await expect(page.locator(`#${anchor}`)).toBeInViewport();
  }
  await expect(page.getByRole('link', { name: 'Device or firmware issues' })).toHaveAttribute(
    'href',
    'https://github.com/OpenAthan-Project/openathan/issues',
  );
  await expect(
    page.getByRole('link', { name: 'Website or browser installer issues' }),
  ).toHaveAttribute('href', 'https://github.com/OpenAthan-Project/website/issues');
});

test('public pages fit the viewport and diagrams explain both cable arrangements', async ({
  page,
}) => {
  for (const path of [
    '/',
    '/docs/',
    '/docs/getting-started/',
    '/docs/troubleshooting/',
    '/install/',
  ]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    // Ordinary navigation never promises a new tab. Device handoff links are tested separately.
    await expect(page.locator('a:not([target="_blank"])').filter({ hasText: '↗' })).toHaveCount(0);
    if (path === '/docs/getting-started/') {
      await expect(
        page.getByRole('img', { name: /Connect the computer to the Atom/ }),
      ).toBeVisible();
      await expect(page.getByRole('img', { name: /Unplug the Atom’s USB cable/ })).toBeVisible();
    }
  }
});
