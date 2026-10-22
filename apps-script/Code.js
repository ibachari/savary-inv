/* Inventaire emballages — Maison Savary
   Classeur maître de l'app ibachari.github.io/savary-inv, relié à Hello Harel.

   Onglets :
   - Bilan        : état du stock, contrôle par zone et par niveau, alertes
                    (recalculé à chaque envoi de l'app et à chaque synchro)
   - Produits     : le catalogue que l'app relit au démarrage, avec la partie
                    gestion (prix, stock minimum, contact) et le dernier comptage
   - Inventaires  : une ligne par produit compté et par date d'inventaire
   - Archive AAAA : dernier comptage de chaque mois, produit par produit
   - Inutilisés   : les produits retirés depuis l'app (« n'est plus stocké ») ;
                    la synchro Hello Harel ne les rajoute jamais
   - Journal      : chaque changement fait depuis l'app ou par la synchro
   - Zones        : les zones du plan

   Hello Harel :
   - API publique (clé X-AUTH-TOKEN) : produits, famille, stock disponible
   - session web (catalogue d'achat, /purchasing/catalog.json) : fournisseur et
     unité d'achat de chaque produit acheté. Lecture seule, rien n'est écrit.
   La synchro tourne dans n8n (workflow « Inventaire emballages — synchro Hello
   Harel », toutes les heures) avec la clé d'API déjà enregistrée dans n8n : le
   classeur ne détient aucun identifiant Hello Harel. n8n envoie les produits à
   l'action « majHH » ; les fournisseurs, absents de l'API publique, viennent de
   l'onglet caché « Fournisseurs HH » (relevé du catalogue d'achat). */

const JETON = "553171";                  // le même que l'app et le webhook n8n
const HH = "https://maison-savary.helloharel.com";

const ONGLETS = {
  Produits: ["Intitulé", "Code HH", "Fournisseur", "Contact fournisseur", "Service", "Zone", "Zone 2",
             "Unités/colis", "Prix unitaire (€)", "Prix du colis (€)", "Stock minimum (unités)",
             "Mouvement de stock (O/N)", "À jeter (O/N)",
             "Dernier comptage", "Quantité comptée", "Valeur stockée (€)", "Statut stock", "Trouvé hors zone",
             "Stock HH", "Unité HH", "Catégorie HH", "ID HH", "Origine", "Mis à jour", "Unités app par unité HH"],
  Inventaires: ["Date inventaire", "Zone constatée", "Zone attribuée", "Intitulé", "Code HH", "Fournisseur",
                "Service", "Unités/colis", "Colis", "Unités hors colis", "Quantité comptée",
                "Prix unitaire (€)", "Valeur (€)", "Stock HH à l'envoi", "Compté par", "Source", "Envoyé le"],
  Journal: ["Quand", "Action", "Intitulé", "Avant", "Après", "Détail"],
  Zones: ["Code", "Libellé", "Niveau"]
};
ONGLETS["Inutilisés"] = ONGLETS.Produits.concat(["Retiré le"]);

const P = {n: 0, h: 1, f: 2, contact: 3, s: 4, z1: 5, z2: 6, u: 7, pu: 8, pcol: 9, min: 10, mvt: 11, jeter: 12,
           dern: 13, qte: 14, val: 15, statut: 16, hors: 17,
           stock: 18, unite: 19, cat: 20, id: 21, origine: 22, maj: 23, fhh: 24};
const I = {date: 0, zc: 1, za: 2, n: 3, h: 4, f: 5, s: 6, u: 7, colis: 8, hors: 9, qte: 10, pu: 11, val: 12,
           stock: 13, qui: 14, source: 15, envoye: 16};

/* Familles Hello Harel comptées comme consommables, et le service qu'elles
   prennent dans l'app quand la synchro crée un produit. */
const FAMILLES = {
  "Emballage": "Emballage", "Cartons": "Emballage",
  "Hygiène": "Hygiène", "Hygiène - 20% TVA": "Hygiène",
  "Fourniture Bureau": "Bureau"
};

const ZONES_DEFAUT = [
  ["A", "RDC — rack mur gauche", "RDC"], ["B", "RDC — bloc central, allée gauche", "RDC"],
  ["C", "RDC — bloc central, allée droite", "RDC"], ["D", "RDC — rack mur droit", "RDC"],
  ["AA", "R+1 — au-dessus de la zone A", "R+1"], ["BB", "R+1 — au-dessus de la zone B", "R+1"],
  ["CC", "R+1 — au-dessus de la zone C", "R+1"], ["DD", "R+1 — au-dessus de la zone D", "R+1"],
  ["E", "Réserve — en dessous du rez-de-chaussée", "Réserve"], ["F", "Salle Hygiène Paredes", "Hygiène"],
  ["Autres", "À classer — emplacement à préciser", "Autres"]
];
const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
              "Septembre", "Octobre", "Novembre", "Décembre"];

const norm = s => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
const ss = () => SpreadsheetApp.getActive();
const tz = () => ss().getSpreadsheetTimeZone();
const maintenant = () => Utilities.formatDate(new Date(), tz(), "dd/MM/yyyy HH:mm");
const jourIso = d => Utilities.formatDate(new Date(d), tz(), "yyyy-MM-dd");
const versDate = iso => { const [a, m, j] = String(iso).slice(0, 10).split("-").map(Number); return new Date(a, m - 1, j); };
const nombre = v => (v === "" || v == null || isNaN(Number(v))) ? null : Number(v);
const arrondi = v => Math.round(v * 100) / 100;

/* ---------- menu et installation ---------- */

/* Menu du classeur : c'est par lui que se font l'autorisation du script
   (premier lancement) et la saisie des identifiants Hello Harel, qui restent
   dans les propriétés du script et jamais dans le code. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Inventaire")
    .addItem("Recalculer le bilan", "recalculerMenu")
    .addToUi();
}

/* Sans danger si on la relance : ne redemande que les identifiants manquants. */
function installer() {
  const ui = SpreadsheetApp.getUi();
  const pr = PropertiesService.getScriptProperties();
  const demandes = [
    ["HH_API_KEY", "Clé d'API Hello Harel (en-tête X-AUTH-TOKEN)"],
    ["HH_WEB_EMAIL", "Identifiant de connexion Hello Harel (adresse e-mail)"],
    ["HH_WEB_PASSWORD", "Mot de passe Hello Harel"]
  ];
  for (const [cle, question] of demandes) {
    if (pr.getProperty(cle)) continue;
    const r = ui.prompt("Connexion Hello Harel", question, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) { ui.alert("Installation interrompue."); return; }
    pr.setProperty(cle, r.getResponseText().trim());
  }
  preparerOnglets_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "syncHH")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncHH").timeBased().everyHours(1).create();
  ui.alert("Installé. La synchronisation Hello Harel tournera toutes les heures.");
}

function syncMenu() {
  const r = syncHH();
  SpreadsheetApp.getUi().alert(r.ok
    ? "Hello Harel synchronisé : " + r.ajoutes.length + " produit(s) ajouté(s), " + r.maj + " mis à jour."
    : "Échec : " + r.error);
}

function recalculerMenu() {
  recalculer_();
  SpreadsheetApp.getUi().alert("Bilan, archive et colonnes calculées à jour.");
}

