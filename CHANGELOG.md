# Changelog

## 0.3.1 — media boot and KVM reconnection fixes

- Correct AMT image capacities, optical probes, response lengths and next-boot activation.
- Add optional read-only USB-R companion media for Linux and keep idle media sessions alive.
- Release orphaned browser redirections when WebSocket heartbeat replies stop; healthy tabs remain connected.
- Wait for the previous KVM session to finish stopping before reconnecting or changing color depth; clean up delayed starts after the console closes.
- Verify Ubuntu 26.04.1 Server up to installer language selection on MS-02 Ultra; document the separate temporary PCIe power-management workaround. No installation was performed.
- Publish tested ARM64 and AMD64 Docker archives with SHA-256 checksums.

## 0.3.0 — first public preview

- Docker/browser workspace for Intel AMT and JetKVM, with ARM64 and AMD64 builds.
- Shared device/group management, users and AMT group permissions.
- AMT KVM, SOL, virtual media, power and boot controls.
- JetKVM WebRTC console, media storage/URL workflows and ATX extension controls.
- Serein, Luma and Orbit layouts with light/dark modes and adjustable scale.
- Automatic status refresh and editable existing devices.
- Public documentation and synthetic screenshots; local deployment and credential-import helpers removed.

This is an early release. See [verification scope](docs/TESTING.md) and [security boundaries](SECURITY.md).
