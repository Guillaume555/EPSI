/*
  ============================================================================
  SmartRoom — Serveur Node.js
  ============================================================================
  Pilier 3.C — EnergyTech & SmartGrid — Workshop National B3 Horizon 2080

  Rôle du serveur :
    - Reçoit les données capteurs (présence, température, humidité) envoyées
      par la carte ESP8266 via WebSocket.
    - Calcule automatiquement l'état de chaque équipement (éclairage, écran
      climatisation/chauffage, écran divertissement) selon la présence,
      l'heure, la température/humidité et le mode crise — sauf si l'humain a
      forcé manuellement un équipement (Auto / ON / OFF) depuis le dashboard.
    - Modélise une PRODUCTION D'ÉNERGIE réaliste : un réacteur nucléaire à
      puissance plafonnée (réduite en mode crise), complété par une réserve
      de secours qui se charge/décharge selon l'écart production/consommation,
      et par deux sources bonus (vélo générateur, récupération thermoélectrique
      sur l'écran climatisation). Si la réserve tombe à 0% alors que la
      consommation dépasse la production : coupure d'urgence réelle de tout
      ce qui n'est pas vital.
    - Diffuse en continu (WebSocket) l'état complet à tous les dashboards
      connectés, et envoie à l'ESP8266 la commande des 3 LED.

  Démarrage : npm install && npm start
  ============================================================================
*/

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const SERVER_BUILD = 'v7 — production nucléaire + réserve de secours avec coupure d\'urgence réelle';

const PORT = 3000;

// ----------------------------------------------------------------------------
// Équipements pilotables
// ----------------------------------------------------------------------------
const EQUIPMENT = {
  led1: { label: 'Éclairage 1', group: 'eclairage', watts: 15 },
  led2: { label: 'Éclairage 2', group: 'eclairage', watts: 15 },
  led3: { label: 'Éclairage 3', group: 'eclairage', watts: 15 },
  ecran1: { label: 'Écran 1 — Chauffage / Climatisation', group: 'appareils', watts: 300 },
  ecran2: { label: 'Écran 2 — TV / Divertissement', group: 'appareils', watts: 120 },
};

// ----------------------------------------------------------------------------
// Seuils de confort (élargis en mode crise) + seuil de danger absolu
// ----------------------------------------------------------------------------
const COMFORT_TEMP_MIN = 19;
const COMFORT_TEMP_MAX = 24;
const CRISIS_TEMP_MIN = 15;
const CRISIS_TEMP_MAX = 28;
const COMFORT_HUMIDITY_MAX = 65;
const CRISIS_HUMIDITY_MAX = 80;
const DANGER_TEMP_MAX = 30; // au-delà : urgence thermique, priorité absolue sur tout le reste

const PRICE_PER_KWH = 0.20; // € — estimation utilisée pour le coût affiché

// ----------------------------------------------------------------------------
// Modèle de production d'énergie
// ----------------------------------------------------------------------------
const NUCLEAR_OUTPUT_NOMINAL_W = 650; // production plafonnée en fonctionnement normal
const NUCLEAR_OUTPUT_CRISIS_W = 325;  // production réduite de moitié en mode crise
const RESERVE_CAPACITY_WH = 150;      // capacité totale de la réserve de secours
const BIKE_OUTPUT_W = 100;            // bonus vélo générateur (production humaine)
const THERMOELECTRIC_OUTPUT_W = 25;   // bonus récupération thermoélectrique (actif si écran1 ON)

// ----------------------------------------------------------------------------
// Support de vie (ventilation) — jamais totalement coupé, seulement réduit
// ----------------------------------------------------------------------------
const SUPPORTVIE_NORMAL_W = 40;
const SUPPORTVIE_ECO_W = 15;

// Budget "si tout restait allumé en continu" — sert uniquement de référence
// pour calculer le pourcentage d'économie affiché. Doit être déclaré APRÈS
// SUPPORTVIE_NORMAL_W (sinon ReferenceError: temporal dead zone JS).
const NOMINAL_BUDGET_W = Object.values(EQUIPMENT).reduce((sum, eq) => sum + eq.watts, 0) + SUPPORTVIE_NORMAL_W;