function preparerOnglets_() {
  const c = ss();
  ["Bilan", "Produits", "Inventaires", "Inutilisés", "Journal", "Zones"].forEach(nom => {
    if (!c.getSheetByName(nom)) c.insertSheet(nom);
    if (ONGLETS[nom]) {
      const f = c.getSheetByName(nom), ent = ONGLETS[nom];
      f.getRange(1, 1, 1, ent.length).setValues([ent]);
    }
  });
  const z = c.getSheetByName("Zones");
  if (z.getLastRow() < 2) z.getRange(2, 1, ZONES_DEFAUT.length, 3).setValues(ZONES_DEFAUT);
  ["Feuille 1", "Sheet1"].forEach(n => { const v = c.getSheetByName(n); if (v && v.getLastRow() === 0) c.deleteSheet(v); });
  mettreEnForme_();
}

/* Mise en forme des onglets à colonnes fixes. Le Bilan et l'Archive se
   mettent en forme à chaque recalcul. */
function mettreEnForme_() {
  const c = ss();
  const entete = (f, n) => {
    f.getRange(1, 1, 1, n).setFontWeight("bold").setBackground("#12211d").setFontColor("#ffffff")
      .setVerticalAlignment("middle").setWrap(true);
    f.setFrozenRows(1);
    f.setRowHeight(1, 42);
    if (!f.getFilter() && f.getLastRow() > 1) f.getRange(1, 1, f.getLastRow(), n).createFilter();
  };
  const largeurs = (f, l) => l.forEach((w, i) => f.setColumnWidth(i + 1, w));

  const p = c.getSheetByName("Produits");
  entete(p, ONGLETS.Produits.length);
  p.setFrozenColumns(1);
  largeurs(p, [330, 95, 150, 120, 90, 55, 55, 75, 85, 85, 90, 85, 70, 95, 90, 95, 115, 80, 80, 90, 120, 60, 110, 115]);
  p.getRange("I:J").setNumberFormat("#,##0.00## €");
  p.getRange("P:P").setNumberFormat("#,##0.00 €");
  p.getRange("N:N").setNumberFormat("dd/mm/yyyy");
  p.getRange("O:O").setNumberFormat("#,##0");
  p.getRange("S:S").setNumberFormat("#,##0.##");
  // colonnes calculées par le script : fond gris clair, à ne pas saisir
  p.getRange(2, P.dern + 1, Math.max(p.getMaxRows() - 1, 1), 5).setBackground("#f1f3ee");
  p.getRange(2, P.pcol + 1, Math.max(p.getMaxRows() - 1, 1), 1).setBackground("#f1f3ee");
  p.getRange(2, P.stock + 1, Math.max(p.getMaxRows() - 1, 1), 6).setBackground("#eef3f8");
  const statut = p.getRange(2, P.statut + 1, Math.max(p.getMaxRows() - 1, 1), 1);
  const hors = p.getRange(2, P.hors + 1, Math.max(p.getMaxRows() - 1, 1), 1);
  p.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("SOUS MINIMUM").setBackground("#f9e2e0").setFontColor("#b3261e").setBold(true).setRanges([statut]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Stock nul").setFontColor("#78837c").setRanges([statut]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Non compté").setFontColor("#b8690f").setRanges([statut]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("OK").setFontColor("#0f6b57").setRanges([statut]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground("#f7ecdc").setFontColor("#b8690f").setRanges([hors]).build()
  ]);
  ajouterValidation_(p, P.mvt + 1, ["O", "N"]);
  ajouterValidation_(p, P.jeter + 1, ["O", "N"]);

  const inv = c.getSheetByName("Inventaires");
  entete(inv, ONGLETS.Inventaires.length);
  inv.setFrozenColumns(1);
  largeurs(inv, [95, 70, 70, 330, 95, 150, 90, 75, 60, 75, 90, 85, 90, 85, 100, 190, 115]);
  inv.getRange("A:A").setNumberFormat("dd/mm/yyyy");
  inv.getRange("H:K").setNumberFormat("#,##0");
  inv.getRange("L:L").setNumberFormat("#,##0.00## €");
  inv.getRange("M:M").setNumberFormat("#,##0.00 €");
  const zc = inv.getRange(2, I.zc + 1, Math.max(inv.getMaxRows() - 1, 1), 1);
  inv.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=AND($B2<>\"\",$C2<>\"\",$B2<>$C2)")
      .setBackground("#f7ecdc").setFontColor("#b8690f").setRanges([zc]).build()
  ]);

  const inu = c.getSheetByName("Inutilisés");
  entete(inu, ONGLETS["Inutilisés"].length);
  largeurs(inu, [330]);
  inu.setTabColor("#78837c");

  const j = c.getSheetByName("Journal");
  entete(j, ONGLETS.Journal.length);
  largeurs(j, [115, 160, 330, 90, 90, 220]);

  const z = c.getSheetByName("Zones");
  entete(z, ONGLETS.Zones.length);
  largeurs(z, [70, 300, 90]);

  c.getSheetByName("Bilan").setTabColor("#0f6b57");
  p.setTabColor("#12211d");
  inv.setTabColor("#b8690f");
  ["Bilan", "Produits", "Inventaires"].forEach((n, i) => { c.setActiveSheet(c.getSheetByName(n)); c.moveActiveSheet(i + 1); });
}

function ajouterValidation_(f, col, valeurs) {
  const regle = SpreadsheetApp.newDataValidation().requireValueInList(valeurs, true).setAllowInvalid(true).build();
  f.getRange(2, col, Math.max(f.getMaxRows() - 1, 1), 1).setDataValidation(regle);
}

/* ---------- lecture / écriture des onglets ---------- */

function lignes_(nom) {
  const f = ss().getSheetByName(nom);
  const n = f.getLastRow() - 1;
  return n > 0 ? f.getRange(2, 1, n, ONGLETS[nom].length).getValues() : [];
}

/* Les codes Hello Harel (« 0775 ») sont du texte : sans ce format, Sheets en
   ferait des nombres et perdrait les zéros de tête. */
const COL_CODE = {Produits: P.h + 1, "Inutilisés": P.h + 1, Inventaires: I.h + 1};

