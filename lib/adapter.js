'use strict';

const utils = require('@iobroker/adapter-core');
const { SourceManager } = require('./sources');
const { BatteryManager } = require('./batteries');
const { availableForDevicesW, PRIORITY } = require('./surplus');
const { RuleEngine } = require('./rules');
const { runHealthCheck } = require('./health');
const { StatsManager } = require('./stats');

class SCCAdapter extends utils.Adapter {

    constructor(options) {
        try {
            const fs = require('fs');
            const path = require('path');
            const dir = path.join(__dirname, '..');
            const file = path.join(dir, 'scc-start-marker.txt');
            fs.appendFileSync(file, new Date().toISOString() + ' constructor start\n');
        } catch (_) {}
        try {
            if (typeof process !== 'undefined' && process.stdout && process.stdout.write) {
                process.stdout.write('[SCC] constructor start\n');
            }
        } catch (_) {}
        const opts = (options && typeof options === 'object') ? { ...options, name: 'scc' } : { name: 'scc' };
        super(opts);
        this.sources = null;
        this.batteries = null;
        this.rules = null;
        this.stats = null;
        this.intervalId = null;
        this.healthCheckIntervalId = null;
        this.initialStatesDelayId = null;
        this.initialStatesDelayId2 = null;
        this.tickInProgress = false;
        this.standaloneServer = null;
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        try {
            if (this.log && typeof this.log.info === 'function') {
                this.log.info('SCC: constructor called');
            } else if (typeof process !== 'undefined' && process.stdout && process.stdout.write) {
                process.stdout.write('[SCC] constructor done (no this.log)\n');
            }
        } catch (e) {
            try {
                if (process.stderr && process.stderr.write) process.stderr.write('[SCC] constructor log failed: ' + (e.message || e) + '\n');
            } catch (_) {}
        }
    }

