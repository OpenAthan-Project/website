# OpenAthan public site

Astro uses this directory as `srcDir`; `pages/` defines the homepage, installer, documentation and 404 page. `/docs/` links to Getting started, Troubleshooting and project information. The former `/guides/` pages remain as static redirects with fallback links. Shared semantic structure and styles live in `layouts/`, `components/` and `styles.css`. Client-side installer logic lives in the framework-independent TypeScript modules in `../installer/`.

The build emits portable static files. The development-only simulator route is omitted from the static build, along with its simulator implementation. The Mukta Malar Regular and Bold fonts are self-hosted under `public/fonts/` with their SIL Open Font License; the browser makes no third-party font requests. There are no trackers or client framework dependencies.

The public website is separate from the device-hosted setup/settings interface and is never required for daily standalone operation. Users follow a reported unique hostname or IP fallback to the device; prayer settings and activation stay there.

See the root [README](../README.md) for commands, routes and validation. Original public documentation uses [CC BY 4.0](LICENSE.md); authored website software uses the repository's Apache-2.0 license.

The visual system uses a white canvas, charcoal reading text, slate-blue links and buttons, and pale supporting panels. The header uses a text-only wordmark. The homepage keeps setup and participation links visible; hardware requirements remain in documentation and USB setup. See [DESIGN.md](../DESIGN.md) for tokens and responsive conventions.
