# SAFEWAY MANIF — Cahier des charges fonctionnel et technique

**Version :** 1.0  
**Type :** PWA / WebApp mobile-first  
**Objectif :** aider les personnes présentes dans ou autour d’une manifestation à se déplacer de manière plus sûre grâce à des informations communautaires récentes, anonymes et éphémères.

---

# 1. Vision produit

SafeWay Manif est une application cartographique collaborative fonctionnant sur navigateur mobile.

L’utilisateur active un **Mode Manif** et peut :

- visualiser les rues et passages autour de lui ;
- voir si un axe est actuellement praticable, incertain ou déconseillé ;
- signaler un danger ou un obstacle ;
- confirmer ou invalider un signalement existant ;
- obtenir un itinéraire privilégiant les passages récemment confirmés comme praticables ;
- recevoir les changements importants concernant son trajet en cours.

L’application doit être pensée comme un outil de **sécurité piétonne et de prévention des risques**, et non comme un outil de surveillance de personnes.

Aucune identité réelle n’est demandée.

Aucune position individuelle d’utilisateur n’est visible.

Aucun historique de déplacement n’est conservé.

---

# 2. Principes fondamentaux

## 2.1 Privacy by design

La confidentialité doit être intégrée dès l’architecture.

Principes obligatoires :

- aucune identité réelle ;
- pseudonyme obligatoire ;
- aucune adresse postale ;
- aucun nom/prénom ;
- aucun numéro de téléphone obligatoire ;
- aucune date de naissance ;
- aucun contact importé ;
- aucun historique GPS ;
- aucune trajectoire utilisateur sauvegardée ;
- aucune position précise affichée publiquement ;
- aucun profil public détaillé ;
- aucune liste de participants à une manifestation ;
- aucune conservation inutile de métadonnées.

Les seules données persistantes du compte doivent être limitées au strict nécessaire.

---

# 3. Compte utilisateur

## 3.1 Données persistantes autorisées

Compte minimal :

```text
user_id
pseudo
auth_public_key / passkey
created_at
reputation_score
moderation_status
```

Le `user_id` doit être aléatoire et ne contenir aucune information personnelle.

Le pseudo est obligatoire.

Le pseudo doit être unique.

## 3.2 Authentification recommandée

Priorité :

### Option A — Passkeys / WebAuthn

Solution recommandée.

Avantages :

- aucun mot de passe serveur ;
- résistance au phishing ;
- clé privée conservée sur l’appareil de l’utilisateur ;
- le serveur conserve uniquement la clé publique nécessaire à l’authentification.

### Option B — Mot de passe

Seulement si nécessaire.

Dans ce cas :

- hash via Argon2id ;
- salt individuel ;
- jamais de mot de passe en clair ;
- jamais de log contenant le mot de passe ;
- politique anti-bruteforce.

---

# 4. Mode Manif

L’utilisateur peut activer :

> MODE MANIF

Une fois activé, l’application demande une autorisation GPS temporaire.

La position sert uniquement à :

- centrer la carte ;
- déterminer la proximité des signalements ;
- proposer un itinéraire ;
- permettre la validation locale d’un événement ;
- calculer si l’utilisateur est suffisamment proche pour confirmer un signalement.

La position GPS brute ne doit jamais être enregistrée durablement.

À la fermeture du Mode Manif :

- les données locales de session sont supprimées ;
- les coordonnées temporaires sont détruites ;
- aucune timeline de déplacement n’est conservée côté serveur.

---

# 5. Carte

Technologie recommandée :

- MapLibre GL JS
- OpenStreetMap
- fournisseur de tuiles compatible avec la charge attendue

Éviter toute dépendance inutile à un fournisseur imposant une collecte de données utilisateur.

## 5.1 Couleurs des routes

### Vert

Passage récemment confirmé comme praticable.

### Orange

Informations insuffisantes, anciennes ou contradictoires.

### Rouge

Passage actuellement signalé comme bloqué ou présentant un risque important.

### Gris

Aucune information communautaire récente.

---

# 6. Signalements

Les signalements doivent concerner la sécurité et la praticabilité d’une zone.

Types principaux :

```text
PASSAGE_LIBRE
PASSAGE_BLOQUE
FOULE_DENSE
MOUVEMENT_FOULE
GAZ_FUMEE
INCENDIE
DEBRIS
VEHICULE_BLOQUANT
VIOLENCE_EN_COURS
INTERVENTION_EN_COURS
SECOURS_PRESENT
SORTIE_ACCESSIBLE
DANGER_AUTRE
```

## Important

L’application ne doit pas permettre :

- d’identifier individuellement une personne ;
- de publier son identité ;
- d’afficher la position individuelle d’un manifestant ;
- d’établir un historique de mouvements individuels ;
- de suivre en temps réel une unité ou un agent identifiable.

Les informations sur une intervention doivent rester **agrégées au niveau d’une zone** et être formulées comme une information de sécurité :

> Intervention en cours — passage déconseillé.

Aucun nom, matricule, visage ou identifiant individuel ne doit pouvoir être associé à un signalement.

