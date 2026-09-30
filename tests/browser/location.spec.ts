import { expect, test } from '@playwright/test';

const device = 'http://openathan-a1b2c3.local/';
const helperHash = `#v=1&device=${encodeURIComponent(device)}`;

test('precise browser location returns a reviewable proposal without an IP request', async ({
  page,
}) => {
  let ipCalls = 0;
  await page.route('https://get.geojs.io/**', (route) => {
    ipCalls++;
    return route.abort();
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 44.4113861, longitude: -79.6819456, accuracy: 14 },
          } as GeolocationPosition),
      },
    });
  });
  await page.goto(`/location/${helperHash}`);
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: 'Find location' }).click();
  await expect(page.getByText('Source: your browser’s location')).toBeVisible();
  await expect(page.getByText('Reported accuracy: within 14 metres.')).toBeVisible();
  expect(ipCalls).toBe(0);
  const returnUrl = new URL(
    (await page.getByRole('link', { name: 'Review on device' }).getAttribute('href')) || '',
  );
  expect(returnUrl.origin).toBe('http://openathan-a1b2c3.local');
  expect(new URLSearchParams(returnUrl.hash.slice(1)).get('latitude')).toBe('44.4113861');
});

test('permission denial automatically falls back to a labelled IP estimate', async ({ page }) => {
  let ipCalls = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) =>
          error({ code: 1, message: 'Denied' } as GeolocationPositionError),
      },
    });
  });
  await page.route('https://get.geojs.io/v1/ip/geo.json', (route) => {
    ipCalls++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        latitude: '43.7',
        longitude: '-79.4',
        accuracy: 1000,
        timezone: 'America/Toronto',
      }),
    });
  });
  await page.goto(`/location/${helperHash}`);
  await page.getByRole('button', { name: 'Find location' }).click();
  await expect(page.getByText('Source: approximate IP location from GeoJS')).toBeVisible();
  await expect(page.getByText('Estimated radius: 1000 km.')).toBeVisible();
  await expect(page.getByText(/IP estimates can be far from the speaker/)).toBeVisible();
  expect(ipCalls).toBe(1);
  const returnUrl = new URL(
    (await page.getByRole('link', { name: 'Review on device' }).getAttribute('href')) || '',
  );
  expect(new URLSearchParams(returnUrl.hash.slice(1)).get('source')).toBe('ip');
  expect(new URLSearchParams(returnUrl.hash.slice(1)).get('accuracy')).toBe('1000');
});

test('location timeout and offline provider leave manual setup available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) =>
          error({ code: 3, message: 'Timeout' } as GeolocationPositionError),
      },
    });
  });
  await page.route('https://get.geojs.io/**', (route) => route.abort('internetdisconnected'));
  await page.goto(`/location/${helperHash}`);
  await page.getByRole('button', { name: 'Find location' }).click();
  await expect(
    page.getByText('Could not find a location. Enter it manually on your device.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to device settings' })).toHaveAttribute(
    'href',
    device,
  );
  await expect(page.getByRole('link', { name: 'Review on device' })).toBeHidden();
});
