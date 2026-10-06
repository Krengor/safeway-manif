# Registre des données

Pour chaque donnée : où elle vit, combien de temps, et ce qu'un attaquant ayant un accès complet au serveur
pourrait en tirer.

| Donnée | Emplacement | Durée | Exposition en cas de compromission serveur |
|---|---|---|---|
| Coordonnées GPS | RAM du téléphone | durée du Mode Manif | aucune (jamais transmises) |
| Cellule de présence (≈ 70 m) | requête HTTP en transit | durée de la requête | aucune trace persistante (ni base, ni logs) |
| Pseudo | PostgreSQL `users` | jusqu'à suppression du compte | liste de pseudos |
| Clé publique passkey | PostgreSQL `credentials` | jusqu'à suppression du compte | inexploitable pour s'authentifier |
| Date de création du compte | PostgreSQL, au jour près | jusqu'à suppression du compte | faible |
| Signalement (type, cellule, horodatages, compteurs) | PostgreSQL `events` | expiration (10-60 min) + ≤ 1 min | carte publique des dernières minutes, sans auteur |
| Jeton de vote `HMAC(secret, user:event)` | PostgreSQL `event_votes` | idem événement | avec `VOTE_TOKEN_SECRET` : savoir si un compte donné a voté sur un événement **actif** |
| Session | Redis, `sha256(jeton) → user_id` | 30 jours glissants | aucune session utilisable (seule l'empreinte est stockée) |
| Compteur de rate limiting | Redis, clé `HMAC(secret, ip)` | 1 à 10 min | IP récentes, seulement avec `RATE_LIMIT_SECRET` |
| Départ / arrivée d'un itinéraire | requête au routing-service (sans cookie) puis Valhalla, en mémoire | durée du calcul | aucune trace persistante ; ni lien avec un compte (pas de cookie), ni journal (Valhalla sans logs) |
| Trajet en cours, alertes | mémoire du téléphone | jusqu'à l'arrêt du trajet ou du Mode Manif | aucune (jamais transmis) |
| Logs | stdout | selon l'hébergeur | méthode, route, statut, durée |

## Point d'attention connu

L'API voit, au moment d'un signalement, qu'un compte authentifié se trouvait près d'une cellule. Ce lien
n'est jamais écrit, mais un attaquant contrôlant le processus API **en direct** pourrait l'observer. Pistes
pour réduire ce risque (V0.3+) : jetons de présence anonymes (blind signatures) qui découplent
l'authentification de l'acte de signaler.

## Sauvegardes

Les tables `events` et `event_votes` doivent être exclues des sauvegardes longue durée (§31) :
`pg_dump --exclude-table-data=events --exclude-table-data=event_votes`.
