# Changelog

## v0.3.0 (2026-04-15)
- Strom-Erweiterung: PV/BKW-Modus eingefuehrt (`bkw.mode: bkw|pv`) fuer klarere Bezeichnungen in der Karte
- Reihenfolge der Bereiche optimiert: Kostenblock vor PV/BKW-Block
- Amortisationsbereich wird nur noch automatisch angezeigt, wenn `amortization` explizit konfiguriert ist
- Einspeiselimit wird in der UI aus `bkw.feed_in_limit_w` gelesen (kein harter 800-W-Wert mehr)
- Kostenblock-Beschriftung wechselt passend zwischen `BKW-Ersparnis` und `PV-Ersparnis`

## v0.2.1 (2026-04-15)
- UI-Fix: Im Kostenblock wird `BKW-Ersparnis` nur noch angezeigt, wenn PV/BKW wirklich konfiguriert ist
- Bei reiner Strom-/Tarifkonfiguration ohne PV/BKW bleibt der BKW-Teil ausgeblendet

## v0.2.0 (2026-04-15)
- Strom-Erweiterung: Tarif- und Kostenblock fuer die Hochrechnung dokumentiert und integriert
- Kostenbereich wird automatisch nur dann gezeigt, wenn `tariff` und `billing` gemeinsam konfiguriert sind
- Neue Plausibilitaetswarnungen fuer Teil-Konfigurationen (`tariff` ohne `billing` bzw. `billing` ohne `tariff`)
- README um klaren Konfigurationsblock fuer Tarife/Kosten erweitert

## v0.1.1b (2026-04-15)
- Hotfix: HACS Repository-Struktur fuer Dashboard-Validierung korrigiert
- `hacs.json` in den Repository-Root verschoben
- Live-Bundle als Root-Datei `ha-energie-monitoring.js` bereitgestellt
- README-Resource-Pfade auf die Root-Datei aktualisiert

## v0.1.1a (2026-04-12)
- Hotfix: saubere Trennung von Dev- und Live-Kartentypen umgesetzt
- Live registriert nur noch `custom:energie-monitoring-card`
- Legacy-Alias `custom:strom-monitoring-card` aus Live-Build entfernt
- README um klare Typ-Zuordnung fuer paralleles Testen erweitert

## v0.1.0 (2026-04-12)
- Erste Strom-Uebersicht als offizieller Start der neuen Release-Linie fertiggestellt
- Einsteigerfreundliche Basis-Konfiguration mit Fokus auf klare Pflichtwerte umgesetzt
- Soll/Ist-Ansicht fuer Stromverbrauch mit Ziel-/Referenzlogik bereitgestellt
- Dokumentation fuer den Einstieg strukturiert (inkl. Beispielbilder im `images`-Ordner)
