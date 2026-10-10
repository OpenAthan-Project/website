import type { Hardware } from './release';
import type { DeviceStatus } from './protocol';
import type { FirmwareInfo, UpgradeCheck, UpgradeOffer } from './upgrade';
export type Connected =
  | { kind: 'unrecognized' }
  | { kind: 'existing'; status: DeviceStatus; hardware?: Hardware };
export interface InstallerService {
  readonly simulated: boolean;
  readonly installAvailable: boolean;
  readonly installHardware?: Hardware[];
  onDisconnect?: () => void;
  connect(): Promise<Connected>;
  install(
    confirmed: boolean,
    progress: (percent: number) => void,
    hardware?: Hardware,
  ): Promise<DeviceStatus>;
  discardUpdate(): Promise<void>;
  firmware(): Promise<FirmwareInfo>;
  checkUpdate(): Promise<UpgradeCheck>;
  update(offer: UpgradeOffer, progress: (percent: number) => void): Promise<void>;
  status(): Promise<DeviceStatus>;
  scan(): Promise<{ ssid: string; signal: number; secured: boolean }[]>;
  wifi(ssid: string, password: string): Promise<void>;
  password(password: string): Promise<number>;
  close(): Promise<void>;
}
