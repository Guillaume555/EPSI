/*
  ============================================================================
  SmartRoom — Firmware ESP8266 (version WiFi / WebSocket)
  ============================================================================
  Pilier 3.C — EnergyTech & SmartGrid — Workshop National B3 Horizon 2080

  Ce firmware est celui qui communique EN DIRECT avec le serveur Node.js
  (server/server.js) via WebSocket, pour alimenter le dashboard en données
  réelles (présence, température, humidité) et recevoir les commandes des
  3 LED (éclairage) décidées automatiquement ou manuellement depuis le
  dashboard.

  Capteurs :
    - DHT22          → température (°C) + humidité (%)
    - HC-SR04        → détection de présence (mesure de distance, seuil)
  Actionneurs :
    - LED1 / LED2 / LED3 → éclairage piloté par le serveur (auto ou manuel)

  Protocole WebSocket (identique à server/server.js) :
    ESP8266 → Serveur :
      { "type": "sensors", "presence": bool, "temperature": float, "humidity": float }
    Serveur → ESP8266 :
      { "type": "command", "led1": bool, "led2": bool, "led3": bool }

  Bibliothèques nécessaires (Gestionnaire de bibliothèques Arduino IDE) :
    - ESP8266WiFi        (fournie avec le core ESP8266)
    - WebSockets          by Markus Sattler (Links2004/arduinoWebSockets)
    - ArduinoJson          by Benoit Blanchon (v6.x)
    - DHT sensor library    by Adafruit  (+ Adafruit Unified Sensor)
  ============================================================================
*/

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ----------------------------------------------------------------------------
// À MODIFIER : identifiants WiFi et adresse IP du serveur (PC qui lance
// "npm start"). Trouver l'IP du PC avec "ipconfig" (Windows) → IPv4.
// ----------------------------------------------------------------------------
const char* WIFI_SSID     = "NOM_DU_WIFI";
const char* WIFI_PASSWORD = "MOT_DE_PASSE_WIFI";
const char* SERVER_HOST   = "192.168.1.XX"; // IP locale du PC serveur
const uint16_t SERVER_PORT = 3000;

// ----------------------------------------------------------------------------
// Broches (macros NodeMCU D0..D8 → GPIO réels, gérées par le core ESP8266)
// ----------------------------------------------------------------------------
#define DHT_PIN   D2
#define DHT_TYPE  DHT22

const int TRIG_PIN = D1;
const int ECHO_PIN = D5;

const int LED1_PIN = D6;
const int LED2_PIN = D7;
const int LED3_PIN = D0;

// Distance (cm) en dessous de laquelle on considère qu'il y a présence
const int PRESENCE_DISTANCE_CM = 150;

// Envoi des données capteurs toutes les X ms
const unsigned long SEND_INTERVAL_MS = 2000;

DHT dht(DHT_PIN, DHT_TYPE);
WebSocketsClient webSocket;

unsigned long lastSendAt = 0;

// ----------------------------------------------------------------------------
// Mesure de distance HC-SR04
// ----------------------------------------------------------------------------
long readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 25000UL); // timeout 25ms (~4m)
  if (duration == 0) return -1; // pas d'écho reçu
  return duration * 0.034 / 2;
}

// ----------------------------------------------------------------------------
// Application d'une commande reçue du serveur sur les 3 LED
// ----------------------------------------------------------------------------
void applyCommand(bool led1, bool led2, bool led3) {
  digitalWrite(LED1_PIN, led1 ? HIGH : LOW);
  digitalWrite(LED2_PIN, led2 ? HIGH : LOW);
  digitalWrite(LED3_PIN, led3 ? HIGH : LOW);
}

// ----------------------------------------------------------------------------
// Callback WebSocket
// ----------------------------------------------------------------------------
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[WS] Connecté au serveur SmartRoom");
      break;

    case WStype_DISCONNECTED:
      Serial.println("[WS] Déconnecté du serveur");
      break;

    case WStype_TEXT: {
      StaticJsonDocument<256> doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        Serial.print("[WS] Erreur JSON : ");
        Serial.println(err.c_str());
        return;
      }

      const char* msgType = doc["type"] | "";
      if (strcmp(msgType, "command") == 0) {
        bool led1 = doc["led1"] | false;
        bool led2 = doc["led2"] | false;
        bool led3 = doc["led3"] | false;
        applyCommand(led1, led2, led3);
        Serial.printf("[WS] Commande reçue -> LED1:%d LED2:%d LED3:%d\n", led1, led2, led3);
      }
      break;
    }

    default:
      break;
  }
}

// ----------------------------------------------------------------------------
// setup()
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("=== SmartRoom — Firmware ESP8266 (WiFi) ===");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED1_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);
  pinMode(LED3_PIN, OUTPUT);
  digitalWrite(LED1_PIN, LOW);
  digitalWrite(LED2_PIN, LOW);
  digitalWrite(LED3_PIN, LOW);

  dht.begin();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connexion au WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connecté, IP locale : ");
  Serial.println(WiFi.localIP());

  webSocket.begin(SERVER_HOST, SERVER_PORT, "/");
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(3000);
}

// ----------------------------------------------------------------------------
// loop()
// ----------------------------------------------------------------------------
void loop() {
  webSocket.loop();

  unsigned long now = millis();
  if (now - lastSendAt >= SEND_INTERVAL_MS) {
    lastSendAt = now;

    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();
    long distance = readDistanceCm();
    bool presence = (distance > 0 && distance <= PRESENCE_DISTANCE_CM);

    if (isnan(temperature)) temperature = 21.0; // valeur de repli si lecture invalide
    if (isnan(humidity)) humidity = 45.0;

    StaticJsonDocument<200> doc;
    doc["type"] = "sensors";
    doc["presence"] = presence;
    doc["temperature"] = temperature;
    doc["humidity"] = humidity;

    String out;
    serializeJson(doc, out);
    webSocket.sendTXT(out);

    Serial.printf("[Capteurs] presence=%d temp=%.1f°C hum=%.1f%% dist=%ldcm\n",
                  presence, temperature, humidity, distance);
  }
}
