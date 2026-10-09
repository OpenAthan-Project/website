# GitHub Pages deployment and release adoption

The `Website` workflow validates pull requests and `main` pushes. It also checks
GitHub’s latest stable firmware release at minutes **7 and 37** of every hour.
Publishing a qualified firmware release as latest authorizes website adoption;
no release-selection PR, extra credential or cross-repository trigger is needed.
The website never compiles firmware or updates connected speakers.

The USB update policy is enabled ahead of the next capable firmware release and
is retained through scheduled release adoption. Owners on released firmware
through v0.4.0 first need a Wi-Fi or maintainer update to gain USB support.
Capable speakers require an explicit update check and confirmation before any
USB transfer; publishing a release never installs it on connected speakers.

## Validation and deployment

Every build freezes one release selection before importing artifacts. The importer,
version labels, release links, browser installer and `/release.json` share it.
The workflow verifies artifact/source identity, sizes, supported hardware/layout
and hashes, then runs formatting, type, unit, build and development/built-site
browser checks. Only a successful `main` run uploads the tested `dist/` artifact;
the deploy job never rebuilds or imports a different release.

A scheduled poll compares the candidate tag, manifest SHA-256 and website commit
with `https://openathan.com/release.json`. Unchanged selections skip dependency
installation, the full checks and deployment. Website-only changes still trigger
validation, so a failed main deployment is retried on the next poll. A missing
metadata file (404) during initial migration triggers validation. Malformed
metadata, network errors, invalid artifacts and failing checks stop the run and
retain the existing site. Changing the currently served or committed manual tag’s manifest is rejected;
publish a new tag instead.

All main runs share concurrency. Immediately before deployment, the workflow
checks that the tested website commit is still main and the tested release is
still selected. Superseded runs skip deployment; the next run handles the new
selection. PRs and manual runs on other branches never deploy. Workflow failures
are visible in GitHub Actions and use the repository’s existing notification settings.

## Manual run, inactivity and rollback

For an urgent check, open **Actions → Website → Run workflow**, selecting `main`.
The manual run always performs validation. No external scheduler or keepalive
commits are configured.

GitHub schedules can be delayed or dropped under load, and public-repository
schedules disable after 60 days without repository activity. The 30-minute cadence
is not a delivery-time guarantee. If disabled, open **Actions → Website → Enable
workflow**, then run it on `main`. See [GitHub’s schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

For a persistent rollback, submit a reviewed PR setting `automatic: false` in
`installer/catalog.json` and selecting a known qualified tag and manifest hash.
To stop fresh installations, set `release: null`; recovery remains available.
A main merge validates and deploys that policy. Do not leave automatic mode enabled
when intending to hold a manual release. Website rollback does not change firmware
already installed on speakers.

## Domain and post-deployment checks

The Pages site uses `openathan.com`, configured in GitHub Pages settings; there is
no `CNAME` file because the site is published from an Actions artifact. Keep
**Enforce HTTPS** enabled after GitHub provisions its certificate.

The existing DNS configuration has four DNS-only apex `A` records pointing to
`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`, plus
`www` pointing to `OpenAthan-Project.github.io`. Preserve domain-verification TXT
records and unrelated DNS records. This release automation does not modify DNS.

After the initial reviewed deployment, check HTTPS on `/`, `/install/`, `/docs/`,
`/docs/getting-started/`, `/release.json` and a missing route; check the `www`
redirect. Compare version labels, installer selection and all served manifest/image
hashes with the published release. Confirm simulator routes remain absent.
Reuse accepted hardware evidence and retain its source limits; these website
checks do not establish physical installation, audible playback or OTA delivery.
