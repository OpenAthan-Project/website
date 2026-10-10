# Getting started

The published [setup instructions](https://openathan.com/docs/getting-started/),
[firmware update guidance](https://openathan.com/docs/getting-started/#firmware-updates)
and [troubleshooting](https://openathan.com/docs/troubleshooting/) are maintained
in the [Astro setup page](../pages/docs/getting-started.astro) and
[troubleshooting page](../pages/docs/troubleshooting.astro). This Markdown file
is a source guide, not a second rendered setup page.

The [browser installer](../../installer/README.md) consumes a verified selection
of the firmware repository's approved stable latest release. It supports fresh
installation and settings/history-preserving Wi-Fi/password recovery. Fresh
installation erases saved data; existing-device firmware upgrades use the
device page or a preserving USB transition. Publication, physical qualification
and software checks remain distinct evidence.

The supported reference build uses AtomS3R C126 + Pyramid A167. Connect only the Atom USB-C data cable to the computer for installation/setup, then disconnect it and use only the Pyramid bottom power cable for normal operation. Complete prayer settings and activation on the device's returned unique hostname, using its IP fallback if needed.

The website never compiles firmware or automatically updates connected speakers.
Use the [development instructions](../../README.md) for local preview. The
development simulator lets reviewers explore the flow without hardware and is
excluded from the production build.

USB setup has one connection entry. Choose the USB device, then read-only discovery opens existing-speaker controls or installation confirmation. An unrecognized result is not proof of a blank device. Installation requires explicit hardware and full-erasure confirmation; recognized OpenAthan with unreadable status receives troubleshooting, never installation.

## Waveshare Box V2

Support is being prepared for v0.5.0. It becomes available in the browser installer
when that qualified release is published. Use the **ESP32-S3-Touch-LCD-1.85C-BOX V2**;
V1 is not supported. Connect a USB data cable to its rear USB-C port.

The installer recognizes hardware already running compatible OpenAthan. For a
new installation, select **Waveshare Box V2** and confirm erasure. Installation
replaces existing firmware, Wi-Fi credentials, settings and prayer history.
After installation, save Wi-Fi and a device password, open the device page and
finish location, prayer settings and volume. Use the same rear USB-C port for
normal power. BOOT stops playback, skips the next prayer or cancels that skip;
use RESET to restart. Touch and microphone features are not part of this release.

The RTC can retain synchronized time across powered restarts. The first boot
still needs internet time. Battery retention, unplugged retention and drift
have not been qualified.
