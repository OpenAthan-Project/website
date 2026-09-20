# OpenAthan Browser Installer

Target route: `https://openathan.com/install`

The installer will let nontechnical users connect supported hardware over USB and install a stable, precompiled OpenAthan firmware release with a small number of clearly explained steps.

## Repository contract

- Firmware binaries and release metadata are produced and published by [`OpenAthan-Project/openathan`](https://github.com/OpenAthan-Project/openathan).
- This repository consumes release artifacts and does not compile firmware.
- The installer must identify supported hardware and firmware versions explicitly.
- Unsupported browsers and devices must receive clear, actionable guidance.
- Installation, failure, retry, and recovery paths must be tested on physical reference hardware before public release.

Users should not need ESPHome, Arduino IDE, PlatformIO, Python, or Home Assistant.

No installer implementation or firmware manifest format has been selected in this scaffold.
