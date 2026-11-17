import { AUDIO_BOARD, HARDWARE, WAVESHARE, isHardware, type Hardware } from '../installer/release';
import type { Selection } from '../tools/release-selection';

type PartsLink = { label: string; href: string };
interface SpeakerCopy {
  name: string;
  subtitle: string;
  display: string;
  controls: string;
  buyingNote: string | null;
  parts: PartsLink;
  setupAnchor: string;
  connect: string;
  power: string;
  joinWifi: string;
  findAddress: string;
}

const builds = 'https://github.com/OpenAthan-Project/openathan/blob/main/hardware/reference-builds';
const speakerCopy = {
  [AUDIO_BOARD]: {
    name: 'Waveshare AUDIO-Board',
    subtitle: 'Without a screen',
    display: 'Prayer-status lights',
    controls: 'Volume down, Stop, and volume up',
    buyingNote: null,
    parts: {
      label: 'Check the supported board revision',
      href: `${builds}/waveshare-audio-board/README.md`,
    },
    setupAnchor: 'audio-board-setup',
    connect: 'Use the AUDIO-Board’s USB-C port.',
    power: 'Power the AUDIO-Board through its USB-C port.',
    joinWifi: 'Keep other unconfigured OpenAthan speakers unplugged so you can identify this one.',
    findAddress: 'The AUDIO-Board has no screen. Use its USB-C port to read its current address.',
  },
  [WAVESHARE]: {
    name: 'Waveshare Box V2',
    subtitle: 'With a round screen',
    display: 'Clock, next prayer, and prayer ring',
    controls: 'BOOT stops audio',
    buyingNote: 'Choose the V2 speaker box. V1 and the bare board are unsupported.',
    parts: { label: 'See the Box V2 hardware guide', href: `${builds}/waveshare-box-v2/README.md` },
    setupAnchor: 'waveshare-setup',
    connect: 'Use the Box V2’s rear USB-C port.',
    power: 'Power the Box V2 through its rear USB-C port.',
    joinWifi: 'While audio is idle, briefly press BOOT to show the Wi-Fi QR code and network name.',
    findAddress:
      'While audio is idle, briefly press BOOT to show the webpage QR code and addresses on the same screen. A press during playback stops the audio.',
  },
  [HARDWARE]: {
    name: 'M5Stack AtomS3R + Voice Pyramid',
    subtitle: 'Two modules to connect',
    display: 'Small screen and prayer-status lights',
    controls: 'Front button stops audio',
    buyingNote: 'Choose AtomS3R C126 with the GC9107 screen and Voice Pyramid A167.',
    parts: { label: 'Check the parts guide', href: `${builds}/voice-pyramid/bom.md` },
    setupAnchor: 'atom-setup',
    connect:
      'Connect the two modules. Unplug Pyramid bottom power, then use only the Atom’s own USB-C port.',
    power:
      'Unplug the Atom’s USB cable. Use only the Pyramid’s bottom USB-C port for normal power.',
    joinWifi:
      'While audio is idle, briefly press the Atom’s front button to show the Wi-Fi QR code.',
    findAddress:
      'While audio is idle, briefly press the Atom’s front button to show the webpage QR code. Press again to see the addresses. A press during playback stops the audio.',
  },
} satisfies Record<Hardware, SpeakerCopy>;

export type GuideSpeaker = SpeakerCopy & { hardware: Hardware; releaseTag: string | null };

export function guideSpeakers({
  release,
  hardwareReleases,
}: Pick<Selection, 'release' | 'hardwareReleases'>): GuideSpeaker[] {
  return Object.keys(speakerCopy)
    .filter(isHardware)
    .map((hardware) => ({
      ...speakerCopy[hardware],
      hardware,
      releaseTag: (hardware === HARDWARE ? release : hardwareReleases?.[hardware])?.tag ?? null,
    }));
}
