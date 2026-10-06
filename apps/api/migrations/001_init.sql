-- SafeWay — schéma initial V0.1
-- Règle d'or (§42) : chaque colonne doit justifier sa présence.
-- Aucune colonne de latitude/longitude, d'IP, de user-agent ni d'historique.

CREATE EXTENSION IF NOT EXISTS postgis;  -- réservé au routage (V0.2), aucune donnée utilisateur

-- ---------------------------------------------------------------------------
-- Comptes : pseudo + clé publique de passkey, rien d'autre.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- aléatoire, jamais séquentiel
  pseudo           text NOT NULL CHECK (char_length(pseudo) BETWEEN 3 AND 24),
  reputation_score real NOT NULL DEFAULT 1,                     -- interne, jamais exposé (§21)
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at       date NOT NULL DEFAULT current_date           -- précision au jour suffisante
);
CREATE UNIQUE INDEX users_pseudo_lower_idx ON users (lower(pseudo));

CREATE TABLE credentials (
  id          text PRIMARY KEY,                                  -- credential ID WebAuthn (base64url)
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  public_key  bytea NOT NULL,                                    -- clé PUBLIQUE uniquement
  counter     bigint NOT NULL DEFAULT 0,
  transports  text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX credentials_user_idx ON credentials (user_id);

-- ---------------------------------------------------------------------------
-- Signalements : éphémères, rattachés à une cellule H3 et non à une personne.
-- Pas d'auteur stocké. Suppression physique peu après expiration (job de purge).
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id               text NOT NULL,          -- cellule H3 rés. 7 (lecture / canaux temps réel)
  cell_id               text NOT NULL,          -- cellule H3 rés. 10 (≈ 66 m)
  type                  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_confirmation_at  timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  confirmations         integer NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  invalidations         integer NOT NULL DEFAULT 0 CHECK (invalidations >= 0)
);
-- Un seul signalement par (cellule, type) : un doublon devient une confirmation.
CREATE UNIQUE INDEX events_cell_type_idx ON events (cell_id, type);
CREATE INDEX events_zone_expires_idx ON events (zone_id, expires_at);
CREATE INDEX events_expires_idx ON events (expires_at);

-- Votes : le votant est représenté par HMAC(secret, user_id:event_id).
-- Le jeton change pour chaque événement → impossible de relier les votes d'une même
-- personne entre événements sans le secret. Supprimés avec l'événement.
CREATE TABLE event_votes (
  event_id     uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  actor_token  bytea NOT NULL,
  vote         smallint NOT NULL CHECK (vote IN (-1, 1)),
  PRIMARY KEY (event_id, actor_token)
);
