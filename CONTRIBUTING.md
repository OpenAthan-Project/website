# Contributing to the OpenAthan Website

OpenAthan is intended for ordinary users, including people with no embedded-development experience. Website and installer contributions should make installation and documentation clearer, safer, and more accessible.

## Local development

See the [README](README.md#local-preview) for the pinned Node version, preview commands, and public routes, and [validation and build](README.md#validation-and-build) for the available checks.

### Development simulators

`/preview/installer/` exercises installation and recovery success and failure flows without a speaker, firmware files, or hardware transport. Use made-up credentials. `/preview/device/` previews the local handoff opened by simulated device links. The simulator routes and implementation are excluded from the production static build.

The development browser suite (`npm run test:browser`) includes simulator tests. The built-site suite (`npm run test:browser:built`) excludes them. Browser simulation does not replace physical installation, interruption, and preservation validation; see the [installer contract](installer/README.md).

### Development server

Astro can run its development server in the background when launched by a coding agent. Use `npm run dev -- --host 127.0.0.1 --ignore-lock` for a foreground process, as the browser-test runner does. Use `npm run dev -- --stop` to stop an Astro-managed background server.

### Redirects and device handoff

The former `/guides/setup/` and `/guides/recovery/` addresses redirect to `/docs/getting-started/` and `/docs/troubleshooting/`. These ordinary HTML pages use an immediate meta refresh, a canonical URL, and a fallback link, so they work on static hosting without server redirect rules or JavaScript.

The optional `/location/` helper asks for browser location after one Detect action and automatically tries GeoJS IP location if that fails. It sends proposed coordinates to the device through a versioned URL fragment. The user reviews the suggestion and timetable before saving locally; the helper does not call a device settings API.

## Engineering principles

- Keep the generated site deployable as an ordinary static artifact.
- Do not couple the project to a hosting provider unless provider-specific configuration is genuinely required and isolated under `deployment/`.
- Keep firmware compilation and release production in the `OpenAthan-Project/openathan` repository.
- Only install published firmware artifacts from trusted OpenAthan releases.
- Preserve the separation between the public site and the device-local UI.
- Design installation and setup instructions for phone-friendly, nontechnical use.
- Treat accessibility, recovery guidance, and unsupported-browser behavior as core installer requirements.
- Do not add bundled audio or other media without verified redistribution rights.

## Pull requests

Keep pull requests focused. Explain affected routes, test relevant links and supported browsers, and update public documentation for user-visible changes.

By contributing, you agree that your contributions may be distributed under the license applicable to the part of the repository you modify.
