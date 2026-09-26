# OpenAthan website repository guidance

## Product and repository boundaries

- This repository owns the public website, public documentation and browser
  installer. Firmware, release production and the device-local UI belong in
  [OpenAthan-Project/openathan](https://github.com/OpenAthan-Project/openathan).
- Consume published artifacts from trusted OpenAthan releases; do not compile
  firmware here. The public website must not become a runtime dependency for
  standalone device operation or its local interface.
- Keep the generated site an ordinary, portable static artifact. Isolate necessary
  hosting-provider configuration under `deployment/`.
- Use the [README](README.md) for current project setup and available build commands,
  [contributor guidance](CONTRIBUTING.md) for engineering expectations, and the
  [installer contract](installer/README.md) when changing installation behavior.

## Website and installer experience

- Write for nontechnical users. Keep instructions direct, accessible and usable
  on narrow screens, without assuming embedded-development tools or experience.
- Identify supported hardware and firmware explicitly. Provide actionable guidance
  for unsupported browsers/devices, failures, retries and recovery.
- Preserve the separation between USB installation and the device-hosted setup
  experience. Describe available capabilities accurately using published evidence;
  do not imply release readiness from a successful development build.
- Test installation, failure, retry and recovery paths on physical reference
  hardware before public release, as required by the installer contract.

## Validation and pull requests

- Match checks to the change: validate relevant routes and links, and check changed
  user-facing behavior in applicable browsers and viewport sizes, including keyboard
  access. Use documented build/test commands when the implementation provides them.
- Documentation-only changes require whitespace, link and consistency checks;
  firmware builds and hardware access are not required.
- Keep changes focused and update documentation for user-visible behavior.
  Before creating a PR, rebase onto the latest `main`, review the final diff again,
  resolve findings or ask about unresolved issues, and rerun affected checks when the
  rebase changes the result.
- Follow the [PR template](.github/pull_request_template.md). Explain the problem,
  resulting behavior and affected routes for external contributors. Distinguish
  automated/browser checks from physical installer validation and state material
  limitations.

## Licensing and private material

- Preserve [Apache-2.0 software licensing](LICENSE) and
  [CC BY 4.0 documentation licensing](site/LICENSE.md). Third-party dependencies
  and media retain their own terms; preserve attribution and verify compatible
  redistribution rights before bundling media.
- Keep credentials, private diagnostic archives and recovery images outside Git.
  Keep personal filesystem paths and machine-local context in local instructions.
  Dated device state and changing binary measurements belong in relevant validation
  or release reports, not this instruction file.
