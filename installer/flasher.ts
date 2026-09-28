import { ESPLoader } from 'esptool-js';
import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { FlashTransport } from './flash-transport';
import { FLASH_BYTES, parseManifest, verifyBundle, type ReleaseBundle } from './release';

export interface Programmer {
  inspect(): Promise<{ chip: string; flashBytes: number; secured: boolean }>;
  write(bundle: ReleaseBundle, progress: (percent: number) => void): Promise<void>;
  digest(offset: number, bytes: number): Promise<string>;
  restart(): Promise<void>;
  close(): Promise<void>;
}
/** Also exercised with a fake programmer. Recovery and simulator never import this module. */
export async function flashBundle(
  programmer: Programmer,
  input: ReleaseBundle,
  confirmed: boolean,
  progress: (percent: number) => void,
): Promise<void> {
  let failed = false;
  try {
    if (!confirmed) throw new Error('Confirm a new installation before continuing.');
    const manifest = parseManifest(input.manifest, {
      tag: input.manifest.tag,
      manifestSha256: '0'.repeat(64),
      mediaReviewed: true,
      hardwareQualified: true,
    });
    const bundle = await verifyBundle(
      manifest,
      new Map(input.parts.map((part) => [part.metadata.file, part.bytes])),
    );
    const device = await programmer.inspect();
    if (device.chip !== 'ESP32-S3' || device.flashBytes !== FLASH_BYTES || device.secured)
      throw new Error(
        'This device does not match the supported unlocked 8 MB ESP32-S3 hardware. Nothing was installed.',
      );
    await programmer.write(bundle, progress);
    for (const part of bundle.parts) {
      const expected = bytesToHex(md5(part.bytes));
      if (
        (await programmer.digest(part.metadata.offset, part.bytes.length)).toLowerCase() !==
        expected
      )
        throw new Error(
          'Flash verification failed. Keep the cable connected and follow recovery guidance.',
        );
    }
    await programmer.restart();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await programmer.close();
    } catch (error) {
      // A removed port can also reject close; preserve the installation failure.
      if (!failed) throw error;
    }
  }
}

export function serialProgrammer(port: SerialPort): Programmer {
  const transport = new FlashTransport(port, false);
  const loader = new ESPLoader({
    transport,
    baudrate: 115200,
    debugLogging: false,
    terminal: { clean() {}, write() {}, writeLine() {} },
  });
  return {
    async inspect() {
      await loader.main();
      const info = await loader.getSecurityInfo();
      const size = await loader.detectFlashSize();
      return {
        chip: loader.chip.CHIP_NAME,
        flashBytes: size === '8MB' ? FLASH_BYTES : 0,
        secured:
          loader.secureDownloadMode ||
          info.parsedFlags.SECURE_BOOT_EN ||
          info.parsedFlags.SECURE_DOWNLOAD_ENABLE ||
          info.flashCryptCnt.toString(2).replaceAll('0', '').length % 2 === 1,
      };
    },
    async write(bundle, progress) {
      const total = bundle.parts.reduce((sum, part) => sum + part.bytes.length, 0);
      await loader.writeFlash({
        fileArray: bundle.parts.map((part) => ({
          data: part.bytes,
          address: part.metadata.offset,
        })),
        // A fresh installation explicitly replaces the entire device. Recovery never
        // calls this code. Keep the producer's validated image headers unchanged.
        eraseAll: true,
        compress: true,
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        calculateMD5Hash: (bytes) => bytesToHex(md5(bytes)),
        reportProgress: (index, written, fileTotal) => {
          const prior = bundle.parts
            .slice(0, index)
            .reduce((sum, part) => sum + part.bytes.length, 0);
          progress(
            Math.min(
              100,
              Math.round(
                ((prior + (written / fileTotal) * bundle.parts[index]!.bytes.length) / total) * 100,
              ),
            ),
          );
        },
      });
    },
    digest: (offset, bytes) => loader.flashMd5sum(offset, bytes),
    restart: () => loader.after('hard_reset'),
    async close() {
      // connect() sets baudrate only after opening succeeds. A fatal USB error
      // can null both streams while the port still needs to be closed.
      if (transport.baudrate !== 0) await transport.disconnect();
    },
  };
}
