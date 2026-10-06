-- Révision par signalement : permet aux clients de fusionner sans ambiguïté les versions
-- reçues par le polling (cache CDN de quelques secondes) et par le temps réel.
ALTER TABLE events ADD COLUMN revision integer NOT NULL DEFAULT 1;