---

# 7. Création d’un signalement

Workflow :

1. utilisateur maintient une zone de la carte ou appuie sur « Signaler » ;
2. sélection du type de danger ;
3. l’application vérifie que l’utilisateur est physiquement proche ;
4. le signalement est envoyé ;
5. il apparaît avec un niveau de confiance initial faible ;
6. les personnes proches peuvent le confirmer ou l’invalider.

Aucune zone de commentaire libre n’est nécessaire en V1.

Cela limite :

- doxxing ;
- insultes ;
- désinformation ;
- publication d’informations personnelles.

---

# 8. Précision géographique

Ne jamais publier les coordonnées GPS exactes ayant servi à créer un signalement.

Créer une cellule géographique ou un segment de rue.

Exemple :

```text
GPS utilisateur
    ↓
matching sur segment de rue
    ↓
suppression GPS brut
    ↓
stockage uniquement :
segment_id
event_type
timestamp
confidence
```

Possibilité d’utiliser :

- H3 ;
- geohash ;
- segment OpenStreetMap ;
- clustering géospatial.

Les événements doivent être associés à une zone suffisamment large pour éviter la surveillance individuelle.

---

# 9. Validation communautaire

Chaque événement possède :

```text
confirmations
invalidations
created_at
last_confirmation_at
confidence_score
status
```

Boutons :

- Toujours vrai
- Plus d’actualité

Une validation ne doit être acceptée que si l’utilisateur se trouve réellement à proximité de la zone.

---

# 10. Score de confiance

Exemple :

```text
confidence =
recency_score
× local_confirmations
× user_reputation
× geographic_proximity
× consistency_score
```

Critères :

### Récence

Un événement récent vaut beaucoup plus qu’un événement ancien.

### Confirmations indépendantes

Plusieurs utilisateurs distincts proches géographiquement augmentent la fiabilité.

### Réputation

Un utilisateur dont les précédents signalements sont régulièrement confirmés obtient progressivement davantage de poids.

### Contradiction

Les validations opposées réduisent automatiquement le score.

---

# 11. Expiration automatique

Les informations doivent être temporaires.

Exemple V1 :

| Événement | Durée indicative |
|---|---:|
| Passage libre | 10 min |
| Passage bloqué | 15 min |
| Foule dense | 10 min |
| Gaz / fumée | 15 min |
| Mouvement de foule | 10 min |
| Violence en cours | 10 min |
| Intervention en cours | 10 min |
| Débris / obstacle | 30 min |
| Secours | 15 min |

Chaque nouvelle confirmation peut prolonger légèrement la durée.

Après expiration :

```text
status = expired
```

Puis suppression physique rapide de l’événement.

---

# 12. Routage sécurisé

L’utilisateur choisit une destination.

Le moteur calcule un itinéraire.

Le coût d’un segment pourrait être :

```text
routing_cost =
distance
+ danger_penalty
+ uncertainty_penalty
+ stale_data_penalty
```

Priorité :

1. passage praticable récemment confirmé ;
2. zone sans danger connu ;
3. éviter les zones rouges ;
4. éviter les zones à forte incertitude si une alternative raisonnable existe.

Le résultat doit être présenté comme :

> Itinéraire basé sur les informations communautaires disponibles.

Ne jamais garantir qu’un trajet est « sûr ».

---

# 13. Actualisation temps réel

Technologies possibles :

- WebSocket ;
- Server-Sent Events ;
- Redis Pub/Sub.

Lorsqu’un événement apparaît ou change près du trajet :

```text
SERVER
   ↓
WebSocket
   ↓
CLIENT
   ↓
Map update
```

Pas besoin de rafraîchir manuellement la page.

---

# 14. Géolocalisation côté client

La position doit être traitée au maximum côté client.

Workflow recommandé :

```text
navigator.geolocation
        ↓
coordonnées temporairement en RAM
        ↓
calcul local / map matching
        ↓
envoi de l’identifiant de zone si nécessaire
        ↓
suppression des coordonnées
```

Éviter :

```text
POST /location
{ latitude, longitude, user_id }
```

Préférer :

```text
POST /presence-proof
{
  area_token,
  event_id
}
```

---

# 15. Preuve de proximité

Objectif :

permettre à quelqu’un de confirmer qu’il se trouve approximativement dans la zone sans stocker sa position.

Approche V1 pragmatique :

1. GPS récupéré dans le navigateur ;
2. conversion immédiate vers une cellule géographique ;
3. comparaison avec la cellule du signalement ;
4. coordonnées brutes détruites ;
5. seule la preuve de proximité éphémère est envoyée.

Approches avancées ultérieures :

- tokens de proximité ;
- signatures anonymes ;
- preuves cryptographiques spécialisées.

---

# 16. Chiffrement

Objectif : chiffrement partout où cela est pertinent.

## 16.1 Transport

Obligatoire :

```text
HTTPS uniquement
TLS 1.3 préféré
HSTS
Secure Cookies
HttpOnly
SameSite
```

Aucune API accessible en HTTP.

Redirection HTTP → HTTPS immédiatement.

