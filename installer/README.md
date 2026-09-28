# OpenAthan browser installer

The `/install/` wizard supports two explicit paths: **Install a new device** and **Fix Wi-Fi or password**. Supported reference hardware is M5Stack AtomS3R C126 + Pyramid A167, with an unlocked ESP32-S3 and 8 MiB flash. USB setup targets desktop Chrome and Edge with Web Serial in a secure context. The documentation at `/docs/` remains available in other browsers.

The current catalog has no release. Installation is disabled before the USB picker. Command-only recovery is implemented, but physical browser qualification remains pending. Review `/preview/installer/` on the development server to exercise the complete wizard safely. Its injected simulator transport cannot reach Web Serial or the flasher; its route and code are excluded from the static build. Both example addresses are clickable and open `/preview/device/` in a new tab, a clearly labelled local handoff preview. They never navigate to the example hostname or LAN IP. Actual device addresses open the reported local device URL. No firmware or recording fixtures are served.

## Protocol and session ownership

The implementation follows the firmware [provisioning handoff](https://github.com/OpenAthan-Project/openathan/blob/d376d4e3e59b59e3b7b26910768d630048c9839e/firmware/esphome/provisioning/README.md) and [Python protocol tests](https://github.com/OpenAthan-Project/openathan/blob/d376d4e3e59b59e3b7b26910768d630048c9839e/tests/test_provision_device.py). No firmware API change is required.

- Improv Serial v1: Wi-Fi credentials (1), device information (3), network scan (4).
- OpenAthan v1 extension: status (1), device password (2). Maintenance/test commands are not exposed.
- One serial owner, one reader, one writer and one outstanding command; concurrent commands are rejected. Provisioning uses 115200 baud. Readers, writers and the port are released before flashing or returning control.
- Frames validate version, checksums, lengths and UTF-8. Partial frames expire after one second. Initial firmware discovery has a combined 10-second deadline after the port opens: identification gets up to 5 seconds, then status uses the remaining time. The normal 40-second command deadline covers firmware's 30-second Wi-Fi join timeout.
- Wi-Fi and password writes are sent once. Missing/malformed acknowledgements or disconnects yield an uncertain outcome and block further writes in that session. Read-only status is permitted. A connected status does not identify the attempted SSID and cannot prove that an uncertain Wi-Fi write succeeded. Reconnection and a deliberate user decision are required before any later attempt.
- Error 255 during either credential save triggers a read-only status check. A reported storage/password/setup fault or unreadable status blocks further changes; a healthy status allows a deliberate retry without claiming that the rejected save succeeded. Recovery also offers **Refresh status** to detect Wi-Fi reconnection and updated device links using the existing USB session, without writing credentials. **Open device settings** uses the same check before displaying device links; neither action can leave a previous healthy status authorizing changes after a failed read.
- SSIDs are 1–32 UTF-8 bytes; Wi-Fi passwords are 8–63 UTF-8 bytes or exactly 64 hexadecimal ASCII characters (0–9, A–F, a–f). Embedded nulls are rejected, and credentials are never trimmed or truncated. Device passwords are 12–128 printable ASCII characters, matching the firmware.

Credentials are held only in temporary browser memory, removed from forms after submission and never logged, stored, added to URLs or sent to analytics. JavaScript strings cannot be guaranteed to be physically zeroed; transmitted byte buffers are cleared after writing. Avoid browser tracing with real credentials. The site opens only validated device-reported local links chosen by the user; it does not call the device's HTTP API across origins.

Recovery never imports or invokes the flashing adapter, erase operations or settings/history commands. Unrecognized firmware receives troubleshooting guidance. Recognized OpenAthan firmware on the installation path is directed to recovery, including when its status is unreadable. A failed recognition probe is not permission to erase: new installation requires a separate explicit hardware/full-erasure confirmation. Existing-device upgrades are outside this version.

## Reviewed release import

The website imports exactly one reviewed, stable, published release from `OpenAthan-Project/openathan`. It does not use `latest`, build firmware, accept local binary uploads or fetch user-provided manifest URLs.

Current `catalog.json`:

```json
{ "schema": 1, "release": null }
```

A later release-selection PR must provide a catalog entry of this shape:

```json
{
  "schema": 1,
  "release": {
    "tag": "v1.0.0",
    "manifestSha256": "<64 lowercase hexadecimal characters>",
    "mediaReviewed": true,
    "hardwareQualified": true
  }
}
```

The approval fields record completed human review; they are not substitutes for it. That PR must link the recording rights/attribution review and physical qualification evidence. Keep this preview's catalog null until those prerequisites and firmware publication are complete.

Run `npm run release:import` after selecting a release. The importer checks GitHub's published release identity, exact asset names/URLs, the tag's commit, byte limits and all SHA-256 values. It downloads only the selected manifest and its two binaries, verifies them, and writes ignored static files under `public/releases/<tag>/`. With a null catalog it performs no network request. Remove obsolete generated release directories when changing or clearing the pin; the build rejects extra binaries. CI imports and verifies the same pin before building. Browser downloads enforce byte limits while streaming (16 KiB for the manifest and each image’s declared size), independently of response headers; failed streams are cancelled before verification or flashing.

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

## Validation boundaries and public-launch prerequisites

Unit tests exercise Python-compatible framing, fragmentation, checksums, malformed data, timeouts, command serialization, uncertain writes and release rejection. Fake-programmer tests require confirmation, compatible hardware and successful flash readback before completion. Recovery tests assert that the flasher is never called. Browser tests cover complete simulated installation/recovery, denied/busy ports, disconnects, wrong Wi-Fi credentials, password validation, storage faults, uncertain acknowledgements, unsupported browsers, focus and narrow layouts.

These simulations establish software behavior only. They do not establish USB reliability, bootloader entry, physical writes, power-cycle behavior, audible playback or durable preservation. Before enabling an installation release or publicly launching, explicitly coordinate testing on reference hardware and complete at least:

1. Fresh installation in desktop Chrome and Edge, both images verified, followed by actual device-hosted setup and activation.
2. Interrupted-flash recovery, failed downloads/verification, wrong-device rejection and supported bootloader/reconnect behavior.
3. Network scan/manual/hidden-network entry, incorrect credentials, lost acknowledgements, device-password creation/reset and storage-fault handling.
4. Recovery preservation checks for current settings, prayer-consumption history, shared audio and recovery capability, including interruptions and power cycles.
5. Recording licensing/content/quality approval, firmware release qualification and a separately reviewed public deployment.

Use the firmware repository's current hardware runbooks and fresh private backups for coordinated acceptance. Historical full-flash images can roll back prayer history and are not routine credential recovery. Keep diagnostics, credentials, recovery images and recordings outside this repository. This preview does not modify the current speaker.
