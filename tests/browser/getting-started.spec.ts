import { expect, test } from '@playwright/test';
import { AUDIO_BOARD, WAVESHARE } from '../../installer/release';

const guide = '/docs/getting-started/';
const audio = 'Waveshare AUDIO-Board';
const box = 'Waveshare Box V2';
const atom = 'M5Stack AtomS3R + Voice Pyramid';

test('model links carry the correct USB and phone steps through setup without changing owner help', async ({
  page,
  browserName,
}) => {
  await page.goto(guide);
  await expect(page.getByRole('heading', { name: `Setup for ${audio}` })).toBeVisible();
  const ownerModel = page.getByLabel('Your existing speaker');
  const linkTab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  await expect(ownerModel).toHaveValue('');
  await page.getByText('Find your speaker’s settings', { exact: true }).click();
  await expect(page.getByText(/Choose your model above to see/)).toBeVisible();
  await ownerModel.selectOption(WAVESHARE);
  await expect(page.getByText(/addresses on the same screen/)).toBeVisible();
  await expect(page.getByText(/The AUDIO-Board has no screen/)).toBeHidden();
  await expect(page.getByRole('heading', { name: `Setup for ${audio}` })).toBeVisible();

  for (const [model, anchor, connect, power, join] of [
    [
      box,
      'waveshare-setup',
      /Use the Box V2’s rear USB-C port/,
      /Power the Box V2 through its rear USB-C port/,
      /briefly press BOOT to show the Wi-Fi QR code/,
    ],
    [
      atom,
      'atom-setup',
      /use only the Atom’s own USB-C port/,
      /Use only the Pyramid’s bottom USB-C port/,
      /briefly press the Atom’s front button to show the Wi-Fi QR code/,
    ],
    [
      audio,
      'audio-board-setup',
      /Use the AUDIO-Board’s USB-C port/,
      /Power the AUDIO-Board through its USB-C port/,
      /Keep other unconfigured OpenAthan speakers unplugged/,
    ],
  ] as const) {
    const choice = page.getByRole('link', { name: `Show setup steps for ${model}` });
    await choice.focus();
    await choice.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#${anchor}$`));
    await expect(choice).toHaveAttribute('aria-current', 'true');
    const setup = page.locator(`#${anchor}`);
    await expect(setup.getByRole('heading', { name: `Setup for ${model}` })).toBeFocused();
    await expect(setup).toBeInViewport();
    await expect(setup.getByText(/desktop Chrome or Edge.*2\.4 GHz/)).toBeVisible();
    await expect(setup.getByText(connect)).toBeVisible();
    await page.keyboard.press(linkTab);
    await expect(setup.getByRole('link', { name: 'Choose a different speaker' })).toBeFocused();

    const wifi = page.locator('#phone-setup');
    await expect(wifi.getByText(power).first()).toBeVisible();
    await expect(wifi.getByText(join)).toBeVisible();
    for (const unused of [audio, box, atom].filter((name) => name !== model)) {
      await expect(page.getByRole('heading', { name: `Setup for ${unused}` })).toBeHidden();
      await expect(wifi.getByText(`${unused}.`, { exact: true }).first()).toBeHidden();
    }
    await wifi.getByText('Finish Wi-Fi setup on this computer instead', { exact: true }).click();
    await expect(wifi.getByText(power)).toHaveCount(2);
    await expect(wifi.getByText(power).last()).toBeVisible();
    await wifi.getByText('Finish Wi-Fi setup on this computer instead', { exact: true }).click();

    await expect(ownerModel).toHaveValue(WAVESHARE);
    await expect(page.getByText(/addresses on the same screen/)).toBeVisible();
  }

  await ownerModel.selectOption(AUDIO_BOARD);
  await expect(page.getByText(/The AUDIO-Board has no screen/)).toBeVisible();
  await expect(page.getByText(/addresses on the same screen/)).toBeHidden();
  await expect(page.getByRole('heading', { name: `Setup for ${audio}` })).toBeVisible();
});

