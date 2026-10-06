-- Réputation (V0.2) : chaque vote pèse selon la réputation de son auteur.
-- Les poids sont agrégés et anonymes ; le lien auteur ↔ signalement n'est jamais stocké ici
-- (il ne vit qu'en mémoire Redis le temps du signalement).
ALTER TABLE events
  ADD COLUMN support_weight real NOT NULL DEFAULT 0 CHECK (support_weight >= 0),
  ADD COLUMN against_weight real NOT NULL DEFAULT 0 CHECK (against_weight >= 0);
UPDATE events SET support_weight = confirmations, against_weight = invalidations;

-- Poids du vote au moment où il a été émis (pour l'annuler exactement en cas de changement d'avis).
ALTER TABLE event_votes ADD COLUMN weight real NOT NULL DEFAULT 1;

ALTER TABLE users ADD CONSTRAINT users_reputation_range CHECK (reputation_score BETWEEN 0.25 AND 2);
