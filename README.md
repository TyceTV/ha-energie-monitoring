# Energie-Monitoring-Card

Eine Home-Assistant-Karte fuer ein schrittweises Energie-Monitoring.

Aktueller Fokus:
1. Strom-Basis (Hausstrom) einfach und uebersichtlich
2. Strom-Erweiterungen mit PV/BKW/Speicher
3. Optionale Module fuer Kosten und Amortisation

Geplante Erweiterung:
1. Gas
2. Wasser

## Installation

### HACS (empfohlen)
1. HACS -> Frontend -> Benutzerdefiniertes Repository hinzufuegen
2. Repository-URL: `https://github.com/TyceTV/strom-monitoring-card`
3. Typ: `Dashboard`
4. Installieren
5. Browser hart neu laden (`Strg+F5`)

Die Ressource wird normalerweise automatisch angelegt als:
- `/hacsfiles/strom-monitoring-card/strom-monitoring-card.js`

### Manuell
1. `strom-monitoring-card.js` nach `/config/www/` kopieren
2. `Einstellungen -> Dashboards -> Ressourcen -> Ressource hinzufuegen`
3. URL: `/local/strom-monitoring-card.js`
4. Typ: `JavaScript-Modul`
5. Browser hart neu laden (`Strg+F5`)

## Schnellstart

### 1) Technisch minimal

```yaml
type: custom:strom-monitoring-card
entity_grid_total_kwh: sensor.grid_energy_total
```

Beispielansicht (Minimal-Konfiguration):

![Minimalansicht der Strom Monitoring Card](images/ha-strom_minimal.png)

Was du bekommst:
- Live-Istwerte (Tag/Woche/Monat)
- technische Funktionspruefung der Karte
- fuer sinnvolle Bewertung mindestens `year_start_meter_kwh` setzen

### 2) Empfohlen (fuer sinnvolles Monitoring mit Auto-Berechnung)

```yaml
type: custom:strom-monitoring-card
entity_grid_total_kwh: sensor.stromzahler_verbrauch

report_year: "2026"
reference_year: "2025"
year_start_meter_kwh: 7454

targets:
  year_kwh: 3500
reference:
  year_kwh: 4065
```
Beispielansicht (Empfohlen-Konfiguration):

![Empfohlene Ansicht der Strom Monitoring Card](images/ha-strom_minimal_empfohlen.png)


Was du bekommst:
- Istwerte + Bewertung (Einsparung/Mehrverbrauch)
- Zielwerte werden automatisch aus Jahresfortschritt berechnet (wenn `targets` fehlen)
- Referenz wird automatisch aus `reference_year` abgeleitet oder auf Ziele gespiegelt (Auto-Referenz)
- Jahreswerte aus Zaehlerstand ab Jahresbeginn

## Woher kommen die Werte?

### Pflicht
- `entity_grid_total_kwh`
  - dein kumulativer Netzbezugszaehler in kWh
  - muss ein ansteigender Gesamtzaehler sein

### Jahresbasis
- `year_start_meter_kwh`
  - Zaehlerstand am 01.01. des Berichtsjahres
  - Beispiel: Wenn am 01.01. der Zaehler 7454 kWh hatte -> `7454`

### Jahre
- `report_year`
  - Jahr der aktuellen Beobachtung (z. B. `"2026"`)
- `reference_year`
  - Vergleichsjahr (z. B. `"2025"`)

### Ziele (`targets`)
- `targets` sind optional.
- Wenn gesetzt, nutzt die Karte exakt diese Werte.
- Empfohlen: nur `targets.year_kwh` setzen.
- Bedeutung: Das ist dein Jahresziel, also der Verbrauch, den du im laufenden Jahr erreichen willst.
- Wenn nicht gesetzt, berechnet die Karte automatisch:
  - `targets.year_kwh = (aktueller_zaehler - year_start_meter_kwh) / vergangene_tage * tage_im_jahr`
  - `targets.month_kwh = targets.year_kwh / 12`
  - `targets.day_kwh = targets.year_kwh / tage_im_jahr`
- `targets.day_kwh` und `targets.month_kwh` sind optional fuer Feintuning.

### Referenz (`reference`)
- `reference` ist optional.
- Wenn gesetzt, nutzt die Karte exakt diese Werte.
- Empfohlen: nur `reference.year_kwh` setzen.
- Bedeutung: Das ist dein Vorjahresverbrauch (z. B. aus der Stromrechnung), gegen den verglichen wird.
- Wenn nicht gesetzt:
  - mit `reference_year`: automatische Referenz aus Vorjahresverbrauch
  - ohne verwertbare Vorjahresdaten: Fallback auf `targets` (Hinweis als Plausibilitaetswarnung: Auto-Referenz aktiv)

## Wichtige Felder (Kurzueberblick)

- `thresholds.good_pct`: ab welcher negativen Abweichung als Einsparung gilt
- `thresholds.warn_pct`: ab welcher positiven Abweichung als Mehrverbrauch gilt
- `tariff.*`: Tarifdaten fuer Kostenrechnung
- `billing.*`: Referenzkosten/Abschlag
- `bkw.*`: Balkonkraftwerk-Basisdaten
- `ui.show_sections.*`: einzelne Bloecke ein-/ausblenden

## Lizenz

MIT

## Changelog

Siehe [CHANGELOG.md](./CHANGELOG.md)

## Mini-Glossar

- `kWh`: Kilowattstunde (Energieverbrauch/-erzeugung)
- `ct/kWh`: Cent pro Kilowattstunde (Arbeitspreis)