test('legacy fragments reveal the appropriate model or help and generic phone entry gives each model a path', async ({
  page,
}) => {
  await page.goto(`${guide}#phone-setup`);
  const wifi = page.locator('#phone-setup');
  await expect(wifi.getByRole('heading', { name: /Connect the speaker/ })).toBeInViewport();
  await expect(wifi.getByRole('link', { name: 'choose your speaker', exact: true })).toBeVisible();
  for (const name of [audio, box, atom]) {
    await expect(wifi.getByText(`${name}.`, { exact: true }).first()).toBeVisible();
  }
  await expect(wifi.getByText(/Save it before choosing Connect speaker/)).toBeVisible();

  for (const [fragment, expected] of [
    ['audio-board-setup', `Setup for ${audio}`],
    ['waveshare-setup', `Setup for ${box}`],
    ['find-speaker-page', 'Continue to device settings'],
    ['firmware-updates', 'Check for updates'],
    ['other-hardware', 'Firmware architecture and hardware adapters'],
  ] as const) {
    await page.goto(`${guide}#${fragment}`);
    const target = page.locator(`#${fragment}`);
    await expect(target).toHaveCount(1);
    await expect(target).toBeInViewport();
    await expect(page.getByText(expected, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Your existing speaker')).toHaveValue('');
  }
});

test('repeat model navigation and Back and Forward retain their destinations and owner choice', async ({
  page,
}) => {
  await page.goto(guide);
  await page.getByLabel('Your existing speaker').selectOption(AUDIO_BOARD);
  const boxChoice = page.getByRole('link', { name: `Show setup steps for ${box}` });
  const boxHeading = page.getByRole('heading', { name: `Setup for ${box}` });
  await boxChoice.click();
  await expect(boxHeading).toBeInViewport();
  await page.getByRole('link', { name: 'Choose a different speaker' }).click();
  await boxChoice.click();
  await expect(boxHeading).toBeInViewport();
  await boxChoice.click();
  await expect(boxHeading).toBeFocused();
  await expect(boxHeading).toBeInViewport();

  await page.getByRole('link', { name: `Show setup steps for ${atom}` }).click();
  const atomHeading = page.getByRole('heading', { name: `Setup for ${atom}` });
  await expect(atomHeading).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(/#waveshare-setup$/);
  await expect(boxHeading).toBeInViewport();
  await page.goForward();
  await expect(page).toHaveURL(/#atom-setup$/);
  await expect(atomHeading).toBeInViewport();
  await expect(page.getByLabel('Your existing speaker')).toHaveValue(AUDIO_BOARD);
  await page.getByText('Find your speaker’s settings', { exact: true }).click();
  await expect(page.getByText(/The AUDIO-Board has no screen/)).toBeVisible();
});

for (const retainBox of [true, false]) {
  test(`Back to phone setup restores ${retainBox ? 'Box V2 steps' : 'all model options'}`, async ({
    page,
  }) => {
    if (retainBox) {
      await page.goto(guide);
      await page.getByRole('link', { name: `Show setup steps for ${box}` }).click();
      await page.getByRole('link', { name: /Continue to phone setup/ }).click();
    } else {
      await page.goto(`${guide}#phone-setup`);
    }
    await expect(page).toHaveURL(/#phone-setup$/);
    const ownerModel = page.getByLabel('Your existing speaker');
    await ownerModel.selectOption(AUDIO_BOARD);
    await page.getByRole('link', { name: `Show setup steps for ${atom}` }).click();
    await expect(page.getByRole('heading', { name: `Setup for ${atom}` })).toBeInViewport();

    await page.goBack();
    await expect(page).toHaveURL(/#phone-setup$/);
    const wifi = page.locator('#phone-setup');
    await expect(wifi.getByRole('heading', { name: /Connect the speaker/ })).toBeInViewport();
    await expect(wifi.getByText(`${box}.`, { exact: true }).first()).toBeVisible();
    const atomSteps = wifi.getByText(`${atom}.`, { exact: true }).first();
    const audioSteps = wifi.getByText(`${audio}.`, { exact: true }).first();
    const prompt = wifi.getByRole('link', { name: 'choose your speaker', exact: true });
    if (retainBox) {
      await expect(atomSteps).toBeHidden();
      await expect(audioSteps).toBeHidden();
      await expect(prompt).toBeHidden();
    } else {
      await expect(atomSteps).toBeVisible();
      await expect(audioSteps).toBeVisible();
      await expect(prompt).toBeVisible();
    }

    await page.goForward();
    await expect(page).toHaveURL(/#atom-setup$/);
    await expect(wifi.getByText(`${atom}.`, { exact: true }).first()).toBeVisible();
    await expect(wifi.getByText(`${box}.`, { exact: true }).first()).toBeHidden();
    await expect(ownerModel).toHaveValue(AUDIO_BOARD);
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('comparison links, phone alternatives, and native owner help remain usable', async ({
    page,
  }) => {
    await page.goto(guide);
    await expect(page.getByLabel('Your existing speaker')).toBeHidden();
    await page.getByRole('link', { name: `Show setup steps for ${atom}` }).click();
    await expect(page).toHaveURL(/#atom-setup$/);
    await expect(page.getByRole('heading', { name: `Setup for ${atom}` })).toBeInViewport();
    await expect(page.getByRole('img', { name: /Connect the computer to the Atom/ })).toBeVisible();
    await page
      .locator('#atom-setup')
      .getByRole('link', { name: /Continue to phone setup/ })
      .click();
    await expect(page.getByRole('heading', { name: /Connect the speaker/ })).toBeInViewport();
    await expect(page.getByRole('img', { name: /Unplug the Atom’s USB cable/ })).toBeVisible();
    await expect(page.getByText(/The temporary 192.168.4.1 address/)).toBeVisible();
    await page.goto(`${guide}#find-speaker-page`);
    const disclosure = page.locator('#find-speaker-page');
    await expect(disclosure).toBeInViewport();
    await disclosure.click();
    await expect(page.getByText(/The AUDIO-Board has no screen/)).toBeVisible();
    await expect(page.getByText(/addresses on the same screen/)).toBeVisible();
    await expect(page.getByText(/Press again to see the addresses/)).toBeVisible();
  });
});