## 16.2 Base de données

Chiffrement au repos :

- volume chiffré ;
- sauvegardes chiffrées ;
- secrets séparés de la base ;
- rotation périodique des clés.

## 16.3 Secrets

Jamais dans Git.

Utiliser :

- variables d’environnement protégées ;
- secret manager ;
- Vault si nécessaire à grande échelle.

## 16.4 Données sensibles temporaires

Les données GPS brutes :

- jamais écrites dans les logs ;
- jamais écrites dans la base ;
- jamais ajoutées à un outil analytics ;
- supprimées immédiatement après utilisation.

---

# 17. Logs

Les logs doivent être minimaux.

Interdit dans les logs :

```text
latitude
longitude
IP complète
GPS
user-agent complet si inutile
token
cookie
mot de passe
passkey credential secret
```

Possibilité de conserver temporairement :

```text
timestamp arrondi
endpoint
code HTTP
erreur technique
request_id aléatoire
```

---

# 18. Adresses IP

Les IP ne doivent pas être utilisées pour tracer les utilisateurs.

Pour la sécurité anti-abus, utiliser en priorité :

- rate limiting en mémoire ;
- fenêtre temporelle courte ;
- token anonyme ;
- challenge anti-bot.

Si une IP doit exceptionnellement être traitée pour empêcher une attaque :

- traitement temporaire ;
- pas d’historique longue durée ;
- suppression rapide ;
- jamais affichée dans l’interface d’administration standard.

---

# 19. Analytics

Éviter les trackers publicitaires.

Ne pas intégrer :

- pixels publicitaires ;
- fingerprinting ;
- suivi cross-site ;
- SDK marketing invasifs.

Pour les statistiques produit :

préférer des métriques agrégées :

```text
sessions_actives
signalements_total
confirmations_total
zones_actives
latence_API
```

Sans profil utilisateur marketing.

---

# 20. Anti-abus

Risques :

- faux signalements ;
- spam ;
- brigading ;
- bots ;
- création massive de comptes ;
- falsification GPS ;
- tentatives de saturation.

Protections :

- rate limiting ;
- CAPTCHA / Turnstile uniquement si nécessaire ;
- réputation ;
- limites par compte ;
- validation communautaire ;
- expiration rapide ;
- détection statistique d’anomalies ;
- shadow moderation possible ;
- cooldown entre signalements identiques.

---

# 21. Réputation

Score interne non public.

Exemple :

```text
+ signalement confirmé
+ invalidation correcte
+ présence régulière cohérente

- signalement massivement invalidé
- spam
- comportement anormal
```

Ne jamais afficher une note publique permettant de profiler les utilisateurs.

---

# 22. Modération

Dashboard administrateur séparé.

Fonctions :

- visualiser les événements actifs ;
- détecter les anomalies ;
- suspendre un compte ;
- supprimer un signalement ;
- analyser les signalements abusifs ;
- observer des métriques agrégées.

L’administrateur ne doit pas avoir accès à un historique GPS inexistant.

---

# 23. UX mobile

L’interface doit fonctionner à une main.

Écran principal :

```text
┌─────────────────────────┐
│ SAFEWAY                 │
│ Mode Manif : ON         │
├─────────────────────────┤
│                         │
│          CARTE          │
│                         │
│ 🟢 passage libre        │
│ 🟠 incertain            │
│ 🔴 danger / blocage     │
│                         │
├─────────────────────────┤
│ [ Signaler ] [ Trajet ] │
└─────────────────────────┘
```

---

# 24. Création rapide d’un signalement

UI :

```text
Que se passe-t-il ?

🟢 Passage libre
🔴 Passage bloqué
🟠 Foule dense
💨 Gaz / fumée
🔥 Incendie
⚠️ Danger
🚑 Secours
↗️ Sortie accessible
```

Maximum deux interactions pour publier.

---

# 25. Accessibilité

Prévoir :

- gros boutons ;
- contraste élevé ;
- utilisation sous forte luminosité ;
- mode sombre ;
- texte lisible ;
- retours haptiques si disponibles ;
- icônes + texte ;
- compatibilité lecteur d’écran.

Ne jamais dépendre uniquement de la couleur.

---

# 26. Résilience réseau

Les manifestations peuvent saturer les réseaux mobiles.

Prévoir :

- cache PWA ;
- assets hors ligne ;
- faible consommation réseau ;
- compression ;
- payloads API courts ;
- cache local temporaire ;
- synchronisation lorsque la connexion revient.

L’utilisateur doit pouvoir continuer à voir la dernière carte disponible même si le réseau est momentanément indisponible.

Afficher clairement :

> Données non actualisées depuis X minutes.

---

# 27. Architecture proposée

```text
                         ┌─────────────────────┐
                         │       PWA           │
                         │ React / Next.js     │
                         │ MapLibre            │
                         └─────────┬───────────┘
                                   │ HTTPS
                                   │
                         ┌─────────▼───────────┐
                         │       API           │
                         │ FastAPI / Node.js   │
                         └──────┬───────┬──────┘
                                │       │
                     ┌──────────▼─┐   ┌─▼─────────┐
                     │ PostgreSQL │   │   Redis   │
                     │ + PostGIS  │   │ realtime  │
                     └────────────┘   └───────────┘
```

