# Mise en ligne et exploitation

Déploiement de référence : **un VPS OVHcloud** (VPS-3 : 8 vCPU, 24 Go, Ubuntu 24.04) et le domaine
**safeway-manif.fr** chez OVH. Tout tourne en Docker sur ce serveur ; aucun service tiers.

Compter environ 30 minutes la première fois (hors construction du graphe d'itinéraire).

## 0. Avant de commander

1. **Clé SSH** sur ton PC (si tu n'en as pas déjà une) — PowerShell :
   ```powershell
   ssh-keygen -t ed25519 -C "safeway"
   Get-Content $HOME\.ssh\id_ed25519.pub   # à coller dans OVH lors de la commande du VPS
   ```
2. **Clé de sauvegarde** (`age`) — elle chiffre les sauvegardes ; la partie privée ne va **jamais**
   sur le serveur :
   ```powershell
   winget install FiloSottile.age
   age-keygen -o safeway-backup-key.txt     # affiche la clé PUBLIQUE (age1…)
   ```
   Ranger `safeway-backup-key.txt` dans ton gestionnaire de mots de passe (et une copie hors ligne).
   Sans elle, les sauvegardes sont illisibles — c'est voulu.

## 1. Commande et DNS

- VPS : système **Ubuntu 24.04**, ta clé SSH ajoutée à la commande, datacenter en Europe.
- Domaine : dans l'espace client OVH → *Domaines* → *safeway-manif.fr* → *Zone DNS* :
  - `A` `@` → IPv4 du VPS ; `AAAA` `@` → IPv6 du VPS (si fournie) ;
  - supprimer les enregistrements `A`/`AAAA` par défaut qui pointent ailleurs ;
  - recommandé : `CAA` `@` `0 issue "letsencrypt.org"` (seul Let's Encrypt peut émettre un certificat).
- Vérifier depuis le PC : `nslookup safeway-manif.fr` doit renvoyer l'IP du VPS (quelques minutes).

## 2. Préparer le serveur

```bash
ssh ubuntu@<ip-du-vps>
curl -fsSLO https://raw.githubusercontent.com/Krengor/safeway-manif/main/infrastructure/deploy/provision.sh
less provision.sh            # relire avant d'exécuter en root
sudo bash provision.sh
```

Résultat : mises à jour de sécurité automatiques, SSH par clé uniquement (root interdit), pare-feu
(22, 80, 443), fail2ban, Docker, utilisateur `safeway`, dépôt dans `/opt/safeway`, sauvegarde
programmée chaque nuit. Le script refuse de couper les mots de passe SSH si aucune clé n'est installée.

## 3. Secrets, sauvegarde, carte

```bash
ssh safeway@<ip-du-vps>
cd /opt/safeway
infrastructure/deploy/gen-secrets.sh safeway-manif.fr        # crée .env.prod (600)
echo "age1…ta-clé-publique…" > .backup-recipient             # clé PUBLIQUE de l'étape 0
infrastructure/deploy/map-assets.sh                           # Besançon + Franche-Comté
SAFEWAY_REGIONS=france infrastructure/deploy/map-assets.sh    # ou : une carte par région (≈ 4,7 Go, long)
```

Copier le contenu de `.env.prod` dans ton gestionnaire de mots de passe (`cat .env.prod`). À ne
**jamais** régénérer en production : `EVENT_SIGNING_KEY` invaliderait les partages hors réseau en cours,
`VOTE_TOKEN_SECRET` l'anti-double-vote des signalements actifs, les mots de passe la base existante.

## 4. Premier déploiement

```bash
infrastructure/deploy/deploy.sh
```

La première fois, Valhalla construit le graphe d'itinéraire (Franche-Comté : quelques minutes) ;
l'itinéraire répond « indisponible » en attendant, le reste fonctionne. Caddy obtient seul le
certificat HTTPS.

## 5. Ton compte administrateur

1. Sur ton téléphone : ouvrir https://safeway-manif.fr, créer ton compte (passkey).
2. Sur le serveur :
   ```bash
   docker compose --env-file .env.prod -f infrastructure/docker/docker-compose.prod.yml \
     exec api node dist/admin-cli.js grant <ton-pseudo>
   ```
3. Dans l'app : 👤 → 🛡️ Modération.

## 6. Vérifications après mise en ligne

- [ ] https://safeway-manif.fr s'ouvre, `http://` redirige vers `https://`.
- [ ] Sur téléphone : passkey, Mode Manif (GPS), signalement, vote, itinéraire, ajout à l'écran d'accueil.
- [ ] Carte hors ligne : Confidentialité → Préparer la manif → Télécharger, puis mode avion.
- [ ] https://www.ssllabs.com/ssltest/ : A ou A+ ; https://securityheaders.com : A+.
- [ ] `systemctl list-timers safeway-backup.timer` : prochaine sauvegarde programmée.
- [ ] Test de restauration (section 8) sur ton PC.

## 7. Mises à jour

Une fois une PR fusionnée dans `main` :

```bash
ssh safeway@<ip> 'cd /opt/safeway && infrastructure/deploy/deploy.sh'
```

Le script construit la nouvelle version pendant que l'ancienne tourne, sauvegarde la base, applique les
migrations, puis redémarre les services un par un en vérifiant leur santé. Chacun ne s'interrompt que
quelques secondes ; l'app les absorbe (envois en attente, reconnexion du temps réel). Au moindre
service en échec, **retour automatique** à la version précédente.

- Revenir manuellement à la version précédente : `infrastructure/deploy/deploy.sh --rollback`.
- Déployer une version précise : `infrastructure/deploy/deploy.sh <tag-ou-commit>`.
- Les migrations de base sont toujours des ajouts (jamais de suppression de colonne utilisée), pour
  qu'un retour arrière reste possible.

## 8. Sauvegardes

- Chaque nuit à 03:30 et avant chaque mise à jour : `/var/backups/safeway/safeway-<date>.dump.age`,
  conservées 14 jours.
- Contenu : comptes (pseudo, réputation, statut, rôle) et clés publiques des passkeys. **Jamais** les
  signalements ni les votes (éphémères) : une sauvegarde ne doit pas devenir un historique des manifs.
- Copie hors serveur (recommandée) : un bucket OVH Object Storage via `rclone`, puis
  `SAFEWAY_BACKUP_RCLONE=ovh:safeway-backups` dans le service systemd.

**Tester une restauration chaque mois**, sur ton PC (Docker Desktop + Git Bash) :

```bash
scp safeway@<ip>:/var/backups/safeway/safeway-<date>.dump.age .
infrastructure/deploy/restore.sh safeway-<date>.dump.age safeway-backup-key.txt
# → comptes : N, passkeys : N, signalements (doit être 0) : 0
```

Restauration réelle (perte du serveur, erreur grave) : sur le serveur, après avoir copié la clé privée
**temporairement** :
`infrastructure/deploy/restore.sh <fichier> <clé> --for-real` (puis supprimer la clé du serveur).

## 9. Surveillance et incidents

| Besoin | Commande (dans `/opt/safeway`) |
|---|---|
| État des services | `docker compose --env-file .env.prod -f infrastructure/docker/docker-compose.prod.yml ps` |
| Erreurs récentes | `… logs --since 1h api` (journaux : erreurs seulement, ni IP ni contenu) |
| Charge (niveau §56) | `curl -s https://safeway-manif.fr/api/map/status` ou écran Modération |
| Métriques internes | `… exec api wget -qO- http://127.0.0.1:9100/metrics` |
| Redémarrer un service | `… restart api` |
| Espace disque | `df -h /` et `docker system df` |

- **Redis redémarré** : tout le monde est déconnecté (Redis n'est jamais écrit sur disque, par choix de
  confidentialité). Chacun se reconnecte par passkey ; les envois en attente repartent.
- **Forte affluence prévue** : forcer le niveau 1 ou 2 à l'avance depuis l'écran Modération.
- **Serveur compromis** : couper (`… down`), réinstaller le VPS, changer **tous** les secrets, restaurer
  la dernière sauvegarde. Rien de ce que l'attaquant aurait pu lire ne relie un pseudo à une position.

## Limites connues de ce déploiement

- **Un seul serveur** : une panne du VPS arrête le service (l'app garde la dernière carte et les envois
  en attente). La cible 500 000 utilisateurs suppose plusieurs serveurs (`docs/architecture.md`).
- **Disque non chiffré par nos soins** : la base ne contient ni position ni signalement ancien ; le
  chiffrement du volume (LUKS) est possible mais imposerait de saisir une phrase secrète à chaque
  redémarrage du serveur (site indisponible d'ici là). À décider avant l'ouverture au public.
- **Tests de charge** : à lancer sur ce serveur avant toute annonce publique (`tests/load/README.md`),
  depuis une autre machine.
