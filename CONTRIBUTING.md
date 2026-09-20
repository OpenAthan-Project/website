# Contributing to the OpenAthan Website

OpenAthan is intended for ordinary users, including people with no embedded-development experience. Website and installer contributions should make installation and documentation clearer, safer, and more accessible.

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
