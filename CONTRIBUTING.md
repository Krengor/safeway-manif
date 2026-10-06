# Contribuer à SafeWay

Merci ! Avant tout, lisez les règles qui ne se négocient pas.

## Règles impératives

Une contribution est refusée si elle :
- journalise, stocke ou transmet à un tiers des coordonnées GPS, une trajectoire ou un historique de position ;
- rend un utilisateur visible ou identifiable sur la carte ;
- ajoute un traqueur, un SDK publicitaire ou du fingerprinting ;
- introduit un identifiant séquentiel public ;
- ajoute un secret au dépôt ;
- permet de suivre une personne, une unité ou un agent identifiable.

Avant d'ajouter une donnée, posez la question : **« Cette donnée doit-elle vraiment être collectée ou stockée ? »**
Si la réponse est non, ne la collectez pas.

## Checklist de PR

- [ ] `npm run typecheck && npm run lint && npm test` passent
- [ ] aucune nouvelle donnée personnelle, ou justification écrite dans la PR
- [ ] comportement sous forte charge envisagé (requêtes DB, cache, batching — voir §68 du cahier des charges)
- [ ] comportement si une dépendance (Redis, routage…) tombe
- [ ] textes en français, accessibles (icône + texte, jamais la couleur seule)

## Environnement

Voir le [README](README.md#démarrage-local).
