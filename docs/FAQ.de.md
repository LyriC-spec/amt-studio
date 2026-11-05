# Häufige Fragen

[English FAQ](FAQ.md) · [Installation](INSTALL.md)

## Ist das ein MeshCommander-Fork?

Es wird kein MeshCommander-Anwendungsquellcode mitgeliefert. AMT Studio hat eine eigene Oberfläche und einen Teamserver. Für KVM- und Medien-Decodierung kommt Device Management Toolkit zum Einsatz; siehe [Fremdkomponenten](../THIRD_PARTY_NOTICES.md). Nicht jede MeshCommander-Funktion ist enthalten.

## Funktioniert AMT mit jedem Intel-Rechner?

Nein. Hardware und Firmware müssen Intel AMT unterstützen, AMT muss bereits eingerichtet sein, und die gewünschten Dienste müssen freigegeben sein. Je nach Gerät ist eine lokale Zustimmung erforderlich. Fehlende Hardwarefunktionen und Zustimmungsvorgaben lassen sich damit nicht umgehen.

## Ich sehe das Bild, kann aber nicht schreiben.

Zuerst **Tastatur & Maus aktivieren** wählen und in den entfernten Bildschirm klicken. Die Konsole startet im Ansichtsmodus. Die Tastaturauswahl muss zur Belegung auf dem Zielsystem passen; sie stellt dessen Betriebssystem nicht um. Bei AMT löst **Strg + Alt + Umschalt** die Eingabe. Beim Verlassen der Konsole werden gehaltene Tasten freigegeben.

## Wo ändere ich eine IP-Adresse?

Unter **Geräte** den Host auswählen und in den Details **Bearbeiten** anklicken. Bei unverändertem Zugang kann das Kennwortfeld leer bleiben. Bei geänderter Adresse, geändertem Benutzernamen oder geändertem JetKVM-Protokoll/Port wird ein vorhandenes Kennwort erneut benötigt. Zertifikatsvertrauen und alter Status werden zurückgesetzt. Speichern trennt laufende Sitzungen dieses Geräts.

## Warum muss ich Zertifikate bestätigen?

AMT-Geräte verwenden häufig eigene Zertifikate. Den SHA-256-Fingerabdruck mit einer vertrauenswürdigen Anzeige vergleichen und erst dann bestätigen. Nach einer Änderung erneut prüfen. Das Browserzertifikat des Teamservers und das Zertifikat des Zielgeräts sind zwei getrennte Verbindungen. Der AMT-TLS-Kompatibilitätsmodus für ältere Firmware umgeht diese Prüfung nicht.

## JetKVM ist verbunden, aber das Bild fehlt.

Der Browser muss JetKVM direkt über WebRTC erreichen können. Eine erreichbare AMT-Studio-Webseite allein reicht nicht. Routing, VPN, Firewall, eine eventuell bereits belegte Sitzung und HDMI-Ausgabe prüfen. Ein TURN-Relay ist nicht enthalten.

## Wo sind die Medien für JetKVM?

In der JetKVM-Konsole auf **Medien** klicken. Dort lassen sich ISO-/IMG-Dateien hochladen, vorhandene Dateien verbinden oder direkte HTTP-/HTTPS-URLs nutzen. Der URL-Server muss Range-Anfragen unterstützen und vom JetKVM erreichbar sein. Die Bibliothek in der Seitennavigation ist dagegen für Intel AMT.

Ein Upload verbindet noch kein Laufwerk und startet den Rechner nicht neu. Ein JetKVM-Medium bleibt auch nach dem Schließen der Konsole verbunden. Vor dem Löschen oder Ersetzen auswerfen. Ein abgebrochener Upload kann eine `.incomplete`-Datei hinterlassen. Die Uploadgrenze liegt bei 64 GiB und dem verfügbaren Speicher; serverseitig gilt außerdem ein Zeitlimit von 30 Minuten pro HTTP-Anfrage.

## Was brauche ich für ATX?

Eine angeschlossene und korrekt verkabelte JetKVM-ATX-Platine. Erst dann im Bereich **ATX** die Erweiterung auswählen. Das ersetzt eine zuvor gewählte andere Erweiterung. Power kurz, Power fünf Sekunden und Reset müssen jeweils bestätigt werden. Die LED-Anzeigen entsprechen den Eingängen der Platine; eine dunkle LED beweist nicht, dass der Rechner aus ist.

## Können mehrere Benutzer zusammenarbeiten?

Ja. Geräte und Gruppen liegen zentral auf dem Teamserver. Für AMT lassen sich Gruppenrechte vergeben. JetKVM-Konsolen samt Medien und ATX bleiben Administratoren vorbehalten, weil die WebRTC-Schnittstelle privilegierte Gerätefunktionen freigibt. „Nur ansehen“ ist dort nur eine Eingabesperre der Oberfläche.

## Warum wird die Anmeldung vorübergehend abgewiesen?

Die Anmeldung ist pro Quell-IP begrenzt; auch erfolgreiche Anmeldungen zählen. Nach vielen Versuchen zehn Minuten warten. Hinter einem gemeinsamen Proxy können mehrere Benutzer dasselbe Limit teilen. Abgelaufene Sitzungen erfordern eine neue Anmeldung.

## Was gehört in ein Backup?

Das vollständige Datenvolume bei gestoppter Anwendung, einschließlich `vault.key`, Benutzerdateien, Geräten und Medien. Dazu TLS-Dateien und `.env`. Ohne den passenden Tresorschlüssel sind gespeicherte Gerätekennwörter nicht wiederherstellbar. Backups enthalten Geheimnisse und gehören nicht in GitHub-Issues. `docker compose down -v` löscht das Datenvolume und ist kein Update-Befehl.

## Kann ich den Dienst direkt ins Internet stellen?

Für ein privates Verwaltungsnetz oder VPN verwenden. SSO, MFA und Clusterbetrieb sind nicht implementiert. Pro Datenvolume nur eine schreibende Serverinstanz betreiben. Ein vorgeschalteter Proxy ergänzt diese fehlenden Funktionen nicht automatisch.

## Was soll in einen Fehlerbericht?

Version, Containerarchitektur, Browser, Gerätetyp, Firmware, Schritte zum Nachstellen und bereinigte Fehlermeldungen. Bitte keine Kennwörter, echten Management-Adressen, Tresordateien, Einrichtungsschlüssel oder ungeschwärzten Konsolenbilder veröffentlichen.
