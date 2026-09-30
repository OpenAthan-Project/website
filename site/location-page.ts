import {
  browserSuggestion,
  ipSuggestion,
  locationHandoffUrl,
  returnAddressFromHash,
  type LocationSuggestion,
} from './location-helper';

const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const button = get<HTMLButtonElement>('find-location');
const status = get<HTMLParagraphElement>('location-status');
const result = get<HTMLElement>('location-result');
const manual = get<HTMLParagraphElement>('manual-location');
const returnLink = get<HTMLAnchorElement>('return-device');
const useLink = get<HTMLAnchorElement>('use-location');
const device = returnAddressFromHash(window.location.hash);

if (window.location.hash)
  history.replaceState(null, '', window.location.pathname + window.location.search);
if (device) {
  returnLink.href = device.href;
  returnLink.hidden = false;
}

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function browserLocation(): Promise<LocationSuggestion> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(new Error('Browser location unavailable.'));
      return;
    }
    let settled = false;
    const finish = (value: LocationSuggestion | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const watchdog = setTimeout(() => finish(new Error('Browser location timed out.')), 12000);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          try {
            finish(browserSuggestion(position));
          } catch (error) {
            finish(error as Error);
          }
        },
        () => finish(new Error('Browser location unavailable.')),
        { maximumAge: 60000, timeout: 10000 },
      );
    } catch (error) {
      finish(error as Error);
    }
  });
}

async function approximateLocation(): Promise<LocationSuggestion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('https://get.geojs.io/v1/ip/geo.json', {
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('IP location unavailable.');
    return ipSuggestion(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function showSuggestion(value: LocationSuggestion): void {
  result.hidden = false;
  manual.hidden = true;
  get<HTMLInputElement>('location-latitude').value = String(value.latitude);
  get<HTMLInputElement>('location-longitude').value = String(value.longitude);
  get<HTMLInputElement>('location-timezone').value = value.timezone || 'Choose on your device';
  get<HTMLParagraphElement>('location-source').textContent =
    value.source === 'browser'
      ? 'Source: your browser’s location'
      : 'Source: approximate IP location from GeoJS';
  get<HTMLParagraphElement>('location-accuracy').textContent =
    value.source === 'browser'
      ? Number.isFinite(value.accuracy)
        ? `Reported accuracy: within ${Math.ceil(value.accuracy!)} metres.`
        : 'Accuracy was not reported.'
      : Number.isFinite(value.accuracy)
        ? `Estimated radius: ${Math.ceil(value.accuracy!)} km.`
        : 'An accuracy radius was not reported.';
  const caution = get<HTMLParagraphElement>('location-caution');
  caution.hidden = value.source !== 'ip';
  caution.textContent =
    value.source === 'ip'
      ? 'IP estimates can be far from the speaker, especially with a VPN or mobile connection. Check the location and timezone before saving.'
      : '';
  if (device) {
    useLink.href = locationHandoffUrl(device, value);
    useLink.hidden = false;
  }
  get<HTMLButtonElement>('copy-location').onclick = async () => {
    const text = `Latitude: ${value.latitude}\nLongitude: ${value.longitude}\nTimezone: ${value.timezone || '(choose on device)'}`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Values copied. Review them on your device before saving.');
    } catch {
      get<HTMLInputElement>('location-latitude').select();
      setStatus('Copy is unavailable here. Select and copy the values above.');
    }
  };
  setStatus('Location suggested. Review it before opening your device settings.');
}

button.addEventListener('click', async () => {
  button.disabled = true;
  result.hidden = true;
  manual.hidden = true;
  setStatus('Checking browser location…');
  try {
    let suggestion: LocationSuggestion;
    try {
      suggestion = await browserLocation();
    } catch {
      setStatus('Precise location unavailable. Checking an approximate IP location…');
      suggestion = await approximateLocation();
    }
    showSuggestion(suggestion);
  } catch {
    manual.hidden = false;
    setStatus('Could not find a location. Enter it manually on your device.', true);
  } finally {
    button.disabled = false;
  }
});
