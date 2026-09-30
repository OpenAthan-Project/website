import { describe, expect, it } from 'vitest';
import {
  deviceReturnUrl,
  ipSuggestion,
  locationHandoffUrl,
  returnAddressFromHash,
} from '../../site/location-helper';

describe('location handoff', () => {
  it('accepts only local OpenAthan return addresses', () => {
    for (const address of [
      'http://openathan-a1b2c3.local/',
      'http://192.168.2.16/',
      'http://10.0.0.4/',
    ]) {
      expect(deviceReturnUrl(address)?.href).toBe(address);
    }
    for (const address of [
      'https://openathan-a1b2c3.local/',
      'http://example.com/',
      'http://127.0.0.1/',
      'http://openathan-a1b2c3.local:8080/',
      'http://openathan-a1b2c3.local/path',
      'http://admin:password@openathan-a1b2c3.local/',
      'http://192.168.2.16/?x=1',
    ])
      expect(deviceReturnUrl(address)).toBeNull();
  });

  it('returns a versioned fragment without accepting a substituted destination', () => {
    const device = returnAddressFromHash('#v=1&device=http%3A%2F%2Fopenathan-a1b2c3.local%2F');
    expect(device?.href).toBe('http://openathan-a1b2c3.local/');
    const handoff = locationHandoffUrl(device!, {
      latitude: 44.4113861,
      longitude: -79.6819456,
      timezone: 'America/Toronto',
      source: 'browser',
      accuracy: 12,
    });
    expect(new URL(handoff).hash).toContain('latitude=44.4113861');
    expect(new URL(handoff).hash).toContain('source=browser');
    expect(returnAddressFromHash('#v=1&device=http%3A%2F%2Fevil.example%2F')).toBeNull();
    expect(
      returnAddressFromHash('#v=1&v=1&device=http%3A%2F%2Fopenathan-a1b2c3.local%2F'),
    ).toBeNull();
  });

  it('checks IP coordinates and carries the provider accuracy radius', () => {
    expect(
      ipSuggestion({ latitude: '0', longitude: '0', accuracy: 1000, timezone: 'UTC' }),
    ).toEqual({ latitude: 0, longitude: 0, accuracy: 1000, timezone: 'UTC', source: 'ip' });
    expect(() => ipSuggestion({ latitude: '999', longitude: '0' })).toThrow();
    expect(() => ipSuggestion({ latitude: '', longitude: '-80' })).toThrow();
    expect(() => ipSuggestion({ latitude: null, longitude: '-80' })).toThrow();
  });
});
