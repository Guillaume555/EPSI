# SmartRoom

**Workshop National B3 — Horizon 2080**
Pilier 3.C — *EnergyTech & SmartGrid*

Équipe : **Guillaume** (dashboard, serveur, intégration), **Oumaima**, **Hafsa**, **Imane**, **Léo** (capteurs / carte de sécurité OLED).

---

## 1. Objectif du projet

En 2080, l'énergie n'est plus une ressource illimitée : les habitats doivent produire eux-mêmes une partie de leur électricité et arbitrer en permanence entre confort et consommation. **SmartRoom** est le prototype d'une chambre intelligente qui répond à ce problème : elle **mesure en continu son environnement réel** (présence, température, humidité), **pilote automatiquement ses équipements** (éclairage, chauffage/climatisation, divertissement) pour rester confortable tout en consommant le moins possible, et **modélise une vraie contrainte de production d'énergie** — un réacteur nucléaire à puissance plafonnée, complété par une réserve de secours et des sources bonus (vélo générateur, récupération thermoélectrique) — avec une **vraie conséquence** si la consommation dépasse durablement ce que la chambre peut produire : une coupure d'urgence de tout ce qui n'est pas vital.

L'objectif n'est pas de simuler des chiffres abstraits, mais de montrer un système bouclé et cohérent : **capteurs réels → décision automatique → actionneurs réels → dashboard qui explique pourquoi**, avec la possibilité de forcer manuellement n'importe quel équipement, et de déclencher des scénarios de démonstration (mode crise, simulation de nuit, vélo générateur) pour l'oral.

## 2. Réponse à la problématique (résumé)

