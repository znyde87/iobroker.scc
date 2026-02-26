# SCC VIS/Material Widgets

## 1. Haus-Grafik mit Energieflüssen – eigenes VIS-2-Widget (empfohlen)

Der SCC-Adapter bringt ein **echtes VIS-2-Widget** mit: **„SCC Energy flow (house)“** – die Haus-Grafik mit animierten Flusslinien (PV, Last, Batterie, Netz) wie im Admin-Flow-Tab.

### Voraussetzung

- **VIS 2** und **SCC-Adapter** sind installiert.
- Die Widget-Dateien liegen unter `widgets/scc/`. Beim **Download von GitHub** oder bei der **Installation über ioBroker/npm** ist dieser Ordner bereits enthalten – es ist kein Build nötig.

### In VIS 2 verwenden

1. VIS 2 öffnen und eine Ansicht bearbeiten.
2. **Widget hinzufügen** → in der Widget-Liste **„SCC“** (oder „scc“) suchen.
3. **„SCC Energy flow (house)“** / **„SCC Energiefluss (Haus)“** auswählen und auf die Ansicht ziehen.
4. Beim Widget unter **Daten / private** den Datenpunkt **„Flow data (e.g. scc.0.flowData)“** auf `scc.0.flowData` setzen (bei anderer Instanz z. B. `scc.1.flowData`).
5. Widget-Größe anpassen (Seitenverhältnis der Grafik 1024:1536).

Das Widget lädt die Daten aus dem gewählten Datenpunkt und aktualisiert die Anzeige automatisch.

### Widget bauen (nur für Entwickler)

**Normale Nutzer:** Das Widget liegt fertig unter `widgets/scc/` – kein Build nötig.

**Entwickler** (nach Änderungen in `vis2-widgets/`): Im Projektroot ausführen:

```bash
npm run build:widgets
```

Das aktualisiert `widgets/scc/`. Danach **VIS-2 ggf. neu starten** und in der Widget-Liste nach dem Set **„SCC“** suchen.

**Haus-Grafik:** Das Widget lädt das Haus-Bild von `/adapter/scc/house.png`. Liegt die Datei `house.png` im Ordner `admin/` des Adapters, wird sie angezeigt. Fehlt sie, erscheint ein dezenter Haus-Umriss als Fallback.

**Widget-URL (404 beheben):** Die Widget-Datei muss unter `widgets/scc/customWidgets.js` im Adapterordner liegen. Bei 404: Admin- und VIS-2-Adapter neu starten, Browser-Cache leeren.

**Linux (z. B. Raspberry Pi):** Wenn beim Build ein Fehler zu `@rollup/rollup-linux-x64-gnu` oder „Cannot find module“ erscheint, wurde `vis2-widgets/node_modules` oft auf anderer Plattform installiert. Dann im Adapterordner ausführen:
`cd vis2-widgets && rm -rf node_modules package-lock.json && npm install`, danach erneut `npm run build:widgets`.

---

## 2. Kompaktes Energiefluss-Widget (HTML)

Die Datei **`scc-flow-widget.html`** enthält eine kompakte Zeile: Brutto → Batterie → Verbraucher sowie Hausverbrauch und Autarkie. Für **VIS** oder **Material** als **HTML-Widget** nutzbar.

### In VIS nutzen

1. **Widget hinzufügen** → **HTML** (bzw. „HTML-Widget“).
2. Inhalt von `scc-flow-widget.html` einfügen.
3. OID auf `scc.0.flowData` setzen. Bei anderer Instanz: `scc.X.flowData`.

### In Material nutzen

1. Karte mit HTML-Inhalt anlegen.
2. Inhalt von `scc-flow-widget.html` einfügen.
3. Datenpunkt `scc.0.flowData` anbinden.

---

## Alternative: Flow-Tab als iframe

Den kompletten **Flow-Tab** aus dem Admin in VIS einbetten:

```html
<iframe src="/adapter/scc/0/flow.html" style="width:100%;height:600px;border:0;"></iframe>
```

(Bei anderer Instanz `0` durch die gewünschte Instanznummer ersetzen.)
