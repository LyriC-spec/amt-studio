# Docker installation

The container is a Linux image for `linux/amd64` and `linux/arm64`. Use Docker Engine with Compose v2 on Linux, or Linux containers in Docker Desktop on Windows/macOS. The web UI works across operating systems. Hardware and Docker Desktop networking can differ; verify LAN/VPN reachability from the container and browser.

## 1. Download the project

```sh
git clone https://github.com/LyriC-spec/amt-studio.git
cd amt-studio
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed. Edit `.env`: keep `127.0.0.1` for local access or set `AMT_LISTEN_ADDRESS` to the server's actual LAN address. Do not forward this management service directly to the Internet; use your existing VPN.

## 2. Create or install a TLS certificate

The server requires TLS for a non-loopback bind. Provide `tls/server.crt` and `tls/server.key`. For a certificate issued by your CA, use the full certificate chain in `server.crt` and its unencrypted private key in `server.key`. Restrict filesystem access to the key.

For a local self-signed certificate on Linux/macOS, replace `amt.example.test` with the DNS name you will actually open:

```sh
mkdir -p tls
openssl req -x509 -newkey rsa:3072 -nodes \
  -keyout tls/server.key -out tls/server.crt -days 365 \
  -subj '/CN=AMT Studio' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:amt.example.test'
openssl x509 -in tls/server.crt -noout -fingerprint -sha256
```

If you browse by IP, add `IP:YOUR_SERVER_IP` to the subject alternative names, replacing that placeholder with the actual address. Do not use a DNS entry for a numeric IP.

Alternatively, with Node.js and OpenSSL installed, `npm run tls:init -- amt.example.test` creates the same files. It accepts a DNS name or IP address and refuses to overwrite existing keys. On Windows it also detects OpenSSL installed by Git for Windows; `OPENSSL_BIN` can select another executable.

The container runs as UID/GID 1000. On Linux, grant that user access:

```sh
sudo chown -R 1000:1000 tls
sudo chmod 700 tls
sudo chmod 600 tls/server.key
sudo chmod 644 tls/server.crt
```

On Docker Desktop, ensure its file sharing can read the directory. Verify the SHA-256 fingerprint before accepting a self-signed certificate in your browser. This certificate is valid for 365 days; replace it before expiry and recreate the container. Never commit `tls/` to Git.

## 3. Start and create the first account

```sh
docker compose up -d --build
docker compose ps
docker compose exec amt-studio cat /data/setup-token.txt
```

Wait for `healthy`, then open `https://localhost:9443` (or your configured server address). Use the setup token to create an administrator account. The token file is deleted after successful setup. There is no shared default login. Treat the token as a secret and do not paste it into issues.

If a build fails, inspect its output; if the container exits, run `docker compose logs --tail=100 amt-studio`. Remove credentials and identifying data before sharing logs.

## Prebuilt release image

The [GitHub releases](https://github.com/LyriC-spec/amt-studio/releases) provide separate Docker image archives for AMD64 and ARM64, with SHA-256 checksum files. Choose the archive matching your Docker host. No registry account is needed. Wait for the release build to finish if the assets are still being generated.

For example, after downloading the AMD64 archive and checksum into the project directory:

```sh
sha256sum -c amt-studio-0.3.1-linux-amd64.tar.gz.sha256
docker load -i amt-studio-0.3.1-linux-amd64.tar.gz
docker compose up -d --no-build --pull never
```

For ARM64 use the `linux-arm64` files. On PowerShell, compare `Get-FileHash -Algorithm SHA256` with the checksum file instead of `sha256sum`. Prepare TLS before starting Compose. The archive loads `amt-studio-web:0.3.1`, matching the default Compose image. `AMT_IMAGE` can override the image name when using your own registry.

To build both architectures yourself, use `docker buildx bake`; the builder needs native workers for both platforms or QEMU emulation. Add an appropriate image tag and `--push` only when publishing to your own registry.

## Network paths

| From | To | Purpose |
| --- | --- | --- |
| Browser | Teamserver TCP 9443 | HTTPS and WebSocket |
| Teamserver | AMT TCP 16993 | TLS management |
| Teamserver | AMT TCP 16995 | KVM, SOL and storage redirection |
| Teamserver | JetKVM HTTP/HTTPS port | Local login, signaling and uploads |
| Browser | JetKVM WebRTC endpoints | Direct video and input; negotiated network ports |

Do not assume JetKVM video goes through the Docker server. No TURN relay, cloud connection or automatic VPN is configured. A proxy must support WebSockets and large uploads. If using a reverse proxy, configure `AMT_PUBLIC_ORIGIN` to the exact browser origin and preserve Host/origin handling; keep the proxy-to-server leg protected. The bundled Compose file uses direct HTTPS and has no proxy dependency.

## Updates and backups

See the dedicated [update guide (German)](../UPDATE.md) for the 0.3.1 archive workflow, backups, version selection, verification and rollback.

An update interrupts console sessions. Before changing versions, stop the container and back up the complete named `amt-data` volume plus `tls/` and `.env`. The volume contains device records, user hashes, `vault.key`, audit records and the AMT media library. **Devices without the matching vault key cannot have their saved passwords recovered.** Keep backups private and encrypted.

For source builds, pull the intended revision and run `docker compose up -d --build`. For a release archive, verify its checksum, load it with `docker load`, set `AMT_IMAGE` if its version differs from the Compose default, then run `docker compose up -d --no-build --pull never`. Check the health status afterward. Restore backups only into a stopped instance; do not run two writers against the same data volume. `docker compose down -v` deletes the application data and must not be used as an update command.

## Local development

Use Node.js 24. `npm ci && npm run start:web` builds and serves on `http://127.0.0.1:9443` with a new `team-data/` directory. Read `team-data/setup-token.txt` to set up this separate development instance. This loopback-only HTTP mode is for local development; do not change its bind address without TLS.

`npm run dev` is the Vite frontend server, not a complete management backend. Use `npm run start:web` for functional local testing.
