# AMT Studio aktualisieren

Diese Anleitung beschreibt das Update einer bestehenden Docker-Installation auf **0.3.1**. Sie wurde nach der Veröffentlichung ergänzt und liegt auch als einzelne Datei beim [Release v0.3.1](https://github.com/LyriC-spec/amt-studio/releases/tag/v0.3.1). Die bereits veröffentlichten Docker-Archive und der Versions-Tag bleiben unverändert.

## Was in 0.3.1 enthalten ist

- Korrigierte AMT-Medienabfragen, Kapazitätsangaben und einmalige Startoptionen.
- Die ISO-Option **USB-R-Kompatibilität für Linux** und Keepalives für Medienverbindungen während Lesepausen.
- KVM-Wiederverbindungen und Farbtiefenwechsel warten auf das Ende der vorherigen Sitzung. Verzögert aufgebaute Verbindungen werden auch nach dem Schließen der Konsole beendet.
- Der Teamserver gibt Sitzungen nicht mehr antwortender Browserverbindungen nach ungefähr 30–60 Sekunden frei. Gesunde andere Tabs bleiben verbunden.

Details stehen im [Änderungsprotokoll](https://github.com/LyriC-spec/amt-studio/blob/v0.3.1/CHANGELOG.md) und in der [FAQ](https://github.com/LyriC-spec/amt-studio/blob/v0.3.1/docs/FAQ.md). Ein Firmware- oder Netzwerkabbruch selbst kann weiterhin auftreten. Für den beschriebenen PCIe-Fehler des MS-02 Ultra bleibt der dort erklärte temporäre Startparameter `pcie_port_pm=off` ein separates Hilfsmittel.

## 1. Passendes Docker-Archiv herunterladen

Im [Release](https://github.com/LyriC-spec/amt-studio/releases/tag/v0.3.1) stehen zwei Varianten:

| Docker-Host | Archiv |
| --- | --- |
| Intel/AMD x86-64 | `amt-studio-0.3.1-linux-amd64.tar.gz` |
| ARM64, beispielsweise Raspberry Pi 5 | `amt-studio-0.3.1-linux-arm64.tar.gz` |

Die jeweils gleichnamige Datei mit der Endung `.sha256` ebenfalls herunterladen. Entscheidend ist die Architektur des Docker-Hosts, nicht die des Rechners mit dem Browser. Docker Desktop muss Linux-Container verwenden. `docker info --format '{{.Architecture}}'` zeigt die Hostarchitektur.

Die folgenden Befehle im bisherigen Compose-Verzeichnis ausführen. Den Verzeichnisnamen beziehungsweise Compose-Projektnamen beibehalten, damit Docker dasselbe Datenvolume verwendet. Bei mehreren Compose-Dateien weiterhin dieselben `-f`-Optionen wie bisher verwenden.

## 2. Prüfsumme prüfen und Image laden

Für AMD64 unter Linux/macOS:

```sh
sha256sum -c amt-studio-0.3.1-linux-amd64.tar.gz.sha256
docker load -i amt-studio-0.3.1-linux-amd64.tar.gz
```

Unter macOS kann statt `sha256sum -c` der Befehl `shasum -a 256 -c` verwendet werden. Für ARM64 in beiden Dateinamen `amd64` durch `arm64` ersetzen. Erst bei passender Prüfsumme mit `docker load` fortfahren.

In PowerShell die SHA-256-Ausgabe vergleichen und anschließend das passende Archiv laden:

```powershell
Get-FileHash -Algorithm SHA256 .\amt-studio-0.3.1-linux-amd64.tar.gz
Get-Content .\amt-studio-0.3.1-linux-amd64.tar.gz.sha256
docker load -i .\amt-studio-0.3.1-linux-amd64.tar.gz
```

Beide Archive enthalten das Image-Tag **`amt-studio-web:0.3.1`**. Es ist kein Registry-Konto nötig; ein bloßes `docker compose pull` lädt diese Release-Archive nicht.

## 3. Sitzungen beenden und Daten sichern

Alle laufenden KVM-, SOL- und AMT-Medienverbindungen beenden. Während einer Installation über virtuelle Medien kein Update durchführen. Anschließend den Teamserver anhalten:

```sh
docker compose stop amt-studio
```

Das **vollständige Datenvolume** sowie `tls/`, die Compose-Dateien und gegebenenfalls `.env` sichern. Das Datenvolume enthält Geräte, Benutzerkonten, Medien, Protokolle und `vault.key`. Ohne den passenden Schlüssel sind gespeicherte Gerätekennwörter nicht wiederherstellbar. Die Sicherung enthält vertrauliche Daten und gehört nicht in ein öffentliches Repository.

Beispiel für eine Dateisicherung unter Linux/macOS, solange der gestoppte Container noch existiert:

```sh
backup_dir="backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup_dir"
container_id=$(docker compose ps -aq amt-studio)
docker cp "${container_id}:/data" "$backup_dir/data"
cp -a tls compose.yaml "$backup_dir/"
if [ -f .env ]; then cp -a .env "$backup_dir/"; fi
```

Prüfen, dass die Befehle erfolgreich waren und die Sicherung `data/vault.key` sowie die übrigen Daten enthält. Zusätzliche Compose-Override-Dateien ebenfalls sichern. Unter Windows oder bei verwalteten Docker-Servern kann stattdessen die vorhandene Volume-/Dateisicherung verwendet werden; sie muss dieselben Inhalte bei gestopptem Container erfassen.

## 4. Version auswählen und starten

In der vorhandenen `.env` diesen Eintrag setzen beziehungsweise aktualisieren; andere Einstellungen erhalten:

```dotenv
AMT_IMAGE=amt-studio-web:0.3.1
```

Das funktioniert mit der veröffentlichten Compose-Datei, deren `image`-Zeile `AMT_IMAGE` auswertet. Ist in einer älteren oder eigenen Compose-Datei ein Image fest eingetragen, stattdessen dort die Zeile des Dienstes `amt-studio` auf `image: amt-studio-web:0.3.1` ändern. Bind-Adresse, Ports, TLS-Pfade und Volume-Zuordnung beibehalten. Auch eine bereits in der Shell gesetzte Variable `AMT_IMAGE` muss auf die gewünschte Version zeigen; sie hat Vorrang vor `.env`.

```sh
docker compose up -d --no-build --pull never --wait --wait-timeout 90 amt-studio
docker compose ps amt-studio
```

`--no-build` verwendet das geladene Release-Image. Bei einem Fehler die Ausgabe und `docker compose logs --tail=100 amt-studio` prüfen. Ein anderer Build-Kontext in einer bestehenden Installation muss für diesen Weg nicht geändert werden.

**Kein `docker compose down -v` ausführen:** Das würde die Anwendungsdaten löschen. Für ein normales Update werden weder die Daten noch die TLS-Zertifikate neu angelegt.

## 5. Ergebnis prüfen

Der Container soll `healthy` melden und `amt-studio-web:0.3.1` verwenden. Danach die Browserseite neu laden und prüfen:

- Version **0.3.1** wird angezeigt.
- Anmeldung, bisherige Geräte, Gruppen, Benutzer und Medien sind vorhanden.
- Eine KVM-Verbindung lässt sich öffnen und wieder schließen.

Erscheint unerwartet die Ersteinrichtung statt der bisherigen Anmeldung, keine neue Einrichtung starten. Zuerst den Compose-Projektnamen und die Zuordnung des Datenvolumes prüfen. Ein versehentlich neues, leeres Volume kann diese Anzeige verursachen.

Falls nach einem Verbindungsabbruch noch eine Sitzung belegt ist: Die Live-Verbindung über das Banner wiederherstellen und KVM erneut öffnen. Unter **Medien → Aktive Umleitungen** kann eine eigene hängende KVM-Sitzung gezielt getrennt werden. Administratoren können auch fremde Sitzungen beenden; vorher prüfen, ob jemand daran arbeitet.

## Rückkehr zur vorherigen Version

Das bisherige Image und die Sicherung bis zum erfolgreichen Abschluss behalten. Bei einem fehlgeschlagenen Update den Dienst stoppen, das vorherige Image-Tag in `.env` beziehungsweise Compose wieder eintragen und mit demselben `up`-Befehl starten. Fehlt das alte Image lokal, dessen Release-Archiv erneut prüfen und laden.

Eine nötige Datenwiederherstellung nur bei gestopptem Dienst durchführen, einschließlich des zur Sicherung gehörenden Vault-Schlüssels. Keine zwei Server gleichzeitig auf dasselbe Datenvolume schreiben lassen. Bei späteren Versionen zusätzlich die jeweiligen Hinweise zu Datenmigrationen beachten.

## Selbst aus dem Quellcode bauen

Wer eigene Images baut, verwendet den Quellstand des gewünschten Tags, für diese Version `v0.3.1`. Lokale Anpassungen und Konfiguration vorher sichern. Nach dem Wechsel auf diesen Quellstand und der Datensicherung:

```sh
docker compose up -d --build --wait --wait-timeout 90 amt-studio
```

Image-Tag und Build-Kontext müssen zum ausgewählten Quellstand passen. Der vorgefertigte Release-Weg oben verwendet dagegen bewusst `--no-build`.
