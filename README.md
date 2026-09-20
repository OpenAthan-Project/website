# OpenAthan Website

This repository contains the public OpenAthan website, public-facing documentation, hardware and build guidance, and the browser-based firmware installer.

> **Project status:** early development. This repository currently contains an information architecture scaffold; no public site or working firmware installer has been implemented yet.

## Routes

- `/` will serve the OpenAthan homepage and public documentation at [openathan.com](https://openathan.com).
- `/install` will serve the browser firmware installer at [openathan.com/install](https://openathan.com/install).

## Repository boundary

Firmware, `openathan-core`, hardware support, the device-local UI, and development documentation live in [`OpenAthan-Project/openathan`](https://github.com/OpenAthan-Project/openathan).

Firmware builds and release artifacts are produced by the `openathan` repository. The installer in this repository will consume published release artifacts; it will not compile firmware.

The device-local interface served from `openathan.local` also belongs to the firmware repository and must not depend on this public website or cloud infrastructure.

## Layout

```text
site/          Homepage, public documentation, and hardware/build content
installer/     Browser firmware installer
deployment/    Provider-specific configuration, only if a deployment requires it
```

No static-site framework or hosting provider has been selected. Future site work must produce an ordinary static build artifact that can move between hosting providers. Do not structure the project around a `*.github.io` URL.

## Development

There is no build command yet. Framework selection and the first site implementation should be reviewed separately from this scaffold.

See [CONTRIBUTING.md](CONTRIBUTING.md) before making changes.

## Licensing

- OpenAthan-authored website and installer software: [Apache License 2.0](LICENSE).
- OpenAthan-authored public documentation and original documentation images: [CC BY 4.0](site/LICENSE.md).
- Third-party dependencies and media remain under their respective licenses.

Do not add third-party Athan or Quran recordings unless their redistribution rights are explicit and compatible.
