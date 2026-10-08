# OpenAthan Website

The website and USB installer for OpenAthan, a standalone speaker that automatically plays the Athan at prayer times.

Visit [openathan.com](https://openathan.com) for supported hardware, installation, setup, and recovery instructions.

- [Connect your speaker](https://openathan.com/install/)
- [Getting started and supported hardware](https://openathan.com/docs/getting-started/)
- [Troubleshooting and recovery](https://openathan.com/docs/troubleshooting/)

## Installation and updates

Connect once through USB setup: the website checks the speaker and shows existing-device controls or installation confirmation. The browser installer supports fresh installation on **AtomS3R C126 + Pyramid A167** and Wi-Fi/password recovery for existing devices. **Fresh installation erases saved data.** Existing owners should [update from the device page or follow the preserving USB transition](https://openathan.com/docs/getting-started/#firmware-updates).

The installer uses the latest approved stable OpenAthan release. The website is scheduled to check for releases twice hourly and deploys only after artifact verification and website tests pass. See the [deployment guide](deployment/README.md) for timing limitations, release selection, and rollback.

Prayer settings and activation happen on the device's own local page. The speaker operates independently of this website and Home Assistant. The optional [location helper](https://openathan.com/location/) uses browser location with a GeoJS IP-location fallback; users review the suggestion before saving it on the device.

## Local preview

The website uses Astro and TypeScript. Use Node **24.19.0** (pinned in `.nvmrc`) and npm:

```sh
npm ci
npm run release:import
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:4321/`:

| Route                    | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `/`                      | Introduction to OpenAthan                             |
| `/install/`              | USB installation and Wi-Fi/password recovery          |
| `/location/`             | Optional location suggestion for the device settings  |
| `/docs/`                 | Documentation, contribution, issue, and license links |
| `/docs/getting-started/` | Hardware, setup, and firmware update instructions     |
| `/docs/troubleshooting/` | Connection troubleshooting and recovery               |

See [CONTRIBUTING.md](CONTRIBUTING.md) for development simulators, server behavior, and engineering expectations, and [DESIGN.md](DESIGN.md) for the visual system.

## Validation and build

```sh
npm run format:check
npm run check
npm test
npm run release:import
npm run build
npx playwright install chromium webkit
npm run test:browser
npm run test:browser:built
```

Use `npm run format` when editing the website or installer. The build checks local links, release-file integrity, and simulator exclusion. Browser tests cover Chromium, desktop WebKit, and a narrow WebKit viewport. Browser simulation does not establish physical USB qualification; see the [installer contract](installer/README.md) for hardware validation requirements.

`dist/` contains portable static assets; `npm run preview` serves that build locally. After validation passes on `main`, GitHub Actions publishes the exact tested build to GitHub Pages at `openathan.com`. Pull requests only validate. See the [deployment guide](deployment/README.md) for deployment and domain checks.

## Repository boundary

This repository owns the public website, documentation, and browser installer. [`OpenAthan-Project/openathan`](https://github.com/OpenAthan-Project/openathan) owns firmware, reusable product logic, hardware adapters, and the device-local interface. It builds and publishes the release artifacts consumed here.

```text
site/                   Astro pages, layouts, styles, and public documentation
installer/              Installer protocols and wizard
installer/catalog.json  Automatic-release policy and manual rollback pin
public/releases/        Generated, ignored imports of approved releases
tools/                  Release discovery, import, and static-output checks
tests/                  Protocol, release, transport, and browser tests
deployment/             Deployment, schedule, and rollback instructions
```

This repository never compiles firmware or includes private recordings, recovery images, or CI audio. The site has no analytics, account service, or application backend. Dependencies are pinned with a lockfile, Astro telemetry is disabled by the project CLI wrapper, and fonts are hosted locally.

## Licensing

- OpenAthan-authored website and installer software: [Apache License 2.0](LICENSE).
- OpenAthan-authored public documentation and original documentation images: [CC BY 4.0](site/LICENSE.md).
- Third-party software and media retain their own licenses; see [NOTICE](NOTICE).

Do not add Athan or Quran recordings without explicit, compatible redistribution rights.