---

# 28. Stack recommandée

## Frontend

```text
Next.js
TypeScript
React
MapLibre GL JS
TailwindCSS
PWA
WebAuthn
```

## Backend

Option recommandée :

```text
FastAPI
Python
PostgreSQL
PostGIS
Redis
WebSocket
```

ou :

```text
Node.js
NestJS
PostgreSQL
PostGIS
Redis
WebSocket
```

## Infra

```text
Docker
Nginx / Caddy
TLS
PostgreSQL chiffré
Redis
CI/CD
```

Hébergement européen recommandé.

---

# 29. Base de données

## users

```sql
id UUID PRIMARY KEY
pseudo VARCHAR UNIQUE NOT NULL
public_key TEXT
reputation_score FLOAT DEFAULT 1
created_at TIMESTAMP
status VARCHAR
```

## events

```sql
id UUID PRIMARY KEY
area_id VARCHAR NOT NULL
road_segment_id VARCHAR
type VARCHAR NOT NULL
created_at TIMESTAMP NOT NULL
expires_at TIMESTAMP NOT NULL
confidence_score FLOAT
status VARCHAR
```

## event_votes

```sql
id UUID PRIMARY KEY
event_id UUID
anonymous_actor_token VARCHAR
vote VARCHAR
created_at TIMESTAMP
```

Éviter de stocker directement `user_id` lorsqu’il n’est pas nécessaire.

L’objectif est de réduire les possibilités de reconstruction d’un historique d’activité.

---

# 30. Suppression automatique

Job périodique :

```text
events expirés
    ↓
suppression
```

Les tables temporaires doivent être purgées.

Exemple :

```text
toutes les 5 minutes :
DELETE FROM events
WHERE expires_at < NOW() - INTERVAL '30 minutes';
```

Aucun archivage permanent des cartes de manifestations.

---

# 31. Sauvegardes

Les sauvegardes ne doivent pas réintroduire des données que le produit prétend supprimer rapidement.

Conséquence :

les événements temporaires peuvent être exclus des sauvegardes longue durée.

Sauvegarder principalement :

- comptes ;
- configuration ;
- données indispensables au fonctionnement.

Chiffrer toutes les sauvegardes.

---

# 32. API V1

## Auth

```text
POST /auth/register
POST /auth/login
POST /auth/passkey/register
POST /auth/passkey/login
POST /auth/logout
```

## Map

```text
GET /map/events
GET /map/status
```

## Event

```text
POST /events
GET /events/{id}
POST /events/{id}/confirm
POST /events/{id}/invalidate
```

## Route

```text
POST /route
```

## Account

```text
GET /me
PATCH /me/pseudo
DELETE /me
```

---

# 33. Suppression du compte

L’utilisateur doit pouvoir supprimer son compte instantanément.

```text
DELETE /me
```

Effets :

- suppression du pseudo ;
- suppression des clés publiques associées ;
- suppression des données persistantes du compte ;
- invalidation des sessions.

Les événements communautaires temporaires ne doivent pas contenir assez d’informations pour reconstruire son historique.

---

# 34. Threat model

Menaces à prendre en compte :

### Attaquant externe

Objectifs possibles :

- voler la base ;
- récupérer les comptes ;
- suivre des utilisateurs ;
- injecter de faux signalements.

### Utilisateur malveillant

Objectifs :

- spam ;
- désinformation ;
- faux dangers ;
- manipulation de trajet.

### Administrateur compromis

Limiter ce qu’un compte admin peut voir.

Principe :

> même en cas de compromission serveur, le système doit contenir le moins possible de données permettant de reconstruire les déplacements d’un individu.

---

# 35. Sécurité applicative

Obligatoire :

- CSP stricte ;
- protection XSS ;
- validation serveur de tous les payloads ;
- ORM / requêtes paramétrées ;
- protection CSRF lorsque pertinente ;
- CORS restrictif ;
- rate limiting ;
- Content Security Policy ;
- Referrer-Policy ;
- Permissions-Policy ;
- HSTS ;
- cookies Secure + HttpOnly ;
- vérification automatique des dépendances ;
- scans SAST/DAST dans la CI.

---

# 36. Permissions navigateur

Limiter au minimum.

Exemple :

```text
geolocation = uniquement pendant Mode Manif
camera = non
microphone = non
contacts = non
bluetooth = non
```

Le GPS doit être demandé au moment où son utilisation est compréhensible pour l’utilisateur.

---

# 37. Transparence utilisateur

Écran « Confidentialité ».

Texte simple :

> SafeWay utilise votre position uniquement pendant le Mode Manif pour afficher votre environnement et vérifier les informations proches. Votre position GPS brute n’est pas conservée et votre déplacement n’est pas enregistré.

Afficher également clairement les limites :

> Les informations sont fournies par la communauté et peuvent être incomplètes, anciennes ou incorrectes.

