# ioBroker SCC (Self-Consumption Charging)

[Deutsch](README.md) | **English**

[![Downloads](https://img.shields.io/npm/dm/iobroker.scc.svg)](https://www.npmjs.com/package/iobroker.scc)
[![Installed](https://iobroker.live/badges/scc-installed.svg)](https://iobroker.live/badges/scc-installed)

**SCC** stands for **Self-Consumption Charging**: control self-consumption – charge batteries first, then switch devices with PV surplus, rest to grid.

**Note:** This adapter is **in development**. **No liability** is assumed for functionality, damage or consequences of use. Use at your own risk.

---

## Description

This ioBroker adapter calculates **PV surplus** from configurable sources (e.g. Shelly Pro 3 EM, inverter, meter), integrates **batteries** (SoC, charge/discharge power), and switches **devices/sockets** depending on surplus remaining after battery charging. Priority is configurable: **Battery first** (default) or **Devices first**.

### Core features

- **Sources:** Multiple sources with types generation, consumption, grid power, feed-in – flexibly combinable (e.g. Shelly at main connection as grid power).
- **Batteries:** Multiple storages with SoC, optional charge/discharge power; target SoC per battery; reserve for charging is subtracted from “available for consumers” (with “battery first” priority).
- **Rules:** Threshold-based switching of devices (ON/OFF above watt), hysteresis, min. duration, delay.
- **States:** `surplus.powerW`, `surplus.availableForDevicesW`, `batteries.powerReservedW`, `consumption.totalW`, `grid.consumptionW` / `grid.feedInW`, `autarky.percent`, etc. – for VIS, dashboards and scripts.
- **Admin:** Configuration via JSON UI; **Flow tab** with graphical energy flow view (house, PV, battery, grid, live values).

### SCC abbreviation

**SCC = Self-Consumption Charging**: Focus on using solar surplus first for storage charging, then for consumers – typical for PV systems with battery and controllable loads (heat pump, sockets).

---

## Installation

Via ioBroker Admin: **Adapters** → **SCC** (PV surplus control) install.  
Or via CLI:

```bash
iobroker add scc
```

**Node.js** 18.x or higher.

---

## Configuration

- **Sources:** States with type (generation, consumption, grid power, feed-in). E.g. one Shelly Pro 3 EM at main connection as **one** source “Grid power” (negative = feed-in).
- **Batteries:** Per storage SoC state (%), optional charge/discharge state (W), target SoC, name.
- **Surplus priority:** “Battery first” (default) or “Devices first”.
- **Rules:** Per device target state (e.g. Shelly socket), **device power (W)** (typical consumption), ON/OFF threshold (W), hysteresis, min. duration, delay. **ON above** should be ≥ device power + margin (e.g. 2000 W device → ON above 2200 W) so no grid/battery is used when switching on; with device power set, ON only switches when “available for consumers” ≥ max(ON above, device power).
- **Options:** “Surplus active” threshold, fixed battery reserve (W), PV forecast (optional), compute consumption from balance (optional).

Details and data model: [CONCEPT.md](CONCEPT.md).

---

## Important states (examples)

| State | Description |
|-------|-------------|
| `surplus.powerW` | Gross surplus (W) |
| `surplus.availableForDevicesW` | Available for consumers (W), after battery reserve |
| `surplus.feedInW` | Feed-in (W) |
| `batteries.powerReservedW` | Power reserved for battery charging (W) |
| `batteries.allCharged` | All batteries ≥ target SoC |
| `consumption.totalW` | Total household consumption (W) |
| `grid.consumptionW` / `grid.feedInW` | Grid import / feed-in (W) |
| `autarky.percent` | Self-sufficiency (%) |
| `rules.<id>.state` | Device on/off (boolean) |

---

## Flow tab

Under **Adapter instance → “Flow” tab** there is a graphical view:

![PV surplus – Energy flow (Flow dashboard)](docs/screenshot-flow.png)

- House diagram with PV, battery, grid, household consumption
- Animated energy flow lines (green/red by logic)
- Live values: photovoltaics, load, battery, grid (feed-in/import)
- Self-sufficiency, energy distribution (gross → battery → consumers), power distribution, overview, sources, batteries, devices, PV forecast

Data comes from adapter states; if the connection is missing (e.g. in some Admin setups), a notice is shown.

- **Open as single page:** In the Flow tab, the “Open as single page” button opens the view in a new window (e.g. for a second screen or fullscreen).
- **Standalone (without Admin):** In the adapter configuration a **standalone port** (e.g. 8095) can be set. Then the Flow page is available at `http://<ioBroker-host>:<port>/flow.html` – without Admin login.

---

## Versioning

ioBroker development uses **SemVer (Semantic Versioning)** ([semver.org](https://semver.org/)).

- **Version** is in `package.json` and in `io-package.json` under `common.version` – both must **match** (`x.y.z`).
- **Major (x.0.0):** Incompatible API or configuration changes.
- **Minor (0.x.0):** New features, backward compatible.
- **Patch (0.0.x):** Bug fixes, backward compatible.

### Automatic sync

When bumping the version with **npm**, `io-package.json` is updated automatically:

```bash
npm version patch   # 0.3.0 → 0.3.1
npm version minor   # 0.3.1 → 0.4.0
npm version major   # 0.4.0 → 1.0.0
```

The script `scripts/sync-version.js` runs in the **version** lifecycle and copies the new version from `package.json` to `io-package.json`. Then: add an entry to `CHANGELOG.md` and optionally commit/tag.

---

## License

MIT License. See [LICENSE](LICENSE).

---

*Parts of this project were developed with the help of AI assistants (e.g. for code and documentation).*
