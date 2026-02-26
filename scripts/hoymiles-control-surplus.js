// ----------------------
// KONFIGURATION
// ----------------------
const CONFIG = {
    hoymilesDeviceId: "MSA-280024391944",

    // ioBroker States Hauptbatterie
    soc: "modbus.3.inputRegisters.33216SOC",
    chargePower: "modbus.3.inputRegisters.33181Pchr",
    dischargePower: "modbus.3.inputRegisters.33179Pdischr",

    // Überschuss-State (dynamische Ladeleistung) – z.B. SCC Adapter
    surplusState: "scc.0.surplus.powerW",  // Brutto-Überschuss; Alternative: "scc.0.surplus.availableForDevicesW"

    // Schwellenwerte
    socHigh: 99,
    socLow: 11,

    // Maximale Ladeleistung Hoymiles (W) – Gerät kann max. 1000 W
    hoyChargeMax: 1000,
};

// MQTT States Hoymiles
const TOPICS = {
    emsMode: `mqtt.0.homeassistant.select.${CONFIG.hoymilesDeviceId}.ems_mode.command`,
    powerCtrl: `mqtt.0.homeassistant.number.${CONFIG.hoymilesDeviceId}.power_ctrl.set`
};

// ----------------------
// ZUSTAND / HILFSFUNKTIONEN
// ----------------------
let mqttRetrigger = null;
let lastEmsMode = null;
let lastPower = null;

let prevCharging = false;
let prevDischarging = false;

/**
 * Setzt EMS-Mode und/oder PowerCtrl
 */
function sendIfChanged(emsMode, power) {
    if (emsMode !== lastEmsMode) {
        setState(TOPICS.emsMode, emsMode);
        setTimeout(() => setState(TOPICS.emsMode, emsMode), 1000);
        lastEmsMode = emsMode;
        log(`Hoymiles EMS-Mode geändert → ${emsMode}`, "info");
    }

    if (power !== lastPower || emsMode === "mqtt_ctrl") {
        setState(TOPICS.powerCtrl, Number(power));
        lastPower = power;
        log(`Hoymiles PowerCtrl → ${power}W`, "debug");
    }
}

/**
 * Retrigger für PowerCtrl (damit mqtt_ctrl dauerhaft ankommt)
 */
function startRetrigger(power) {
    if (mqttRetrigger) clearInterval(mqttRetrigger);
    mqttRetrigger = setInterval(() => {
        if (lastEmsMode === "mqtt_ctrl") {
            setState(TOPICS.powerCtrl, Number(power));
            log(`Hoymiles Retrigger: PowerCtrl ${power}W gesendet`, "debug");
        }
    }, 60 * 1000);
}

function stopRetrigger() {
    if (mqttRetrigger) {
        clearInterval(mqttRetrigger);
        mqttRetrigger = null;
    }
}

/**
 * Liest aktuellen Überschuss (W) und begrenzt auf hoyChargeMax.
 * Rückgabe: 0 .. hoyChargeMax (für Ladebefehl dann negativ senden).
 */
function getSurplusChargeW() {
    const raw = Number(getState(CONFIG.surplusState).val);
    if (isNaN(raw) || raw <= 0) return 0;
    return Math.min(Math.round(raw), CONFIG.hoyChargeMax);
}

// ----------------------
// HAUPTFUNKTION
// ----------------------
function controlHoymiles() {
    const soc = Number(getState(CONFIG.soc).val || 0);
    const pChr = Number(getState(CONFIG.chargePower).val || 0);
    const pDis = Number(getState(CONFIG.dischargePower).val || 0);

    const isCharging = pChr > 50;
    const isDischarging = pDis > 50;

    const now = new Date();
    const isAfterNoon = now.getHours() >= 12;

    const surplusW = getSurplusChargeW();
    log(`SOC=${soc}%, Pchr=${pChr}W, Pdis=${pDis}W, Überschuss=${surplusW}W, Stunde=${now.getHours()}`, "debug");

    // 1) Hauptbatterie lädt → mqtt_ctrl 0W
    if (isCharging) {
        prevCharging = true;
        prevDischarging = false;
        sendIfChanged("mqtt_ctrl", 0);
        startRetrigger(0);
        return;
    }

    // 2) Hauptbatterie entlädt → mqtt_ctrl 0W
    if (isDischarging) {
        prevDischarging = true;
        prevCharging = false;
        sendIfChanged("mqtt_ctrl", 0);
        startRetrigger(0);
        return;
    }

    // 3) Entladeende + SOC zu niedrig → general Modus
    if (!isDischarging && prevDischarging && soc <= CONFIG.socLow) {
        prevDischarging = false;
        stopRetrigger();
        sendIfChanged("general", 0);
        return;
    }

    // 4) SOC hoch + nach 12 Uhr + Hauptbatterie lädt/entlädt nicht → Hoymiles mit dynamischem Überschuss laden
    if (!isCharging && !isDischarging && soc >= CONFIG.socHigh && isAfterNoon) {
        if (prevCharging) prevCharging = false;
        const chargeW = -surplusW;  // negativ = Hoymiles soll laden
        sendIfChanged("mqtt_ctrl", chargeW);
        startRetrigger(chargeW);
        return;
    }

    // 5) Default: Idle – Retrigger auf 0W umstellen oder general + Retrigger aus
    if (lastEmsMode === "mqtt_ctrl") {
        sendIfChanged("mqtt_ctrl", 0);
        startRetrigger(0);
    } else {
        sendIfChanged("general", 0);
        stopRetrigger();
    }
}

// ----------------------
// TRIGGER + SICHERHEIT
// ----------------------
on({ id: CONFIG.soc, change: "any" }, controlHoymiles);
on({ id: CONFIG.chargePower, change: "any" }, controlHoymiles);
on({ id: CONFIG.dischargePower, change: "any" }, controlHoymiles);
on({ id: CONFIG.surplusState, change: "any" }, controlHoymiles);

setInterval(controlHoymiles, 30 * 1000);

log("Hoymiles Control Script (dynamisch mit Überschuss) gestartet", "info");
