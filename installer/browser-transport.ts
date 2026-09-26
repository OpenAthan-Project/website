import type { ByteTransport } from './session';

export function usbSupport(): string | null {
  if (!window.isSecureContext)
    return 'USB setup needs HTTPS or localhost. Open this page in a secure browser window.';
  if (!navigator.serial?.requestPort)
    return 'For USB setup, open this page on a computer in Chrome or Edge. You can read the documentation on this device.';
  return null;
}
export async function requestDevicePort(): Promise<SerialPort> {
  if (usbSupport()) throw new Error(usbSupport()!);
  return navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a, usbProductId: 0x1001 }] });
}

export class BrowserTransport implements ByteTransport {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private loop?: Promise<void>;
  private closing = false;
  private closed?: Promise<void>;
  private onBytes?: (bytes: Uint8Array) => void;
  private onDisconnect?: () => void;
  private constructor(private port: SerialPort) {}
  static async open(port: SerialPort): Promise<BrowserTransport> {
    await port.open({ baudRate: 115200, flowControl: 'none' });
    const transport = new BrowserTransport(port);
    try {
      // No deliberate reset sequence for command-only recovery. Opening USB can still
      // affect connectivity on this hardware; retain one session for the transaction.
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      if (!port.readable || !port.writable) throw new Error('USB streams are unavailable.');
      transport.reader = port.readable.getReader();
      transport.writer = port.writable.getWriter();
      return transport;
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }
  listen(onBytes: (bytes: Uint8Array) => void, onDisconnect: () => void): () => void {
    if (this.loop) throw new Error('USB input already has an owner.');
    this.onBytes = onBytes;
    this.onDisconnect = onDisconnect;
    this.loop = this.read();
    return () => {
      this.onBytes = undefined;
      this.onDisconnect = undefined;
    };
  }
  private async read(): Promise<void> {
    try {
      while (!this.closing) {
        const result = await this.reader!.read();
        if (result.done) break;
        this.onBytes?.(result.value);
      }
    } catch {
      /* Report only a generic disconnect; never expose serial payloads. */
    } finally {
      this.reader?.releaseLock();
      this.reader = undefined;
      if (!this.closing) this.onDisconnect?.();
    }
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.closing || !this.writer) throw new Error('USB connection is closed.');
    await this.writer.write(bytes);
  }
  close(): Promise<void> {
    return (this.closed ??= this.release());
  }
  private async release(): Promise<void> {
    this.closing = true;
    await this.reader?.cancel().catch(() => undefined);
    await this.loop;
    this.reader?.releaseLock();
    this.reader = undefined;
    // Abort queued output before releasing ownership. A timed-out command must
    // not remain queued for transmission after another owner opens the port.
    await this.writer?.abort().catch(() => undefined);
    this.writer?.releaseLock();
    this.writer = undefined;
    await this.port.close();
  }
}