function ajouterLignes_(nom, rows) {
  if (!rows.length) return;
  const f = ss().getSheetByName(nom);
  if (COL_CODE[nom]) f.getRange(1, COL_CODE[nom], f.getMaxRows(), 1).setNumberFormat("@");
  f.getRange(f.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function journal_(action, n, avant, apres, detail) {
  ss().getSheetByName("Journal").appendRow([maintenant(), action, n || "", avant == null ? "" : avant, apres == null ? "" : apres, detail || ""]);
}

/* Ligne de la feuille Produits (numéro de ligne Sheets) pour un intitulé. */
function trouver_(n) {
  const k = norm(n);
  const rows = lignes_("Produits");
  for (let i = 0; i < rows.length; i++) if (norm(rows[i][P.n]) === k) return {ligne: i + 2, row: rows[i]};
  return null;
}

function catalogue_() {
  const p = lignes_("Produits").filter(r => r[P.n]).map(r => ({
    n: String(r[P.n]), h: String(r[P.h] || ""), f: String(r[P.f] || ""), s: String(r[P.s] || ""),
    z1: String(r[P.z1] || "Autres"), z2: r[P.z2] ? String(r[P.z2]) : null, u: Number(r[P.u]) || 1,
    st: nombre(r[P.stock]), un: String(r[P.unite] || ""), min: nombre(r[P.min])
  }));
  const z = lignes_("Zones").filter(r => r[0]).map(r => ({c: String(r[0]), l: String(r[1]), n: String(r[2])}));
  return {ok: true, p, z, maj: PropertiesService.getScriptProperties().getProperty("HH_MAJ") || ""};
}

/* ---------- web app ---------- */

function sortie_(obj, callback) {
  const txt = JSON.stringify(obj);
  if (callback && /^[A-Za-z0-9_]+$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + txt + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const q = (e && e.parameter) || {};
  if (q.token !== JETON) return sortie_({ok: false, error: "jeton invalide"}, q.callback);
  try {
    if (q.action === "getData") return sortie_(catalogue_(), q.callback);
    return sortie_({ok: true, service: "inventaire emballages"}, q.callback);
  } catch (err) {
    return sortie_({ok: false, error: String(err.message || err)}, q.callback);
  }
}

function doPost(e) {
  let d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { return sortie_({ok: false, error: "corps illisible"}); }
  if (String(d.token) !== JETON) return sortie_({ok: false, error: "jeton invalide"});
  if ((d.action || "inventaire") === "syncHH") {
    try { return sortie_(syncHH()); } catch (err) { return sortie_({ok: false, error: String(err.message || err)}); }
  }
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    if (!ss().getSheetByName("Produits")) preparerOnglets_();
    switch (d.action || "inventaire") {
      case "inventaire": return sortie_(enregistrerInventaire_(d));
      case "conditionnement": return sortie_(changerConditionnement_(d));
      case "zone": return sortie_(changerZone_(d));
      case "retirer": return sortie_(retirer_(d));
      case "ajouterProduit": return sortie_(ajouterProduit_(d.produit || {}));
      case "migrer": return sortie_(migrer_(d));
      case "majPrix": return sortie_(majPrix_(d));
      case "majHH": return sortie_(majHH_(d));
      case "majFacteurs": return sortie_(majFacteurs_(d));
      default: return sortie_({ok: false, error: "action inconnue"});
    }
  } catch (err) {
    return sortie_({ok: false, error: String(err.message || err)});
  } finally {
    verrou.releaseLock();
  }
}

/* ---------- inventaire ---------- */

/* L'app envoie tous ses produits comptés à chaque synchro (2,5 s après chaque
   saisie, puis à l'appui sur « Envoyer »). Une ligne par date + produit :
   un nouvel envoi remplace la ligne, il n'en ajoute pas une deuxième.
   Ligne reçue : [Date, Zone constatée, Produit, Service, Unités/colis, Colis,
   Unités hors colis, Quantité totale, Zone attribuée, Compté par]. */
function enregistrerInventaire_(d) {
  const lignes = Array.isArray(d.lignes) ? d.lignes : [];
  if (!d.date || !lignes.length) return {ok: false, error: "rien à enregistrer"};
  const jour = versDate(d.date);
  const prods = {};
  lignes_("Produits").forEach(r => prods[norm(r[P.n])] = r);
  const envoye = maintenant();
  const rows = lignes.map(l => {
    const p = prods[norm(l[2])];
    const pu = p ? nombre(p[P.pu]) : null, qte = Number(l[7]) || 0;
    const r = new Array(ONGLETS.Inventaires.length).fill("");
    r[I.date] = jour; r[I.zc] = l[1] || ""; r[I.za] = l[8] || (p ? p[P.z1] : "");
    r[I.n] = l[2]; r[I.h] = p ? p[P.h] : ""; r[I.f] = p ? p[P.f] : ""; r[I.s] = l[3] || "";
    r[I.u] = Number(l[4]) || 0; r[I.colis] = Number(l[5]) || 0; r[I.hors] = Number(l[6]) || 0; r[I.qte] = qte;
    r[I.pu] = pu == null ? "" : pu; r[I.val] = pu == null ? "" : arrondi(qte * pu);
    r[I.stock] = p && p[P.stock] !== "" ? p[P.stock] : "";
    r[I.qui] = l[9] || d.qui || ""; r[I.source] = "App"; r[I.envoye] = envoye;
    return r;
  });
  const res = remplacerInventaire_(rows);
  recalculer_();
  const inconnus = lignes.filter(l => !prods[norm(l[2])]).map(l => l[2]);
  return {ok: true, recus: lignes.length, ajoutees: res.ajoutees, majs: res.majs, inconnus};
}

/* Upsert par date + intitulé. */
function remplacerInventaire_(rows) {
  const f = ss().getSheetByName("Inventaires");
  const cle = (dt, n) => jourIso(dt) + "|" + norm(n);
  const existantes = {};
  lignes_("Inventaires").forEach((r, i) => { if (r[I.date]) existantes[cle(r[I.date], r[I.n])] = i + 2; });
  const nouvelles = [];
  let majs = 0;
  rows.forEach(r => {
    const deja = existantes[cle(r[I.date], r[I.n])];
    if (deja) { f.getRange(deja, 1, 1, r.length).setValues([r]); majs++; }
    else nouvelles.push(r);
  });
  ajouterLignes_("Inventaires", nouvelles);
  return {ajoutees: nouvelles.length, majs};
}

/* ---------- modifications faites depuis l'app ---------- */

function modifierCellule_(ligne, col, valeur) {
  const f = ss().getSheetByName("Produits");
  f.getRange(ligne, col + 1).setValue(valeur);
  f.getRange(ligne, P.maj + 1).setValue(maintenant());
}

function changerConditionnement_(d) {
  const u = Number(d.u);
  if (!(u >= 1)) return {ok: false, error: "conditionnement invalide"};
  const t = trouver_(d.n);
  if (!t) return {ok: false, error: "produit introuvable : " + d.n};
  modifierCellule_(t.ligne, P.u, u);
  journal_("Conditionnement", t.row[P.n], t.row[P.u], u, d.qui || "");
  recalculer_();
  return {ok: true};
}

function changerZone_(d) {
  const z = String(d.z1 || "").trim();
  if (!z) return {ok: false, error: "zone vide"};
  const t = trouver_(d.n);
  if (!t) return {ok: false, error: "produit introuvable : " + d.n};
  if (String(t.row[P.z1]) === z) return {ok: true, inchange: true};
  modifierCellule_(t.ligne, P.z1, z);
  journal_("Zone", t.row[P.n], t.row[P.z1], z, d.qui || "");
  recalculer_();
  return {ok: true};
}

function retirer_(d) {
  const t = trouver_(d.n);
  if (!t) return {ok: false, error: "produit introuvable : " + d.n};
  const row = t.row.slice();
  row[P.maj] = maintenant();
  ss().getSheetByName("Inutilisés").appendRow(row.concat([maintenant()]));
  ss().getSheetByName("Produits").deleteRow(t.ligne);
  journal_("Retiré (plus stocké)", row[P.n], "", "", d.qui || "");
  recalculer_();
  return {ok: true};
}

function ajouterProduit_(p) {
  const n = String(p.n || "").trim();
  if (!n) return {ok: false, error: "intitulé vide"};
  if (trouver_(n)) return {ok: false, error: "cette référence existe déjà"};
  const r = new Array(ONGLETS.Produits.length).fill("");
  r[P.n] = n; r[P.f] = p.fournisseur || ""; r[P.s] = p.s || ""; r[P.z1] = p.z1 || "Autres";
  r[P.u] = Number(p.u) || 1; r[P.min] = Number(p.min) || ""; r[P.origine] = "App"; r[P.maj] = maintenant();
  ajouterLignes_("Produits", [r]);
  journal_("Ajout (app)", n, "", "", "");
  recalculer_();
  return {ok: true};
}

/* Reprise de l'ancien classeur : n'écrit que dans des onglets vides, et seulement
   avec la clé de reprise (absente de l'app publique). */
const CLE_MIGRATION = "";
function migrer_(d) {
  if (!CLE_MIGRATION || d.cle !== CLE_MIGRATION) return {ok: false, error: "reprise fermée"};
  if (d.remplacer) {
    ["Produits", "Inventaires", "Journal", "Inutilisés"].forEach(n => {
      const f = ss().getSheetByName(n);
      if (f.getLastRow() > 1) f.getRange(2, 1, f.getLastRow() - 1, f.getLastColumn()).clearContent();
    });
  } else if (lignes_("Produits").length || lignes_("Inventaires").length) return {ok: false, error: "le classeur contient déjà des données"};
  const prods = (d.produits || []).map(r => { const x = r.slice(0, ONGLETS.Produits.length); while (x.length < ONGLETS.Produits.length) x.push(""); x[P.h] = String(x[P.h]); return x; });
  const invs = (d.inventaires || []).map(r => { const x = r.slice(); x[I.date] = versDate(x[I.date]); x[I.h] = String(x[I.h]); return x; });
  ajouterLignes_("Produits", prods);
  ajouterLignes_("Inventaires", invs);
  ajouterLignes_("Journal", (d.journal || []).map(r => [maintenant()].concat(r)));
  recalculer_();
  mettreEnForme_();
  return {ok: true, produits: prods.length, inventaires: invs.length};
}

/* Prix unitaires corrigés d'après les factures fournisseurs, et onglet
   « Corrections HH » (ce qu'il reste à reprendre dans Hello Harel).
   Même clé que la reprise : absente de l'app publique. */
function majPrix_(d) {
  if (!CLE_MIGRATION || d.cle !== CLE_MIGRATION) return {ok: false, error: "fermé"};
  const f = ss().getSheetByName("Produits");
  const index = {};
  lignes_("Produits").forEach((r, i) => index[norm(r[P.n])] = {ligne: i + 2, avant: r[P.pu]});
  const absents = [];
  (d.prix || []).forEach(x => {
    const t = index[norm(x.n)];
    if (!t) { absents.push(x.n); return; }
    const c = f.getRange(t.ligne, P.pu + 1);
    c.setValue(x.pu);
    c.setNote(x.source);
    f.getRange(t.ligne, P.maj + 1).setValue(maintenant());
    journal_("Prix (facture)", x.n, t.avant, x.pu, x.source);
  });
  if (d.corrections) {
    let c = ss().getSheetByName("Corrections HH");
    if (!c) c = ss().insertSheet("Corrections HH");
    c.clear();
    const rows = d.corrections;
    c.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    (d.titres || []).forEach(n => c.getRange(n, 1, 1, rows[0].length).setFontWeight("bold").setFontColor("#ffffff").setBackground("#0f6b57"));
    (d.entetes || []).forEach(n => c.getRange(n, 1, 1, rows[0].length).setFontWeight("bold").setBackground("#d9ebe4").setWrap(true));
    c.setColumnWidth(1, 330);
    for (let k = 2; k <= rows[0].length; k++) c.setColumnWidth(k, 160);
    c.getRange(1, 1, rows.length, rows[0].length).setVerticalAlignment("top");
    c.getRange(2, 7, rows.length, 1).setWrap(true);
    c.setFrozenRows(1);
    c.setTabColor("#b3261e");
  }
  recalculer_();
  return {ok: true, prix: (d.prix || []).length - absents.length, absents};
}

/* Secret partagé avec le workflow n8n (absent de l'app publique). */
const CLE_N8N = "";

/* Appelée par n8n avec les produits de l'API publique. Le catalogue d'achat
   n'étant pas dans cette API, les fournisseurs sont lus dans « Fournisseurs HH »
   et un consommable compte comme acheté s'il y figure ou s'il a du stock. */
function majHH_(d) {
  if (!CLE_N8N || d.cle !== CLE_N8N) return {ok: false, error: "clé n8n invalide"};
  const produits = Array.isArray(d.produits) ? d.produits : [];
  if (produits.length < 100) return {ok: false, error: "liste de produits incomplète (" + produits.length + ")"};
  let fo = ss().getSheetByName("Fournisseurs HH");
  if (!fo) { fo = ss().insertSheet("Fournisseurs HH"); fo.hideSheet(); }
  if (Array.isArray(d.fournisseurs) && d.fournisseurs.length) {
    fo.clear();
    const ent = [["ID HH", "Code HH", "Fournisseurs", "Facteur d'achat", "Ligne active"]];
    fo.getRange(1, 2, Math.max(fo.getMaxRows(), 1), 1).setNumberFormat("@");
    fo.getRange(1, 1, d.fournisseurs.length + 1, 5).setValues(ent.concat(d.fournisseurs.map(r => [r[0], String(r[1]), r[2], r[3], r[4] ? "O" : "N"])));
  }
  const achats = [];
  const vus = {};
  if (fo.getLastRow() > 1) fo.getRange(2, 1, fo.getLastRow() - 1, 5).getValues().forEach(r => {
    vus[r[0]] = 1;
    String(r[2]).split(" / ").filter(Boolean).forEach(four => achats.push({
      links: {product: {name: "/products/products/" + r[0]}}, supplier: {displayName: four},
      handlingUnit: {factor: Number(r[3]) || 1}, active: r[4] === "O"}));
  });
  /* Consommable sans ligne d'achat connue mais avec du stock : il a été reçu. */
  produits.forEach(p => {
    if (!vus[p.id] && p.category && FAMILLES[p.category.name] && Number(p.availableQuantity) > 0)
      achats.push({links: {product: {name: "/products/products/" + p.id}}, supplier: {displayName: ""}, handlingUnit: {factor: 1}, active: true});
  });
  const f = ss().getSheetByName("Produits");
  const rows = lignes_("Produits");
  const res = fusionner_(produits, achats, rows, lignes_("Inutilisés"), maintenant());
  f.getRange(1, P.h + 1, f.getMaxRows(), 1).setNumberFormat("@");
  if (rows.length) f.getRange(2, 1, rows.length, rows[0].length).setValues(res.rows.map(r => { r[P.h] = String(r[P.h]); return r; }));
  ajouterLignes_("Produits", res.ajouts);
  res.ajouts.forEach(a => journal_("Ajout (Hello Harel)", a[P.n], "", "", a[P.f] ? "acheté chez " + a[P.f] : "en stock dans Hello Harel"));
  res.lies.forEach(n => journal_("Relié à Hello Harel", n, "", "", "intitulé identique"));
  PropertiesService.getScriptProperties().setProperty("HH_MAJ", maintenant());
  recalculer_();
  return {ok: true, produitsHH: produits.length, ajoutes: res.ajouts.map(a => a[P.n]), relies: res.lies, maj: res.maj};
}

/* « Unités app par unité HH » : combien d'unités comptées dans l'app font une
   unité de stock Hello Harel (2000 pour des gants stockés au colis dans HH). */
function majFacteurs_(d) {
  if (!CLE_N8N || d.cle !== CLE_N8N) return {ok: false, error: "clé n8n invalide"};
  const f = ss().getSheetByName("Produits");
  f.getRange(1, P.fhh + 1).setValue(ONGLETS.Produits[P.fhh]);
  ss().getSheetByName("Inutilisés").getRange(1, 1, 1, ONGLETS["Inutilisés"].length).setValues([ONGLETS["Inutilisés"]]);
  const index = {};
  lignes_("Produits").forEach((r, i) => index[norm(r[P.n])] = {ligne: i + 2, avant: r[P.fhh]});
  const absents = [];
  (d.facteurs || []).forEach(x => {
    const t = index[norm(x.n)];
    if (!t) { absents.push(x.n); return; }
    const c = f.getRange(t.ligne, P.fhh + 1);
    c.setValue(x.f);
    if (x.source) c.setNote(x.source);
    journal_("Unités par unité HH", x.n, t.avant, x.f, x.source || "");
  });
  recalculer_();
  return {ok: true, absents};
}

/* Comptage de l'app face au stock Hello Harel, dans l'unité de Hello Harel.
   Trié pour traiter d'abord les conditionnements HH à corriger, puis les plus
   gros écarts en valeur. */
function rapprochement_(etat) {
  let f = ss().getSheetByName("Rapprochement HH");
  if (!f) f = ss().insertSheet("Rapprochement HH");
  const ent = ["Intitulé", "Code HH", "Zone", "Unités/colis (app)", "Compté (unités app)", "Date du comptage",
               "Unité HH", "Unités app par unité HH", "Compté en unité HH", "Stock HH", "Écart (unité HH)",
               "Écart (€)", "Statut", "À faire"];
  const ordre = {"Conditionnement HH à corriger": 0, "Écart": 1, "OK": 2, "Pas de stock géré dans HH": 3, "Non compté": 4};
  const rows = etat.filter(e => e.r[P.h]).map(e => {
    const r = e.r, fac = nombre(r[P.fhh]) || 1, st = nombre(r[P.stock]);
    const q = e.der ? e.der.q : null;
    const conv = q == null ? null : q / fac;
    const ecart = conv == null || st == null ? null : conv - st;
    const euros = ecart != null && e.pu != null ? arrondi(ecart * fac * e.pu) : "";
    let statut, faire = "";
    if (q == null) statut = "Non compté";
    else if (st == null) statut = "Pas de stock géré dans HH";
    else if (fac > 1) {
      statut = "Conditionnement HH à corriger";
      faire = "HH : stock à l'unité, achat au colis de " + fac + " — puis inventaire à " + q + " unités";
    } else if (Math.abs(ecart) <= Math.max(1, 0.05 * Math.max(conv, st))) statut = "OK";
    else {
      statut = "Écart";
      faire = "Vérifier : compté " + q + ", HH " + st + (q && st && Math.abs(q / st - r[P.u]) / r[P.u] < 0.2 ? " — HH semble compter en colis de " + r[P.u] : "");
    }
    return [r[P.n], String(r[P.h]), r[P.z1], r[P.u], q == null ? "" : q, e.der ? e.der.d : "", r[P.unite], fac,
            conv == null ? "" : Math.round(conv * 100) / 100, st == null ? "" : st, ecart == null ? "" : Math.round(ecart * 100) / 100,
            euros, statut, faire];
  }).sort((a, b) => (ordre[a[12]] - ordre[b[12]]) || (Math.abs(Number(b[11]) || 0) - Math.abs(Number(a[11]) || 0)));
  f.clear();
  f.clearConditionalFormatRules();
  f.getRange(1, 1, 1, ent.length).setValues([ent]).setFontWeight("bold").setBackground("#12211d").setFontColor("#ffffff").setWrap(true);
  if (rows.length) f.getRange(2, 1, rows.length, ent.length).setValues(rows);
  const n = Math.max(rows.length, 1);
  f.getRange(2, 2, n, 1).setNumberFormat("@");
  f.getRange(2, 6, n, 1).setNumberFormat("dd/mm/yyyy");
  f.getRange(2, 5, n, 1).setNumberFormat("#,##0");
  f.getRange(2, 9, n, 3).setNumberFormat("#,##0.##");
  f.getRange(2, 12, n, 1).setNumberFormat("#,##0.00 €");
  const st = f.getRange(2, 13, n, 1);
  f.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Conditionnement HH à corriger").setBackground("#f9e2e0").setFontColor("#b3261e").setBold(true).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Écart").setBackground("#f7ecdc").setFontColor("#b8690f").setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("OK").setFontColor("#0f6b57").setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Non compté").setFontColor("#78837c").setRanges([st]).build()
  ]);
  f.setFrozenRows(1); f.setFrozenColumns(1);
  f.setColumnWidth(1, 330); f.setColumnWidth(13, 190); f.setColumnWidth(14, 380);
  f.getRange(2, 14, n, 1).setWrap(true);
  if (f.getLastRow() > 1 && !f.getFilter()) f.getRange(1, 1, f.getLastRow(), ent.length).createFilter();
  f.setTabColor("#b8690f");
}

