import { parsePin, parseHardwareReleases } from './release';
import { usbSupport } from './browser-transport';
import { RealService } from './real-service';
import { mountInstaller } from './ui';

const root = document.querySelector<HTMLElement>('[data-real-installer]');
if (root) {
  try {
    mountInstaller(
      root,
      new RealService(
        parsePin(JSON.parse(root.dataset.releaseSelection ?? 'null')),
        JSON.parse(root.dataset.releaseSelection ?? 'null')?.usbUpdateEnabled === true,
        parseHardwareReleases(
          JSON.parse(root.dataset.releaseSelection ?? 'null')?.hardwareReleases,
        ),
      ),
      usbSupport(),
    );
  } catch {
    root.querySelector('[data-panel]')!.textContent =
      'The installer is temporarily unavailable. Please use the setup and troubleshooting documentation.';
  }
}