    _parseArray(val) {
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') {
            try {
                const a = JSON.parse(val);
                return Array.isArray(a) ? a : [];
            } catch (_e) { return []; }
        }
        // Admin can store table as object with numeric keys: { "0": row0, "1": row1 }
        if (val && typeof val === 'object') {
            const keys = Object.keys(val).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
            if (keys.length) return keys.map(k => val[k]);
        }
        return [];
    }

    _sourceStateId(entry) {
        if (!entry || typeof entry !== 'object') return '';
        const v = entry.stateId ?? entry.id ?? entry.stateid ?? entry['undefined'];
        if (v == null) return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'object' && v.id != null) return String(v.id).trim();
        return '';
    }

    /** Eine Tabelle nur mit stateId-Spalte → Array von State-IDs (Strings). */
    _normalizeSourceTableIds(arr) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const s of arr) {
            const id = this._sourceStateId(Array.isArray(s) ? { stateId: s[0] } : s);
            if (id) out.push(id);
        }
        return out;
    }

    /** Eine Tabelle nur mit name-Spalte → Array von Namen (Strings). */
    _normalizeSourceTableNames(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.map(s => {
            const v = Array.isArray(s) ? s[0] : (s && s.name);
            return (v != null ? String(v).trim() : '') || undefined;
        });
    }

    /** Zwei Tabellen (IDs + Namen) nach Index zusammenführen → Array von { stateId, type, name? }. */
    _mergeSourceTables(idsArr, namesArr, type) {
        const ids = this._normalizeSourceTableIds(idsArr);
        const names = (namesArr && Array.isArray(namesArr)) ? this._normalizeSourceTableNames(namesArr) : [];
        return ids.map((id, i) => ({ stateId: id, type, name: (names[i] != null && names[i] !== '') ? names[i] : undefined }));
    }

    /** Eine Tabelle mit stateId und optional name (Legacy) → Array von { stateId, type, name? } */
    _normalizeSourceTable(arr, type) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const s of arr) {
            let id = '';
            let name = '';
            if (Array.isArray(s)) {
                const idVal = s[0];
                const nameVal = s[1];
                id = (idVal != null && typeof idVal === 'string') ? idVal.trim() : (idVal && idVal.id != null ? String(idVal.id).trim() : '');
                if (nameVal != null) name = String(nameVal).trim();
            } else if (s && typeof s === 'object') {
                id = this._sourceStateId(s);
                if (s.name != null) name = String(s.name).trim();
            }
            if (!id) continue;
            out.push({ stateId: id, type: type, name: name || undefined });
        }
        return out;
    }

    /** Legacy: stateId + optional type pro Zeile */
    _normalizeSources(arr) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const s of arr) {
            let entry = s;
            if (Array.isArray(s)) {
                const id = (s[0] != null && typeof s[0] === 'string') ? String(s[0]).trim() : (s[0] && s[0].id ? String(s[0].id).trim() : '');
                if (!id) continue;
                const typ = s[1] != null ? String(s[1]).trim() : '';
                entry = { stateId: id, sourceType: typ || undefined, type: typ || undefined };
            } else if (s && typeof s === 'object') {
                const id = this._sourceStateId(s);
                if (!id) continue;
                entry = { ...s, stateId: id };
            }
            if (!entry || typeof entry !== 'object') continue;
            out.push(entry);
        }
        return out;
    }

    _batterySocStateId(entry) {
        if (!entry || typeof entry !== 'object') return '';
        const v = entry.socStateId ?? entry.socState ?? entry.stateId ?? entry.id ?? entry['undefined'];
        return this._toStateIdString(v);
    }

    /** State-ID aus Admin (string oder objectId-Objekt { id: "..." }) immer als String. */
    _toStateIdString(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'object' && v.id != null) return String(v.id).trim();
        return '';
    }

    /** Eine Tabelle SoC + optional Name → Array von { socStateId, name? } (socStateId immer String). */
    _normalizeBatteriesSoc(arr) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const b of arr) {
            let socId = '';
            let name = '';
            if (Array.isArray(b)) {
                const v = b[0];
                socId = this._toStateIdString(v);
                if (b[1] != null) name = String(b[1]).trim();
            } else if (b && typeof b === 'object') {
                socId = this._batterySocStateId(b);
                if (b.name != null) name = String(b.name).trim();
            }
            if (!socId) continue;
            out.push({ socStateId: socId, name: name || undefined });
        }
        return out;
    }

    /** Eine Spalte State-IDs → Array von { chargePowerStateId? } oder { dischargePowerStateId? }. */
    _normalizeBatteriesPowerColumn(arr, key) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const row of arr) {
            let id = '';
            if (Array.isArray(row)) id = this._toStateIdString(row[0]);
            else if (row && typeof row === 'object') id = this._toStateIdString(row[key] || row.stateId);
            out.push(id || undefined);
        }
        return out;
    }

    /** Tabellen Lade + Entlade (oder alte Tabelle Lade/Entlade) → Array von { chargePowerStateId?, dischargePowerStateId? }. */
    _mergeBatteriesPowerRows(chargeRows, dischargeRows, legacyPowerRows) {
        if (Array.isArray(legacyPowerRows) && legacyPowerRows.length > 0) {
            const out = [];
            for (const b of legacyPowerRows) {
                let chargeId = '';
                let dischargeId = '';
                if (Array.isArray(b)) {
                    chargeId = this._toStateIdString(b[0]);
                    dischargeId = this._toStateIdString(b[1]);
                } else if (b && typeof b === 'object') {
                    chargeId = this._toStateIdString(b.chargePowerStateId || b.chargePowerState);
                    dischargeId = this._toStateIdString(b.dischargePowerStateId || b.dischargePowerState);
                }
                out.push({ chargePowerStateId: chargeId || undefined, dischargePowerStateId: dischargeId || undefined });
            }
            return out;
        }
        const chargeIds = Array.isArray(chargeRows) ? chargeRows : [];
        const dischargeIds = Array.isArray(dischargeRows) ? dischargeRows : [];
        const len = Math.max(chargeIds.length, dischargeIds.length);
        const out = [];
        for (let i = 0; i < len; i++) {
            out.push({
                chargePowerStateId: chargeIds[i] || undefined,
                dischargePowerStateId: dischargeIds[i] || undefined
            });
        }
        return out;
    }

    /** Legacy: socStateId + optional charge/discharge pro Zeile */
    _normalizeBatteries(arr, defaultTargetSoc) {
        if (!Array.isArray(arr)) return [];
        const target = typeof defaultTargetSoc === 'number' ? defaultTargetSoc : 90;
        const out = [];
        for (const b of arr) {
            let socId = '';
            let chargeId = '';
            let dischargeId = '';
            if (Array.isArray(b)) {
                const v = b[0];
                socId = (v != null && typeof v === 'string') ? v.trim() : (v && v.id ? String(v.id).trim() : '');
                if (b[1] != null) chargeId = String(b[1]).trim();
                if (b[2] != null) dischargeId = String(b[2]).trim();
            } else if (b && typeof b === 'object') {
                socId = this._batterySocStateId(b);
                chargeId = (b.chargePowerStateId || b.chargePowerState || '') && String(b.chargePowerStateId || b.chargePowerState).trim();
                dischargeId = (b.dischargePowerStateId || b.dischargePowerState || '') && String(b.dischargePowerStateId || b.dischargePowerState).trim();
            }
            if (!socId) continue;
            const row = { socStateId: socId, targetSoc: target };
            if (chargeId) row.chargePowerStateId = chargeId;
            if (dischargeId) row.dischargePowerStateId = dischargeId;
            out.push(row);
        }
        return out;
    }

    _normalizeRules(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.filter(r => r && typeof r === 'object');
    }

    _normalizeRuleGroups(arr) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const g of arr) {
            const row = Array.isArray(g) ? { groupId: g[0], name: g[1], thresholdOn: g[2], thresholdOff: g[3] } : (g && typeof g === 'object' ? g : null);
            if (row && (row.groupId || row.name)) {
                out.push({
                    groupId: (row.groupId || row.id || '').toString().trim() || undefined,
                    name: (row.name || '').toString().trim() || undefined,
                    thresholdOn: typeof row.thresholdOn === 'number' ? row.thresholdOn : (Number(row.thresholdOn) || 0),
                    thresholdOff: typeof row.thresholdOff === 'number' ? row.thresholdOff : (Number(row.thresholdOff) !== undefined ? Number(row.thresholdOff) : undefined)
                });
            }
        }
        return out;
    }

    async onReady() {
        this.log.info('SCC: onReady called');
        const rawConfig = this.config || {};
        this.log.debug('onReady: raw config keys=' + Object.keys(rawConfig).join(', ') + '; sources=' + (Array.isArray(rawConfig.sources) ? rawConfig.sources.length : typeof rawConfig.sources) + ', batteries=' + (Array.isArray(rawConfig.batteries) ? rawConfig.batteries.length : typeof rawConfig.batteries) + ', rules=' + (Array.isArray(rawConfig.rules) ? rawConfig.rules.length : typeof rawConfig.rules));

        try {
            const config = this.config || {};
            let sources = [];
            const useNewSourceTables = config.sourcesGeneration != null || config.sourcesConsumption != null || config.sourcesGrid != null || config.sourcesFeedIn != null;
            if (useNewSourceTables) {
                const gen = this._normalizeSourceTable(this._parseArray(config.sourcesGeneration || []), 'generation');
                const consRaw = this._normalizeSourceTable(this._parseArray(config.sourcesConsumption || []), 'consumption');
                const grid = this._normalizeSourceTable(this._parseArray(config.sourcesGrid || []), 'grid');
                const feedIn = this._normalizeSourceTable(this._parseArray(config.sourcesFeedIn || []), 'feedIn');
                const consumptionTotalId = this._toStateIdString(config.consumptionTotal);
                const consumptionTotalName = (config.consumptionTotalName && String(config.consumptionTotalName).trim()) || 'Hausverbrauch';
                if (consumptionTotalId) {
                    sources = [].concat(
                        gen,
                        [{ stateId: consumptionTotalId, type: 'consumption', name: consumptionTotalName }],
                        consRaw.map(s => ({ ...s, type: 'consumptionDetail' })),
                        grid,
                        feedIn
                    );
                } else {
                    sources = [].concat(gen, consRaw, grid, feedIn);
                }
            } else {
                const sourcesRaw = this._parseArray(config.sources);
                const sourceType = config.sourceType || 'generation';
                sources = this._normalizeSources(sourcesRaw);
                const validTypes = ['grid', 'generation', 'consumption', 'feedIn'];
                sources.forEach(s => {
                    const t = s.sourceType || s.type;
                    s.type = (t && validTypes.includes(t)) ? t : sourceType;
                });
            }
            sources.forEach(s => {
                s.unit = s.unit || 'auto';
                s.factor = (typeof s.factor === 'number') ? s.factor : 1;
            });

            const batteryTargetSoc = (typeof config.batteryTargetSoc === 'number') ? config.batteryTargetSoc : 90;
            let batteries = [];
            const useNewBatteryTables = config.batteriesSoc != null || config.batteriesPower != null || config.batteriesCharge != null || config.batteriesDischarge != null;
            if (useNewBatteryTables && Array.isArray(config.batteriesSoc) && config.batteriesSoc.length > 0) {
                const socRows = this._normalizeBatteriesSoc(this._parseArray(config.batteriesSoc));
                const chargeIds = this._normalizeBatteriesPowerColumn(this._parseArray(config.batteriesCharge || []), 'chargePowerStateId');
                const dischargeIds = this._normalizeBatteriesPowerColumn(this._parseArray(config.batteriesDischarge || []), 'dischargePowerStateId');
                const powerRows = this._mergeBatteriesPowerRows(chargeIds, dischargeIds, this._parseArray(config.batteriesPower || []));
                batteries = socRows.map((row, i) => {
                    const p = powerRows[i] || {};
                    const socId = this._toStateIdString(row.socStateId);
                    const chargeId = this._toStateIdString(p.chargePowerStateId);
                    const dischargeId = this._toStateIdString(p.dischargePowerStateId);
                    return {
                        socStateId: socId,
                        targetSoc: batteryTargetSoc,
                        chargePowerStateId: chargeId || undefined,
                        dischargePowerStateId: dischargeId || undefined,
                        name: row.name || undefined
                    };
                });
            } else {
                batteries = this._normalizeBatteries(this._parseArray(config.batteries), batteryTargetSoc);
            }
            const rulesOnOff = this._normalizeRules(this._parseArray(config.rulesOnOff || [])).map(r => ({ ...r, ruleType: 'on_off' }));
            const rulesPid = this._normalizeRules(this._parseArray(config.rulesPid || [])).map(r => ({ ...r, ruleType: 'pid' }));
            const rulesLegacy = this._normalizeRules(this._parseArray(config.rules || []));
            const rules = (rulesOnOff.length || rulesPid.length)
                ? [...rulesOnOff, ...rulesPid]
                : rulesLegacy;

            const surplusPriority = (config.surplusPriority === PRIORITY.DEVICES_FIRST || config.surplusPriority === 'devices_first')
                ? PRIORITY.DEVICES_FIRST
                : PRIORITY.BATTERY_FIRST;
            this.config = {
                sources,
                batteries,
                rules,
                ruleGroups: this._normalizeRuleGroups(this._parseArray(config.ruleGroups)),
                surplusThresholdW: config.surplusThresholdW,
                batteryReserveW: config.batteryReserveW,
                useBatteryChargePower: config.useBatteryChargePower,
                surplusPriority,
                pollIntervalMs: config.pollIntervalMs,
                sourceType: config.sourceType || 'generation',
                batteryTargetSoc,
                simulationMode: config.simulationMode === true,
                debugRules: config.debugRules === true,
                forecastEnabled: config.forecastEnabled === true,
                forecastSourceId: this._toStateIdString(config.forecastSourceId) || '',
                computeConsumptionFromBalance: config.computeConsumptionFromBalance === true,
                standalonePort: config.standalonePort,
                adminPort: config.adminPort
            };

            this.log.debug('onReady: normalized config sources=' + this.config.sources.length + ', batteries=' + this.config.batteries.length + ', rules=' + this.config.rules.length);

            this.sources = new SourceManager(this, this.config.sources);
            this.batteries = new BatteryManager(this, this.config.batteries);
            this.rules = new RuleEngine(this, this.config.rules);
            this.stats = new StatsManager(this);

            try {
                await this.sources.init();
                await this.batteries.init();
            } catch (e) {
                this.log.warn('sources/batteries init: ' + (e && e.message ? e.message : String(e)));
            }

            try {
                await this.ensureObjects();
            } catch (e) {
                this.log.warn('ensureObjects: ' + (e && e.message ? e.message : String(e)));
            }

            try {
                await this.cleanupObsoleteStates();
            } catch (e) {
                this.log.warn('cleanupObsoleteStates: ' + (e && e.message ? e.message : String(e)));
            }

            try {
                await this.readInitialStates();
            } catch (e) {
                this.log.warn('readInitialStates: ' + (e && e.message ? e.message : String(e)));
            }
            const initialStatesDelayMs = 3500;
            this.initialStatesDelayId = setTimeout(() => {
                this.initialStatesDelayId = null;
                this.readInitialStates().catch(e => {
                    this.log.warn('readInitialStates (delayed): ' + (e && e.message ? e.message : String(e)));
                });
            }, initialStatesDelayMs);
            this.initialStatesDelayId2 = setTimeout(() => {
                this.initialStatesDelayId2 = null;
                this.readInitialStates().catch(e => {
                    this.log.warn('readInitialStates (delayed 10s): ' + (e && e.message ? e.message : String(e)));
                });
            }, 10000);

            this.subscribeAll();
            this.on('message', this.onMessage.bind(this));

            const pollMs = Math.max(500, Number(this.config.pollIntervalMs) || 1000);
            this.intervalId = setInterval(() => this.tick(), pollMs);
            const runHealthCheckAndWarn = () => {
                runHealthCheck(this, this.config).then(r => {
                    this.setStateAsync(this.namespace + '.info.health', JSON.stringify(r), true);
                }).catch(() => {});
            };
            const healthCheckDelayMs = 8000;
            this.healthCheckIntervalId = setTimeout(() => {
                runHealthCheckAndWarn();
                this.healthCheckIntervalId = setInterval(runHealthCheckAndWarn, 60000);
            }, healthCheckDelayMs);
            this.log.info('SCC adapter started. Surplus threshold: ' + (this.config.surplusThresholdW || 50) + ' W. Use log level "debug" for details.');
            const port = Math.max(0, parseInt(this.config.standalonePort, 10) || 0);
            if (port > 0) {
                try {
                    await this._startStandaloneServer(port);
                    this.log.info('SCC: Flow single page at http://<Host>:' + port + '/flow.html');
                } catch (e) {
                    this.log.warn('SCC: Standalone server could not start: ' + (e && e.message ? e.message : String(e)));
                }
            }
        } catch (err) {
            this.log.error('SCC onReady failed: ' + (err && err.message ? err.message : String(err)));
            if (err && err.stack) this.log.debug(err.stack);
            // Nicht erneut werfen, damit der Adapter grün bleibt und Konfiguration geändert werden kann
        }
    }

    onMessage(obj) {
        if (!obj) return;
        const command = obj.command;
        if (command === 'getConfig') {
            this._onMessageGetConfig(obj);
            return;
        }
        if (command === 'setConfig') {
            this._onMessageSetConfig(obj);
            return;
        }
        if (command !== 'getFlowData') return;
        const prefix = this.namespace + '.';
        const collect = async () => {
            try {
                const flowState = await this.getStateAsync(prefix + 'flowData');
                if (flowState && flowState.val != null) {
                    const parsed = typeof flowState.val === 'string' ? JSON.parse(flowState.val) : flowState.val;
                    if (parsed && parsed.surplus) return parsed;
                }
            } catch (e) { /* ignore */ }
            const data = { surplus: {}, consumption: {}, batteries: {}, grid: {}, generation: {}, sourcesList: [], rulesList: [], forecast: { enabled: false, powerW: null }, simulationMode: false };
            try {
                const powerW = await this.getStateAsync(prefix + 'surplus.powerW');
                const availableW = await this.getStateAsync(prefix + 'surplus.availableForDevicesW');
                const feedInW = await this.getStateAsync(prefix + 'surplus.feedInW');
                const reservedW = await this.getStateAsync(prefix + 'batteries.powerReservedW');
                const allCharged = await this.getStateAsync(prefix + 'batteries.allCharged');
                const consumptionTotalW = await this.getStateAsync(prefix + 'consumption.totalW');
                const gridConsW = await this.getStateAsync(prefix + 'grid.consumptionW');
                const gridFeedW = await this.getStateAsync(prefix + 'grid.feedInW');
                const genW = await this.getStateAsync(prefix + 'generation.totalW');
                const dischargeW = await this.getStateAsync(prefix + 'batteries.totalDischargeW');
                const forecastState = await this.getStateAsync(prefix + 'forecast.powerW');
                const simState = await this.getStateAsync(prefix + 'info.simulationMode');
                data.surplus.powerW = powerW && powerW.val != null ? powerW.val : 0;
                data.surplus.availableForDevicesW = availableW && availableW.val != null ? availableW.val : 0;
                data.surplus.feedInW = feedInW && feedInW.val != null ? feedInW.val : 0;
                data.consumption.totalW = consumptionTotalW && consumptionTotalW.val != null ? consumptionTotalW.val : 0;
                data.batteries.powerReservedW = reservedW && reservedW.val != null ? reservedW.val : 0;
                data.batteries.allCharged = allCharged && allCharged.val === true;
                data.batteries.totalDischargeW = dischargeW && dischargeW.val != null ? dischargeW.val : 0;
                data.grid.consumptionW = gridConsW && gridConsW.val != null ? gridConsW.val : 0;
                data.grid.feedInW = gridFeedW && gridFeedW.val != null ? gridFeedW.val : 0;
                data.generation.totalW = genW && genW.val != null ? genW.val : 0;
                if (forecastState && forecastState.val != null) {
                    data.forecast = { enabled: true, powerW: typeof forecastState.val === 'number' ? forecastState.val : null };
                }
                data.simulationMode = !!(simState && simState.val === true);
                data.sourcesList = [];
                data.rulesList = [];
            } catch (e) {
                this.log.warn('getFlowData: ' + e.message);
            }
            return data;
        };
        const sendResponse = (err, data) => {
            if (typeof obj.callback === 'function') obj.callback(err, data);
            if (obj.from && typeof this.sendTo === 'function') this.sendTo(obj.from, obj.command, data || {}, obj.callback);
        };
        collect().then(data => sendResponse(null, data)).catch(err => sendResponse(err, null));
    }

    _onMessageGetConfig(obj) {
        const send = (err, data) => {
            if (typeof obj.callback === 'function') obj.callback(err, data);
            if (obj.from && typeof this.sendTo === 'function') this.sendTo(obj.from, obj.command, data || {}, obj.callback);
        };
        const rules = Array.isArray(this.config?.rules) ? this.config.rules : [];
        const data = {
            rulesOnOff: rules.filter(r => r.ruleType === 'on_off'),
            rulesPid: rules.filter(r => r.ruleType === 'pid')
        };
        send(null, data);
    }

    async _onMessageSetConfig(obj) {
        const send = (err, data) => {
            if (typeof obj.callback === 'function') obj.callback(err, data);
            if (obj.from && typeof this.sendTo === 'function') this.sendTo(obj.from, obj.command, data || {}, obj.callback);
        };
        const payload = obj.message || obj.data || {};
        if (!payload || typeof payload !== 'object') {
            send(new Error('setConfig: no payload'));
            return;
        }
        try {
            const id = 'system.adapter.' + this.namespace;
            const cur = await this.getObjectAsync(id);
            if (!cur || !cur.native) {
                send(new Error('setConfig: instance object not found'));
                return;
            }
            const native = { ...cur.native };
            if (Array.isArray(payload.rulesOnOff)) native.rulesOnOff = payload.rulesOnOff;
            if (Array.isArray(payload.rulesPid)) native.rulesPid = payload.rulesPid;
            await this.extendObjectAsync(id, { native });
            send(null, { ok: true });
        } catch (e) {
            this.log.warn('setConfig: ' + (e && e.message ? e.message : String(e)));
            send(e || new Error('setConfig failed'));
        }
    }

    onUnload(callback) {
        this.log.info('SCC: onUnload called');
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.healthCheckIntervalId) {
            clearTimeout(this.healthCheckIntervalId);
            clearInterval(this.healthCheckIntervalId);
            this.healthCheckIntervalId = null;
        }
        if (this.initialStatesDelayId) {
            clearTimeout(this.initialStatesDelayId);
            this.initialStatesDelayId = null;
        }
        if (this.initialStatesDelayId2) {
            clearTimeout(this.initialStatesDelayId2);
            this.initialStatesDelayId2 = null;
        }
        this._stopStandaloneServer();
        callback();
    }

    async getFlowDataAsync() {
        const prefix = this.namespace + '.';
        try {
            const flowState = await this.getStateAsync(prefix + 'flowData');
            if (flowState && flowState.val != null) {
                const parsed = typeof flowState.val === 'string' ? JSON.parse(flowState.val) : flowState.val;
                if (parsed && parsed.surplus) return parsed;
            }
        } catch (e) { /* ignore */ }
        const data = { surplus: {}, consumption: {}, batteries: {}, grid: {}, generation: {}, sourcesList: [], rulesList: [], forecast: { enabled: false, powerW: null }, simulationMode: false };
        try {
            const powerW = await this.getStateAsync(prefix + 'surplus.powerW');
            const availableW = await this.getStateAsync(prefix + 'surplus.availableForDevicesW');
            const feedInW = await this.getStateAsync(prefix + 'surplus.feedInW');
            const reservedW = await this.getStateAsync(prefix + 'batteries.powerReservedW');
            const allCharged = await this.getStateAsync(prefix + 'batteries.allCharged');
            const consumptionTotalW = await this.getStateAsync(prefix + 'consumption.totalW');
            const gridConsW = await this.getStateAsync(prefix + 'grid.consumptionW');
            const gridFeedW = await this.getStateAsync(prefix + 'grid.feedInW');
            const genW = await this.getStateAsync(prefix + 'generation.totalW');
            const dischargeW = await this.getStateAsync(prefix + 'batteries.totalDischargeW');
            const forecastState = await this.getStateAsync(prefix + 'forecast.powerW');
            const simState = await this.getStateAsync(prefix + 'info.simulationMode');
            data.surplus.powerW = powerW && powerW.val != null ? powerW.val : 0;
            data.surplus.availableForDevicesW = availableW && availableW.val != null ? availableW.val : 0;
            data.surplus.feedInW = feedInW && feedInW.val != null ? feedInW.val : 0;
            data.consumption.totalW = consumptionTotalW && consumptionTotalW.val != null ? consumptionTotalW.val : 0;
            data.batteries.powerReservedW = reservedW && reservedW.val != null ? reservedW.val : 0;
            data.batteries.allCharged = allCharged && allCharged.val === true;
            data.batteries.totalDischargeW = dischargeW && dischargeW.val != null ? dischargeW.val : 0;
            data.grid.consumptionW = gridConsW && gridConsW.val != null ? gridConsW.val : 0;
            data.grid.feedInW = gridFeedW && gridFeedW.val != null ? gridFeedW.val : 0;
            data.generation.totalW = genW && genW.val != null ? genW.val : 0;
            if (forecastState && forecastState.val != null) {
                data.forecast = { enabled: true, powerW: typeof forecastState.val === 'number' ? forecastState.val : null };
            }
            data.simulationMode = !!(simState && simState.val === true);
        } catch (e) {
            this.log.warn('getFlowDataAsync: ' + (e && e.message ? e.message : String(e)));
        }
        return data;
    }

    _startStandaloneServer(port) {
        const http = require('http');
        const fs = require('fs');
        const path = require('path');
        const adminDir = path.join(__dirname, '..', 'admin');
        const mime = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
        const self = this;
        const server = http.createServer(async (req, res) => {
            const url = (req.url || '').split('?')[0] || '/';
            if (url === '/api/flowData') {
                try {
                    const data = await self.getFlowDataAsync();
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify(data || {}));
                } catch (e) {
                    res.writeHead(500);
                    res.end('');
                }
                return;
            }
            if (url === '/api/config') {
                const adminPort = Math.max(0, parseInt(self.config.adminPort, 10) || 8084);
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ adminPort: adminPort }));
                return;
            }
            const file = (url === '/' || url === '/flow.html') ? 'flow.html' : url.slice(1) || 'flow.html';
            const safe = ['flow.html', 'admin.css', 'house.png', 'logo.png'].includes(file) ? file : null;
            if (!safe) {
                if (url === '/') {
                    res.writeHead(302, { Location: '/flow.html' });
                    res.end();
                    return;
                }
                res.writeHead(404);
                res.end();
                return;
            }
            const fp = path.join(adminDir, safe);
            fs.readFile(fp, (err, buf) => {
                if (err) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                const ext = path.extname(safe);
                res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
                res.end(buf);
            });
        });
        return new Promise((resolve, reject) => {
            server.on('error', (err) => {
                this.log.warn('SCC Standalone server: ' + (err && err.message ? err.message : String(err)));
                reject(err);
            });
            server.listen(port, '0.0.0.0', () => {
                this.standaloneServer = server;
                resolve();
            });
        });
    }

    _stopStandaloneServer() {
        if (this.standaloneServer) {
            try {
                this.standaloneServer.close();
            } catch (e) { /* ignore */ }
            this.standaloneServer = null;
        }
    }

    async ensureObjects() {
        const prefix = this.namespace + '.';
        const create = async (id, common) => {
            await this.extendObjectAsync(id, { type: 'state', common });
        };

        await create(prefix + 'surplus.powerW', {
            type: 'number', role: 'value.power', name: 'Brutto-Überschuss', unit: 'W', read: true, write: false
        });
        await create(prefix + 'surplus.active', {
            type: 'boolean', role: 'indicator', name: 'Überschuss aktiv (Brutto)', read: true, write: false
        });
        await create(prefix + 'surplus.availableForDevicesW', {
            type: 'number', role: 'value.power', name: 'Für Verbraucher verfügbar', unit: 'W', read: true, write: false
        });
        await create(prefix + 'surplus.availableForDevices', {
            type: 'boolean', role: 'indicator', name: 'Verfügbar für Geräte', read: true, write: false
        });
        await create(prefix + 'surplus.sourcesOk', {
            type: 'boolean', role: 'indicator', name: 'Quellen OK', read: true, write: false
        });
        await create(prefix + 'surplus.feedInW', {
            type: 'number', role: 'value.power', name: 'Einspeisung', unit: 'W', read: true, write: false
        });

        await create(prefix + 'grid.consumptionW', {
            type: 'number', role: 'value.power', name: 'Netzbezug', unit: 'W', read: true, write: false
        });
        await create(prefix + 'grid.feedInW', {
            type: 'number', role: 'value.power', name: 'Netzeinspeisung', unit: 'W', read: true, write: false
        });
        await create(prefix + 'generation.totalW', {
            type: 'number', role: 'value.power', name: 'PV-Quellen gesamt', unit: 'W', read: true, write: false
        });
        await create(prefix + 'autarky.percent', {
            type: 'number', role: 'value', name: 'Autarkie', unit: '%', read: true, write: false
        });

        await create(prefix + 'info.health', {
            type: 'string', role: 'json', name: 'Health-Check Ergebnis', read: true, write: false
        });
        await create(prefix + 'info.simulationMode', {
            type: 'boolean', role: 'indicator', name: 'Simulationsmodus aktiv', read: true, write: false
        });

        await create(prefix + 'stats.surplusHoursToday', {
            type: 'number', role: 'value', name: 'Überschuss-Stunden heute', unit: 'h', read: true, write: false
        });
        await create(prefix + 'stats.autarkyPercentToday', {
            type: 'number', role: 'value', name: 'Autarkie heute', unit: '%', read: true, write: false
        });
        await create(prefix + 'stats.consumptionWhToday', {
            type: 'number', role: 'value.power', name: 'Verbrauch heute', unit: 'Wh', read: true, write: false
        });
        await create(prefix + 'stats.gridConsumptionWhToday', {
            type: 'number', role: 'value.power', name: 'Netzbezug heute', unit: 'Wh', read: true, write: false
        });

        await create(prefix + 'flowData', {
            type: 'string', role: 'json', name: 'Flow-Daten (für Tab)', read: true, write: false
        });

        await create(prefix + 'forecast.powerW', {
            type: 'number', role: 'value.power', name: 'PV-Vorhersage (Leistung)', unit: 'W', read: true, write: false
        });

        await create(prefix + 'consumption.totalW', {
            type: 'number', role: 'value.power', name: 'Verbrauch gesamt', unit: 'W', read: true, write: false
        });

        await create(prefix + 'batteries.allCharged', {
            type: 'boolean', role: 'indicator', name: 'Alle Batterien voll', read: true, write: false
        });
        await create(prefix + 'batteries.powerReservedW', {
            type: 'number', role: 'value.power', name: 'Für Batterie reserviert', unit: 'W', read: true, write: false
        });

        for (const b of this.config.batteries || []) {
            try {
                const bid = this.batteries.getBatteryId(b);
                const base = prefix + 'batteries.' + bid + '.';
                await create(base + 'soc', { type: 'number', role: 'value.battery', name: 'SoC', unit: '%', read: true, write: false });
                await create(base + 'needsCharge', { type: 'boolean', role: 'indicator', name: 'Ladebedarf', read: true, write: false });
                await create(base + 'targetSoc', { type: 'number', role: 'value', name: 'Ziel-SoC', unit: '%', read: true, write: false });
                await create(base + 'chargePowerW', { type: 'number', role: 'value.power', name: 'Ladeleistung', unit: 'W', read: true, write: false });
                await create(base + 'dischargePowerW', { type: 'number', role: 'value.power', name: 'Entladeleistung', unit: 'W', read: true, write: false });
            } catch (e) {
                this.log.warn('ensureObjects battery: ' + (e && e.message ? e.message : String(e)));
            }
        }

        for (const s of this.config.sources || []) {
            try {
                const sid = (s.stateId || s.id || '').replace(/[.\s]/g, '_');
                if (!sid) continue;
                await create(prefix + 'sources.' + sid + '.lastValue', {
                    type: 'number', role: 'value', name: 'Letzter Wert (W)', unit: 'W', read: true, write: false
                });
            } catch (e) {
                this.log.warn('ensureObjects source: ' + (e && e.message ? e.message : String(e)));
            }
        }

        for (const r of this.config.rules || []) {
            try {
                const rid = this.rules.getRuleId(r);
                const base = prefix + 'rules.' + rid + '.';
                await create(base + 'state', { type: 'boolean', role: 'switch', name: 'Aktuell ein', read: true, write: false });
                await create(base + 'lastSwitch', { type: 'string', role: 'value.time', name: 'Letzte Schaltung', read: true, write: false });
                if ((r.ruleType || 'on_off') === 'pid') {
                    await create(base + 'outputPercent', { type: 'number', role: 'value.level', name: 'Ausgang (%)', unit: '%', read: true, write: false });
                }
            } catch (e) {
                this.log.warn('ensureObjects rule: ' + (e && e.message ? e.message : String(e)));
            }
        }
    }

    /** Entfernt Objekte/States von Quellen, Batterien und Regeln, die nicht mehr in der Config sind. */
    async cleanupObsoleteStates() {
        const prefix = this.namespace + '.';
        const validSourceSids = new Set(
            (this.config.sources || []).map(s => (this.sources.getStateId(s) || '').replace(/[.\s]/g, '_')).filter(Boolean)
        );
        const validBatteryIds = new Set((this.config.batteries || []).map(b => this.batteries.getBatteryId(b)));
        const validRuleIds = new Set((this.config.rules || []).map(r => this.rules.getRuleId(r)).filter(Boolean));

        const tryDelete = async (id) => {
            try {
                await this.delObjectAsync(id, { recursive: true });
                this.log.debug('cleanup removed: ' + id);
            } catch (e) {
                this.log.debug('cleanup delete ' + id + ': ' + (e && e.message ? e.message : ''));
            }
        };

        try {
            const srcStart = prefix + 'sources.';
            const srcEnd = prefix + 'sources.\u9999';
            const res = await this.getObjectViewAsync('system', 'channel', { startkey: srcStart, endkey: srcEnd });
            if (res && res.rows && Array.isArray(res.rows)) {
                for (const row of res.rows) {
                    const id = (row.value && row.value._id) || row.id;
                    if (!id || !id.startsWith(srcStart)) continue;
                    const sid = id.substring(srcStart.length);
                    if (!validSourceSids.has(sid)) await tryDelete(id);
                }
            }
        } catch (e) {
            this.log.warn('cleanup sources: ' + (e && e.message ? e.message : String(e)));
        }

        try {
            const batStart = prefix + 'batteries.';
            const batEnd = prefix + 'batteries.\u9999';
            const res = await this.getObjectViewAsync('system', 'channel', { startkey: batStart, endkey: batEnd });
            if (res && res.rows && Array.isArray(res.rows)) {
                for (const row of res.rows) {
                    const id = (row.value && row.value._id) || row.id;
                    if (!id || !id.startsWith(batStart)) continue;
                    const bid = id.substring(batStart.length).split('.')[0];
                    if (!validBatteryIds.has(bid)) await tryDelete(id);
                }
            }
        } catch (e) {
            this.log.warn('cleanup batteries: ' + (e && e.message ? e.message : String(e)));
        }

        try {
            const ruleStart = prefix + 'rules.';
            const ruleEnd = prefix + 'rules.\u9999';
            const res = await this.getObjectViewAsync('system', 'channel', { startkey: ruleStart, endkey: ruleEnd });
            if (res && res.rows && Array.isArray(res.rows)) {
                for (const row of res.rows) {
                    const id = (row.value && row.value._id) || row.id;
                    if (!id || !id.startsWith(ruleStart)) continue;
                    const rid = id.substring(ruleStart.length).split('.')[0];
                    if (!validRuleIds.has(rid)) await tryDelete(id);
                }
            }
        } catch (e) {
            this.log.warn('cleanup rules: ' + (e && e.message ? e.message : String(e)));
        }
    }

    subscribeAll() {
        const ids = [
            ...this.sources.getSubscribeIds(),
            ...this.batteries.getSubscribeIds()
        ];
        if (ids.length) this.subscribeStates(ids);
    }

    /** Liest SoC und Lade-/Entladeleistung (fremde States mit getForeignStateAsync). */
    async readInitialStates() {
        const readForeign = this.getForeignStateAsync || this.getStateAsync;
        for (const s of this.config.sources || []) {
            const stateId = this.sources.getStateId(s);
            if (!stateId) continue;
            try {
                const st = await readForeign.call(this, stateId);
                if (st && st.val != null) this.sources.setLastValue(stateId, st.val);
            } catch (_) {}
        }
        for (const b of this.config.batteries || []) {
            const socId = this._toStateIdString(b.socStateId || b.socState);
            if (socId) {
                try {
                    const st = await readForeign.call(this, socId);
                    if (st && st.val != null) this.batteries.setSoc(socId, st.val);
                } catch (_) {}
            }
            const chargeId = this._toStateIdString(b.chargePowerStateId || b.chargePowerState);
            if (chargeId) {
                try {
                    const st = await readForeign.call(this, chargeId);
                    if (st && st.val != null) this.batteries.setChargePower(chargeId, st.val);
                } catch (_) {}
            }
            const dischargeId = this._toStateIdString(b.dischargePowerStateId || b.dischargePowerState);
            if (dischargeId) {
                try {
                    const st = await readForeign.call(this, dischargeId);
                    if (st && st.val != null) this.batteries.setDischargePower(dischargeId, st.val);
                } catch (_) {}
            }
        }
    }

    onStateChange(id, state) {
        if (!state) return;
        const srcIds = this.sources.getSubscribeIds();
        const batIds = this.batteries.getSubscribeIds();

        if (srcIds.includes(id)) {
            this.sources.setLastValue(id, state.val);
        }
        for (const b of this.config.batteries || []) {
            if ((b.socStateId || b.socState) === id) {
                this.batteries.setSoc(id, state.val);
                break;
            }
            if ((b.chargePowerStateId || b.chargePowerState) === id) {
                this.batteries.setChargePower(id, state.val);
                break;
            }
            if ((b.dischargePowerStateId || b.dischargePowerState) === id) {
                this.batteries.setDischargePower(id, state.val);
                break;
            }
        }
        this.tick();
    }

    async tick() {
        if (this.tickInProgress) return;
        this.tickInProgress = true;
        try {
            const surplusW = this.sources.computeBruttoSurplusW();
            const sourcesOk = this.sources.hasAnyValidValue();

            let reservedW = this.batteries.getReservedPowerW(this.config.useBatteryChargePower);
            if (reservedW === 0 && !this.batteries.allCharged()) {
                reservedW = Number(this.config.batteryReserveW) || 0;
            }
            const totalDischargeW = this.batteries.getTotalDischargeW();
            const totalChargeW = this.batteries.getTotalChargeW();
            const availableW = availableForDevicesW(surplusW, reservedW, totalDischargeW, this.config.surplusPriority, this.config.surplusDevicesOnlyFromSurplus === true);
            const thresholdW = Number(this.config.surplusThresholdW) || 50;

            this.log.debug('tick: surplusW=' + surplusW + ', reservedW=' + reservedW + ', availableW=' + availableW + ', sourcesOk=' + sourcesOk);

            const prefix = this.namespace + '.';
            await this.setStateAsync(prefix + 'surplus.powerW', surplusW, true);
            await this.setStateAsync(prefix + 'surplus.active', surplusW >= thresholdW, true);
            await this.setStateAsync(prefix + 'surplus.availableForDevicesW', availableW, true);
            await this.setStateAsync(prefix + 'surplus.availableForDevices', availableW >= thresholdW, true);
            await this.setStateAsync(prefix + 'surplus.sourcesOk', sourcesOk, true);

            const gridConsumptionW = this.sources.getGridConsumptionW();
            const gridFeedInW = this.sources.getGridFeedInW();
            const generationTotalW = this.sources.getGenerationTotalW();

            let consumptionTotalW;
            if (this.config.computeConsumptionFromBalance) {
                const g = gridConsumptionW != null ? gridConsumptionW : 0;
                const gen = generationTotalW != null ? generationTotalW : 0;
                const dis = totalDischargeW != null ? totalDischargeW : 0;
                const feed = gridFeedInW != null ? gridFeedInW : 0;
                const ch = totalChargeW != null ? totalChargeW : 0;
                consumptionTotalW = Math.max(0, g + gen + dis - feed - ch);
            } else {
                consumptionTotalW = this.sources.getConsumptionTotalW();
            }
            await this.setStateAsync(prefix + 'consumption.totalW', consumptionTotalW != null ? consumptionTotalW : 0, true);
            await this.setStateAsync(prefix + 'grid.consumptionW', gridConsumptionW != null ? gridConsumptionW : 0, true);
            await this.setStateAsync(prefix + 'grid.feedInW', gridFeedInW != null ? gridFeedInW : 0, true);
            await this.setStateAsync(prefix + 'generation.totalW', generationTotalW != null ? generationTotalW : 0, true);

            let feedInW = this.sources.getFeedInFromSourcesW();
            if (feedInW == null) feedInW = (gridFeedInW != null ? gridFeedInW : Math.max(0, surplusW - reservedW - availableW));
            await this.setStateAsync(prefix + 'surplus.feedInW', feedInW, true);

            const totalConsumption = consumptionTotalW != null ? consumptionTotalW : 0;
            const gridCons = gridConsumptionW != null ? gridConsumptionW : 0;
            const autarkyPercent = totalConsumption > 0
                ? Math.max(0, Math.min(100, (1 - gridCons / totalConsumption) * 100))
                : (gridCons > 0 ? 0 : 100);
            await this.setStateAsync(prefix + 'autarky.percent', autarkyPercent, true);

            if (this.stats) {
                this.stats.tick(surplusW, totalConsumption, gridConsumptionW != null ? gridConsumptionW : 0, this.config.pollIntervalMs);
                await this.setStateAsync(prefix + 'stats.surplusHoursToday', this.stats.getSurplusHoursToday(), true);
                await this.setStateAsync(prefix + 'stats.autarkyPercentToday', this.stats.getAutarkyPercentToday(), true);
                await this.setStateAsync(prefix + 'stats.consumptionWhToday', this.stats.getConsumptionWhToday(), true);
                await this.setStateAsync(prefix + 'stats.gridConsumptionWhToday', this.stats.getGridConsumptionWhToday(), true);
            }
            await this.setStateAsync(prefix + 'info.simulationMode', !!this.config.simulationMode, true);

            let forecastPowerW = null;
            if (this.config.forecastEnabled && this.config.forecastSourceId) {
                try {
                    const readForecast = this.getForeignStateAsync || this.getStateAsync;
                    const getForecastObj = this.getForeignObjectAsync || this.getObjectAsync;
                    const forecastState = await readForecast.call(this, this.config.forecastSourceId);
                    if (forecastState && forecastState.val != null) {
                        const v = forecastState.val;
                        if (typeof v === 'number' && !isNaN(v)) {
                            let w = Math.max(0, v);
                            const obj = await getForecastObj.call(this, this.config.forecastSourceId);
                            const unit = obj && obj.common && obj.common.unit ? String(obj.common.unit).trim().toLowerCase() : '';
                            if (unit === 'kw' || unit === 'kwh') w = v * 1000;
                            forecastPowerW = Math.max(0, w);
                        } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                            const w = v.powerW ?? v.power ?? v.W ?? v.watt ?? null;
                            if (typeof w === 'number' && !isNaN(w)) forecastPowerW = Math.max(0, w);
                        } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'number') {
                            forecastPowerW = Math.max(0, v[0]);
                        } else if (typeof v === 'string') {
                            const parsed = parseFloat(v, 10);
                            if (!isNaN(parsed)) forecastPowerW = Math.max(0, parsed);
                        }
                    }
                } catch (e) {
                    this.log.debug('forecast read: ' + (e && e.message ? e.message : ''));
                }
            }
            if (this.config.forecastEnabled) {
                await this.setStateAsync(prefix + 'forecast.powerW', forecastPowerW != null ? forecastPowerW : 0, true);
            }

            const readForeign = this.getForeignStateAsync || this.getStateAsync;
            for (const b of this.config.batteries || []) {
                const bid = this.batteries.getBatteryId(b);
                if (this.batteries.getSocPercent(bid) != null) continue;
                const socId = this._toStateIdString(b.socStateId || b.socState);
                if (!socId) continue;
                try {
                    const st = await readForeign.call(this, socId);
                    if (st && st.val != null) this.batteries.setSoc(socId, st.val);
                } catch (_) {}
            }

            const flowPayload = {
                surplus: { powerW: surplusW, availableForDevicesW: availableW, feedInW: feedInW, priority: this.config.surplusPriority },
                consumption: { totalW: totalConsumption },
                grid: { consumptionW: gridConsumptionW != null ? gridConsumptionW : 0, feedInW: gridFeedInW != null ? gridFeedInW : 0 },
                generation: { totalW: generationTotalW != null ? generationTotalW : 0 },
                autarky: { percent: autarkyPercent },
                forecast: this.config.forecastEnabled ? { enabled: true, powerW: forecastPowerW != null ? forecastPowerW : null } : { enabled: false, powerW: null },
                simulationMode: !!this.config.simulationMode,
                batteries: {
                    powerReservedW: reservedW,
                    totalDischargeW: totalDischargeW,
                    totalChargeW: this.batteries.getTotalChargeW(),
                    allCharged: this.batteries.allCharged()
                }
            };
            for (const b of this.config.batteries || []) {
                const bid = this.batteries.getBatteryId(b);
                const chargeW = this.batteries.getChargePowerW(bid);
                const dischargeW = this.batteries.getDischargePowerW(bid);
                const soc = this.batteries.getSocPercent(bid);
                const targetSoc = this.batteries.getTargetSoc(bid);
                const needsCharge = this.batteries.needsCharge(bid);
                if (!flowPayload.batteries.items) flowPayload.batteries.items = {};
                flowPayload.batteries.items[bid] = {
                    chargePowerW: chargeW != null ? chargeW : 0,
                    dischargePowerW: dischargeW != null ? dischargeW : 0,
                    soc: soc != null ? soc : null,
                    targetSoc,
                    needsCharge,
                    name: b.name || ''
                };
            }
            flowPayload.sourcesList = (this.config.sources || []).map(s => {
                const stateId = this.sources.getStateId(s);
                const w = stateId ? this.sources.getLastValueW(stateId) : null;
                return { stateId: stateId || '', name: s.name || '', type: s.type || '', lastValueW: w != null ? w : 0 };
            });
            let rulesAvailableW = availableW;
            if (this.config.simulationMode === true) {
                try {
                    const readSim = this.getForeignStateAsync || this.getStateAsync;
                    const simState = await readSim.call(this, '0_userdata.0.PID_Simulation_SCC.Ueberschuss_W');
                    if (simState && simState.val != null && typeof simState.val === 'number' && !isNaN(simState.val)) {
                        rulesAvailableW = Math.max(0, simState.val);
                    }
                } catch (e) {
                    this.log.debug('Simulation surplus read: ' + (e && e.message ? e.message : ''));
                }
            }
            await this.rules.evaluate(rulesAvailableW);
            const ruleStates = this.rules.getRuleStates();
            const simMode = !!(this.config.simulationMode === true);
            const tempLimitValues = {};
            for (const r of this.config.rules || []) {
                if (r.ruleType !== 'pid') continue;
                const tid = this._toStateIdString(r.tempLimitStateId || r.tempLimitTempStateId);
                if (!tid) continue;
                try {
                    const readFn = this.getForeignStateAsync || this.getStateAsync;
                    const st = await readFn.call(this, tid);
                    if (st && st.val != null && typeof st.val === 'number' && !isNaN(st.val)) {
                        tempLimitValues[this.rules.getRuleId(r)] = st.val;
                    }
                } catch (e) { /* ignore */ }
            }
            flowPayload.rulesList = (this.config.rules || []).map(r => {
                const rid = this.rules.getRuleId(r);
                const rs = ruleStates[rid];
                const item = { ruleId: rid, name: r.name || '', state: rs && rs.state === true };
                if (rs && rs.outputPercent != null) item.outputPercent = rs.outputPercent;
                if (simMode && rs && rs.pidDebug) item.pidDebug = rs.pidDebug;
                if (r.ruleType === 'pid' && tempLimitValues[rid] != null) item.tempLimitCurrent = tempLimitValues[rid];
                return item;
            });
            await this.setStateAsync(prefix + 'flowData', JSON.stringify(flowPayload), true);

            await this.setStateAsync(prefix + 'batteries.allCharged', this.batteries.allCharged(), true);
            await this.setStateAsync(prefix + 'batteries.powerReservedW', reservedW, true);

            for (const b of this.config.batteries || []) {
                const bid = this.batteries.getBatteryId(b);
                const base = prefix + 'batteries.' + bid + '.';
                await this.setStateAsync(base + 'soc', this.batteries.getSocPercent(bid), true);
                await this.setStateAsync(base + 'needsCharge', this.batteries.needsCharge(bid), true);
                await this.setStateAsync(base + 'targetSoc', this.batteries.getTargetSoc(bid), true);
                await this.setStateAsync(base + 'chargePowerW', this.batteries.getChargePowerW(bid) != null ? this.batteries.getChargePowerW(bid) : 0, true);
                await this.setStateAsync(base + 'dischargePowerW', this.batteries.getDischargePowerW(bid) != null ? this.batteries.getDischargePowerW(bid) : 0, true);
            }

            for (const s of this.config.sources || []) {
                const stateId = this.sources.getStateId(s);
                const sid = (stateId || '').replace(/[.\s]/g, '_');
                if (sid) {
                    const w = this.sources.getLastValueW(stateId);
                    await this.setStateAsync(prefix + 'sources.' + sid + '.lastValue', w != null ? w : 0, true);
                }
            }

            for (const [rid, rs] of Object.entries(ruleStates)) {
                await this.setStateAsync(prefix + 'rules.' + rid + '.state', rs.state, true);
                if (rs.lastSwitch) await this.setStateAsync(prefix + 'rules.' + rid + '.lastSwitch', rs.lastSwitch, true);
                if (rs.outputPercent != null) await this.setStateAsync(prefix + 'rules.' + rid + '.outputPercent', rs.outputPercent, true);
            }
        } catch (e) {
            this.log.error('tick: ' + (e && e.message ? e.message : String(e)));
            if (e && e.stack) this.log.debug(e.stack);
        } finally {
            this.tickInProgress = false;
        }
    }
}

module.exports = SCCAdapter;