---

# 38. MVP

## V0.1

- création de compte ;
- pseudo ;
- passkey ;
- carte ;
- GPS ;
- signalement ;
- confirmations ;
- expiration automatique ;
- couleur des rues.

## V0.2

- routage ;
- score de confiance ;
- réputation ;
- WebSockets ;
- alertes sur trajet.

## V0.3

- anti-abus avancé ;
- fonctionnement réseau dégradé ;
- modération ;
- optimisation de charge.

---

# 39. Phase 2

Fonctionnalités potentielles :

- zones de secours ;
- points d’eau ;
- transports accessibles ;
- rues fermées ;
- événements publics ;
- festivals ;
- catastrophes ;
- mouvements de foule ;
- évacuations locales.

Le produit pourra évoluer vers :

> SafeWay — navigation collaborative de sécurité urbaine.

---

# 40. Hors périmètre

Ne pas développer :

- suivi individuel de personnes ;
- carte des utilisateurs ;
- historique GPS ;
- replay d’une manifestation ;
- heatmap nominative ;
- reconnaissance faciale ;
- identification automatique d’individus ;
- scraping de réseaux sociaux pour identifier des participants ;
- suivi en temps réel d’une unité ou d’un agent identifiable ;
- stockage de photos contenant des visages en V1.

---

# 41. Nom du produit

Nom de travail :

**SafeWay Manif**

Architecture de marque possible :

```text
SafeWay
├── SafeWay Manif
├── SafeWay Festival
├── SafeWay Event
└── SafeWay Emergency
```

---

# 42. Objectif de Claude

Claude doit développer le projet avec les priorités suivantes :

1. sécurité des utilisateurs ;
2. minimisation absolue des données ;
3. confidentialité ;
4. architecture simple ;
5. mobile-first ;
6. temps réel ;
7. faible consommation réseau ;
8. capacité à monter en charge ;
9. code maintenable ;
10. UX extrêmement rapide.

Avant d’implémenter une fonctionnalité, Claude doit se poser la question :

> « Cette donnée doit-elle vraiment être collectée ou stockée ? »

Si la réponse est non :

**ne pas la collecter.**

---

# 43. Règles impératives pour le développement

Claude ne doit jamais :

```text
logger les coordonnées GPS
sauvegarder les déplacements
sauvegarder un historique de localisation
envoyer le GPS à un service analytics
mettre des secrets dans Git
utiliser des identifiants séquentiels publics
ajouter un tracker publicitaire
rendre visibles les utilisateurs sur la carte
```

Claude doit systématiquement préférer :

```text
données éphémères
traitement local
agrégation
pseudonymisation
chiffrement
expiration automatique
collecte minimale
```

---

# 44. Première étape de développement

Créer d’abord :

```text
/apps/web
/apps/api
/packages/shared
/infrastructure
```

Puis :

1. Docker Compose ;
2. PostgreSQL/PostGIS ;
3. Redis ;
4. API ;
5. frontend ;
6. MapLibre ;
7. authentification ;
8. système de signalements ;
9. temps réel ;
10. routage.

Le code doit être conçu dès la première version pour éviter qu’une future fonctionnalité ne transforme accidentellement SafeWay en système de surveillance.

---

# 45. Définition du succès

SafeWay est réussi si un utilisateur peut :

1. ouvrir l’application ;
2. activer Mode Manif ;
3. voir immédiatement les conditions autour de lui ;
4. signaler un danger en quelques secondes ;
5. confirmer une information ;
6. obtenir un itinéraire évitant les zones actuellement déconseillées ;
7. fermer l’application ;
8. ne laisser derrière lui aucun historique exploitable de ses déplacements.

**Principe final :**

> Collecter le minimum.  
> Chiffrer le nécessaire.  
> Supprimer le temporaire.  
> Ne jamais transformer la sécurité collective en surveillance individuelle.

---

# 46. Dépôt GitHub public et transparence

Le dépôt principal de SafeWay Manif doit être **public**.

Objectifs :

- permettre l’audit du code par la communauté ;
- permettre la revue de sécurité par des chercheurs indépendants ;
- rendre vérifiable la politique de minimisation des données ;
- favoriser les contributions externes ;
- publier les correctifs de sécurité de manière traçable ;
- éviter toute sécurité reposant sur l’obscurité du code source.

Structure recommandée :

```text
safeway-manif/
├── apps/
│   ├── web/
│   ├── api/
│   └── realtime-gateway/
├── packages/
│   └── shared/
├── infrastructure/
│   ├── docker/
│   ├── kubernetes-examples/
│   └── terraform-examples/
├── docs/
├── tests/
├── .github/
│   └── workflows/
├── .env.example
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── LICENSE
└── README.md
```

## 46.1 Ce qui ne doit jamais être public

Le dépôt public ne doit jamais contenir :

```text
clés privées
secrets JWT
mots de passe
credentials PostgreSQL
credentials Redis
clés TLS privées
jetons d’administration
identifiants cloud
endpoints internes sensibles
backups
logs de production
fichiers .env réels
adresses IP internes de production
exports de base de données
```

