/* Ce qui arrive ici est le même corps que celui envoyé au classeur Google
   Sheets : { token, date, entetes, lignes, manuel }. Une ligne vaut
   [Date, Secteur, Produit, Service, Unités/colis, Nb colis, Unités hors colis, Quantité totale]. */
/* Le navigateur envoie en text/plain pour éviter un préflight CORS : selon le
   type, n8n livre donc soit un objet, soit la chaîne brute. */
let d = $json.body ?? $json;
if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }

const JETON = '553171';

const refus = (motif) => [{ json: { poster: false, motif } }];

if (String(d.token || '') !== JETON) return refus('jeton invalide');

/* L'application pousse toute seule 2,5 s après chaque saisie : sans ce garde-fou
   le canal recevrait une alerte à chaque case remplie. Seul l'appui volontaire
   sur « Envoyer » vaut « inventaire enregistré ». */
if (d.manuel !== true) return refus('synchronisation automatique, pas une clôture');

const lignes = Array.isArray(d.lignes) ? d.lignes : [];
if (!lignes.length) return refus('aucune ligne');

const COL = { secteur: 1, produit: 2, service: 3, parColis: 4, colis: 5, horsColis: 6, total: 7 };
const nb = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

let unites = 0, colis = 0;
const parService = new Map(), secteurs = new Set();
for (const l of lignes) {
  unites += nb(l[COL.total]);
  colis += nb(l[COL.colis]);
  secteurs.add(String(l[COL.secteur] || '?'));
  const s = String(l[COL.service] || 'Sans service');
  const acc = parService.get(s) || { refs: 0, unites: 0 };
  acc.refs += 1; acc.unites += nb(l[COL.total]);
  parService.set(s, acc);
}

/* Anti-doublon : deux appuis sur « Envoyer » à une minute d'intervalle ne font
   qu'un seul inventaire. La mémoire est celle du workflow, elle survit aux exécutions. */
const memoire = $getWorkflowStaticData('global');
memoire.derniers = memoire.derniers || {};
const cle = `${d.date}|${[...parService.keys()].sort().join('+')}`;
const maintenant = Date.now();
const FENETRE_MS = 15 * 60 * 1000;
for (const [k, t] of Object.entries(memoire.derniers)) if (maintenant - t > FENETRE_MS) delete memoire.derniers[k];
if (memoire.derniers[cle]) return refus('déjà annoncé il y a moins de 15 minutes');
memoire.derniers[cle] = maintenant;

const fr = (n) => n.toLocaleString('fr-FR');
const jour = new Date((d.date || new Date().toISOString().slice(0, 10)) + 'T12:00:00')
  .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const detail = [...parService.entries()]
  .sort((a, b) => b[1].unites - a[1].unites)
  .map(([s, v]) => `• *${s}* — ${fr(v.refs)} référence${v.refs > 1 ? 's' : ''}, ${fr(v.unites)} unités`);

/* Produits passés sous leur stock minimum, calculés par le classeur après
   l'enregistrement et transmis par l'app. */
function alerteMinimum(liste) {
  if (!Array.isArray(liste) || !liste.length) return [];
  return ['', `:warning: *${liste.length} produit${liste.length > 1 ? 's' : ''} sous le stock minimum*`,
    ...liste.slice(0, 15).map(p => `• ${p.n} — ${fr(p.q)} / mini ${fr(p.min)}${p.f ? ` (${p.f})` : ''}`),
    ...(liste.length > 15 ? [`• … et ${liste.length - 15} autre(s), voir l'onglet Bilan`] : [])];
}

const texte = [
  `:package: *Inventaire emballages enregistré* — ${jour}`,
  '',
  `${fr(lignes.length)} référence${lignes.length > 1 ? 's' : ''} comptée${lignes.length > 1 ? 's' : ''} · ${fr(colis)} colis · *${fr(unites)} unités* au total`,
  `Zones relevées : ${[...secteurs].sort().join(', ')}`,
  '',
  ...detail,
  ...alerteMinimum(d.sousMin),
  '',
  '_Le classeur Google Sheets est à jour._',
].join('\n');

return [{ json: { poster: true, channel: 'prod-emballage', texte } }];
