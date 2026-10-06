-- Modération (§22) : rôle administrateur, attribué uniquement en ligne de commande
-- sur le serveur (src/admin-cli.ts), jamais via l'API.
ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