Les fichiers `.env`, `.pem`, `.key`, dumps et secrets doivent être exclus via `.gitignore` et contrôlés dans la CI.

Activer sur GitHub :

- secret scanning ;
- push protection ;
- Dependabot ;
- CodeQL ;
- branches protégées ;
- revue obligatoire avant merge ;
- CI obligatoire avant merge.

Créer un `SECURITY.md` avec une procédure de signalement responsable des vulnérabilités.

---

# 47. Objectif de charge : 500 000 utilisateurs simultanés

SafeWay doit être conçu avec une **cible architecturale de 500 000 utilisateurs simultanément connectés**.

Cette cible ne signifie pas que chaque utilisateur génère une requête par seconde.

Le dimensionnement doit distinguer :

```text
utilisateurs connectés
utilisateurs actifs
WebSockets/SSE ouverts
requêtes HTTP par seconde
votes par seconde
signalements par seconde
mises à jour cartographiques par seconde
calculs d’itinéraire par seconde
```

La capacité réelle doit être démontrée par des tests de charge reproductibles avant mise en production à grande échelle.

## 47.1 Hypothèse de pointe à tester

Scénario de stress initial :

```text
500 000 sessions simultanées
300 000 connexions temps réel simultanées
50 000 utilisateurs actifs sur une minute
10 000 lectures carte / seconde en pointe
2 000 votes / seconde en pointe
500 nouveaux signalements / seconde en pointe
1 000 recalculs d’itinéraire / seconde en pointe
```

Ces valeurs servent de **scénario de validation technique**, pas de promesse contractuelle.

---

# 48. Architecture scalable horizontalement

Aucun composant critique ne doit dépendre d’un serveur unique.

Architecture cible :

```text
                 ┌──────────────────────────┐
                 │        CDN / EDGE        │
                 │ static assets + cache    │
                 └────────────┬─────────────┘
                              │
                     ┌────────▼────────┐
                     │ Load Balancer   │
                     └───────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐  ┌────▼─────┐  ┌────▼─────┐
        │ API node  │  │ API node │  │ API node │
        │ stateless │  │ stateless│  │ stateless│
        └─────┬─────┘  └────┬─────┘  └────┬─────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
      ┌─────▼─────┐    ┌────▼──────┐   ┌────▼────────┐
      │ PostgreSQL │    │ Redis      │   │ Event Bus   │
      │ + PostGIS  │    │ Cluster    │   │ NATS/Kafka  │
      └────────────┘    └────────────┘   └─────────────┘

         ┌──────────────────────────────────┐
         │ Realtime Gateway Pool            │
         │ WebSocket/SSE horizontal scaling │
         └──────────────────────────────────┘
```

Les API doivent rester **stateless** autant que possible pour permettre l’ajout automatique d’instances.

---

# 49. CDN et cache massif

Les éléments statiques ne doivent pas arriver depuis l’API principale.

Servir via CDN :

```text
JavaScript
CSS
fonts
icônes
manifest PWA
tuiles cartographiques statiques compatibles
assets de l’interface
```

Objectif : absorber l’immense majorité du trafic statique à l’edge.

Les réponses publiques non personnelles peuvent avoir un cache très court lorsque cela est compatible avec la fraîcheur attendue.

Exemple :

```text
zones sans changement : cache 5-15 s
configuration : cache 1-5 min
assets versionnés : cache long immutable
```

---

# 50. Temps réel à 500 000 utilisateurs

Ne jamais envoyer tous les événements à tous les utilisateurs.

Créer des canaux géographiques.

Exemple :

```text
FR/Paris/H3_CELL_8A...
FR/Lyon/H3_CELL_8B...
FR/Rennes/H3_CELL_8C...
```

Un client s’abonne uniquement aux cellules proches de son viewport ou de son trajet.

Workflow :

```text
EVENT
 ↓
zone géographique
 ↓
Event Bus
 ↓
Realtime Gateway concerné
 ↓
clients abonnés à cette zone
```

Cela évite un broadcast global impossible à soutenir à grande échelle.

## 50.1 Realtime Gateway

Séparer le temps réel de l’API REST classique.

Créer :

```text
apps/realtime-gateway
```

Le gateway doit :

- accepter un grand nombre de connexions persistantes ;
- rester stateless ;
- supporter le scaling horizontal ;
- appliquer du backpressure ;
- fermer les clients abusifs ;
- limiter la fréquence des messages ;
- regrouper les mises à jour lorsque possible.

---

# 51. Backpressure et regroupement des événements

Si 100 signalements changent en une seconde dans une même zone, ne pas envoyer obligatoirement 100 messages séparés.

Utiliser un mécanisme de batching :

```text
fenêtre 100-500 ms
      ↓
regroupement événements
      ↓
1 payload compressé
```

Exemple :

```json
{
  "zone": "8a1fb...",
  "updates": [
    {"id":"...","status":"active"},
    {"id":"...","status":"expired"},
    {"id":"...","confidence":0.82}
  ]
}
```

---

