/*
  ============================================================================
  SmartRoom — Dashboard (client)
  ============================================================================
  Se connecte au serveur en WebSocket, s'enregistre comme "dashboard", et
  met à jour tout le DOM à chaque message { type: "state", ... } reçu.
  Envoie les commandes de l'utilisateur (crise, nuit, vélo, forçage manuel
  d'un équipement) au serveur, qui répond par un nouvel état complet.
  ============================================================================
*/

const GROUP_LABELS = {
  eclairage: 'listEclairage',
  appareils: 'listAppareils',
};

let latestState = null;
let ws = null;
let lastMessageAt = null;

// ---------------------------------------------------------------- connexion
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.addEventListener('open', () => {
    setConnectionStatus(true);
    ws.send(JSON.stringify({ type: 'register-dashboard' }));
  });

  ws.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (payload.type === 'state') {
      latestState = payload;
      lastMessageAt = Date.now();
      render(payload);
    }
  });

  ws.addEventListener('close', () => {
    setConnectionStatus(false);
    setTimeout(connect, 2000);
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

function setConnectionStatus(connected) {
  const el = document.getElementById('connectionStatus');
  const label = el.querySelector('.connection__label');
  el.classList.toggle('is-connected', connected);
  label.textContent = connected ? 'Connecté' : 'Déconnecté — reconnexion…';
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ---------------------------------------------------------------- rendu principal
function render(payload) {
  const { state, equipment, consumption, energy, history, log, comfort } = payload;

  renderBanners(state);
  renderStatusStrip(state);
  renderCards(state);
  renderEnergy(state, consumption, energy);
  renderConditions(history, comfort);
  renderGeneration(state, consumption);
  renderSupportVie(state, consumption);
  renderDevices(equipment, state);
  renderLog(log);
  renderDemoButtons(state);

  document.body.classList.toggle('is-emergency', !!state.emergencyShutdown);
}

function renderBanners(state) {
  toggle('crisisBanner', state.crisisMode);
  toggle('thermalBanner', state.thermalEmergency);
  toggle('reserveBanner', state.emergencyShutdown);
}

function toggle(id, visible) {
  document.getElementById(id).classList.toggle('hidden', !visible);
}

function renderStatusStrip(state) {
  setChip('chipSystem', state.emergencyShutdown
    ? 'Coupure d\'urgence'
    : state.thermalEmergency
      ? 'Urgence thermique'
      : state.crisisMode
        ? 'Mode crise'
        : 'Nominal');
  setChip('chipPresence', state.presence ? 'Présence détectée' : 'Aucune présence');
  setChip('chipTemp', `${formatNumber(state.temperature, 1)} °C`);
  setChip('chipHumidity', `${formatNumber(state.humidity, 0)} %`);
}

function setChip(id, value) {
  document.querySelector(`#${id} .chip__value`).textContent = value;
}

function renderCards(state) {
  document.getElementById('cardPresence').textContent = state.presence ? 'Occupée' : 'Vide';
  document.getElementById('cardPresenceHint').textContent = state.presence
    ? 'Quelqu\'un est détecté dans la pièce'
    : `Vide depuis ${formatElapsedSince(state.lastPresenceAt)}`;

  document.getElementById('cardTemp').textContent = `${formatNumber(state.temperature, 1)} °C`;
  document.getElementById('cardTempHint').textContent = state.thermalEmergency
    ? 'Au-dessus du seuil de sécurité !'
    : state.climatMode === 'chauffage'
      ? 'Chauffage nécessaire'
      : state.climatMode === 'climatisation'
        ? 'Climatisation nécessaire'
        : 'Dans la plage de confort';

  document.getElementById('cardHumidity').textContent = `${formatNumber(state.humidity, 0)} %`;
  document.getElementById('cardHumidityHint').textContent = state.humidity > 65
    ? 'Humidité élevée'
    : 'Humidité normale';
}

function renderEnergy(state, consumption, energy) {
  document.getElementById('energyCurrent').textContent = `${Math.round(consumption.total)} W`;
  document.getElementById('energyProduction').textContent = `${Math.round(consumption.production)} W`;

  const pct = Math.round((state.reserveWh / energy.reserveCapacityWh) * 100);
  document.getElementById('reserveValue').textContent = `${pct}% (${Math.round(state.reserveWh)} Wh / ${energy.reserveCapacityWh} Wh)`;

  const bar = document.getElementById('reserveBar');
  bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  bar.classList.toggle('is-warning', pct <= 40 && pct > 15);
  bar.classList.toggle('is-critical', pct <= 15);

  document.getElementById('energyEstimated').textContent = `${Math.round(energy.estimatedWh)} Wh`;
  document.getElementById('energySavings').textContent = `${Math.round(energy.economyPct)}%`;
  document.getElementById('energyCost').textContent = `${energy.costEuros.toFixed(3)} €`;
}

function renderConditions(history, comfort) {
  const lastTemp = history.temperature.length ? history.temperature[history.temperature.length - 1].v : null;
  const lastHumidity = history.humidity.length ? history.humidity[history.humidity.length - 1].v : null;

  document.getElementById('sparklineTempValue').textContent = lastTemp !== null ? `${formatNumber(lastTemp, 1)} °C` : '—';
  document.getElementById('sparklineHumidityValue').textContent = lastHumidity !== null ? `${formatNumber(lastHumidity, 0)} %` : '—';

  drawSparkline('sparklineTemp', history.temperature, comfort.dangerTempMax);
  drawSparkline('sparklineHumidity', history.humidity, comfort.humidityMax);
}

function drawSparkline(svgId, points, dangerThreshold) {
  const svg = document.getElementById(svgId);
  svg.innerHTML = '';
  if (!points || points.length < 2) return;

  const values = points.map((p) => p.v);
  const min = Math.min(...values, dangerThreshold ? dangerThreshold - 5 : Infinity);
  const max = Math.max(...values, dangerThreshold || -Infinity);
  const range = max - min || 1;

  const width = 300;
  const height = 60;
  const stepX = width / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p.v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', coords.join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', '#38bdf8');
  polyline.setAttribute('stroke-width', '2');
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(polyline);

  if (dangerThreshold) {
    const y = height - ((dangerThreshold - min) / range) * height;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', String(width));
    line.setAttribute('y1', y.toFixed(1));
    line.setAttribute('y2', y.toFixed(1));
    line.setAttribute('stroke', '#fb7185');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(line);
  }
}

function renderGeneration(state, consumption) {
  setBadge('bikeStatusBadge', state.bikeActive ? 'Actif (+100 W)' : 'Inactif', state.bikeActive ? 'is-on' : 'is-off');
  setBadge('thermoStatusBadge', state.ecran1 ? 'Actif (+25 W)' : 'Inactif', state.ecran1 ? 'is-on' : 'is-off');
  document.getElementById('generationTotal').textContent = `${consumption.generation.generatedW} W`;
}

function renderSupportVie(state, consumption) {
  setBadge('supportModeBadge', state.supportVieEco ? 'Éco (15 W)' : 'Normal (40 W)', state.supportVieEco ? 'is-warning' : 'is-auto');
  document.getElementById('supportNote').textContent = state.emergencyShutdown
    ? 'Coupure d\'urgence en cours : seule la ventilation reste alimentée.'
    : `Ventilation à puissance ${state.supportVieEco ? 'éco' : 'normale'} (${consumption.supportVieW} W).`;
  toggle('emergencyNote', !!state.emergencyShutdown);
}

function setBadge(id, text, className) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `badge ${className}`;
}

function renderDevices(equipment, state) {
  const containers = { listEclairage: [], listAppareils: [] };

  for (const key of Object.keys(equipment)) {
    const eq = equipment[key];
    const containerId = GROUP_LABELS[eq.group] || 'listAppareils';
    containers[containerId].push(key);
  }

  for (const containerId of Object.keys(containers)) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    for (const key of containers[containerId]) {
      container.appendChild(buildDeviceRow(key, equipment[key], state));
    }
  }
}

