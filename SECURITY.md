# Politique de sécurité

SafeWay protège des personnes dans des situations sensibles. Les vulnérabilités, en particulier celles
qui permettraient de **localiser, suivre ou identifier** un utilisateur, sont traitées en priorité.

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique.** Utilisez le signalement privé de GitHub :
onglet **Security → Report a vulnerability** de ce dépôt.

Merci d'indiquer :
- la description et l'impact (quelles données, quels utilisateurs) ;
- les étapes de reproduction ou une preuve de concept ;
- la version / le commit concerné.

Engagements :
- accusé de réception sous 72 h ;
- évaluation initiale sous 7 jours ;
- correctif publié de manière traçable, avec crédit si vous le souhaitez.

## Périmètre prioritaire

- fuite de coordonnées GPS ou de cellules de présence (logs, base, réponses, cache, observabilité) ;
- possibilité de relier des signalements ou des votes à un compte ;
- contournement de la vérification de proximité à grande échelle ;
- usurpation de session, contournement WebAuthn, CSRF, XSS ;
- déni de service applicatif peu coûteux pour l'attaquant.

## Tests autorisés

Testez uniquement sur votre propre instance (`npm run dev:infra`). Pas de test de charge, de spam ni
d'ingénierie sociale contre une instance de production.