# 52. Redis cluster

Redis doit être utilisé pour les données très temporaires :

```text
sessions
rate limiting
compteurs
présence temps réel
cache court
pub/sub local
idempotency keys
anti-spam
```

Éviter d’en faire la source de vérité unique des événements importants.

Prévoir :

- cluster / réplication ;
- TTL systématiques ;
- limites mémoire ;
- politiques d’éviction maîtrisées ;
- monitoring de la latence et mémoire.

---

# 53. PostgreSQL / PostGIS à grande échelle

PostgreSQL reste la source de vérité principale pour les événements actifs nécessaires.

Prévoir :

- PgBouncer ou équivalent pour le pooling de connexions ;
- index géospatiaux PostGIS ;
- index sur `expires_at`, `area_id`, `status` ;
- partitionnement temporel si le volume le justifie ;
- réplicas de lecture ;
- requêtes courtes ;
- suppression asynchrone en lots ;
- aucun N+1 query ;
- limites de temps par requête.

Ne jamais ouvrir une connexion PostgreSQL directe par utilisateur.

---

# 54. File de messages / Event Bus

À cette échelle, certaines opérations doivent être asynchrones.

Utiliser selon les besoins :

```text
NATS
Kafka
Redpanda
RabbitMQ
```

Cas d’usage :

```text
mise à jour score de confiance
expiration
modération automatisée
fan-out temps réel
métriques techniques
notifications
recalcul asynchrone
```

Une panne temporaire d’un worker ne doit pas bloquer la création d’un signalement.

---

# 55. Routage séparé

Le calcul d’itinéraire doit être isolé du backend principal.

Service dédié :

```text
routing-service
```

Possibilités :

- OSRM ;
- Valhalla ;
- GraphHopper ;
- moteur interne ultérieur.

Le moteur doit recevoir une couche de coût temporaire issue des zones rouges/oranges sans avoir besoin de connaître l’identité de l’utilisateur.

Prévoir :

- cache des itinéraires proches ;
- limitation du nombre de recalculs ;
- debounce côté client ;
- fallback sur itinéraire statique si le service temps réel est saturé.

---

# 56. Dégradation contrôlée

SafeWay ne doit pas simplement tomber si la charge dépasse la capacité.

Définir plusieurs niveaux :

## Niveau 0 — Normal

```text
temps réel complet
votes instantanés
routing dynamique
animations UI
```

## Niveau 1 — Forte charge

```text
batching plus agressif
refresh zones toutes les 2-5 s
réduction des animations
cache plus long
```

## Niveau 2 — Charge critique

```text
temps réel limité
lecture prioritaire
écritures toujours disponibles
routing recalculé moins souvent
```

## Niveau 3 — Survie

```text
carte + événements actifs
signalement essentiel
pas de fonctions secondaires
```

Le système doit privilégier :

1. lecture de la carte ;
2. affichage des dangers récents ;
3. création de signalement ;
4. validation ;
5. routage ;
6. fonctionnalités secondaires.

---

# 57. Circuit breakers

Chaque dépendance externe doit être protégée.

Exemple :

```text
service routing indisponible
        ↓
circuit breaker ouvert
        ↓
API principale continue
        ↓
message : routage dynamique temporairement indisponible
```

La panne d’un service secondaire ne doit jamais entraîner la panne générale.

---

# 58. Timeouts et retries

Toutes les communications interservices doivent définir :

```text
timeout
retry limité
exponential backoff
jitter
idempotency
```

Ne jamais utiliser de retry infini.

Les opérations d’écriture doivent utiliser des clés d’idempotence lorsque nécessaire afin d’éviter des doublons en cas de retry réseau.

---

# 59. Autoscaling

Prévoir l’autoscaling sur :

```text
CPU
RAM
requêtes/seconde
latence
nombre de connexions temps réel
lag de la file de messages
```

Ne pas scaler uniquement sur le CPU.

Le système doit pouvoir ajouter automatiquement :

- API nodes ;
- realtime gateways ;
- workers ;
- services de routage.

---

# 60. Multi-zone et haute disponibilité

Aucun serveur unique ne doit être un SPOF.

Prévoir au minimum :

```text
2-3 zones de disponibilité
load balancer redondé
réplication PostgreSQL
Redis répliqué
plusieurs instances API
plusieurs gateways temps réel
```

Une instance doit pouvoir disparaître sans interrompre le service global.

---

# 61. Objectifs SLO initiaux

Cibles de production à tester :

```text
Disponibilité mensuelle cible : >= 99,95 %
API lecture p95 : < 250 ms
API écriture p95 : < 500 ms
propagation temps réel p95 : < 2 s
error rate nominal : < 0,5 %
```

Sous charge extrême, la priorité est la continuité de service, même si certaines latences augmentent temporairement.

---

# 62. Tests de charge obligatoires

Aucune affirmation du type « supporte 500k utilisateurs » ne doit être faite sans test.

Créer dans le repo :

```text
/tests/load/
```

Utiliser par exemple :

```text
k6
Locust
Artillery
```

Scénarios obligatoires :

