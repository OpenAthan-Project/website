import {
  FrameDecoder,
  decodeFields,
  encodeRequest,
  parseStatus,
  validatePassword,
  validateWifi,
  type DeviceStatus,
  type Frame,
} from './protocol';

/** A byte stream; implementations must never log payloads, which can contain passwords. */
export interface ByteTransport {
  write(bytes: Uint8Array): Promise<void>;
  listen(onBytes: (bytes: Uint8Array) => void, onDisconnect: () => void): () => void;
  close(): Promise<void>;
}
export class UncertainOutcome extends Error {
  constructor() {
    super(
      'No acknowledgement was received. The result is uncertain; the command was not repeated.',
    );
    this.name = 'UncertainOutcome';
  }
}
export class DeviceError extends Error {
  constructor(public readonly code: number) {
    super(
      (
        {
          1: 'The device rejected the input. Check the network or password.',
          2: 'This device does not support that command.',
          3: 'Wi-Fi could not connect. Previous saved credentials were retained.',
          255: 'The device is busy or storage is unavailable. Check status before another change.',
        } as Record<number, string>
      )[code] ?? 'The device rejected the command.',
    );
  }
}
interface Pending {
  extension: boolean;
  command: number;
  scan: boolean;
  mutation: boolean;
  results: string[][];
  resolve: (result: string[][]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ProvisioningSession {
  private decoder = new FrameDecoder();
  private pending?: Pending;
  private stopped = false;
  private readonly unlisten: () => void;
  /** Set after any uncertain write; no further mutation until the session is reopened. */
  uncertain = false;
  onDisconnect?: () => void;
  constructor(
    private transport: ByteTransport,
    private timeout = 40_000,
  ) {
    this.unlisten = transport.listen(
      (bytes) => {
        for (const frame of this.decoder.feed(bytes)) this.receive(frame);
      },
      () => {
        this.stopped = true;
        this.fail(
          this.pending?.mutation
            ? new UncertainOutcome()
            : new Error('Device disconnected. Reconnect the USB data cable.'),
        );
        this.onDisconnect?.();
      },
    );
  }
  private fail(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    if (error instanceof UncertainOutcome) this.uncertain = true;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.reject(error);
  }
  private receive(frame: Frame): void {
    const pending = this.pending;
    if (!pending || frame.extension !== pending.extension) return;
    if (frame.type === 2 && frame.payload.length === 1 && frame.payload[0]) {
      this.fail(new DeviceError(frame.payload[0]));
      return;
    }
    if (frame.type !== 4) return;
    try {
      const result = decodeFields(frame.payload);
      if (result.command !== pending.command) return;
      if (pending.scan && result.fields.length) {
        if (pending.results.length >= 32) throw new Error('Too many scan results.');
        pending.results.push(result.fields);
        return;
      }
      if (!pending.scan) pending.results.push(result.fields);
      clearTimeout(pending.timer);
      this.pending = undefined;
      pending.resolve(pending.results);
    } catch {
      this.fail(
        pending.mutation
          ? new UncertainOutcome()
          : new Error('Malformed device response. Reconnect and try again.'),
      );
    }
  }
  async command(
    extension: boolean,
    command: number,
    fields: readonly string[] = [],
    options: { scan?: boolean; mutation?: boolean } = {},
  ): Promise<string[][]> {
    if (this.stopped) throw new Error('Connect the device first.');
    if (this.pending) throw new Error('Another device action is still running.');
    if (options.mutation && this.uncertain)
      throw new Error('Reconnect and check status before another change.');
    const packet = encodeRequest(extension, command, fields);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          options.mutation
            ? new UncertainOutcome()
            : new Error(
                'The device did not respond. Check the cable and close other serial tools.',
              ),
        );
      }, this.timeout);
      const pending = {
        extension,
        command,
        scan: !!options.scan,
        mutation: !!options.mutation,
        results: [],
        resolve,
        reject,
        timer,
      };
      this.pending = pending;
      void this.transport
        .write(packet)
        .catch(() => {
          if (this.pending === pending)
            this.fail(
              options.mutation
                ? new UncertainOutcome()
                : new Error('USB connection failed. Reconnect the device.'),
            );
        })
        .finally(() => packet.fill(0));
    });
  }
  async identify(): Promise<void> {
    const [fields] = await this.command(false, 3);
    if (fields?.length !== 4 || fields[0] !== 'OpenAthan' || fields[2] !== 'ESP32-S3') {
      throw new Error(
        'OpenAthan firmware was not recognized. Recovery cannot install or erase firmware.',
      );
    }
  }
  async status(): Promise<DeviceStatus> {
    return parseStatus((await this.command(true, 1))[0]!);
  }
  async scan(): Promise<{ ssid: string; signal: number; secured: boolean }[]> {
    const results = await this.command(false, 4, [], { scan: true });
    return results.map(([ssid, signal, secured]) => {
      if (
        !ssid ||
        new TextEncoder().encode(ssid).length > 32 ||
        !/^-?\d+$/.test(signal ?? '') ||
        !['YES', 'NO'].includes(secured ?? '')
      )
        throw new Error('Invalid Wi-Fi scan response.');
      return { ssid, signal: Number(signal), secured: secured === 'YES' };
    });
  }
  async wifi(ssid: string, password: string): Promise<void> {
    validateWifi(ssid, password);
    await this.command(false, 1, [ssid, password], { mutation: true });
  }
  async password(password: string): Promise<number> {
    validatePassword(password);
    const [fields] = await this.command(true, 2, [password], { mutation: true });
    if (
      fields?.length !== 2 ||
      fields[0] !== 'saved' ||
      !/^\d+$/.test(fields[1]!) ||
      Number(fields[1]) < 1 ||
      Number(fields[1]) > 0xffffffff
    ) {
      this.uncertain = true;
      throw new UncertainOutcome();
    }
    return Number(fields[1]);
  }
  async close(): Promise<void> {
    this.stopped = true;
    this.fail(this.pending?.mutation ? new UncertainOutcome() : new Error('Connection closed.'));
    this.unlisten();
    this.decoder.reset();
    await this.transport.close();
  }
}
