# GitHub Pages preview

The `Website` workflow validates every pull request and `main` push. A successful
`main` run builds and uploads `dist/` to GitHub Pages. The Pages site uses the
custom domain `openathan.com`. There is no `CNAME` file because Pages is published
from a GitHub Actions artifact.

The Cloudflare DNS zone should have four DNS-only apex `A` records pointing to
`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`.
Add a DNS-only `www` CNAME to `OpenAthan-Project.github.io` for the redirect to
the apex domain. Preserve the GitHub Pages domain-verification TXT record and
unrelated DNS records. After GitHub provisions its certificate, enable **Enforce
HTTPS** in the repository's Pages settings.

After deployment, check HTTPS on `/`, `/install/`, `/docs/`, and a missing route;
check that `www.openathan.com` redirects to `openathan.com`. Confirm the homepage
development notice is visible, first-time installation is unavailable, and
`/preview/installer/` and firmware binaries are absent from the published site.
This preview does not select or qualify an installation release.
