import type { Page } from '@playwright/test';

type Fault = 'storage' | 'password' | 'setup';
type StatusOutcome = Fault | 'unreadable' | 'healthy';
interface DeviceFixture {
  wifi: string;
  password: string;
  setup: string;
  storage: string;
  passwordRevision: number;
  unreadable: boolean;
  requests: { extension: boolean; command: number }[];
  opens: number;
  closes: number;
}
declare global {
  interface Window {
    recoveryDevice: DeviceFixture;
  }
}

/** Fake Web Serial boundary; the page still uses RealService and ProvisioningSession. */
export async function fakeSerialDevice(
  page: Page,
  options: {
    offline?: boolean;
    save?: { reply: 'error255' | 'acknowledged' | 'lost'; status: StatusOutcome };
  } = {},
) {
  await page.addInitScript((options) => {
    const encoder = new TextEncoder();
    const device = (window.recoveryDevice = {
      wifi: options.offline ? '2' : '4',
      password: 'ready',
      setup: 'active',
      storage: 'ready',
      passwordRevision: 1,
      unreadable: false,
      requests: [],
      opens: 0,
      closes: 0,
    } as DeviceFixture);
    let input: ReadableStreamDefaultController<Uint8Array>;
    function frame(extension: boolean, type: number, payload: Uint8Array) {
      const bytes = new Uint8Array(payload.length + 11);
      bytes.set(encoder.encode(extension ? 'OATHAN' : 'IMPROV'));
      bytes.set([1, type, payload.length], 6);
      bytes.set(payload, 9);
      bytes[bytes.length - 2] = bytes.slice(0, -2).reduce((sum, byte) => sum + byte, 0) & 255;
      bytes[bytes.length - 1] = 10;
      input.enqueue(bytes.slice(0, 5));
      input.enqueue(bytes.slice(5));
    }
    function reply(extension: boolean, command: number, fields: string[]) {
      const values = fields.map((field) => encoder.encode(field));
      const payload = new Uint8Array(values.reduce((sum, field) => sum + field.length + 1, 2));
      payload.set([command, payload.length - 2]);
      let offset = 2;
      for (const field of values) {
        payload[offset++] = field.length;
        payload.set(field, offset);
        offset += field.length;
      }
      frame(extension, 4, payload);
    }
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      async open() {
        device.opens++;
        this.readable = new ReadableStream({
          start(controller) {
            input = controller;
          },
        });
        this.writable = new WritableStream({
          write(bytes) {
            // Record only command metadata, never payloads or credentials.
            const extension = bytes[0] === 79;
            const command = bytes[9]!;
            device.requests.push({ extension, command });
            if (!extension && command === 3) {
              reply(false, 3, ['OpenAthan', '1-dev', 'ESP32-S3', 'openathan-test.local']);
            } else if (extension && command === 1) {
              reply(
                true,
                1,
                device.unreadable
                  ? ['invalid status']
                  : [
                      '1',
                      device.wifi,
                      device.password,
                      device.setup,
                      String(device.passwordRevision),
                      'openathan-test.local',
                      device.storage,
                      ...(device.wifi === '4'
                        ? ['http://openathan-test.local/', 'http://192.168.1.42/']
                        : []),
                    ],
              );
            } else if ((!extension && command === 1) || (extension && command === 2)) {
              const save = options.save;
              if (!save) throw new Error('Unexpected credential write');
              if (save.reply !== 'error255' && extension) device.passwordRevision++;
              const outcome = save.status;
              if (outcome === 'unreadable') device.unreadable = true;
              else if (outcome === 'setup') device.setup = 'storage_fault';
              else if (outcome !== 'healthy') device[outcome] = 'fault';
              if (save.reply === 'error255') frame(extension, 2, new Uint8Array([255]));
              else if (save.reply === 'acknowledged')
                reply(
                  extension,
                  command,
                  extension ? ['saved', String(device.passwordRevision)] : [],
                );
            } else {
              throw new Error('Unexpected serial command');
            }
          },
        });
      },
      async setSignals() {},
      async close() {
        device.closes++;
        this.readable = this.writable = null;
      },
    };
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => port },
    });
  }, options);
}