function buildDeviceRow(key, eq, state) {
  const row = document.createElement('div');
  row.className = 'device-row';

  const info = document.createElement('div');
  info.className = 'device-row__info';
  const title = document.createElement('strong');
  title.textContent = eq.label;
  const sub = document.createElement('span');
  const overrideValue = state.overrides[key];
  const isOn = !!state[key];
  sub.textContent = `${eq.watts} W — ${overrideValue === null || overrideValue === undefined ? 'automatique' : 'forcé'} · ${isOn ? 'ON' : 'OFF'}`;
  info.appendChild(title);
  info.appendChild(sub);

  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'toggle-group';

  const buttons = [
    { label: 'Auto', value: null },
    { label: 'ON', value: true },
    { label: 'OFF', value: false },
  ];

  for (const btnDef of buttons) {
    const btn = document.createElement('button');
    btn.textContent = btnDef.label;
    const isActive = overrideValue === undefined ? btnDef.value === null : overrideValue === btnDef.value;
    if (isActive) {
      btn.classList.add(btnDef.value === null ? 'active-auto' : btnDef.value ? 'active-on' : 'active-off');
    }
    btn.addEventListener('click', () => {
      send({ type: 'set-override', equipment: key, value: btnDef.value });
    });
    toggleGroup.appendChild(btn);
  }

  row.appendChild(info);
  row.appendChild(toggleGroup);
  return row;
}

function renderLog(log) {
  const list = document.getElementById('logList');
  list.innerHTML = '';
  for (const entry of log) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = entry.message;
    const time = document.createElement('time');
    time.textContent = formatTime(entry.at);
    li.appendChild(span);
    li.appendChild(time);
    list.appendChild(li);
  }
}

function renderDemoButtons(state) {
  document.getElementById('toggleCrisis').classList.toggle('is-active', state.crisisMode);
  document.getElementById('toggleNight').classList.toggle('is-active', state.forceNight);
  document.getElementById('toggleBike').classList.toggle('is-active', state.bikeActive);
}

// ---------------------------------------------------------------- formatage
function formatNumber(value, decimals) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(decimals);
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatElapsedSince(timestamp) {
  if (!timestamp) return 'un moment';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h`;
}

// ---------------------------------------------------------------- horloge / dernière maj
function tickClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('fr-FR');

  const hint = document.getElementById('lastUpdate');
  if (!lastMessageAt) {
    hint.textContent = 'En attente de données…';
  } else {
    const seconds = Math.floor((Date.now() - lastMessageAt) / 1000);
    hint.textContent = seconds < 2 ? 'Mis à jour à l\'instant' : `Mis à jour il y a ${seconds}s`;
  }
}
setInterval(tickClock, 1000);
tickClock();

// ---------------------------------------------------------------- boutons démo
document.getElementById('toggleCrisis').addEventListener('click', () => {
  send({ type: 'set-crisis', value: !(latestState && latestState.state.crisisMode) });
});
document.getElementById('toggleNight').addEventListener('click', () => {
  send({ type: 'set-night', value: !(latestState && latestState.state.forceNight) });
});
document.getElementById('toggleBike').addEventListener('click', () => {
  send({ type: 'set-bike', value: !(latestState && latestState.state.bikeActive) });
});

connect();
