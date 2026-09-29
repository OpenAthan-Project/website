import { Transport } from 'esptool-js';

/** Keep esptool-js framing while bounding physical-disconnect handling. */
export class FlashTransport extends Transport {
  private failure?: Error;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private readonly interrupted: Promise<never>;
  private interrupt!: (error: Error) => void;
  private readonly disconnected = () => this.fail(new Error('The USB device disconnected.'));

  constructor(port: SerialPort) {
    super(port, false);
    this.interrupted = new Promise((_, reject) => {
      this.interrupt = reject;
    });
    // A disconnect may arrive between operations, before anything awaits it.
    void this.interrupted.catch(() => undefined);
    port.addEventListener('disconnect', this.disconnected);
  }

  private fail(cause: unknown): Error {
    if (!this.failure) {
      this.failure = new Error(
        'USB communication failed during installation. Unplug the cable, reload this page, then reconnect to try again.',
        { cause },
      );
      this.interrupt(this.failure);
      // Do not await abort: some drivers leave the in-flight write pending even
      // after physical loss. The raced write releases its lock independently.
      void this.writer?.abort(this.failure).catch(() => undefined);
    }
    return this.failure;
  }

  override async write(data: Uint8Array): Promise<void> {
    // The loader can retry a block. A failed connection must never resume output,
    // even if the cable is reconnected before the loader finishes unwinding.
    if (this.failure) throw this.failure;
    try {
      const stream = this.device.writable;
      if (!stream) throw new Error('USB output is unavailable.');
      const writer = stream.getWriter();
      this.writer = writer;
      try {
        await Promise.race([writer.write(this.slipWriter(data)), this.interrupted]);
        if (this.failure) throw this.failure;
      } finally {
        // Upstream only releases after a successful write; disconnect() then
        // waits forever for the leaked lock when a write rejects during unplug.
        writer.releaseLock();
        this.writer = undefined;
      }
    } catch (cause) {
      throw this.fail(cause);
    }
  }

  override async read(timeout: number): Promise<Uint8Array> {
    if (this.failure) throw this.failure;
    const bytes = await Promise.race([super.read(timeout), this.interrupted]);
    if (this.failure) throw this.failure;
    return bytes;
  }

  /** Final owner cleanup, separate from esptool's temporary baud-rate reconnects. */
  async close(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // connect() sets baudrate only after opening succeeds. Both streams can
      // become null on physical loss while the port still needs to be closed.
      if (this.baudrate !== 0)
        await Promise.race([
          this.disconnect(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(this.fail(new Error('USB cleanup timed out.'))), 5000);
          }),
        ]);
    } finally {
      clearTimeout(timer);
      this.device.removeEventListener('disconnect', this.disconnected);
    }
  }
}
