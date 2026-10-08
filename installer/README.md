# OpenAthan browser installer

The `/install/` wizard has one **Connect speaker** entry with a **Choose USB device** action. Read-only discovery then opens existing-speaker controls or new-installation confirmation. Installation and credential recovery remain separate operations. Supported reference hardware is M5Stack AtomS3R C126 + Pyramid A167, with an unlocked ESP32-S3 and 8 MiB flash. USB setup targets desktop Chrome and Edge with Web Serial in a secure context. The documentation at `/docs/` remains available in other browsers.

The website adopts the firmware repository’s latest approved stable release after verification and website tests. The committed pin is a local-preview default and a manual rollback option, not a version label that needs changing for every release. Credential recovery remains a command-only operation after discovery.

Review `/preview/installer/` on the development server to exercise the complete wizard without hardware. Its injected simulator transport cannot reach Web Serial or the flasher; its route and code are excluded from the static build. Both example addresses are clickable and open `/preview/device/` in a new tab, a clearly labelled local handoff preview. They never navigate to the example hostname or LAN IP. Actual device addresses open the reported local device URL. Synthetic firmware and recording fixtures are never served.

## Protocol and session ownership

Credential recovery follows the firmware [provisioning handoff](https://github.com/OpenAthan-Project/openathan/blob/d376d4e3e59b59e3b7b26910768d630048c9839e/firmware/esphome/provisioning/README.md) and [Python protocol tests](https://github.com/OpenAthan-Project/openathan/blob/d376d4e3e59b59e3b7b26910768d630048c9839e/tests/test_provision_device.py). The separate application updater requires the new [USB upgrade protocol](https://github.com/OpenAthan-Project/openathan/blob/main/docs/development/usb-firmware-updates.md).

- Improv Serial v1: Wi-Fi credentials (1), device information (3), network scan (4).
- OpenAthan v1 extension: status (1), device password (2). Maintenance/test commands are not exposed.
- One serial owner, one reader, one writer and one outstanding command; concurrent commands are rejected. Provisioning uses 115200 baud. Readers, writers and the port are released before flashing or returning control.
- Frames validate version, checksums, lengths and UTF-8. Partial frames expire after one second. Initial firmware discovery has a combined 10-second deadline after the port opens: identification gets up to 5 seconds, then status uses the remaining time. The normal 40-second command deadline covers firmware's 30-second Wi-Fi join timeout.
- Wi-Fi and password writes are sent once. Missing/malformed acknowledgements or disconnects yield an uncertain outcome and block further writes in that session. Read-only status is permitted. A connected status does not identify the attempted SSID and cannot prove that an uncertain Wi-Fi write succeeded. Reconnection and a deliberate user decision are required before any later attempt.
- A Wi-Fi save acknowledgement must contain exactly the firmware v1 URL pair: the HTTP OpenAthan `.local` hostname followed by its HTTP dotted-decimal IPv4 address, both with root paths. Empty, incomplete or unexpected results are uncertain; they cannot become success through a connected status read. These response fields are validated as protocol data, not opened as links; handoff links still come from separately validated status.
- Error 255 during either credential save triggers a read-only status check. A reported storage/password/setup fault or unreadable status blocks further changes; a healthy status allows a deliberate retry without claiming that the rejected save succeeded. Recovery also offers **Refresh status** to detect Wi-Fi reconnection and updated device links using the existing USB session, without writing credentials. **Continue to device settings** uses the same check before displaying device links; neither action can leave a previous healthy status authorizing changes after a failed read.
- SSIDs are 1–32 UTF-8 bytes; Wi-Fi passwords are 8–63 UTF-8 bytes or exactly 64 hexadecimal ASCII characters (0–9, A–F, a–f). Embedded nulls are rejected, and credentials are never trimmed or truncated. Device passwords are 12–128 printable ASCII characters, matching the firmware.

Credentials are held only in temporary browser memory, removed from forms after submission and never logged, stored, added to URLs or sent to analytics. JavaScript strings cannot be guaranteed to be physically zeroed; transmitted byte buffers are cleared after writing. Avoid browser tracing with real credentials. The site opens only validated device-reported local links chosen by the user; it does not call the device's HTTP API across origins.

Recovery never imports or invokes the flashing adapter, erase operations or settings/history commands. Recognized firmware opens a single connected task heading with identity and status. Healthy speakers promote **Continue to device settings**, followed by a quieter firmware row and collapsed native **Wi-Fi and password recovery** disclosure. Missing credentials promote the required repair and expand recovery unless an explicit firmware check has identified a pending USB update. Task transitions focus their heading and announce status. Fresh installation retains explicit hardware/full-erasure confirmation and one **Back to connection** action; after verified installation, Wi-Fi Back returns to the installed-speaker summary and cannot return to erase confirmation. Recognized firmware with unreadable status and discovery disconnects cannot become installation candidates. See the [owner guidance](https://openathan.com/docs/getting-started/#firmware-updates).

## Preserving USB updates

`catalog.json` has an optional `usbUpdateEnabled` boolean, omitted or `false` by default. It is currently **false**. Release discovery carries this reviewed policy through the frozen selection; automatic adoption of a newer firmware release cannot enable USB writes. Enable it only in a separately reviewed activation after the new physical qualification and a capable release are available. It does not change the schema-1 fresh-install manifest or `/release.json`.

**Check for updates** explicitly probes read-only firmware INFO command `0x10`; connection alone does not probe firmware or download update artifacts. Error 2 identifies legacy firmware: owners need an initial Wi-Fi or maintainer update, with credential recovery still available. New firmware reports its actual version/commit, boot health and update state. Unsupported bootloaders, pending startup checks and conflicting updates prevent offers. Checking never mutates the speaker.

INFO states `usb_descriptor`, `usb_receiving`, `usb_interrupted`, `usb_selection_uncertain` and `awaiting_power` establish pending USB ownership. Its resolution takes priority over settings and credential recovery: **Finish power handoff** for a verified selection, **Discard incomplete transfer** only after confirmed startup health, or **Check update status** for other owned states. The firmware row contains details without a duplicate resolution button. Recovery stays visible in an initially collapsed native disclosure with an explanation, disabled Wi-Fi/password controls and read-only **Refresh status**. Recovery entry, scanning and credential submission also enforce the restriction independently of rendered controls.

Within the current connection, a provisioning-status refresh or failed INFO read cannot clear known USB ownership. Failed INFO promotes **Reconnect and check** without retaining a stale handoff or discard action. Only a successful firmware check showing ownership has cleared restores ordinary recovery, including the fresh check after a successful discard. Legacy unsupported firmware and ordinary startup/network-update states do not establish USB ownership. These checks and resolution controls remain available while `usbUpdateEnabled` is false; that policy continues to prevent new USB transfers.

When activated, the browser verifies the selected manifest, P-256 signature on the exact descriptor payload, compatibility and application SHA-256/size/header/version before offering that exact release. It sends only the descriptor and OTA application through a dedicated serialized session: BEGIN, bounded descriptor chunks, VERIFY, bounded application chunks and FINISH. The firmware independently verifies trust and controls the inactive slot. This path never imports the esptool adapter, writes the bootloader/audio/NVS partitions, or accepts user-supplied binaries or URLs.

Chunks contain a device-issued 64-bit token, descriptor/application kind and exact offset. Each acknowledgement must echo the token/kind and next offset. Writes are sent once. Lost or malformed replies block later mutation; FINISH rejection or failed readback is also uncertain because boot selection may have succeeded. Reconnect and read authoritative firmware state before another owner decision. No automatic transfer retry or conversion to a device-side network download occurs. A rebooted incomplete request can be discarded explicitly through USB; a verified selected image cannot be discarded.

Completion means **Update written and verified**, followed by Atom USB unplug and Pyramid bottom-only power. The browser displays this handoff as soon as writing and boot selection are verified, before closing USB. Cleanup errors show a nonfatal connection notice; disconnects, including earlier queued notices, cannot replace the power instructions or device links. **Finish power handoff** after reconnecting to an `awaiting_power` device has the same protection, even when Wi-Fi or password status is missing. Returning to the connection screen resets that protection. Installation and credential recovery retain their existing completion sequence.

Verified writing and selection do not mean startup succeeded. Owners confirm the installed version and health result on the device page after startup; the firmware retains its existing confirmation/rollback checks. A failed or uncertain transfer still requires reconnecting and reading firmware status, without an automatic resend or success claim. Settings, prayer-consumption history and shared audio are outside the application write range.

## Approved release discovery and import

The website consumes stable published releases only from `OpenAthan-Project/openathan`. It never builds firmware, accepts local binary uploads or fetches user-provided manifest URLs.

`catalog.json` retains schema 1 with an optional `automatic` boolean (omitted means `false`). With automatic mode enabled, publishing a qualified release as GitHub’s **latest** authorizes website adoption. Maintainers must finish media rights/content review, appropriate physical qualification and publication approval first. Generated `mediaReviewed` and `hardwareQualified` fields record that publication policy; software checks cannot establish those human approvals or new physical results.

The committed release remains a verified manual pin. Set `automatic` to `false` to hold or roll back to it through a reviewed PR. Set `release` to `null` to disable fresh installation; null takes precedence over automatic release discovery. The USB picker remains available for existing-device controls and recovery, while unrecognized firmware receives an unavailable-installation screen without erase controls. Automatic mode must remain off for a persistent manual rollback.

`npm run release:import` discovers a selection once, verifies the published identity, exact asset names/URLs, source commit, bounded sizes, hardware/layout and hashes, then imports its manifest and two fresh-install binaries under ignored `public/releases/<tag>/`. If the release also publishes `upgrade.json` and `firmware.ota.bin`, both are required together and verified against the committed trust key, manifest identity, application digest and factory application bytes. Old generated imports are removed only after the candidate verifies; null removes all generated firmware imports without querying the firmware service. CI first runs `release:select`, then `release:import -- --snapshot` to retain its frozen selection.

The ignored `build/release-selection.json` supplies the importer, public labels, release links, installer and static integrity checker. A production build requires a snapshot matching the current policy. Local development without a snapshot uses the committed pin; it does not discover latest in the browser. `/release.json` is a read-only static interface with schema 1, the website commit, and either `release: null` or `release: { tag, manifestSha256 }`. It contains no credentials or device information.

The browser independently verifies this served selection’s manifest and binaries. Streaming limits remain 16 KiB for the manifest and each image’s declared size; failed streams are cancelled before verification or flashing. See [deployment instructions](../deployment/README.md) for scheduling, tested-artifact deployment, failure handling and rollback.

### Version-1 manifest contract

The firmware release must attach `manifest.json`, the matching factory image and the approved shared-audio partition image. Example schema (placeholder identities and hashes are not a usable release):

```json
{
  "schema": 1,
  "repository": "OpenAthan-Project/openathan",
  "tag": "v1.0.0",
  "commit": "<40 lowercase hexadecimal characters>",
  "hardware": "atoms3r-c126-pyramid-a167",
  "chip": "ESP32-S3",
  "flashBytes": 8388608,
  "layout": "dual-2m-audio-3_5m-v1",
  "provisioningProtocol": 1,
  "media": {
    "redistributionApproved": true,
    "licenseUrl": "https://github.com/OpenAthan-Project/openathan/blob/<commit>/AUDIO-LICENSES.md"
  },
  "parts": [
    {
      "role": "factory",
      "file": "firmware.factory.bin",
      "offset": 0,
      "bytes": 1200000,
      "sha256": "<actual SHA-256>"
    },
    {
      "role": "audio",
      "file": "athan-audio.bin",
      "offset": 4259840,
      "bytes": 3670016,
      "sha256": "<actual SHA-256>"
    }
  ]
}
```

`factory.bytes` must be the actual file length. The producer is responsible for its pinned-toolchain build, application capacity checks, complete image validation, and approved audio contents/format. Website validation checks the ESP32-S3 boot/app headers and actual partition table against these ranges:

| Partition   | Offset     | Length     |
| ----------- | ---------- | ---------- |
| nvs         | `0x9000`   | `0x5000`   |
| otadata     | `0xe000`   | `0x2000`   |
| app0        | `0x10000`  | `0x200000` |
| app1        | `0x210000` | `0x200000` |
| athan_audio | `0x410000` | `0x380000` |

Exactly two distinct image files are permitted. Factory data starts at zero and ends at or before the audio partition; audio occupies exactly the shared partition. Wrong hardware, unknown layouts/protocols, missing audio, unsafe filenames, overlapping/out-of-range writes, invalid sizes and hashes are rejected. The reserved tail is not an image-write target.

After explicit new-install confirmation, the browser checks the served manifest and binaries again, then esptool-js identifies the chip, flash capacity and security state. Unsupported or secured devices are rejected before writing. A fresh installation **erases the whole flash**, including existing settings and history, then writes both images without changing the producer's headers. esptool verification plus independent per-image flash MD5 checks must pass before reboot/success. MD5 here checks written data against already SHA-256-verified artifacts; it is not the release authenticity mechanism. No automatic flash retry occurs. A verified flash that cannot reconnect directs the user to setup recovery.

The flashing transport releases its output lock even when a USB write rejects. It also listens for the port's physical disconnect event, which interrupts pending reads and writes even if the browser never settles the write promise. Further output on that failed connection is blocked, and final cleanup has a five-second deadline so it cannot keep the page busy forever. After a communication failure, unplug the cable, reload the page and deliberately reconnect. A cleanup error cannot hide the original installation failure. This adapter retains pinned esptool-js 0.7.0 framing and does not change firmware images.

## Validation boundaries and public-launch prerequisites

Development preview scenarios select new, existing, unrecognized or unreadable device state independently of the connection action. Simulator routes stay excluded from production.

Unit tests exercise Python-compatible framing, fragmentation, checksums, malformed data, timeouts, command serialization, uncertain writes and release rejection. Fake-programmer tests require confirmation, compatible hardware and successful flash readback before completion. Recovery tests assert that the flasher is never called. Browser tests cover complete simulated installation/recovery, denied/busy ports, disconnects, wrong Wi-Fi credentials, password validation, storage faults, uncertain acknowledgements, unsupported browsers, focus and narrow layouts.

These simulations establish software behavior only. They do not establish USB reliability, bootloader entry, physical writes, power-cycle behavior, audible playback or durable preservation. Release maintainers must retain source-bound physical qualification evidence for the applicable behaviors below. Reuse accepted evidence where applicable, state untested changes, and coordinate new hardware testing when required; automatic website adoption does not repeat or establish these results:

1. Fresh installation in desktop Chrome and Edge, both images verified, followed by actual device-hosted setup and activation.
2. Interrupted-flash recovery, failed downloads/verification, wrong-device rejection and supported bootloader/reconnect behavior.
3. Network scan/manual/hidden-network entry, incorrect credentials, lost acknowledgements, device-password creation/reset and storage-fault handling.
4. Recovery preservation checks for current settings, prayer-consumption history, shared audio and recovery capability, including interruptions and power cycles.
5. Recording licensing/content/quality approval, firmware release qualification and approved stable publication. Website adoption follows the reviewed automatic-release policy.
6. Before enabling USB updates: capable confirmed firmware and approved rollback bootloader; desktop Chrome/Edge streaming and exact version confirmation; Atom-only transfer then bottom-power startup; preservation readback; disconnect/power cuts before and after selection; failed startup rollback; invalid/truncated/out-of-order traffic; competing Wi-Fi/USB/settings actions; runtime heap, fragmentation and prayer/audio responsiveness. Prior fresh-install or Wi-Fi update evidence does not establish this new transport.

Use the firmware repository's current hardware runbooks and fresh private backups for coordinated acceptance. Historical full-flash images can roll back prayer history and are not routine credential recovery. Keep private diagnostics, credentials and recovery images outside this repository. Published recordings are imported only through the reviewed release manifest; never commit generated binaries.
