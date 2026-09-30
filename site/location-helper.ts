export type LocationSuggestion = {
  latitude: number;
  longitude: number;
  timezone?: string;
  source: 'browser' | 'ip';
  accuracy?: number;
};

export function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** A return link may point only at an OpenAthan hostname or a private device IPv4 address. */
export function deviceReturnUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const octets = url.hostname.split('.').map(Number);
    const ipv4 =
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
      octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    const privateIp =
      ipv4 &&
      (octets[0] === 10 ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
        (octets[0] === 169 && octets[1] === 254));
    if (
      url.protocol !== 'http:' ||
      (!/^openathan-[a-z0-9-]+\.local$/.test(url.hostname) && !privateIp) ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export function returnAddressFromHash(hash: string): URL | null {
  if (!hash.startsWith('#') || hash.length > 512) return null;
  const values = new URLSearchParams(hash.slice(1));
  if (
    [...values.keys()].some((key) => !['v', 'device'].includes(key)) ||
    values.getAll('v').length !== 1 ||
    values.getAll('device').length !== 1 ||
    values.get('v') !== '1'
  )
    return null;
  return deviceReturnUrl(values.get('device')!);
}

export function locationHandoffUrl(device: URL, suggestion: LocationSuggestion): string {
  if (
    !deviceReturnUrl(device.href) ||
    !validCoordinates(suggestion.latitude, suggestion.longitude)
  ) {
    throw new Error('Invalid device location handoff.');
  }
  const values = new URLSearchParams({
    v: '1',
    latitude: String(suggestion.latitude),
    longitude: String(suggestion.longitude),
    source: suggestion.source,
  });
  if (suggestion.timezone) values.set('timezone', suggestion.timezone);
  if (Number.isFinite(suggestion.accuracy)) values.set('accuracy', String(suggestion.accuracy));
  const url = new URL(device);
  url.hash = values.toString();
  return url.href;
}

export function browserSuggestion(position: GeolocationPosition): LocationSuggestion {
  const { latitude, longitude, accuracy } = position.coords;
  if (!validCoordinates(latitude, longitude)) throw new Error('Invalid browser coordinates.');
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* Leave it for review. */
  }
  return { latitude, longitude, accuracy, timezone, source: 'browser' };
}

export function ipSuggestion(data: unknown): LocationSuggestion {
  if (!data || typeof data !== 'object') throw new Error('Invalid IP location response.');
  const value = data as Record<string, unknown>;
  const latitude = Number(value.latitude),
    longitude = Number(value.longitude);
  if (
    (typeof value.latitude !== 'number' && typeof value.latitude !== 'string') ||
    (typeof value.longitude !== 'number' && typeof value.longitude !== 'string') ||
    value.latitude === '' ||
    value.longitude === '' ||
    !validCoordinates(latitude, longitude)
  )
    throw new Error('Invalid IP coordinates.');
  const accuracy = Number(value.accuracy);
  return {
    latitude,
    longitude,
    timezone: typeof value.timezone === 'string' ? value.timezone : undefined,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : undefined,
    source: 'ip',
  };
}