/* ---------- colonnes calculées, archive et bilan ---------- */

function recalculer_() {
  const c = ss();
  const fp = c.getSheetByName("Produits");
  const prods = lignes_("Produits");
  const invs = lignes_("Inventaires").filter(r => r[I.date] && r[I.n]);
  const zones = lignes_("Zones").filter(r => r[0]);

  /* Historique par produit, du plus récent au plus ancien. */
  const hist = {};
  invs.forEach((r, i) => (hist[norm(r[I.n])] = hist[norm(r[I.n])] || []).push({d: new Date(r[I.date]), q: Number(r[I.qte]) || 0, zc: r[I.zc], i}));
  Object.keys(hist).forEach(k => hist[k].sort((a, b) => b.d - a.d || b.i - a.i));

  const etat = prods.map(r => {
    const h = hist[norm(r[P.n])] || [];
    const der = h[0];
    const pu = nombre(r[P.pu]), u = nombre(r[P.u]), min = nombre(r[P.min]);
    r[P.pcol] = pu != null && u != null ? arrondi(pu * u) : "";
    r[P.dern] = der ? der.d : "";
    r[P.qte] = der ? der.q : "";
    r[P.val] = der && pu != null ? arrondi(der.q * pu) : "";
    r[P.statut] = !der ? "Non compté" : der.q === 0 ? "Stock nul" : (min != null && min > 0 && der.q < min) ? "SOUS MINIMUM" : "OK";
    r[P.hors] = der && der.zc && der.zc !== r[P.z1] && der.zc !== r[P.z2] ? der.zc : "";
    /* Depuis quand la quantité n'a pas bougé : premier comptage de la série identique. */
    let depuis = der ? der.d : null;
    for (let j = 1; der && j < h.length && h[j].q === der.q; j++) depuis = h[j].d;
    return {r, der, pu, min, depuis};
  });
  if (prods.length) {
    fp.getRange(2, P.pcol + 1, prods.length, 1).setValues(prods.map(r => [r[P.pcol]]));
    fp.getRange(2, P.dern + 1, prods.length, 5).setValues(prods.map(r => [r[P.dern], r[P.qte], r[P.val], r[P.statut], r[P.hors]]));
  }
  archive_(prods, invs);
  bilan_(etat, invs, zones);
  rapprochement_(etat);
}

