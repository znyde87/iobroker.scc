# Changelog

All notable changes to this project are documented here.  
Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows **SemVer** ([semver.org](https://semver.org/)), as used in ioBroker development.  
Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/). Die Versionierung folgt **SemVer** ([semver.org](https://semver.org/)).

---

## [Unreleased]

### Added / Hinzugefügt

- **EN:** **VIS 2 widget** `sccHouseFlow`: House flow diagram (PV, battery, grid, load) as React/TypeScript widget; built with Vite from `vis2-widgets/`, output in `widgets/scc/` (customWidgets.js, assets). io-package.json `visWidgets` and root script `npm run build:widgets` (install + Vite build + copy).  
  **DE:** **VIS-2-Widget** `sccHouseFlow`: Haus-Fluss-Diagramm als React/TypeScript-Widget; Build mit Vite aus `vis2-widgets/`, Ausgabe in `widgets/scc/`. io-package.json `visWidgets` und Skript `npm run build:widgets`.

---

## [0.3.6] – 2026-02-25

### Added / Hinzugefügt

- **EN:** **Adapter options** for **Wallbox** and **Wärmepumpe** (heat pump): optional state IDs for power (W); when enabled, the Flow diagram shows the corresponding connection lines and the values appear in the sources table (Quellen).  
  **DE:** **Adapter-Optionen** für **Wallbox** und **Wärmepumpe**: optionale State-IDs für die Leistung (W); bei Aktivierung zeigt das Fluss-Diagramm die zugehörigen Anschlusslinien und die Werte erscheinen in der Quellen-Tabelle.
- **EN:** **Flow diagram:** House image switches to the variant **with heat pump** (Wärmepumpe) when the heat pump option is enabled in the adapter config; otherwise the standard house image is used.  
  **DE:** **Fluss-Diagramm:** Das Hausbild wechselt auf die Variante **mit Wärmepumpe**, wenn die Option Wärmepumpe in der Adapter-Konfiguration aktiv ist; sonst wird das Standard-Hausbild verwendet.
- **EN:** **Sources table (Quellen):** Wallbox and Wärmepumpe are shown in the „Quellen“ list with their current power (W/kW) when they are configured in the adapter.  
  **DE:** **Quellen-Tabelle:** Wallbox und Wärmepumpe erscheinen in der Liste „Quellen“ mit aktueller Leistung (W/kW), wenn sie in der Adapter-Konfiguration aktiviert sind.

### Changed / Geändert

- **EN:** **Flow diagram lines:** Removed separate tail (Schweif) paths and tail CSS/keyframes. Stroke is again set via CSS only (uniform animated dashes with glow); comet/meteor gradient on stroke was reverted because it did not render correctly on curved paths.  
  **DE:** **Fluss-Linien:** Separate Schweif-Pfade und Tail-CSS/Keyframes entfernt. Stroke wieder nur per CSS (einheitliche animierte Striche mit Glow); Kometen-Gradient auf dem Stroke wurde zurückgenommen (Darstellung auf gekrümmten Pfaden fehlerhaft).

---


## [0.3.5] – 2026-02-22

### Added / Hinzugefügt

- **EN:** Configurable **Admin port** (Socket fallback) in adapter settings: when the Flow page is opened outside the admin (e.g. bookmark, VIS), the socket can connect to this port; 0 disables fallback. Hint text in config.  
  **DE:** Einstellbarer **Admin-Port** (Socket-Fallback) in den Adapter-Einstellungen; 0 = kein Fallback. Hinweistext in der Konfiguration.
- **EN:** Standalone server exposes **GET /api/config** (returns `adminPort`) so the Flow page uses the configured port for socket fallback.  
  **DE:** Standalone-Server liefert **GET /api/config** (adminPort) für den Socket-Fallback.

### Fixed / Behoben

- **EN:** **Standalone port** was not read from config (missing in normalized `this.config`); Flow page now starts correctly on the configured port.  
  **DE:** **Standalone-Port** wurde nicht aus der Konfiguration gelesen; Flow-Seite läuft nun unter dem konfigurierten Port.
- **EN:** **Battery SoC** and **PV forecast** now work with foreign states: use `getForeignStateAsync` / `getForeignObjectAsync` so states from other adapters (e.g. Modbus, DWD) are read correctly.  
  **DE:** **Batterie-SoC** und **PV-Vorhersage** nutzen jetzt `getForeignStateAsync` für fremde States (z. B. Modbus, DWD).
- **EN:** SoC available earlier: second delayed read (10 s), and in each tick missing SoC is refilled once from the state.  
  **DE:** SoC früher verfügbar: zweiter verzögerter Lauf (10 s) und im Tick Nachladen fehlender SoC-Werte.
- **EN:** **lastFilledIdx** for battery display: use `Math.floor(socPercent/20)-1` so the correct topmost filled segment pulses (e.g. 49% → segment 1).  
  **DE:** Oberstes gefülltes Segment pulsiert korrekt (z. B. bei 49%).

### Changed / Geändert

- **EN:** **Repository checker (Issue #9):** io-package.json `licenseInformation` with `type`, `license`, `link`; `native.adminPort`; package.json keywords include `ioBroker`; admin jsonConfig size attributes (xs, md, lg, xl) for tab_general items; README License section with Copyright (c) 2026 ioBroker and current version 0.3.5.  
  **DE:** Repository-Checker: licenseInformation, adminPort, Keywords, jsonConfig-Größen, README Copyright/Version.
- **EN:** **Standalone Flow page:** If `/api/flowData` is available, the page runs in standalone mode (no socket.io load, no 404s); data only via fetch. Admin port for fallback is read from `/api/config`.  
  **DE:** Flow-Seite im Standalone: Bei `/api/flowData` kein Socket.io-Load; Fallback-Port aus `/api/config`.
- **EN:** **Battery display:** Only the topmost filled segment pulses (charging/discharging); stronger green (#00c853); exact transform matrix for user-defined quad; grey background and border of outline removed.  
  **DE:** Batterie-Anzeige: Nur oberstes Segment pulsiert; kräftigeres Grün; Matrix-Transform für Viereck; grauer Hintergrund und Rand entfernt.
- **EN:** **Health check:** No longer logs warnings (still runs and writes to `info.health`).  
  **DE:** Health-Check schreibt keine Warnungen mehr ins Log.

---

## [0.3.4] – 2026-02-20

### Fixed / Behoben

- **EN:** Flow tab object picker: when the admin returns state IDs with instance prefix (e.g. `scc.0.shelly.0....`), the selected ID is now normalized to the real device state (e.g. `shelly.0....`) so rules write to the correct state and the "has no existing object" warning is avoided.  
  **DE:** Flow-Tab Objekt-Picker: Liefert der Admin State-IDs mit Instanz-Prefix (z. B. `scc.0.shelly.0....`), wird die gewählte ID nun auf den echten Geräte-State (z. B. `shelly.0....`) normalisiert, damit Regeln in den richtigen State schreiben und die Meldung „has no existing object“ entfällt.

### Changed / Geändert

- **EN:** README troubleshooting clarifies that this adapter does not create any state for switching; the configured output/target state belongs to the device adapter (e.g. Shelly).  
  **DE:** README Fehlerbehebung: Dieser Adapter legt keinen State zum Schalten an; der konfigurierte Ausgangs-/Ziel-State gehört zum Geräte-Adapter (z. B. Shelly).

---

## [0.3.3] – 2026-02-20

### Changed / Geändert

- **EN:** All adapter log messages (info, warn, error, debug) and health-check texts are now in English; rule debug and pidDebug.reason also in English.  
  **DE:** Alle Adapter-Logs (info, warn, error, debug) und Health-Check-Texte sind jetzt auf Englisch; Regel-Debug und pidDebug.reason ebenfalls.
- **EN:** Main README is in English; German version moved to `doc/de/README.md`; `admin/widgets/README.md` in English.  
  **DE:** Haupt-README auf Englisch; deutsche Fassung nach `doc/de/README.md` verschoben; `admin/widgets/README.md` auf Englisch.
- **EN:** Repository checker fixes (Issue #9): io-package.json – `common.news` as object (version-keyed), `licenseInformation`, `tier`, `globalDependencies` (admin), `adminTab.name` as object; removed deprecated `title`, `license`, `licenseUrl`, `languages`; admin jsonConfig: size attributes (xs, md, lg, xl) for tab_general fields; README Changelog section; `.commitinfo` in `.gitignore`.  
  **DE:** Repository-Checker-Anpassungen (Issue #9): io-package.json – `common.news` als Objekt, `licenseInformation`, `tier`, `globalDependencies`, `adminTab.name` als Objekt; veraltete Felder entfernt; Admin-Config Größenattribute; Changelog-Abschnitt in README; `.commitinfo` in `.gitignore`.

---

## [0.3.2] – 2026-02-19

### Added / Hinzugefügt

- **EN:** PID control: full implementation with process variable, setpoint, P/I terms, output in %; output capped; overtemperature protection for PID rules; rules configurable via Flow tab; PID simulation and debug in Flow.  
  **DE:** PID-Regelung: Vollständige Implementierung mit Istwert, Sollwert, P-/I-Anteil, Ausgang in %; Übertemperatur-Schutz; Regeln über Flow konfigurierbar; PID-Simulation und -Debug im Flow.
- **EN:** Overtemperature protection: optional states `tempLimitStateId` and `tempLimitMax` in config, Flow and jsonConfig.  
  **DE:** Übertemperatur-Schutz: optionale States `tempLimitStateId` und `tempLimitMax` in Konfiguration, Flow und jsonConfig.
- **EN:** PID device card shows “Current temperature” when overtemperature state is configured.  
  **DE:** PID-Karte (Geräte): Anzeige „Aktuelle Temperatur“, wenn Übertemperatur-State konfiguriert ist.

### Changed / Geändert

- **EN:** PID card under devices wider (min 320px, max 420px); label “Overtemperature” → “Current temperature”; rules use `getForeignStateAsync`.  
  **DE:** PID-Karte unter Geräte breiter; Bezeichnung „Übertemperatur“ → „Aktuelle Temperatur“; Rules nutzen `getForeignStateAsync`.

---

## [0.3.0] – 2025-02-17

### Added / Hinzugefügt

- **EN:** Flow tab: house diagram with energy flow (PV, battery, grid, load), animated lines, live values; option “Compute consumption from balance”; README and docs for GitHub.  
  **DE:** Flow-Tab: Haus-Diagramm mit Energiefluss (PV, Batterie, Netz, Last), animierte Linien, Live-Werte; Option „Hausverbrauch aus Bilanz berechnen“; README und Dokumentation.

### Changed / Geändert

- **EN:** Version synced in io-package.json and package.json; Flow tab layout: house left, distribution center, sources/batteries/devices right.  
  **DE:** Version in io-package.json und package.json angeglichen; Layout Flow-Tab: Haus links, Verteilung Mitte, Quellen/Batterien/Geräte rechts.

---

## [0.2.0]

- **EN:** Configuration, sources, batteries, rules, states (surplus, batteries, consumption, grid, autarky).  
  **DE:** Konfiguration, Quellen, Batterien, Regeln, States (surplus, batteries, consumption, grid, autarky).

---

## [0.1.0]

- **EN:** Initial version (scaffold).  
  **DE:** Erste Version (Grundgerüst).
