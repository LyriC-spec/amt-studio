# Verification scope

## Automated coverage

The suite covers HTTP authentication, CSRF/origin enforcement, tab/session isolation, group permissions, credential encryption, certificate trust, snapshots, AMT redirection, keyboard encoding, read-only media sectors, JetKVM authentication and media-upload authorization/streaming. TLS tests create temporary certificates with OpenSSL.

AMT media regression tests exercise next-boot activation flags, image-specific capacity, TOC lead-out/track selection and response lengths, medium-ready sense codes, firmware error reporting and exact reads across the 2 GiB boundary. These run in the ARM64 and AMD64 Docker verification stages too. They verify protocol responses with simulated firmware; they do not establish that a particular ISO boots on real hardware.

Browser fixtures exercise login/status refresh, persisted settings, device editing, AMT KVM/SOL transport, JetKVM WebRTC video, keyboard and mouse packets, media workflows and ATX confirmations. They include actual browser WebRTC peers but a **simulated device**, not a remote physical computer. Confirmed ATX actions in these tests affect only the fixture.

Docker verification executes HTTP/session/snapshot/JetKVM integration tests inside each target architecture. CI builds both `linux/amd64` and `linux/arm64`; emulated architecture tests are not a substitute for physical hardware validation.

## Hardware observations from development

AMT login/status, KVM frames and SOL setup were exercised on a limited development set. JetKVM firmware **0.5.3** was exercised for login, live H.264 video at 1920 × 1080, media/extension status, and upload/delete of an isolated small test file. Device identities and captures from that environment are deliberately not published.

Physical ATX Power/Reset and real target mounting/booting were **not** exercised for this release. The real JetKVM had no ATX extension selected. Other JetKVM firmware versions, browsers, GPU combinations and networks may behave differently. A supported-looking UI control is not evidence that a particular device has the necessary hardware or permissions.

## Screenshot provenance

`scripts/docs-screenshots.cjs` starts a temporary loopback server, seeds fictional devices using documentation addresses and replaces management calls with synthetic responses. The three designs and their light/dark variants are real app renders. No production login, network address, host image or credential file is used.

Do not describe this project as independently audited or universally compatible. Report actual test conditions when contributing compatibility results.
