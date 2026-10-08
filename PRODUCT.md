# OpenAthan

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who want an Athan speaker at home, including people without technical experience. Contributors are a secondary audience and need visible paths to source, documentation and issue reporting.

## Product Purpose

OpenAthan plays stored Athan recordings at prayer times calculated on the device. Users choose their location, prayer settings and volume through a browser on their home Wi-Fi.

## Positioning

Open-source software for a speaker assembled from separately purchased parts. The software is designed to adapt to additional hardware; the current browser installer targets M5Stack AtomS3R C126 with Pyramid A167. Further hardware integrations require development and testing.

## Operating Context

The public website explains the project, provides documentation and performs supported USB setup and recovery. Prayer settings and activation live on the device-hosted interface. The public website is not a runtime dependency. The current build needs internet access to set its clock after restarting; calculation and audio playback run on the device.

## Capabilities and Constraints

- Public fresh installation is available for the selected approved stable reference release. Preserve artifact verification, publication approval and explicit erase confirmation.
- The website adopts stable latest after validation, with manual pin/disable policies for rollback. This never installs updates on existing speakers; owners use the authenticated device page or a preserving USB transition.
- USB setup begins with one connection action, then checks the speaker. Existing-device controls and recovery preserve prayer settings and history. Unrecognized firmware requires explicit hardware/full-erasure confirmation for installation; recognized firmware with unreadable status cannot install.
- Keep hardware model numbers and connection diagrams in setup documentation rather than homepage focal areas.
- Preserve existing routes, anchors, protocol behavior and simulator isolation.
- Firmware and the device-local UI belong in the firmware repository. The public website consumes published release artifacts and does not compile firmware.
- Public release and physical installer qualification require their own evidence; visual implementation and simulator checks do not establish either.

## Brand Commitments

Retain the OpenAthan name and plain-language factual content. Use Athan consistently. The website is a welcoming open-source project with visible participation paths.

The visual identity uses a community bulletin composition, a white canvas, charcoal reading text and slate-blue links and actions. Preserve the text-only OpenAthan wordmark without a separate symbol. Documentation and USB setup share the same typography, pale supporting panels and direct navigation. [DESIGN.md](DESIGN.md) records the implemented tokens, components and responsive behavior.

## Evidence on Hand

The deployed homepage, setup/update documentation, `/release.json` and browser installer share one verified release selection. Firmware release notes and source-bound validation reports document public releases and their limits. The isolated development simulator validates interface behavior without hardware and is excluded from production. Do not invent testimonials, community statistics or photographs of a finished product.

## Product Principles

- Explain the purpose before build details.
- Make current availability clear.
- Support everyday users without hiding contribution paths.
- Distinguish current hardware support from future adaptability.
- Keep device operation independent of this website.

## Accessibility & Inclusion

Readable typography, keyboard access, visible focus, sufficient contrast and narrow-screen layouts are required. Validate the implemented pages and interactive states; visual review alone does not establish accessibility or physical USB qualification.