const ABSENCE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const HISTORY_MAX_POINTS = 40;
const LOG_MAX_ENTRIES = 20;

// ----------------------------------------------------------------------------
// État global
// ----------------------------------------------------------------------------
const state = {
  presence: false,
  temperature: 21,
  humidity: 45,

  crisisMode: false,
  forceNight: false,
  bikeActive: false,
  supportVieEco: false,

  climatMode: null,          // null | 'chauffage' | 'climatisation'
  thermalEmergency: false,

  reserveWh: RESERVE_CAPACITY_WH / 2, // on démarre à moitié chargée
  emergencyShutdown: false,

  lastUpdate: null,
  lastPresenceAt: Date.now(),

  led1: false,
  led2: false,
  led3: false,
  ecran1: false,
  ecran2: false,

  // null = automatique, true/false = forcé manuellement depuis le dashboard
  overrides: {
    led1: null,
    led2: null,
    led3: null,
    ecran1: null,
    ecran2: null,
  },
};

const history = {
  temperature: [],
  humidity: [],
};

const log = [];

let lastTickAt = Date.now();
let energyWh = 0;   // consommation cumulée réelle estimée (Wh) depuis le démarrage
let baselineWh = 0; // consommation cumulée "si tout restait allumé" (Wh), pour le % d'économie

// ----------------------------------------------------------------------------
// Utilitaires
// ----------------------------------------------------------------------------
function addLog(message) {
  log.unshift({ message, at: Date.now() });
  if (log.length > LOG_MAX_ENTRIES) log.length = LOG_MAX_ENTRIES;
}

function pushHistory() {
  const at = Date.now();
  history.temperature.push({ t: at, v: state.temperature });
  history.humidity.push({ t: at, v: state.humidity });
  if (history.temperature.length > HISTORY_MAX_POINTS) history.temperature.shift();
  if (history.humidity.length > HISTORY_MAX_POINTS) history.humidity.shift();
}

function isNight() {
  if (state.forceNight) return true;
  const hour = new Date().getHours();
  return hour >= 20 || hour < 7;
}

function currentProductionW() {
  const base = state.crisisMode ? NUCLEAR_OUTPUT_CRISIS_W : NUCLEAR_OUTPUT_NOMINAL_W;
  const bikeW = state.bikeActive ? BIKE_OUTPUT_W : 0;
  const thermoelectricW = state.ecran1 ? THERMOELECTRIC_OUTPUT_W : 0;
  return base + bikeW + thermoelectricW;
}

// ----------------------------------------------------------------------------
// Logique de décision des équipements (auto vs override manuel)
// ----------------------------------------------------------------------------
function applyEquipment(key, autoValue) {
  const override = state.overrides[key];
  const newValue = (override === null || override === undefined) ? autoValue : !!override;
  if (state[key] !== newValue) {
    addLog(`${EQUIPMENT[key].label} -> ${newValue ? 'ON' : 'OFF'}`);
  }
  state[key] = newValue;
}

