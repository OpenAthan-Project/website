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
  },
];