function archive_(prods, invs) {
  const annees = {};
  invs.forEach(r => annees[new Date(r[I.date]).getFullYear()] = 1);
  Object.keys(annees).forEach(an => {
    const nom = "Archive " + an;
    let f = ss().getSheetByName(nom);
    if (!f) f = ss().insertSheet(nom);
    const parProd = {}, ordre = [];
    const ligne = (n, fo, s) => { const k = norm(n); if (!parProd[k]) { parProd[k] = {n, fo, s, m: new Array(12).fill(""), dm: new Array(12).fill(null)}; ordre.push(k); } return parProd[k]; };
    prods.forEach(r => ligne(r[P.n], r[P.f], r[P.s]));
    invs.forEach(r => {
      const d = new Date(r[I.date]);
      if (String(d.getFullYear()) !== an) return;
      const x = ligne(r[I.n], r[I.f], r[I.s]), m = d.getMonth();
      if (!x.dm[m] || d >= x.dm[m]) { x.m[m] = Number(r[I.qte]) || 0; x.dm[m] = d; }
    });
    const pu = {};
    prods.forEach(r => pu[norm(r[P.n])] = nombre(r[P.pu]));
    const rows = ordre.map(k => {
      const x = parProd[k];
      const dernier = x.m.reduce((a, v) => v === "" ? a : v, "");
      return [x.n, x.fo, x.s].concat(x.m).concat([pu[k] != null && dernier !== "" ? arrondi(pu[k] * dernier) : ""]);
    });
    const ent = ["Intitulé", "Fournisseur", "Service"].concat(MOIS).concat(["Valeur du dernier comptage (€)"]);
    f.clear();
    f.getRange(1, 1, 1, ent.length).setValues([ent]).setFontWeight("bold").setBackground("#12211d").setFontColor("#ffffff").setWrap(true);
    if (rows.length) f.getRange(2, 1, rows.length, ent.length).setValues(rows);
    f.getRange(2, 4, Math.max(rows.length, 1), 12).setNumberFormat("#,##0");
    f.getRange(2, 16, Math.max(rows.length, 1), 1).setNumberFormat("#,##0.00 €");
    f.setFrozenRows(1); f.setFrozenColumns(1);
    f.setColumnWidth(1, 330); f.setColumnWidth(2, 150);
    f.setTabColor("#3d4a45");
  });
}

