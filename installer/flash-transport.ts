import { Transport } from 'esptool-js';

/** Keep esptool-js 0.7.0's framing, but release its writer on rejected USB writes. */
export class FlashTransport extends Transport {
  private writeFailure?: Error;

  override async write(data: Uint8Array): Promise<void> {
    // The loader can retry a block. A failed connection must never resume output,
    // even if the cable is reconnected before the loader finishes unwinding.
    if (this.writeFailure) throw this.writeFailure;
    try {
      const stream = this.device.writable;
      if (!stream) throw new Error('USB output is unavailable.');
      const writer = stream.getWriter();
      try {
        await writer.write(this.slipWriter(data));
      } finally {
        // Upstream only releases after a successful write; disconnect() then
        // waits forever for the leaked lock when a write rejects during unplug.
        writer.releaseLock();
      }
    } catch (cause) {
      this.writeFailure = new Error(
        'USB communication failed during installation. Reconnect the cable and start again.',
        { cause },
      );
      throw this.writeFailure;
    }
  }
}
