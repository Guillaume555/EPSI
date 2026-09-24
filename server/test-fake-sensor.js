/*
  ============================================================================
  SmartRoom — Faux capteur (simulateur)
  ============================================================================
  Permet de tester tout le dashboard SANS la carte ESP8266 branchée : ce
  script se connecte au serveur comme si c'était la carte, et lui envoie des
  données de présence / température / humidité aléatoires toutes les 2
  secondes.

  Utilisation (le serveur — npm start — doit déjà tourner dans un autre
  terminal) :
    npm run fake-sensor
  ============================================================================
*/

const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:3000';
const SEND_INTERVAL_MS = 2000;

let temperature = 21;
let humidity = 45;

function randomWalk(value, min, max, step) {
  const next = value + (Math.random() * 2 - 1) * step;
  return Math.min(max, Math.max(min, next));
}

function connect() {
  const ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log(`[fake-sensor] Connecté au serveur ${SERVER_URL}`);

    setInterval(() => {
      const presence = Math.random() < 0.7; // 70% de chances qu'il y ait quelqu'un
      temperature = randomWalk(temperature, 10, 35, 0.8);
      humidity = randomWalk(humidity, 20, 90, 2);

      const payload = {
        type: 'sensors',
        presence,
        temperature: Math.round(temperature * 10) / 10,
        humidity: Math.round(humidity * 10) / 10,
      };

      ws.send(JSON.stringify(payload));
      console.log('[fake-sensor] envoyé ->', payload);
    }, SEND_INTERVAL_MS);
  });

  ws.on('error', (err) => {
    console.error('[fake-sensor] Erreur de connexion — le serveur (npm start) est-il lancé ?', err.message);
  });

  ws.on('close', () => {
    console.log('[fake-sensor] Déconnecté, nouvelle tentative dans 3s...');
    setTimeout(connect, 3000);
  });
}

connect();