function bilan_(etat, invs, zones) {
  const f = ss().getSheetByName("Bilan");
  const L = 8, out = [], styles = [];
  const ligne = (vals, style) => { const r = vals.slice(); while (r.length < L) r.push(""); out.push(r); styles.push(style || ""); };
  const fr = d => d ? Utilities.formatDate(new Date(d), tz(), "dd/MM/yyyy") : "";
  const jours = (a, b) => Math.round((a - b) / 86400000);

  const comptes = etat.filter(e => e.der);
  const qte = comptes.reduce((s, e) => s + e.der.q, 0);
  const valeur = comptes.reduce((s, e) => s + (e.pu != null ? e.der.q * e.pu : 0), 0);
  const sansPrix = comptes.filter(e => e.pu == null && e.der.q > 0).length;
  const dernierJour = invs.reduce((m, r) => { const d = new Date(r[I.date]); return !m || d > m ? d : m; }, null);
  const duJour = dernierJour ? invs.filter(r => jourIso(r[I.date]) === jourIso(dernierJour)).length : 0;
  const sousMin = etat.filter(e => e.r[P.statut] === "SOUS MINIMUM");
  const horsZone = etat.filter(e => e.r[P.hors]);
  const auj = new Date();
  const immobiles = comptes.filter(e => e.der.q > 0 && e.depuis && jours(auj, e.depuis) >= 30)
    .sort((a, b) => a.depuis - b.depuis);

  ligne(["BILAN DE L'INVENTAIRE — MAISON SAVARY"], "titre");
  ligne(["Mis à jour automatiquement le " + maintenant() + " · état du stock = dernier comptage de chaque produit"], "note");
  ligne([]);
  ligne(["Produits référencés", etat.length], "kpi");
  ligne(["Produits comptés au moins une fois", comptes.length], "kpi");
  ligne(["Jamais comptés", etat.length - comptes.length], "kpi");
  ligne(["Dernier inventaire", fr(dernierJour), duJour + " produit(s) ce jour-là"], "kpi");
  ligne(["Quantité totale en stock (unités)", qte], "kpin");
  ligne(["Valeur du stock (€)", arrondi(valeur), sansPrix ? sansPrix + " produit(s) en stock sans prix unitaire" : ""], "kpie");
  ligne(["Produits trouvés hors de leur zone", horsZone.length], "kpi");
  ligne(["Produits sous stock minimum", sousMin.length], "kpi");
  ligne(["Stock inchangé depuis 1 mois ou plus", immobiles.filter(e => jours(auj, e.depuis) < 90).length], "kpi");
  ligne(["Stock inchangé depuis 3 mois ou plus", immobiles.filter(e => jours(auj, e.depuis) >= 90).length], "kpi");
  ligne([]);

  /* Par zone et par niveau. */
  const niv = {};
  zones.forEach(z => niv[z[0]] = z[2]);
  const parZone = {};
  zones.forEach(z => parZone[z[0]] = {att: 0, cpt: 0, q: 0, v: 0});
  etat.forEach(e => {
    const z = e.r[P.z1] || "Autres";
    const x = parZone[z] || (parZone[z] = {att: 0, cpt: 0, q: 0, v: 0});
    x.att++;
    if (e.der) { x.cpt++; x.q += e.der.q; x.v += e.pu != null ? e.der.q * e.pu : 0; }
  });
  ligne(["CONTRÔLE PAR ZONE"], "section");
  ligne(["Zone", "Niveau", "Produits attribués", "Comptés", "Restants", "Quantité (unités)", "Valeur stockée (€)", "Part de la valeur"], "entete");
  const tot = {att: 0, cpt: 0, q: 0, v: 0};
  Object.keys(parZone).forEach(z => {
    const x = parZone[z];
    ["att", "cpt", "q", "v"].forEach(k => tot[k] += x[k]);
    ligne([z, niv[z] || "", x.att, x.cpt, x.att - x.cpt, x.q, arrondi(x.v), valeur ? x.v / valeur : 0], "zone");
  });
  ligne(["TOTAL", "", tot.att, tot.cpt, tot.att - tot.cpt, tot.q, arrondi(tot.v), valeur ? 1 : 0], "total");
  ligne([]);
  ligne(["RÉCAPITULATIF PAR NIVEAU"], "section");
  ligne(["Niveau", "", "Produits attribués", "Comptés", "Restants", "Quantité (unités)", "Valeur stockée (€)", "Part de la valeur"], "entete");
  const parNiv = {};
  Object.keys(parZone).forEach(z => {
    const n = niv[z] || z, x = parZone[z];
    const y = parNiv[n] || (parNiv[n] = {att: 0, cpt: 0, q: 0, v: 0});
    ["att", "cpt", "q", "v"].forEach(k => y[k] += x[k]);
  });
  Object.keys(parNiv).forEach(n => { const y = parNiv[n]; ligne([n, "", y.att, y.cpt, y.att - y.cpt, y.q, arrondi(y.v), valeur ? y.v / valeur : 0], "zone"); });
  ligne([]);

  ligne(["IRRÉGULARITÉS DE PLACEMENT (90 derniers jours)"], "section");
  ligne(["Produit / Référence", "Service", "Zone attribuée", "Trouvé en", "Quantité (unités)", "Date du constat"], "entete");
  const irr = invs.filter(r => r[I.zc] && r[I.za] && r[I.zc] !== r[I.za] && jours(auj, new Date(r[I.date])) <= 90)
    .sort((a, b) => new Date(b[I.date]) - new Date(a[I.date]));
  if (!irr.length) ligne(["Aucun écart de placement signalé"], "vide");
  irr.slice(0, 60).forEach(r => ligne([r[I.n], r[I.s], r[I.za], r[I.zc], Number(r[I.qte]) || 0, fr(r[I.date])], "liste"));
  ligne([]);

  ligne(["PRODUITS SOUS STOCK MINIMUM"], "section");
  ligne(["Produit / Référence", "Zone", "Quantité (unités)", "Stock minimum", "Manque", "Fournisseur", "Contact"], "entete");
  if (!sousMin.length) ligne(["Aucun produit sous son stock minimum"], "vide");
  sousMin.forEach(e => ligne([e.r[P.n], e.r[P.z1], e.der.q, e.min, e.min - e.der.q, e.r[P.f], e.r[P.contact]], "liste"));
  ligne([]);

  ligne(["PRODUITS DONT LE STOCK N'A PAS BOUGÉ"], "section");
  ligne(["Produit / Référence", "Zone", "Quantité (unités)", "Inchangé depuis le", "Alerte", "Valeur immobilisée (€)"], "entete");
  if (!immobiles.length) ligne(["Aucun stock immobile depuis un mois"], "vide");
  immobiles.forEach(e => {
    const j = jours(auj, e.depuis);
    ligne([e.r[P.n], e.r[P.z1], e.der.q, fr(e.depuis), j >= 90 ? "ROUGE — 3 mois et plus" : "ORANGE — 1 mois et plus",
           e.pu != null ? arrondi(e.der.q * e.pu) : ""], "liste");
  });

  f.clear();
  f.clearConditionalFormatRules();
  f.getRange(1, 1, out.length, L).setValues(out);
  f.setColumnWidth(1, 330);
  for (let c = 2; c <= L; c++) f.setColumnWidth(c, 115);
  f.getRange(1, 1, out.length, L).setVerticalAlignment("middle");
  styles.forEach((s, i) => {
    const r = f.getRange(i + 1, 1, 1, L), n = i + 1;
    if (s === "titre") f.getRange(n, 1).setFontSize(16).setFontWeight("bold").setFontColor("#12211d");
    if (s === "note") f.getRange(n, 1).setFontColor("#78837c").setFontStyle("italic");
    if (s.indexOf("kpi") === 0) { f.getRange(n, 1).setFontColor("#3d4a45"); f.getRange(n, 2).setFontWeight("bold").setHorizontalAlignment("right"); f.getRange(n, 3).setFontColor("#78837c"); }
    if (s === "kpin") f.getRange(n, 2).setNumberFormat("#,##0");
    if (s === "kpie") f.getRange(n, 2).setNumberFormat("#,##0.00 €");
    if (s === "section") r.setFontWeight("bold").setFontColor("#ffffff").setBackground("#0f6b57");
    if (s === "entete") r.setFontWeight("bold").setBackground("#d9ebe4").setWrap(true);
    if (s === "zone" || s === "total") {
      f.getRange(n, 6).setNumberFormat("#,##0"); f.getRange(n, 7).setNumberFormat("#,##0.00 €"); f.getRange(n, 8).setNumberFormat("0.0%");
    }
    if (s === "total") r.setFontWeight("bold").setBorder(true, null, null, null, null, null);
    if (s === "vide") f.getRange(n, 1).setFontColor("#78837c").setFontStyle("italic");
  });
  f.setFrozenRows(2);
}

