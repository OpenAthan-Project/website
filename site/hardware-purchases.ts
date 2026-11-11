// Use vendor-issued referral URLs only after approval. Mark the affected link
// affiliate: true to enable its label, sponsored relationship and disclosure.
export interface HardwarePurchaseLink {
  label: string;
  href: string;
  affiliate: boolean;
}

export interface HardwarePurchaseOption {
  name: string;
  links: HardwarePurchaseLink[];
  warning: string;
  retailers: HardwareRetailer[];
  distributorsUrl: string;
}

export interface HardwareRetailer {
  name: string;
  region: string;
  links: HardwarePurchaseLink[];
}

export const hardwarePurchases: HardwarePurchaseOption[] = [
  {
    name: 'M5Stack build — buy both modules',
    links: [
      {
        label: 'Buy AtomS3R C126',
        href: 'https://shop.m5stack.com/products/atoms3r-dev-kit',
        affiliate: false,
      },
      {
        label: 'Buy Voice Pyramid A167',
        href: 'https://shop.m5stack.com/products/echo-pyramid-smart-speaker-base-without-m5atom',
        affiliate: false,
      },
    ],
    warning:
      'Confirm the Atom’s GC9107 display with the seller; newer ST7735 revisions are not qualified. A167 is also called Echo Pyramid.',
    retailers: [
      {
        name: 'DigiKey',
        region: 'Global, with regional sites',
        links: [
          {
            label: 'DigiKey AtomS3R C126',
            href: 'https://www.digikey.com/en/products/detail/m5stack-technology-co-ltd/C126/25600008',
            affiliate: false,
          },
          {
            label: 'DigiKey Voice Pyramid A167',
            href: 'https://www.digikey.com/en/products/detail/m5stack-technology-co-ltd/A167/29291634',
            affiliate: false,
          },
        ],
      },
      {
        name: 'OpenELAB',
        region: 'US store, with global and German stores',
        links: [
          {
            label: 'OpenELAB AtomS3R C126',
            href: 'https://openelab.com/products/m5stack-atoms3r-development-kit',
            affiliate: false,
          },
          {
            label: 'OpenELAB Voice Pyramid A167',
            href: 'https://openelab.com/products/m5stack-echo-pyramid-smart-speaker',
            affiliate: false,
          },
        ],
      },
      {
        name: 'The Pi Hut',
        region: 'UK',
        links: [
          {
            label: 'The Pi Hut AtomS3R C126',
            href: 'https://thepihut.com/products/atoms3r-development-kit-with-0-85-display-8mb-psram',
            affiliate: false,
          },
          {
            label: 'The Pi Hut Voice Pyramid A167',
            href: 'https://thepihut.com/products/echo-pyramid-smart-speaker-base-without-m5atom',
            affiliate: false,
          },
        ],
      },
      {
        name: 'TinyTronics',
        region: 'Netherlands',
        links: [
          {
            label: 'TinyTronics AtomS3R C126',
            href: 'https://www.tinytronics.nl/en/development-boards/microcontroller-boards/with-wi-fi/m5stack-atoms3r-esp32-s3-pico-development-board-0.85-inch-display',
            affiliate: false,
          },
          {
            label: 'TinyTronics Voice Pyramid A167',
            href: 'https://www.tinytronics.nl/en/platforms-and-systems/m5stack/atom/m5stack-atomic-voice-pyramid-base',
            affiliate: false,
          },
        ],
      },
    ],
    distributorsUrl: 'https://m5stack.com/distributor',
  },
  {
    name: 'Waveshare build — pre-assembled speaker',
    links: [
      {
        label: 'Buy Waveshare Box V2',
        href: 'https://www.waveshare.com/product/esp32-s3-touch-lcd-1.85c.htm',
        affiliate: false,
      },
    ],
    warning:
      'Select the speaker-box option and confirm ESP32-S3-Touch-LCD-1.85C-BOX V2 with the seller. The bare board and V1 are not supported for this build.',
    retailers: [],
    distributorsUrl: 'https://www.waveshare.com/distributors',
  },
];

export const audioBoardPurchase: HardwarePurchaseOption = {
  name: 'Waveshare AUDIO-Board — no screen',
  links: [
    {
      label: 'Buy Waveshare AUDIO-Board',
      href: 'https://www.waveshare.com/product/arduino/boards-kits/esp32-s3/esp32-s3-audio-board.htm',
      affiliate: false,
    },
  ],
  warning:
    'Confirm ESP32-S3-AUDIO-Board, the physical revision and included speaker with the seller. USB-powered use does not require a battery. This is a different model from Box V2.',
  retailers: [],
  distributorsUrl: 'https://www.waveshare.com/distributors',
};
