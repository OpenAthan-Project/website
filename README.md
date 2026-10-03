# OpenAthan Website

A portable, static Astro + TypeScript website with an OpenAthan-owned USB installer and Wi-Fi/password recovery wizard.

**Installation release: the latest approved stable OpenAthan release.** The website checks every 30 minutes and deploys only after artifact verification and website tests pass. The installer supports fresh installation on AtomS3R C126 + Pyramid A167 and Wi-Fi/password recovery for existing devices. [Existing owners update from the device page](https://openathan.com/docs/getting-started/#firmware-updates), or use the preserving USB transition described there. Fresh installation erases saved data.

## Local preview

Use Node **24.19.0** (pinned in `.nvmrc`) and npm:

```sh
npm ci
npm run release:import
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:4321/`:

| Route                    | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `/`                      | Everyday features and an introduction to OpenAthan     |
| `/install/`              | Release-gated installation and command-only recovery   |
| `/location/`             | Optional location suggestion for the device settings   |
| `/docs/`                 | Documentation, contribution, issue and license links   |
| `/docs/getting-started/` | Cable, browser and first-time setup instructions       |
| `/docs/troubleshooting/` | Wi-Fi/password and connection troubleshooting          |
| `/preview/installer/`    | Development-only simulator, with no hardware transport |
| `/preview/device/`       | Local handoff preview opened by simulated device links |

The former `/guides/setup/` and `/guides/recovery/` addresses redirect to `/docs/getting-started/` and `/docs/troubleshooting/`. These are ordinary HTML pages with an immediate meta refresh, a canonical URL and a fallback link; they work on static hosting without server redirect rules or JavaScript.

The homepage introduces automatic Athan playback, phone settings, and stored recordings in plain language, with a link to the parts and setup instructions. Getting started lists the AtomS3R C126 + Pyramid A167 hardware targeted by the browser installer and current setup/recovery and firmware update instructions, includes the original SVG cable diagram, and explains the need for internet time synchronization after a restart. `/docs/getting-started/#other-hardware` describes the hardware-independent design goal and the development path for additional hardware, with links to the firmware architecture and scheduler reuse documentation. The slate-blue design uses a text-only wordmark, a compact project introduction and visible contribution links. Navigation and project links remain available on narrow screens. Only links that open a new tab use the ↗ indicator, with an accessible description.

Use made-up credentials in the simulator. It exercises complete success and failure flows without a speaker or firmware files. Its route and implementation are excluded from the production static build.

Astro can run its development server in the background when launched by a coding agent. Pass `--ignore-lock` for a foreground process, as the browser-test runner does. Use `npm run dev -- --stop` to stop an Astro-managed background server.

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

`dist/` contains ordinary static assets. `npm run preview` serves that build locally. After validation passes on `main`, GitHub Actions publishes the exact tested `dist/` to GitHub Pages at `openathan.com`; pull requests only validate. Scheduled polls skip full validation when the release and website commit are already deployed. The built-site browser suite excludes development simulator tests; the development suite still exercises them. See [deployment/README.md](deployment/README.md) for domain and HTTPS checks. The build checks local links, release-file integrity and simulator exclusion. Browser tests cover Chromium, desktop WebKit and a narrow WebKit viewport. Browser simulation is not physical USB qualification; Chrome/Edge installation, interruption and preservation acceptance remain required before an installation release.

Use `npm run format` when editing the website or installer. Dependencies are version-pinned with a lockfile. The esptool-js adapter loads only after a confirmed new installation with a reviewed release. Astro telemetry is disabled by the project CLI wrapper. The site has no analytics, account service or application backend. Mukta Malar fonts are hosted locally with their SIL Open Font License. See [DESIGN.md](DESIGN.md) for the visual system.

## Repository boundary

[`OpenAthan-Project/openathan`](https://github.com/OpenAthan-Project/openathan) owns firmware, reusable product logic, hardware adapters and the device-local interface. It builds and publishes release artifacts. This repository never compiles firmware or includes private recordings, recovery images or CI audio.

Prayer settings and activation happen on the device's own unique local address. The speaker operates independently of this website and Home Assistant.

The optional `/location/` helper asks for browser location after one Detect action and automatically tries GeoJS IP location if that fails. It sends proposed coordinates to the device only through a versioned URL fragment; the user reviews the suggestion and timetable before saving locally. It does not call a device settings API.

```text
site/          Astro pages, layouts, styles and public documentation
installer/     Framework-independent protocols, session owner and wizard
installer/catalog.json  Automatic-release policy and manual rollback pin
public/releases/        Generated, ignored imports of approved releases
tools/         Release discovery, import and static-output checks
tests/         Protocol, release, transport and browser simulation tests
deployment/    Deployment, schedule and rollback instructions
```

See [installer/README.md](installer/README.md) for the release contract, safety boundaries and launch prerequisites, and [CONTRIBUTING.md](CONTRIBUTING.md) before making changes.

## Licensing

- OpenAthan-authored website and installer software: [Apache License 2.0](LICENSE).
- OpenAthan-authored public documentation and original documentation images: [CC BY 4.0](site/LICENSE.md).
- Third-party software and media retain their own licenses; see [NOTICE](NOTICE).

Do not add Athan or Quran recordings without explicit, compatible redistribution rights.
