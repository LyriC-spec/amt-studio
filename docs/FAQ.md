# Frequently asked questions

[Deutsche FAQ](FAQ.de.md) · [Installation](INSTALL.md)

## Is this a MeshCommander fork?

No MeshCommander application source is bundled. This is a separate interface and teamserver using Device Management Toolkit for KVM/storage decoding. Protocol references and third-party components are listed in [notices](../THIRD_PARTY_NOTICES.md). It does not replace every MeshCommander feature.

## Does any Intel PC support AMT?

No. The hardware/firmware must support Intel AMT, and AMT must already be provisioned. Enable the required KVM/SOL/redirection services through the device's supported setup. Some machines require local user consent. AMT Studio cannot add capabilities missing from the hardware or bypass consent requirements.

## Can I use this on Windows or macOS?

Yes, through a browser and a Linux Docker container. ARM64 and AMD64 images are supported. On Windows/macOS use Docker Desktop's Linux-container mode or a separate Linux server. This public distribution focuses on Docker; it does not ship native desktop installers.

## Why is the interface in German?

The project started with a German interface. English documentation is provided, but the UI has not yet been internationalized. Translation contributions are welcome.

## I can see the screen, but cannot type.

Consoles start in **Nur ansehen** (view-only). Choose **Tastatur & Maus aktivieren** and focus the remote screen. Match the keyboard selection to the target operating system; it does not change that system's layout. `Ctrl+Alt+Shift` releases AMT KVM input. Leaving the console releases held keys. JetKVM's view-only switch is a client-side input lock, not a restricted device credential.

## How do I edit an existing device?

Select it under **Geräte** and choose **Bearbeiten** in the detail pane. A name/group change preserves the saved password. An address, username or JetKVM protocol/port change clears old trust and status and requires a saved password to be re-entered. Saving closes that device's active sessions. You need the group's **manage** permission.

## Why must I confirm certificates?

AMT devices often use their own certificates. Compare the SHA-256 fingerprint with a trusted source before confirming it. A changed certificate or endpoint must be checked again. The browser's trust in the teamserver and the team's trust in a device are separate. Do not disable certificate checks to resolve a mismatch.

## What does AMT TLS compatibility mode do?

It enables compatibility with older AMT firmware lacking secure-renegotiation support. TLS renegotiation remains disabled. Enable it only when the target firmware needs it; it is not a certificate-verification bypass.

## Why does JetKVM connect but show no video?

The browser must reach the JetKVM directly over WebRTC, as well as reach AMT Studio. Check routing, VPN and firewall rules on both paths, and whether another client holds the device session. AMT Studio does not provide a TURN relay. Also check the HDMI input and target computer's video output.

## Why does an AMT installation fail to boot from an image?

Uploading alone does not activate redirection or select the boot source. Connect the ISO from **Medien**, keep that session open throughout installation, and select the one-time CD/DVD media boot in the AMT tools. The next-boot activation option waits for the next boot; it does not restart the target.

Check the image SHA-256 against its publisher's checksum. For an error such as “USB3 failed”, capture the exact text and boot stage, AMT/BIOS version, image filename, and any `mediaProtocol` activity entries. Those entries record the firmware error code, last SCSI opcode and bytes read. The message alone does not establish a USB 3 hardware defect. Remove device addresses and usernames before filing a public issue.

## How do virtual media work?

AMT images live in the teamserver's **Medien** library and are served read-only via storage redirection. JetKVM has its own **Medien** panel in the console: upload to its storage, select an existing file, or provide an HTTP/HTTPS URL. URL sources must support HTTP Range requests and be reachable from JetKVM. See the [official JetKVM media guide](https://jetkvm.com/docs/peripheral-devices/mount-drive).

An upload does not mount the image or reboot the target. Choose CD/DVD for an ISO or Disk for an IMG, then explicitly connect it. Unmount before replacing or deleting a mounted file. A JetKVM mount persists after closing the console. Incomplete uploads can leave `.incomplete` files for explicit cleanup. Uploads are limited to 64 GiB and available storage; an HTTP request also has a 30-minute server timeout.

## Why are ATX controls unavailable?

JetKVM needs an attached and correctly wired [ATX extension board](https://jetkvm.com/docs/extensions/atx-power-control). In **ATX**, choose the ATX extension only when this hardware is installed. This replaces the previously selected extension. Short Power, five-second Power and Reset each need confirmation. A dark LED input does not prove the target is off. Software cannot detect every missing cable or wiring error.

## Can ordinary users access JetKVM?

Devices can be listed according to group rights, but JetKVM consoles/media/ATX are administrator-only. WebRTC exposes privileged RPC commands and does not provide AMT-style restricted sessions. AMT group permissions cover viewing, input, power, SOL, media, boot and management separately.

## Why did login stop working after several attempts?

The server rate-limits logins per source IP, including successful logins. Wait ten minutes after a burst of attempts. Behind a shared proxy, users can share that limit. Sessions also expire after inactivity or their maximum lifetime; log in again rather than repeatedly refreshing a failing request.

## Where are credentials and backups?

Device credentials are encrypted in the data volume; user passwords are stored as scrypt hashes. The vault key is also in the volume. Back up the entire stopped instance, including the key, media and TLS files. Protect the backup as a secret. Do not upload it to an issue or repository. See [installation and backups](INSTALL.md#updates-and-backups).

## Can I expose it publicly or run multiple replicas?

Use a private management network/VPN. SSO, MFA and cluster coordination are not implemented. Run one writable server instance per volume. A reverse proxy alone does not supply these missing protections or the direct JetKVM network path.

## What should a bug report contain?

Version/image tag, CPU architecture, browser, device type, firmware version, reproducible steps and redacted error messages. Say whether the issue occurs with the device's own management interface. Never attach real credentials, vault files, setup tokens or unredacted remote-screen captures.