/* ---------- Hello Harel ---------- */

function hhProduits_(cle) {
  const tous = [];
  for (let off = 0; off < 20000; off += 1000) {
    const r = UrlFetchApp.fetch(HH + "/api/v1/products?limit=1000&offset=" + off,
      {headers: {"X-AUTH-TOKEN": cle}, muteHttpExceptions: true});
    if (r.getResponseCode() !== 200) throw new Error("API produits Hello Harel : HTTP " + r.getResponseCode());
    const page = JSON.parse(r.getContentText());
    tous.push(...page);
    if (page.length < 1000) break;
  }
  return tous;
}

/* Session web ordinaire : le catalogue d'achat n'existe pas dans l'API publique. */
function hhSession_(email, mdp) {
  const pot = {};
  const garder = r => {
    let h = r.getAllHeaders()["Set-Cookie"];
    if (!h) return;
    (Array.isArray(h) ? h : [h]).forEach(c => {
      const kv = c.split(";")[0], i = kv.indexOf("=");
      if (i > 0) pot[kv.slice(0, i).trim()] = kv.slice(i + 1);
    });
  };
  const cookies = () => Object.keys(pot).map(k => k + "=" + pot[k]).join("; ");
  let r = UrlFetchApp.fetch(HH + "/login", {followRedirects: false, muteHttpExceptions: true});
  garder(r);
  const csrf = (r.getContentText().match(/name="_csrf_token"[^>]*value="([^"]+)"/) || [])[1];
  if (!csrf) throw new Error("page de connexion Hello Harel méconnaissable");
  r = UrlFetchApp.fetch(HH + "/login", {method: "post", followRedirects: false, muteHttpExceptions: true,
    headers: {Cookie: cookies()}, payload: {_username: email, _password: mdp, _csrf_token: csrf}});
  garder(r);
  const vers = String(r.getAllHeaders()["Location"] || "");
  if (r.getResponseCode() !== 302 || /login/.test(vers)) throw new Error("connexion web Hello Harel refusée");
  return cookies();
}

function hhCatalogueAchat_(cookie) {
  const tout = [];
  for (let page = 1; page <= 20; page++) {
    const r = UrlFetchApp.fetch(HH + "/purchasing/catalog.json?page=" + page,
      {headers: {Cookie: cookie, "X-Requested-With": "XMLHttpRequest"}, muteHttpExceptions: true});
    if (r.getResponseCode() !== 200) throw new Error("catalogue d'achat : HTTP " + r.getResponseCode());
    const j = JSON.parse(r.getContentText());
    const data = j.data || [];
    if (!data.length || (tout.length && data[0].id === tout[0].id)) break;
    tout.push(...data);
    const total = j.pagination && j.pagination.total;
    if (!total || tout.length >= total) break;
  }
  return tout;
}

