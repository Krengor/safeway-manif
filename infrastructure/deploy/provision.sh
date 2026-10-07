#!/usr/bin/env bash
# Préparation d'un VPS neuf (Ubuntu 24.04 LTS) pour SafeWay. À lancer UNE fois, en root :
#
#   curl -fsSLO https://raw.githubusercontent.com/Krengor/safeway-manif/main/infrastructure/deploy/provision.sh
#   less provision.sh          # toujours relire un script avant de l'exécuter en root
#   sudo bash provision.sh
#
# Relançable sans risque (idempotent). Ce que fait le script :
#   1. mises à jour + correctifs de sécurité automatiques (sans redémarrage automatique) ;
#   2. utilisateur `safeway` (déploiement), avec la même clé SSH que l'utilisateur courant ;
#   3. SSH par clé uniquement, root interdit — SEULEMENT si une clé est déjà installée ;
#   4. pare-feu : 22, 80, 443 (tcp + udp pour HTTP/3), tout le reste fermé ; fail2ban sur SSH ;
#   5. Docker (dépôt officiel) avec rotation des journaux et `live-restore` ;
#   6. réglages réseau pour de nombreuses connexions WebSocket, swap si absent ;
#   7. dépôt cloné dans /opt/safeway, sauvegarde quotidienne programmée (systemd).
set -euo pipefail

REPO_URL="${SAFEWAY_REPO:-https://github.com/Krengor/safeway-manif.git}"
APP_DIR=/opt/safeway
APP_USER=safeway
ADMIN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "À lancer en root (sudo bash provision.sh)." >&2; exit 1; }
. /etc/os-release
[[ "$ID" == "ubuntu" ]] || echo "Attention : testé sur Ubuntu 24.04, système détecté : $PRETTY_NAME" >&2

log "Mises à jour du système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw fail2ban unattended-upgrades age jq cryptsetup

log "Correctifs de sécurité automatiques (pas de redémarrage automatique)"
cat >/etc/apt/apt.conf.d/52safeway-unattended <<'EOF'
Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}-security"; "Docker:${distro_codename}"; };
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

log "Utilisateur de déploiement « $APP_USER »"
id "$APP_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"
admin_home=$(getent passwd "$ADMIN_USER" | cut -d: -f6)
if [[ -s "$admin_home/.ssh/authorized_keys" ]]; then
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
  install -m 600 -o "$APP_USER" -g "$APP_USER" "$admin_home/.ssh/authorized_keys" "/home/$APP_USER/.ssh/authorized_keys"
fi

log "SSH : clé uniquement, root interdit"
if [[ -s "$admin_home/.ssh/authorized_keys" ]]; then
  cat >/etc/ssh/sshd_config.d/10-safeway.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowUsers $ADMIN_USER $APP_USER
EOF
  sshd -t && systemctl reload ssh
else
  echo "!! Aucune clé SSH dans $admin_home/.ssh/authorized_keys : mots de passe SSH laissés actifs" >&2
  echo "!! pour ne pas vous enfermer dehors. Ajoutez votre clé puis relancez ce script." >&2
fi

log "Pare-feu"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable
cat >/etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

log "Docker (dépôt officiel)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# live-restore : les conteneurs continuent de tourner pendant une mise à jour de Docker.
cat >/etc/docker/daemon.json <<'EOF'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker
usermod -aG docker "$APP_USER"

log "Réglages réseau et mémoire"
cat >/etc/sysctl.d/90-safeway.conf <<'EOF'
# Nombreuses connexions WebSocket et pics de connexions (manifestations).
net.core.somaxconn = 8192
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.ip_local_port_range = 10240 65000
net.ipv4.tcp_fin_timeout = 15
fs.file-max = 2097152
vm.swappiness = 10
EOF
sysctl --system >/dev/null
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

log "Dépôt dans $APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi

log "Sauvegarde quotidienne (03:30, heure du serveur)"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" /var/backups/safeway
cat >/etc/systemd/system/safeway-backup.service <<EOF
[Unit]
Description=Sauvegarde chiffrée SafeWay (comptes uniquement)
After=docker.service

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/infrastructure/deploy/backup.sh
EOF
cat >/etc/systemd/system/safeway-backup.timer <<'EOF'
[Unit]
Description=Sauvegarde quotidienne SafeWay

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now safeway-backup.timer >/dev/null

log "Terminé"
cat <<EOF
Étapes suivantes (docs/deploiement.md) :
  1. se connecter en « $APP_USER » : ssh $APP_USER@<ip>
  2. cd $APP_DIR && infrastructure/deploy/gen-secrets.sh <domaine>
  3. placer la clé publique de sauvegarde : $APP_DIR/.backup-recipient (age)
  4. infrastructure/deploy/deploy.sh
EOF
