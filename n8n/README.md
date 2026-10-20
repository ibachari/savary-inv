# Annonce Slack d'un inventaire enregistré

`inventaire-slack.json` est la sauvegarde versionnée du workflow n8n
**« Inventaire emballages — annonce Slack »** (`O63WxC72f1YR6tX4`), actif sur
`n8n.srv994189.hstgr.cloud`. `code.js` est le corps du nœud « Résumer le
comptage », sorti du JSON pour rester lisible et vérifiable (`node --check`).

## Le chemin

```
index.html  ──POST──▶  webhook n8n  ──▶  Résumer le comptage  ──▶  #prod-emballage
 (« Envoyer »)                              (garde-fous)            chat.postMessage
```

L'application appelle le webhook **en plus** de son envoi au classeur Google
Sheets, jamais à la place. Si n8n est indisponible, le comptage part quand même
et l'opérateur ne voit aucune erreur : une annonce ratée ne doit pas ressembler
à un inventaire perdu.

## Les trois garde-fous, et pourquoi ils existent

1. **Jeton** — le webhook est ouvert sur Internet et `index.html` est public.
   Le jeton (`553171`, celui que l'application porte déjà) écarte les robots.
   Il ne protège pas d'un curieux qui lirait la page ; le pire qu'il risque est
   un faux message dans le canal.
2. **`manuel: true`** — l'application se synchronise toute seule 2,5 s après
   chaque case remplie. Sans ce filtre, le canal recevrait une alerte par
   produit compté. Seul l'appui volontaire sur « Envoyer » vaut clôture.
3. **Anti-doublon de 15 minutes** — deux appuis sur « Envoyer » ne font qu'un
   inventaire. La mémoire vit dans `$getWorkflowStaticData('global')`, donc elle
   survit aux exécutions.

Les refus ne sont pas des erreurs : ils sortent par la branche « Rien à
annoncer » et la réponse du webhook porte le motif (`{"poster":false,
"motif":"…"}`), ce qui rend le diagnostic immédiat depuis un simple `curl`.

## Identifiant Slack

Le nœud réutilise `Slack Savary Bot` (`Y363bYdntvl2Y5Fd`, authentification par
en-tête HTTP), le même que « Brassards - Alertes complétion Slack ». Rien à
créer. **Le bot doit être membre de `#prod-emballage`** — sinon Slack répond
`not_in_channel` et l'exécution échoue sans que personne ne le voie.

## Réappliquer le workflow après modification

```sh
set -a && . ~/.claude/secrets/secrets.env && set +a
node construire.mjs                       # code.js → inventaire-slack.json
curl -X PUT "$N8N_API_URL/api/v1/workflows/O63WxC72f1YR6tX4" \
     -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Content-Type: application/json' \
     -d @inventaire-slack.json
```
