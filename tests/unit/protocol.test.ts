import { describe, expect, it } from 'vitest';
import {
  FrameDecoder,
  decodeFields,
  encodeFrame,
  encodeRequest,
  localDeviceUrls,
  parseStatus,
  rpcPayload,
  validatePassword,
  validateWifi,
} from '../../installer/protocol';

describe('firmware protocol compatibility', () => {
  it('matches the independently specified Python GET_DEVICE_INFO fixture', () => {
    expect([...encodeRequest(false, 3)]).toEqual([73, 77, 80, 82, 79, 86, 1, 3, 2, 3, 0, 230, 10]);
  });
  it('decodes the existing Python saved-response fixture through boot noise and fragmentation', () => {
    const decoder = new FrameDecoder();
    const packet = encodeFrame(true, 4, new Uint8Array([2, 6, 5, 115, 97, 118, 101, 100]));
    const frames = [...new TextEncoder().encode('serial noise'), ...packet].flatMap((byte) =>
      decoder.feed(new Uint8Array([byte]), 10),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]?.extension).toBe(true);
    expect(decodeFields(frames[0]!.payload)).toEqual({ command: 2, fields: ['saved'] });
  });
  it('rejects checksums, wrong versions and expired partial frames, then resynchronizes', () => {
    const good = encodeRequest(true, 1),
      bad = good.slice();
    bad[bad.length - 2]! ^= 1;
    const decoder = new FrameDecoder();
    expect(decoder.feed(bad, 1)).toEqual([]);
    const version = good.slice();
    version[6] = 2;
    expect(decoder.feed(version, 2)).toEqual([]);
    decoder.feed(good.slice(0, 8), 3);
    expect(decoder.feed(good.slice(8), 2000)).toEqual([]);
    expect(decoder.feed(good, 2001)).toHaveLength(1);
  });
  it('rejects malformed UTF-8, truncated fields, nulls and oversized requests', () => {
    expect(() => decodeFields(new Uint8Array([1, 2, 4, 120]))).toThrow();
    expect(() => decodeFields(new Uint8Array([1, 2, 1, 255]))).toThrow();
    expect(() => rpcPayload(2, ['a'.repeat(254)])).toThrow();
    expect(() => rpcPayload(2, ['a\0b'])).toThrow();
    expect(() => rpcPayload(2, ['a'.repeat(150), 'b'.repeat(150)])).toThrow();
  });
  it('matches device input limits in bytes and printable ASCII', () => {
    expect(() => validateWifi('é'.repeat(16), 'a'.repeat(8))).not.toThrow();
    expect(() => validateWifi('é'.repeat(17), 'a'.repeat(8))).toThrow();
    expect(() => validateWifi('home', 'short')).toThrow();
    expect(() => validateWifi('home', 'é'.repeat(33))).toThrow();
    expect(() => validatePassword('long passphrase')).not.toThrow();
    expect(() => validatePassword('short')).toThrow();
    expect(() => validatePassword('long passphrase\n')).toThrow();
    expect(() => validatePassword('é'.repeat(20))).toThrow();
  });
  // Expected boundaries come from openathan_device/protocol.cpp::valid_wifi.
  it.each([
    ['7-byte passphrase', 'x'.repeat(7), false],
    ['8-byte passphrase', 'x'.repeat(8), true],
    ['63-byte passphrase', 'x'.repeat(63), true],
    ['64-byte non-hex passphrase', 'x'.repeat(64), false],
    ['64-digit hex key', '01234567'.repeat(8), true],
    ['mixed-case hex key', 'aBcDeF09'.repeat(8), true],
    ['hex key with a non-hex character', 'a'.repeat(63) + 'g', false],
    ['65-byte hex key', 'a'.repeat(65), false],
    ['8-byte Unicode passphrase', 'é'.repeat(4), true],
    ['63-byte Unicode passphrase', 'é'.repeat(31) + 'x', true],
    ['64-byte Unicode passphrase', 'é'.repeat(32), false],
    ['65-byte Unicode passphrase', 'é'.repeat(32) + 'x', false],
    ['embedded null', 'abcd\0efgh', false],
    ['significant spaces', '        ', true],
  ])('matches firmware Wi-Fi validation for %s', (_name, password, accepted) => {
    const validate = () => validateWifi('Test network', password);
    if (accepted) expect(validate).not.toThrow();
    else expect(validate).toThrow();
  });
  it.each([
    ['', false],
    ['a', true],
    ['a'.repeat(32), true],
    ['a'.repeat(33), false],
    ['é'.repeat(16), true],
    ['é'.repeat(17), false],
    ['home\0network', false],
  ])('matches firmware SSID boundaries for %j', (ssid, accepted) => {
    const validate = () => validateWifi(ssid, 'test password');
    if (accepted) expect(validate).not.toThrow();
    else expect(validate).toThrow();
  });
  it('matches both printable-ASCII device-password boundaries', () => {
    for (const size of [12, 128]) expect(() => validatePassword('x'.repeat(size))).not.toThrow();
    for (const size of [11, 129]) expect(() => validatePassword('x'.repeat(size))).toThrow();
  });
  it('parses status while keeping storage faults visible', () => {
    const status = parseStatus([
      '1',
      '4',
      'ready',
      'active',
      '3',
      'openathan-test.local',
      'fault',
      'http://openathan-test.local/',
      'http://192.168.1.5/',
    ]);
    expect(status.storage).toBe('fault');
    expect(status.passwordRevision).toBe(3);
    expect(status.urls).toHaveLength(2);
    expect(() =>
      parseStatus(['2', '4', 'ready', 'active', '3', 'openathan-test.local', 'ready']),
    ).toThrow();
    expect(() =>
      parseStatus(['1', '4', 'ready', 'active', '4294967296', 'openathan-test.local', 'ready']),
    ).toThrow();
  });
  it('does not turn untrusted device text into arbitrary links', () => {
    expect(
      localDeviceUrls(
        [
          'javascript:alert(1)',
          'http://evil.example/',
          'http://user:secret@192.168.1.2/',
          'http://192.168.1.2:8080/',
          'http://192.168.1.2/?secret=1',
          'http://192.168.1.2/',
          'http://openathan-a1b2c3.local/',
        ],
        'openathan-a1b2c3.local',
      ),
    ).toEqual(['http://192.168.1.2/', 'http://openathan-a1b2c3.local/']);
  });
});