### Test A — montée progressive

```text
1k → 10k → 50k → 100k → 250k → 500k sessions
```

### Test B — spike

```text
50k → 300k en quelques minutes
```

### Test C — votes massifs

Simuler une zone recevant des milliers de confirmations.

### Test D — événement viral

Une même ville concentre une part très importante des utilisateurs.

### Test E — panne Redis

Vérifier le comportement dégradé.

### Test F — panne PostgreSQL primaire

Tester le failover.

### Test G — perte d’un realtime gateway

Les clients doivent pouvoir se reconnecter ailleurs.

### Test H — réseau lent

Tester 3G / forte latence / pertes de paquets.

### Test I — DDoS applicatif simulé

Tester limites, protections et maintien des fonctions essentielles.

---

# 63. Soak tests

Faire également des tests longs.

Exemple :

```text
100 000 utilisateurs simulés pendant 6-12 h
```

Objectifs :

- détecter fuite mémoire ;
- fuite de connexions ;
- saturation progressive Redis ;
- croissance anormale de DB ;
- ralentissement après plusieurs heures ;
- problèmes de nettoyage des événements expirés.

---

# 64. Observabilité sans surveillance utilisateur

Monitorer le système, pas les personnes.

Métriques :

```text
RPS
latence p50/p95/p99
erreurs
CPU
RAM
connexions WebSocket
Redis memory
DB connections
DB latency
queue lag
nombre d’événements actifs
nombre de votes / seconde
```

Ne jamais envoyer dans les outils d’observabilité :

```text
coordonnées GPS
trajectoire
pseudo + position
contenu permettant de reconstruire les déplacements
```

Utiliser des identifiants de requête aléatoires et temporaires.

---

# 65. Alerting

Créer des alertes sur :

```text
p95 > seuil
error rate élevé
DB connection pool saturé
Redis mémoire critique
queue lag élevé
gateway temps réel saturé
taux de reconnexion anormal
service routing indisponible
certificat TLS proche expiration
espace disque faible
```

---

# 66. Protection contre le trafic hostile

Comme le dépôt est public, partir du principe que les endpoints, formats et protections sont connus.

Prévoir :

- WAF ;
- rate limiting distribué ;
- quotas par compte et token ;
- détection de bots ;
- limites de taille payload ;
- timeout strict ;
- validation stricte des entrées ;
- bannissement temporaire automatisé ;
- protection anti-DDoS en amont ;
- challenge adaptatif seulement en cas d’abus.

Le service ne doit jamais dépendre de la confidentialité de l’API pour sa sécurité.

---

# 67. CI/CD orientée fiabilité

Chaque Pull Request doit lancer au minimum :

```text
lint
tests unitaires
tests intégration
TypeScript checks
scan dépendances
scan secrets
CodeQL / SAST
build Docker
```

Sur la branche principale :

```text
staging deploy
smoke tests
migration check
performance regression check
```

Les déploiements production doivent supporter :

- rolling update ;
- rollback rapide ;
- migrations rétrocompatibles ;
- health checks ;
- readiness checks ;
- liveness checks.

---

# 68. Règle de développement pour Claude : performance

Claude doit considérer chaque fonctionnalité avec les questions suivantes :

```text
Combien de requêtes DB cela génère-t-il ?
Cela fonctionne-t-il encore avec 500k sessions ?
Peut-on mettre en cache ?
Peut-on batcher ?
Peut-on traiter en asynchrone ?
Que se passe-t-il si cette dépendance tombe ?
Que se passe-t-il sous x10 de charge ?
```

Éviter :

```text
boucles DB par utilisateur
broadcast global
polling agressif
requêtes géospatiales non indexées
payloads lourds
JSON inutilement volumineux
sessions serveur difficiles à scaler
état local non répliqué
```

---

# 69. Critère de validation "500k"

Le projet ne pourra afficher la mention :

> Architecture validée pour 500 000 utilisateurs simultanés

que si un environnement de préproduction représentatif démontre :

```text
500 000 sessions maintenues
pas de crash global
pas de corruption de données
pas de fuite mémoire critique
p95 dans des limites acceptables
error rate maîtrisé
reconnexion automatique fonctionnelle
bascule en mode dégradé fonctionnelle
récupération après suppression volontaire d’instances
```

Les rapports de charge doivent être conservés dans :

```text
/docs/performance/
```

sans données personnelles.

---

# 70. Priorité absolue

À partir de cette version du cahier des charges, SafeWay doit être développé selon quatre contraintes de même niveau :

```text
PRIVACY
SECURITY
RELIABILITY
SCALABILITY
```

Une fonctionnalité n’est considérée terminée que si elle fonctionne correctement :

- en situation normale ;
- en forte charge ;
- en perte partielle d’infrastructure ;
- sans créer de nouvel historique personnel ;
- sans dépendre d’un secret présent dans le dépôt public.

**Objectif final : une application open source, auditable, fortement chiffrée, respectueuse de la vie privée et capable de rester opérationnelle pendant un pic massif pouvant atteindre 500 000 utilisateurs simultanés.**
