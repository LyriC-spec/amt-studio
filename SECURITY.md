# Security

AMT Studio controls management interfaces that can operate independently of the target OS. Deploy it only on networks where administrators are authorized to manage those devices.

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** feature for sensitive findings. Do not open a public issue containing credentials, exploit details for an unpatched vulnerability, a vault backup or screenshots of real systems. If private reporting is unavailable, open a minimal issue requesting a private contact channel without disclosing the vulnerability details.

The current 0.3 release line receives fixes as maintainer capacity allows. There is no guaranteed response time, professional support agreement or completed independent security audit.

## Deployment boundaries

- Use TLS and a trusted management LAN/VPN. Do not expose the server directly to the Internet. SSO and MFA are not implemented.
- Browser sessions use HttpOnly/SameSite cookies, origin and CSRF checks. User/group permissions are enforced by the server for AMT operations.
- Device passwords are encrypted with a key stored in the application volume. Protect the host and backups; possession of the volume and key permits decryption. Authentication hashes are not reversible passwords.
- The teamserver can connect to management endpoints selected by users with device-management permission. Give that permission only to trusted operators; use network-level egress controls where needed.
- HTTP JetKVM connections send local login traffic without TLS on the server-to-device leg. Use only a trusted network, or configure HTTPS with verified trust.
- JetKVM console/media/ATX are admin-only. A manipulated authorized client can send privileged WebRTC RPC calls; the view-only button is not an authorization boundary. A direct WebRTC connection is not guaranteed to be revoked by terminating teamserver signaling. JetKVM RPC actions are not all recorded in the teamserver audit log.
- The container uses UID 1000, a read-only root filesystem, dropped capabilities and a persistent data volume. These controls do not replace host security or firmware updates.
- Run one server instance per data volume. Never publish runtime files, setup tokens, certificates' private keys, logs or backups with the source code.

## Public examples

Documentation uses reserved example addresses and synthetic screenshots. Test credentials are only fixtures for temporary test servers, not working service credentials. The public-file check looks for common private-address and secret signatures; it is an additional check, not a complete secret scanner or security audit.
