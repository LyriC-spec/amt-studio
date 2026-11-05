# Verification scope

## Automated coverage

The suite covers HTTP authentication, CSRF/origin enforcement, tab/session isolation, group permissions, credential encryption, certificate trust, snapshots, AMT redirection, keyboard encoding, read-only media sectors, JetKVM authentication and media-upload authorization/streaming. TLS tests create temporary certificates with OpenSSL.

AMT media regression tests exercise next-boot activation flags, image-specific capacity, TOC lead-out/track selection and response lengths, disc/track information used by Linux probes, medium-ready sense codes, firmware error reporting and exact reads across the 2 GiB boundary. They also check idle PING/PONG traffic, the optional zero-filled USB-R companion drive, short mode-sense replies and write rejection. These run in the ARM64 and AMD64 Docker verification stages too. They verify protocol responses with simulated firmware; they do not establish that a particular ISO boots on real hardware.

Browser fixtures exercise login/status refresh, persisted settings, device editing, AMT KVM/SOL transport, JetKVM WebRTC video, keyboard and mouse packets, media workflows and ATX confirmations. They include actual browser WebRTC peers but a **simulated device**, not a remote physical computer. Confirmed ATX actions in these tests affect only the fixture.

Docker verification executes HTTP/session/snapshot/JetKVM integration tests inside each target architecture. CI builds both `linux/amd64` and `linux/arm64`; emulated architecture tests are not a substitute for physical hardware validation.

## Hardware observations from development

AMT login/status, KVM frames and SOL setup were exercised on a limited development set. JetKVM firmware **0.5.3** was exercised for login, live H.264 video at 1920 × 1080, media/extension status, and upload/delete of an isolated small test file. Device identities and captures from that environment are deliberately not published.

On 5 November 2026, an AMT media compatibility build booted `ubuntu-26.04.1-live-server-amd64.iso` to the installer language selection on a **MS-02 Ultra, BIOS 1.04, AMT 19.0.5**, served by an ARM64 teamserver. The image SHA-256 matched Ubuntu's published checksum. The test used the empty USB-R companion drive and the temporary GRUB parameter `pcie_port_pm=off` to avoid a separate PCIe error storm; see the [FAQ](FAQ.md#ms-02-ultra-repeated-pcie-acsaer-errors-during-linux-boot). No installation or partitioning was performed. This validates that combination, not an entire installation or other firmware/image combinations. KVM sometimes required reconnecting after `ECONNRESET`; the media fix does not claim to resolve that separate symptom.

Physical **JetKVM** ATX Power/Reset and real JetKVM target mounting/booting were **not** exercised. The real JetKVM had no ATX extension selected. Other JetKVM firmware versions, browsers, GPU combinations and networks may behave differently. A supported-looking UI control is not evidence that a particular device has the necessary hardware or permissions.

## Screenshot provenance

`scripts/docs-screenshots.cjs` starts a temporary loopback server, seeds fictional devices using documentation addresses and replaces management calls with synthetic responses. The three designs and their light/dark variants are real app renders. No production login, network address, host image or credential file is used.

Do not describe this project as independently audited or universally compatible. Report actual test conditions when contributing compatibility results.
