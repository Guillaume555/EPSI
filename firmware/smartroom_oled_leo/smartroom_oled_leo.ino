/*
  ============================================================================
  SmartRoom — Sous-système autonome "sécurité + écran OLED" (Léo)
  ============================================================================
  Pilier 3.C — EnergyTech & SmartGrid — Workshop National B3 Horizon 2080

  IMPORTANT — À LIRE :
  Ce sketch est INDÉPENDANT du dashboard web. Il ne se connecte à AUCUN
  WiFi et n'utilise AUCUNE WebSocket : il fonctionne seul, en local, sur
  sa propre carte ESP8266, avec son propre écran OLED.

  Il ne peut donc PAS, tel quel, envoyer ses données au serveur
  (server/server.js) ni apparaître sur le dashboard. Si l'équipe veut
  qu'il remonte ses données au dashboard, il faudrait lui ajouter la
  partie WiFi + WebSocket présente dans l'autre firmware du dossier
  (../smartroom_esp8266/smartroom_esp8266.ino) — décision pas encore
  prise par l'équipe : pour l'instant les deux cartes fonctionnent comme
  deux démonstrations séparées et complémentaires :

    1. smartroom_esp8266/      → carte connectée, alimente le dashboard
                                  en direct (présence, température,
                                  humidité, pilotage LED à distance).
    2. smartroom_oled_leo/     → carte de sécurité locale et autonome,
                                  avec écran OLED, qui déclenche une
                                  alerte physique (relais + LED) si la
                                  température dépasse un seuil ou si
                                  quelqu'un s'approche trop près, SANS
                                  dépendre du réseau ni du serveur.

  Matériel utilisé ici :
    - Écran OLED SSD1306 128x64 (I2C)
    - Capteur DHT11 (température / humidité)
    - Capteur ultrason HC-SR04 (distance)
    - 1 LED + 1 relais (déclenchement physique, ex. ventilation / alarme)

  Ce fichier est fourni tel quel (code réel de Léo), non modifié dans sa
  logique, uniquement documenté ici pour le rapport et la soutenance.
  ============================================================================
*/

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

// -------------------------------------------------------------------
// CONFIGURATION DE L'ÉCRAN OLED SSD1306 (128x64)
// -------------------------------------------------------------------
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// -------------------------------------------------------------------
// CONFIGURATION DU CAPTEUR DHT11
// -------------------------------------------------------------------
#define DHTPIN D5     // Broche DATA du DHT11
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

// -------------------------------------------------------------------
// CONFIGURATION DU CAPTEUR ULTRASONS HC-SR04
// -------------------------------------------------------------------
const int TRIG_PIN = D6; // Broche Trig du capteur ultrasons
const int ECHO_PIN = D7; // Broche Echo du capteur ultrasons

// -------------------------------------------------------------------
// CONFIGURATION DES ACTIONNEURS
// -------------------------------------------------------------------
const int LED_1     = D1; // LED branchée sur D1
const int RELAY_PIN = D4; // Relais branché sur D4

// -------------------------------------------------------------------
// SEUILS DE DÉCLENCHEMENT ET TEMPORISATION
// -------------------------------------------------------------------
const float SEUIL_TEMP = 28.0;              // Déclenchement si T >= 28.0 °C
const int DISTANCE_SEUIL = 20;              // Déclenchement si Distance <= 20 cm
const unsigned long TEMPO_ALLUMAGE = 10000; // Activation pendant 10 secondes (10000 ms)

unsigned long tempsDeclenchement = 0;
bool systemeActif = false;

void setup() {
  Serial.begin(115200);

  // Communication I2C : SDA sur D2, SCL sur D0
  Wire.begin(D2, D0);

  // Configuration des broches d'entrées/sorties
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_1, OUTPUT);

  // État initial : Relais et LED éteints
  digitalWrite(RELAY_PIN, HIGH); // HIGH = Relais désactivé (logique inversée)
  digitalWrite(LED_1, LOW);      // LOW = LED éteinte

  // Initialisation du capteur DHT11
  dht.begin();

  // Initialisation de l'écran OLED (Adresse I2C 0x3C)
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("Échec d'initialisation de l'OLED. Vérifiez le câblage !"));
    for(;;); // Arrêt de sécurité
  }

  // Message au démarrage
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.setCursor(10, 20);
  display.println("Initialisation...");
  display.display();
  delay(1500);
}

void loop() {
  // 1. Lecture du capteur de température DHT11
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();

  // 2. Mesure de la distance avec le capteur ultrasons HC-SR04
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH);
  int distance = duration * 0.034 / 2; // Conversion en cm

  // Diagnostic dans le moniteur série
  Serial.print("Temp: ");
  if (isnan(temp)) Serial.print("Erreur");
  else Serial.print(temp);
  Serial.print(" °C | Hum: ");
  if (isnan(hum)) Serial.print("Erreur");
  else Serial.print(hum);
  Serial.print(" % | Dist: ");
  Serial.print(distance);
  Serial.println(" cm");

  // 3. Détection : Température (>= 28°C) OU Distance (<= 20 cm)
  bool conditionTemp = (!isnan(temp) && temp >= SEUIL_TEMP);
  bool conditionDist = (distance > 0 && distance <= DISTANCE_SEUIL);

  if (conditionTemp || conditionDist) {
    tempsDeclenchement = millis(); // Horodatage du déclenchement

    if (!systemeActif) {
      systemeActif = true;
      digitalWrite(RELAY_PIN, LOW); // Active le relais
      digitalWrite(LED_1, HIGH);   // Allume la LED sur D1
      Serial.println("Alerte ! Relais et LED activés.");
    }
  }

  // 4. Extinction automatique après 10 secondes (non-bloquant)
  if (systemeActif) {
    if (millis() - tempsDeclenchement >= TEMPO_ALLUMAGE) {
      systemeActif = false;
      digitalWrite(RELAY_PIN, HIGH); // Éteint le relais
      digitalWrite(LED_1, LOW);     // Éteint la LED
      Serial.println("Fin de la temporisation. Repos.");
    }
  }

  // 5. Affichage sur l'écran OLED
  display.clearDisplay();
  display.setTextColor(WHITE);

  // Ligne 1 : Température et Humidité
  display.setTextSize(1);
  display.setCursor(0, 0);
  if (!isnan(temp) && !isnan(hum)) {
    display.print("Temp: ");
    display.print(temp, 1);
    display.print((char)247); // Symbole °
    display.print("C ");
    display.print(hum, 0);
    display.println("%");
  } else {
    display.println("Temp: Lecture...");
  }

  // Ligne 2 : Distance
  display.setTextSize(2);
  display.setCursor(0, 20);
  display.print("Dist: ");
  display.print(distance);
  display.println("cm");

  // Ligne 3 : État du système
  display.setTextSize(1);
  display.setCursor(0, 48);
  if (systemeActif) {
    display.println(">> ALERTE : ACTIF <<");
  } else {
    display.println("Etat: Normal");
  }

  display.display();
  delay(1500); // Temps de rafraîchissement requis par le DHT11
}