function computeActuators() {
  const now = Date.now();
  const longAbsence = !state.presence && (now - state.lastPresenceAt > ABSENCE_TIMEOUT_MS);

  // 1. Coupure d'urgence : priorité absolue, ignore même les forçages manuels
  if (state.emergencyShutdown) {
    state.led1 = false;
    state.led2 = false;
    state.led3 = false;
    state.ecran1 = false;
    state.ecran2 = false;
    return;
  }

  // 2. Absence prolongée : les équipements de confort repassent en automatique
  if (longAbsence) {
    for (const key of ['led1', 'led2', 'led3', 'ecran2']) {
      if (state.overrides[key] !== null) {
        state.overrides[key] = null;
        addLog(`${EQUIPMENT[key].label} repassé en automatique (absence prolongée)`);
      }
    }
  }

  // 3. Urgence thermique (sécurité, prioritaire sur le confort)
  const wasThermalEmergency = state.thermalEmergency;
  state.thermalEmergency = state.temperature > DANGER_TEMP_MAX;
  if (state.thermalEmergency && !wasThermalEmergency) {
    addLog(`URGENCE THERMIQUE : température ${state.temperature.toFixed(1)}°C > ${DANGER_TEMP_MAX}°C`);
  } else if (!state.thermalEmergency && wasThermalEmergency) {
    addLog('Urgence thermique levée');
  }

  // 4. Mode climat (chauffage / climatisation) — seuils élargis en mode crise,
  //    mais l'urgence thermique passe toujours devant tout
  const tempMin = state.crisisMode ? CRISIS_TEMP_MIN : COMFORT_TEMP_MIN;
  const tempMax = state.crisisMode ? CRISIS_TEMP_MAX : COMFORT_TEMP_MAX;
  const humidityMax = state.crisisMode ? CRISIS_HUMIDITY_MAX : COMFORT_HUMIDITY_MAX;

  let climatMode = null;
  if (state.thermalEmergency || state.temperature > tempMax || state.humidity > humidityMax) {
    climatMode = 'climatisation';
  } else if (state.temperature < tempMin) {
    climatMode = 'chauffage';
  }
  if (climatMode !== state.climatMode) {
    addLog(climatMode ? `Climat -> ${climatMode}` : 'Climat -> arrêt (température stable)');
  }
  state.climatMode = climatMode;

  // 5. Valeurs automatiques de chaque équipement
  const eclairageAuto = !state.crisisMode && state.presence && isNight() && !longAbsence;
  const ecran2Auto = !state.crisisMode && state.presence;
  const ecran1Auto = climatMode !== null; // piloté par le besoin thermique réel

  applyEquipment('led1', eclairageAuto);
  applyEquipment('led2', eclairageAuto);
  applyEquipment('led3', eclairageAuto);
  applyEquipment('ecran2', ecran2Auto);
  applyEquipment('ecran1', ecran1Auto);
}

// ----------------------------------------------------------------------------
// Consommation / production instantanées
// ----------------------------------------------------------------------------
function computeConsumption() {
  const perEquipment = {};
  let total = 0;

  for (const key of Object.keys(EQUIPMENT)) {
    const on = !!state[key];
    const watts = on ? EQUIPMENT[key].watts : 0;
    perEquipment[key] = { on, watts, label: EQUIPMENT[key].label, group: EQUIPMENT[key].group };
    total += watts;
  }

  const supportVieW = state.supportVieEco ? SUPPORTVIE_ECO_W : SUPPORTVIE_NORMAL_W;
  total += supportVieW;

  const production = currentProductionW();
  const bikeW = state.bikeActive ? BIKE_OUTPUT_W : 0;
  const thermoelectricW = state.ecran1 ? THERMOELECTRIC_OUTPUT_W : 0;

  return {
    perEquipment,
    supportVieW,
    total,
    production,
    generation: { bikeW, thermoelectricW, generatedW: bikeW + thermoelectricW },
  };
}

// ----------------------------------------------------------------------------
// Réserve de secours : se charge ou se décharge selon l'écart
// consommation / production, avec coupure d'urgence réelle si épuisée.
// ----------------------------------------------------------------------------
function tickReserve() {
  const now = Date.now();
  const elapsedH = Math.max(0, (now - lastTickAt) / 3600000);
  lastTickAt = now;

  const consumption = computeConsumption();
  const netW = consumption.total - consumption.production; // > 0 => déficit

  const wasEmpty = state.reserveWh <= 0;
  const wasFull = state.reserveWh >= RESERVE_CAPACITY_WH;

  if (netW > 0) {
    const drawWh = netW * elapsedH;
    state.reserveWh = Math.max(0, state.reserveWh - drawWh);
    if (state.reserveWh <= 0 && !wasEmpty) {
      addLog('Réserve de secours épuisée (0%)');
    }
  } else {
    const chargeWh = -netW * elapsedH;
    state.reserveWh = Math.min(RESERVE_CAPACITY_WH, state.reserveWh + chargeWh);
    if (state.reserveWh >= RESERVE_CAPACITY_WH && !wasFull) {
      addLog('Réserve de secours rechargée à 100%');
    }
  }

  const wasEmergency = state.emergencyShutdown;
  state.emergencyShutdown = state.reserveWh <= 0 && netW > 0;
  if (wasEmergency && !state.emergencyShutdown) {
    addLog("Coupure d'urgence levée — réserve de nouveau disponible");
  } else if (!wasEmergency && state.emergencyShutdown) {
    addLog("COUPURE D'URGENCE — réserve à 0%, production insuffisante");
  }

  energyWh += consumption.total * elapsedH;
  baselineWh += NOMINAL_BUDGET_W * elapsedH;
}