- **Perception du réel** : capteur de présence à ultrason (remplace un capteur de lumière non disponible), capteur température/humidité, sur une carte ESP8266.
- **Décision automatique** : chaque équipement a un mode *automatique* (piloté par la présence, l'heure, la température/humidité, le mode crise) et peut être *forcé manuellement* (Auto / ON / OFF) depuis le dashboard — le forçage manuel est prioritaire, sauf en coupure d'urgence.
- **Contrainte énergétique réaliste** : la chambre ne consomme pas une énergie infinie. Elle dispose d'une production plafonnée (nucléaire) et d'une réserve de secours qui absorbe les écarts. Si la réserve s'épuise alors que la consommation dépasse la production, une **coupure d'urgence réelle** intervient (tout est coupé sauf la ventilation vitale).
- **Génération bonus** : un vélo générateur (production humaine, +100 W) et une récupération thermoélectrique sur le système de climatisation (+25 W), pour illustrer qu'on peut aussi *produire*, pas seulement économiser.
- **Sécurité physique** : une carte annexe (voir §6) déclenche une alerte locale (écran OLED + relais) en cas de dépassement de seuil de température ou de présence très rapprochée, indépendamment du réseau.

## 3. Historique du projet — ce qui a été fait, dans l'ordre

Ce journal résume la progression réelle du projet, pour que les correcteurs comprennent la démarche et pas seulement le résultat final.

1. **Cadrage** — lecture du règlement du Workshop, confirmation qu'un seul sous-thème (3.C) suffit et n'a pas besoin de couvrir 3.A/3.B, choix du sujet *Smart Room*.
2. **Choix du matériel réel disponible** — pas de capteur de lumière fourni par l'école → remplacé par un capteur de présence à ultrason (HC-SR04). Ajout d'un capteur température/humidité (DHT). Deux écrans utilisés comme équipements simulés : un pour le chauffage/climatisation, un pour le divertissement (TV).
3. **Premier scaffold** — mise en place de l'architecture à 3 blocs : firmware ESP8266 (capteurs + LED) ↔ serveur Node.js (Express + WebSocket) ↔ dashboard web (HTML/CSS/JS), avec un script `test-fake-sensor.js` pour pouvoir développer et démontrer le dashboard sans dépendre du matériel physique.
4. **Connexion aux données réelles** — passage d'un dashboard à données simulées à un dashboard connecté en direct à la carte ESP8266 via WebSocket, avec un protocole de messages simple (`sensors`, `command`, `state`).
5. **Refonte visuelle du dashboard** — la première version était trop pauvre visuellement ; ajout de cartes (présence/température/humidité), d'un bandeau d'état, de badges, d'une mise en page en panneaux, pour un rendu plus proche d'un vrai tableau de bord smart-building — tout en gardant chaque chiffre affiché branché sur une vraie donnée du serveur.
6. **Logique auto/manuel** — chaque équipement (éclairage, écran climatisation, écran divertissement) passe d'un simple "allumé/éteint" à un vrai système à 3 états : **Automatique** (décidé par le serveur selon présence/heure/température), **Forcé ON**, **Forcé OFF** — avec retour automatique en mode Auto après une absence prolongée (5 minutes), pour éviter qu'un oubli manuel ne gaspille de l'énergie indéfiniment.
7. **Scénarios réalistes** — ajout du **mode crise énergétique** (seuils de confort élargis, équipements non essentiels priorisés à l'arrêt), de la **simulation de nuit** (pour déclencher l'éclairage automatique sans attendre le soir), et d'une **urgence thermique** absolue (température > 30 °C) qui force la climatisation quel que soit le mode, même en crise.
8. **Modèle de production d'énergie** — remplacement d'un simple "budget" énergétique abstrait par un vrai modèle physique crédible : un réacteur nucléaire à puissance plafonnée (650 W en fonctionnement normal, 325 W en crise), complété par une **réserve de secours rechargeable/déchargeable** (150 Wh) qui absorbe l'écart entre consommation et production. Si la réserve tombe à 0 % alors que la consommation dépasse toujours la production : **coupure d'urgence réelle** de tout ce qui n'est pas vital (seule la ventilation reste alimentée, en mode éco).
9. **Sources de génération bonus** — ajout d'un vélo générateur actionnable depuis le dashboard (+100 W, production humaine, inspiré des générateurs utilisés en expédition/survie) et d'une récupération thermoélectrique sur l'écran climatisation (+25 W, inspirée des générateurs thermoélectriques à radio-isotopes utilisés sur les sondes spatiales comme Voyager ou le rover Curiosity), pour montrer qu'on peut aussi produire, pas seulement consommer moins.
10. **Correction de bug** — une erreur de référence (`SUPPORTVIE_NORMAL_W` utilisée avant sa déclaration) empêchait le serveur de démarrer ; corrigée en réordonnant les constantes du fichier.
11. **Documentation de suivi** — création d'un document de suivi (langages utilisés, architecture des fichiers, cas de simulation, étapes à suivre) et d'un tableau Kanban pour répartir les tâches entre les 5 membres de l'équipe.
12. **Diagrammes UML** — diagramme de cas d'utilisation (avec la carte ESP8266 représentée comme un acteur non-humain stéréotypé «matériel», conformément à la convention UML, et non comme un bonhomme), diagramme de classes, diagramme de séquence, diagramme état-transition — exportés en image pour la présentation.
13. **Réponse conceptuelle à la problématique 3.C** — rédaction de la réponse théorique (au-delà du prototype physique), avec des exemples concrets tirés de ce qui a été réellement implémenté.
14. **Ce document** — rédaction du présent README pour que n'importe quel correcteur puisse comprendre le projet, son évolution, et le faire tourner en quelques minutes.

## 4. Architecture des fichiers

```
smartroom/
├── README.md                          ← ce fichier
├── firmware/
│   ├── smartroom_esp8266/
│   │   └── smartroom_esp8266.ino      ← carte connectée : alimente le dashboard en direct
│   └── smartroom_oled_leo/
│       └── smartroom_oled_leo.ino     ← carte de sécurité autonome (écran OLED, alerte locale)
└── server/
    ├── package.json
    ├── server.js                      ← logique complète (auto/manuel, énergie, WebSocket)
    ├── test-fake-sensor.js            ← simulateur de capteur (pour tester sans matériel)
    └── public/
        ├── index.html                 ← structure du dashboard
        ├── style.css                  ← charte graphique (tokens de couleur, mise en page)
        └── app.js                     ← client WebSocket, mise à jour du DOM en temps réel
```

## 5. Comment ça marche (vue d'ensemble)

```
 ESP8266 (capteurs)                Serveur Node.js                  Dashboard (navigateur)
 ┌────────────────────┐   WS      ┌───────────────────────┐   WS    ┌───────────────────────┐
 │ DHT22 → temp/hum    │ ───────► │ Calcule : auto/manuel, │ ──────► │ Affiche tout en temps  │
 │ HC-SR04 → présence  │           │ énergie, réserve,     │         │ réel, boutons de       │
 │ LED1/2/3 ← commande │ ◄─────── │ urgences, journal      │ ◄────── │ forçage et de scénario │
 └────────────────────┘           └───────────────────────┘         └───────────────────────┘
```

Le serveur est la seule source de vérité : il reçoit les données capteurs, décide de l'état de chaque équipement (sauf forçage manuel), gère la réserve d'énergie, et diffuse l'état complet à tous les dashboards connectés toutes les 5 secondes (et à chaque événement).

### Deux cartes, deux rôles complémentaires

Le dossier `firmware/` contient **deux firmwares différents**, qui ne font pas la même chose :

- **`smartroom_esp8266/`** — la carte "connectée" : elle envoie ses données au serveur en WiFi/WebSocket et alimente le dashboard décrit ci-dessus.
- **`smartroom_oled_leo/`** — la carte de sécurité de Léo : elle fonctionne **seule, en local**, avec un écran OLED, et déclenche une alerte physique (relais + LED) si la température dépasse 28 °C ou si quelqu'un s'approche à moins de 20 cm — **sans WiFi ni WebSocket**, donc sans lien direct avec le dashboard pour l'instant.

Ce point n'est pas un oubli : c'est un choix d'équipe encore ouvert. Les deux peuvent rester deux démonstrations séparées et complémentaires (l'une connectée/pilotable, l'autre autonome/de sécurité), ou la partie WiFi de la première peut être ajoutée à la seconde si l'équipe veut tout unifier avant la soutenance.

## 6. Guide d'installation

### Prérequis

- [Node.js](https://nodejs.org/) (version 18 ou plus récente) installé sur le PC qui fera tourner le serveur.
- Arduino IDE installé si vous voulez flasher une carte ESP8266 réelle (sinon le simulateur suffit pour tester tout le dashboard).

### A. Lancer le serveur + dashboard (sans matériel, avec le simulateur)

Ouvrez un terminal (PowerShell sous Windows) dans le dossier `smartroom/server` :

```powershell
cd chemin\vers\smartroom\server
npm install
npm start
```

Vous devez voir s'afficher :

```
SmartRoom server [v7 — production nucléaire + réserve de secours avec coupure d'urgence réelle] → http://localhost:3000
```

**Laissez ce terminal ouvert.** Ouvrez ensuite votre navigateur sur **http://localhost:3000** : le dashboard s'affiche (vide tant qu'aucune donnée n'est reçue).

Pour simuler des capteurs (sans carte réelle), ouvrez un **second terminal**, toujours dans `smartroom/server` :

```powershell
npm run fake-sensor
```

Le dashboard doit maintenant se remplir et bouger tout seul (présence, température, humidité aléatoires toutes les 2 secondes).

> Erreur fréquente : si le simulateur affiche *"le serveur (npm start) est-il lancé ?"*, c'est que le premier terminal (`npm start`) n'est pas resté ouvert — les deux terminaux doivent tourner **en même temps**.

### B. Brancher la vraie carte ESP8266

1. Ouvrez `firmware/smartroom_esp8266/smartroom_esp8266.ino` dans l'Arduino IDE.
2. Installez les bibliothèques (Gestionnaire de bibliothèques) : `WebSockets` (Markus Sattler / Links2004), `ArduinoJson`, `DHT sensor library` (Adafruit) + `Adafruit Unified Sensor`.
3. En haut du fichier, renseignez votre réseau WiFi et l'adresse IP locale du PC qui fait tourner `npm start` (trouvable avec `ipconfig` sous Windows, ligne "Adresse IPv4") :
   ```cpp
   const char* WIFI_SSID     = "NOM_DU_WIFI";
   const char* WIFI_PASSWORD = "MOT_DE_PASSE_WIFI";
   const char* SERVER_HOST   = "192.168.1.XX";
   ```
4. Câblage (macros NodeMCU) : DHT22 → D2, HC-SR04 TRIG → D1 / ECHO → D5, LED1 → D6, LED2 → D7, LED3 → D0.
5. Téléversez le programme. Ouvrez le moniteur série (115200 bauds) pour vérifier la connexion WiFi puis WebSocket.
6. Le PC et la carte doivent être sur le **même réseau WiFi**. Le dashboard (http://localhost:3000, ou l'IP du PC serveur depuis un autre appareil) se met alors à jour avec les vraies données.

### C. Utiliser le dashboard

- Les panneaux **Éclairage** et **Appareils** ont chacun un interrupteur **Auto / ON / OFF** par équipement.
- Le panneau **Démo & scénarios** permet de déclencher le **mode crise énergétique**, une **simulation de nuit** (pour tester l'éclairage automatique sans attendre le soir), et le **vélo générateur** — utile pour l'oral, sans avoir besoin du matériel physique.
- Le panneau **Journal** trace tous les événements (changements d'état, urgences, réserve).

## 7. Modèle énergétique (détail pour la soutenance)

| Élément | Valeur |
|---|---|
| Production nucléaire nominale | 650 W |
| Production nucléaire en mode crise | 325 W |
| Capacité de la réserve de secours | 150 Wh |
| Bonus vélo générateur | +100 W (tant qu'actionné) |
| Bonus récupération thermoélectrique | +25 W (si climatisation/chauffage actif) |
| Ventilation (support de vie) — normal / éco | 40 W / 15 W |
| Seuil de confort température (normal / crise) | 19–24 °C / 15–28 °C |
| Seuil de danger absolu (urgence thermique) | > 30 °C |

Logique : à chaque cycle, le serveur compare la consommation totale à la production. Si la consommation dépasse la production, la réserve se décharge ; sinon elle se recharge (plafonnée à 150 Wh). **Si la réserve atteint 0 % alors que la consommation dépasse encore la production, une coupure d'urgence force à OFF tous les équipements sauf la ventilation** (qui passe en mode éco) — jusqu'à ce que la consommation redescienne sous la production et que la réserve puisse se reconstituer.

## 8. Technologies utilisées

- **Firmware** : C++ (Arduino), bibliothèques `ESP8266WiFi`, `WebSocketsClient`, `ArduinoJson`, `DHT`.
- **Serveur** : Node.js, `express` (sert le dashboard), `ws` (WebSocket).
- **Dashboard** : HTML / CSS / JavaScript natif (pas de framework), communication temps réel en WebSocket.

## 9. Pour aller plus loin

- Unifier les deux firmwares (ajouter le WiFi à la carte de sécurité de Léo) pour que son alerte remonte aussi sur le dashboard.
- Historiser les données sur plus long terme (actuellement les 40 derniers points en mémoire) pour des statistiques sur plusieurs jours.
- Ajouter un vrai capteur de luminosité si l'école en met un à disposition, en complément (et non en remplacement) du capteur de présence à ultrason.