/* Lancée toutes les heures (et depuis l'app). Met à jour fournisseur, stock et
   famille des produits déjà connus, et ajoute les consommables achetés dans
   Hello Harel qui manquent encore — sauf ceux classés « Inutilisés ». */
function syncHH() {
  const pr = PropertiesService.getScriptProperties();
  const cle = pr.getProperty("HH_API_KEY"), email = pr.getProperty("HH_WEB_EMAIL"), mdp = pr.getProperty("HH_WEB_PASSWORD");
  if (!cle || !email || !mdp) return {ok: false, error: "identifiants Hello Harel absents des propriétés du script"};

  const produits = hhProduits_(cle);
  const achats = hhCatalogueAchat_(hhSession_(email, mdp));

  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const f = ss().getSheetByName("Produits");
    const rows = lignes_("Produits");
    const res = fusionner_(produits, achats, rows, lignes_("Inutilisés"), maintenant());
    f.getRange(1, P.h + 1, f.getMaxRows(), 1).setNumberFormat("@");
    if (rows.length) f.getRange(2, 1, rows.length, rows[0].length).setValues(res.rows.map(r => { r[P.h] = String(r[P.h]); return r; }));
    ajouterLignes_("Produits", res.ajouts);
    res.ajouts.forEach(a => journal_("Ajout (Hello Harel)", a[P.n], "", "", "acheté chez " + a[P.f]));
    res.lies.forEach(n => journal_("Relié à Hello Harel", n, "", "", "intitulé identique"));
    pr.setProperty("HH_MAJ", maintenant());
    recalculer_();
    return {ok: true, produitsHH: produits.length, lignesAchat: achats.length,
            ajoutes: res.ajouts.map(a => a[P.n]), relies: res.lies, maj: res.maj};
  } finally {
    verrou.releaseLock();
  }
}

/* Partie pure, testable hors Apps Script : modifie `rows` en place et renvoie
   les lignes à ajouter. */
function fusionner_(produits, achats, rows, inutilises, quand) {
  const parId = {}, parCode = {}, parLibelle = {};
  produits.filter(p => !p.deleted).forEach(p => {
    parId[p.id] = p;
    if (p.code && !parCode[p.code]) parCode[p.code] = p;
    parLibelle[norm(p.label)] = p;
  });

  /* Ce qu'on achète, produit par produit : fournisseurs et unité d'achat.
     Les lignes inactives servent à nommer le fournisseur d'un produit connu,
     jamais à en ajouter un. */
  const achete = {};
  achats.forEach(a => {
    const m = String((a.links && a.links.product && a.links.product.name) || "").match(/\/(\d+)$/);
    if (!m) return;
    const id = Number(m[1]);
    const x = achete[id] || (achete[id] = {id, four: [], facteur: 1, actif: false});
    const actif = a.active !== false;
    x.actif = x.actif || actif;
    const four = String((a.supplier && a.supplier.displayName) || "").replace(/^\S+\s+-\s+/, "").trim();
    if (four && x.four.indexOf(four) < 0) x.four[actif ? "unshift" : "push"](four);   // ligne sans fournisseur : produit en stock
    const fac = Number(a.handlingUnit && a.handlingUnit.factor) || 1;
    if (actif && fac > x.facteur) x.facteur = fac;
  });

  /* Un produit sans famille dans Hello Harel compte comme consommable si son
     fournisseur vend surtout des consommables (Paredes, Cenpac, As2Pack…). */
  const famille = id => { const p = parId[id]; return p && p.category ? p.category.name : null; };
  const parFour = {};
  Object.keys(achete).forEach(id => {
    const fam = famille(id);
    if (!fam) return;
    achete[id].four.forEach(fo => {
      const s = parFour[fo] || (parFour[fo] = {conso: 0, total: 0, services: {}});
      s.total++;
      if (FAMILLES[fam]) { s.conso++; s.services[FAMILLES[fam]] = (s.services[FAMILLES[fam]] || 0) + 1; }
    });
  });
  const fourConso = fo => parFour[fo] && parFour[fo].conso * 2 > parFour[fo].total;
  const serviceDe = x => {
    const fam = famille(x.id);
    if (fam && FAMILLES[fam]) return FAMILLES[fam];
    const s = (parFour[x.four[0]] || {}).services || {};
    return Object.keys(s).sort((a, b) => s[b] - s[a])[0] || "Emballage";
  };
  const estConso = x => {
    const fam = famille(x.id);
    if (fam) return !!FAMILLES[fam];
    return x.four.some(fourConso);
  };

  const fourDe = p => (achete[p.id] ? achete[p.id].four.join(" / ") : "");
  const uniteDe = p => { const b = (p.packagings || []).filter(k => !k.deleted && Number(k.unit_factor) === 1)[0]; return b ? b.name : ""; };

  const connus = {}, noms = {};
  inutilises.forEach(r => { if (r[P.h]) connus[String(r[P.h])] = 1; noms[norm(r[P.n])] = 1; });

  const lies = [];
  let maj = 0;
  rows.forEach(r => {
    let p = r[P.h] ? parCode[String(r[P.h])] : null;
    if (!p && !r[P.h] && parLibelle[norm(r[P.n])]) {
      p = parLibelle[norm(r[P.n])];
      r[P.h] = p.code;
      lies.push(r[P.n]);
    }
    if (r[P.h]) connus[String(r[P.h])] = 1;
    noms[norm(r[P.n])] = 1;
    if (!p) return;
    const avant = JSON.stringify([r[P.f], r[P.stock], r[P.unite], r[P.cat], r[P.id]]);
    r[P.f] = fourDe(p) || r[P.f];
    r[P.stock] = p.stockManagement === false ? "" : Number(p.availableQuantity) || 0;
    r[P.unite] = uniteDe(p);
    r[P.cat] = p.category ? p.category.name : "";
    r[P.id] = p.id;
    if (JSON.stringify([r[P.f], r[P.stock], r[P.unite], r[P.cat], r[P.id]]) !== avant) maj++;
  });

  const ajouts = [];
  Object.keys(achete).forEach(id => {
    const x = achete[id], p = parId[id];
    if (!p || !x.actif || !estConso(x)) return;
    if (connus[String(p.code)] || noms[norm(p.label)]) return;
    connus[String(p.code)] = 1;
    noms[norm(p.label)] = 1;
    const row = new Array(ONGLETS.Produits.length).fill("");
    row[P.n] = String(p.label).trim();
    row[P.h] = p.code;
    row[P.f] = x.four.join(" / ");
    row[P.s] = serviceDe(x);
    row[P.z1] = "Autres";
    row[P.u] = x.facteur;
    row[P.stock] = p.stockManagement === false ? "" : Number(p.availableQuantity) || 0;
    row[P.unite] = uniteDe(p);
    row[P.cat] = p.category ? p.category.name : "";
    row[P.id] = p.id;
    row[P.origine] = "Hello Harel";
    row[P.maj] = quand;
    ajouts.push(row);
  });
  return {rows, ajouts, lies, maj};
}

if (typeof module !== "undefined") module.exports = {fusionner_, P, I, ONGLETS};