function computeEnergySummary() {
  const economyPct = baselineWh > 0
    ? Math.max(0, Math.min(100, (1 - energyWh / baselineWh) * 100))
    : 0;
  const costEuros = (energyWh / 1000) * PRICE_PER_KWH;

  return {
    estimatedWh: energyWh,
    economyPct,
    costEuros,
    reserveCapacityWh: RESERVE_CAPACITY_WH,
  };
}

// ----------------------------------------------------------------------------
// Assemblage de l'état complet diffusé au dashboard
// ----------------------------------------------------------------------------
function statePayload() {
  return {
    type: 'state',
    state,
    equipment: EQUIPMENT,
    consumption: computeConsumption(),
    energy: computeEnergySummary(),
    history,
    log,
    comfort: {
      tempMin: state.crisisMode ? CRISIS_TEMP_MIN : COMFORT_TEMP_MIN,
      tempMax: state.crisisMode ? CRISIS_TEMP_MAX : COMFORT_TEMP_MAX,
      humidityMax: state.crisisMode ? CRISIS_HUMIDITY_MAX : COMFORT_HUMIDITY_MAX,
      dangerTempMax: DANGER_TEMP_MAX,
    },
    serverBuild: SERVER_BUILD,
  };
}

// ----------------------------------------------------------------------------
// Serveur HTTP + WebSocket
// ----------------------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const dashboards = new Set();
let espSocket = null;

function broadcastToDashboards() {
  const payload = JSON.stringify(statePayload());
  for (const socket of dashboards) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

function sendCommandToEsp() {
  if (espSocket && espSocket.readyState === WebSocket.OPEN) {
    espSocket.send(JSON.stringify({
      type: 'command',
      led1: state.led1,
      led2: state.led2,
      led3: state.led3,
    }));
  }
}

function tick() {
  tickReserve();
  computeActuators();
  broadcastToDashboards();
  sendCommandToEsp();
}

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      return;
    }

    switch (msg.type) {
      case 'sensors': {
        espSocket = socket;
        state.presence = !!msg.presence;
        state.temperature = Number(msg.temperature);
        state.humidity = Number(msg.humidity);
        state.lastUpdate = Date.now();
        if (state.presence) state.lastPresenceAt = Date.now();
        pushHistory();
        tick();
        break;
      }

      case 'register-dashboard': {
        dashboards.add(socket);
        socket.send(JSON.stringify(statePayload()));
        break;
      }

      case 'set-crisis': {
        state.crisisMode = !!msg.value;
        addLog(`Mode crise énergétique ${state.crisisMode ? 'activé' : 'désactivé'}`);
        tick();
        break;
      }

      case 'set-night': {
        state.forceNight = !!msg.value;
        addLog(`Simulation nuit ${state.forceNight ? 'activée' : 'désactivée'}`);
        tick();
        break;
      }

      case 'set-bike': {
        state.bikeActive = !!msg.value;
        addLog(`Vélo générateur ${state.bikeActive ? 'activé' : 'désactivé'} (+${BIKE_OUTPUT_W}W)`);
        tick();
        break;
      }

      case 'set-override': {
        const { equipment, value } = msg;
        if (EQUIPMENT[equipment]) {
          state.overrides[equipment] = value; // null = auto, true/false = forcé
          addLog(`${EQUIPMENT[equipment].label} -> ${value === null ? 'automatique' : (value ? 'forcé ON' : 'forcé OFF')}`);
          tick();
        }
        break;
      }

      default:
        break;
    }
  });

  socket.on('close', () => {
    dashboards.delete(socket);
    if (socket === espSocket) espSocket = null;
  });
});

// Boucle de rafraîchissement périodique (indépendante de la réception de
// nouvelles données capteurs), pour que la réserve/l'urgence évoluent même
// sans nouveau message ESP8266.
setInterval(tick, 5000);

server.listen(PORT, () => {
  console.log(`SmartRoom server [${SERVER_BUILD}] → http://localhost:${PORT}`);
});
