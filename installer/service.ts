import type { DeviceStatus } from './protocol';
export type Path = 'install' | 'recovery';
export type Connected = { kind: 'new' } | { kind: 'existing'; status: DeviceStatus };
export interface InstallerService {
  readonly simulated: boolean;
  readonly installAvailable: boolean;
  onDisconnect?: () => void;
  connect(path: Path): Promise<Connected>;
  install(confirmed: boolean, progress: (percent: number) => void): Promise<DeviceStatus>;
  status(): Promise<DeviceStatus>;
  scan(): Promise<{ ssid: string; signal: number; secured: boolean }[]>;
  wifi(ssid: string, password: string): Promise<void>;
  password(password: string): Promise<number>;
  close(): Promise<void>;
}
