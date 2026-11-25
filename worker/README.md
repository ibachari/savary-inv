# Relais inventaire MP → Hello Harel

Worker Cloudflare `inventaire-mp-hh` (compte de Paul) : https://inventaire-mp-hh.paul-5af.workers.dev

Reçoit les comptages d'une zone (produits remplis seulement) et crée un **inventaire brouillon** dans
Hello Harel. Il ne valide jamais : « Valider » reste à faire dans HH.

Déploiement : `cd worker && npx wrangler@4 deploy` (connexion wrangler OAuth, pas de CLOUDFLARE_API_TOKEN).

Secrets (`npx wrangler@4 secret put NOM`) :
- `HAREL_USER`, `HAREL_PASSWORD` : compte d'automatisation Hello Harel
- `APP_TOKEN` : jeton partagé avec `matieres-premieres.html` (`HHW.token`)

Protocole HH relevé en production le 2026-11-25 (essai sur l'inventaire 1985, annulé) :
création `POST /stock/inventory/create?reload=1`, lignes `GET /stock/inventory/{id}.json`
(en-tête `X-Requested-With`), écriture `POST /stock/inventory/{id}.json` (`X-Lock-Identifier`),
annulation d'un brouillon `GET /stock/inventory/{id}/cancel?confirm=1`.
