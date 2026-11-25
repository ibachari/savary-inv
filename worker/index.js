/* Relais « Inventaire matières premières → Hello Harel ».
 *
 * Reçoit les comptages d'une zone (produits remplis uniquement) et les écrit dans un
 * inventaire BROUILLON de Hello Harel. Ne valide JAMAIS : le bouton « Valider » reste
 * à faire dans HH par un humain.
 *
 * Protocole relevé sur la production le 2026-11-25 (voir README) :
 *   - création : POST /stock/inventory/create?reload=1  (inventory[products] = ids)
 *   - lignes   : GET  /stock/inventory/{id}.json  (en-tête X-Requested-With)
 *   - écriture : POST /stock/inventory/{id}.json  (en-tête X-Lock-Identifier)
 *   - annuler  : GET  /stock/inventory/{id}/cancel?confirm=1  (brouillon seulement)
 */
const BASE = "https://maison-savary.helloharel.com";
const ORIGINES = ["https://ibachari.github.io", "http://localhost:8765"];
const XHR = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };
const MAX_PRODUITS = 300;

let session = null;   // { cookie, le }

function cors(req) {
  const o = req.headers.get("Origin") || "";
  return { "Access-Control-Allow-Origin": ORIGINES.includes(o) ? o : ORIGINES[0], "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
}
const rep = (req, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors(req) } });
const cookiesDe = r => r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");

async function connecter(env) {
  const page = await fetch(BASE + "/login", { redirect: "manual" });
  const csrf = (await page.text()).match(/name="_csrf_token" value="([^"]+)"/)?.[1];
  if (!csrf) throw new Error("jeton CSRF introuvable");
  const c0 = cookiesDe(page);
  const r = await fetch(BASE + "/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: c0 },
    body: new URLSearchParams({ _username: env.HAREL_USER, _password: env.HAREL_PASSWORD, _csrf_token: csrf }) });
  if ((r.headers.get("location") || "").includes("/login")) throw new Error("identifiants Hello Harel refusés");
  session = { cookie: cookiesDe(r) || c0, le: Date.now() };
}

async function hh(env, chemin, { method = "GET", headers = {}, body } = {}) {
  if (!session || Date.now() - session.le > 15 * 60_000) await connecter(env);
  const go = () => fetch(BASE + chemin, { method, redirect: "manual", headers: { Cookie: session.cookie, ...headers }, body });
  let r = await go();
  if (r.status === 302 && (r.headers.get("location") || "").includes("/login")) { await connecter(env); r = await go(); }
  return r;
}
const hhJson = async (env, chemin, opt = {}) => { const r = await hh(env, chemin, { ...opt, headers: { ...XHR, ...(opt.headers || {}) } });
  const t = await r.text(); if (!r.ok) throw new Error(`${chemin} → ${r.status}`);
  try { return JSON.parse(t); } catch { throw new Error(`${chemin} : réponse non JSON (${r.status}) ${t.replace(/\s+/g, " ").slice(0, 160)}`); } };


/* La page d'un inventaire embarque ses lignes en clair : « tableData: {"data":[…]} ». */
function extraireTable(html) {
  const i = html.indexOf("tableData:"); if (i < 0) return null;
  const d = html.indexOf("{", i); if (d < 0) return null;
  let prof = 0, chaine = false, esc = false;
  for (let k = d; k < html.length; k++) {
    const c = html[k];
    if (chaine) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') chaine = false; continue; }
    if (c === '"') chaine = true; else if (c === "{") prof++; else if (c === "}" && --prof === 0) { try { return JSON.parse(html.slice(d, k + 1)); } catch { return null; } }
  }
  return null;
}

const nomFour = s => String(s || "").replace(/^\s*[\w-]*\d[\w-]*\s+-\s+/, "").trim().toLowerCase();   // « 0007 - Patisfrais » → « patisfrais »
const dateIso = d => d?.date ? d.date.slice(0, 10) : "";

async function annulerSiBrouillon(env, id) {
  if (!Number.isInteger(id) || id <= 0) return "aucun";
  const page = (await (await hh(env, `/stock/inventory/${id}`)).text()).replace(/\\\//g, "/");
  if (!new RegExp(`/stock/inventory/${id}/cancel`).test(page)) return "déjà clos (non touché)";
  await hh(env, `/stock/inventory/${id}/cancel?confirm=1`);
  return "annulé";
}

async function idFournisseur(env, pid, nom) {
  const j = await hhJson(env, `/stock/stock_items.json?product=${pid}`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _table_pagination: { page: 1, count: 200, sort: "entryDate", order: "DESC" } }) });
  for (const x of j.data) if (nomFour(x.supplier) === nom) { const m = String(x.links?.supplier || "").match(/accounts\/(\d+)/); if (m) return Number(m[1]); }
  return null;
}

function valider(corps) {
  if (!corps || typeof corps !== "object") return "corps invalide";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corps.date || "")) return "date";
  if (!/^[A-Z0-9]{1,8}$/.test(corps.zone || "")) return "zone";
  if (!Array.isArray(corps.produits) || !corps.produits.length || corps.produits.length > MAX_PRODUITS) return "produits";
  for (const p of corps.produits) {
    if (!Number.isInteger(p.pid) || p.pid <= 0 || !Array.isArray(p.parts) || !p.parts.length || p.parts.length > 12) return "produit " + p.pid;
    for (const x of p.parts) if (!(Number.isFinite(x.q) && x.q >= 0 && x.q < 1e7) || typeof x.f !== "string" || x.f.length > 80) return "quantité " + p.pid;
  }
  return null;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== "POST") return rep(req, { ok: false, erreur: "POST seulement" }, 405);
    let corps; try { corps = await req.json(); } catch { return rep(req, { ok: false, erreur: "JSON invalide" }, 400); }
    if (corps.token !== env.APP_TOKEN) return rep(req, { ok: false, erreur: "jeton" }, 403);
    const mal = valider(corps); if (mal) return rep(req, { ok: false, erreur: "données refusées : " + mal }, 400);

    try {
      const bilan = { ancien: await annulerSiBrouillon(env, Number(corps.precedent)) };

      // 1. création du brouillon avec les produits remplis uniquement
      const pids = [...new Set(corps.produits.map(p => p.pid))];
      const cree = await hh(env, "/stock/inventory/create?reload=1", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ "inventory[setLocation]": "all", "inventory[setProducts]": "select", "inventory[products]": pids.join(",") }) });
      const id = Number((cree.headers.get("location") || "").match(/inventory\/(\d+)/)?.[1]);
      if (!id) throw new Error("création refusée (" + cree.status + ")");
      bilan.inventaire = id; bilan.url = `${BASE}/stock/inventory/${id}`;
      try {
        await hh(env, `/stock/inventory/${id}/start`);
        let page = "", tab = null;
        for (let essai = 0; essai < 20 && !tab; essai++) {   // HH génère les lignes : la page reste « démarrage » quelques secondes
          if (essai) await new Promise(r => setTimeout(r, 1500));
          page = await (await hh(env, `/stock/inventory/${id}`)).text(); tab = extraireTable(page);
        }
        const verrou = page.match(/ENV_LOCK_IDENTIFIER = '([^']+)'/)?.[1];
        if (!verrou) throw new Error("verrou introuvable");
        if (!tab) throw new Error(`page inventaire sans tableau (${page.length} octets) : ` + page.replace(/\s+/g, " ").slice(0, 300));
        const lignes = tab.data;

        // 2. répartition : le comptage d'un fournisseur va sur son stock le plus récent, ses autres stocks à 0
        const items = [], ignores = []; let modifiees = 0;
        const brut = l => ({ movement: l.id, product: l.product.id, handlingUnit: l.handlingUnit.id, location: l.location.id, supplier: l.supplier?.id ?? null,
          endValue: l.endValue, endQuantity: l.endQuantity, endPackagings: l.endPackagings, batchNumber: l.batchNumber || "", expirationDate: dateIso(l.expirationDate), comment: l.comment || "" });
        const parProduit = new Map(); for (const l of lignes) (parProduit.get(l.product.id) || parProduit.set(l.product.id, []).get(l.product.id)).push(l);
        const modifie = new Map();   // ligne.id → item modifié

        for (const p of corps.produits) {
          const L = parProduit.get(p.pid) || [];
          if (!L.length) { ignores.push({ pid: p.pid, motif: "aucune ligne de stock dans HH" }); continue; }
          const somme = new Map(); for (const x of p.parts) { const k = nomFour(x.f); somme.set(k, (somme.get(k) || 0) + x.q); }
          for (const [four, q] of somme) {
            let cible = L.filter(l => nomFour(l.supplier?.string) === four);
            if (!four && L.length) cible = L.filter(l => l.supplier?.id === L.slice().sort((a, b) => (b.stu?.origin || 0) - (a.stu?.origin || 0))[0].supplier?.id);
            const unite = (cible[0] || L[0]).handlingUnit;
            if (unite.factor !== 1) { ignores.push({ pid: p.pid, f: four, motif: "conditionnement HH ≠ unité de base (facteur " + unite.factor + ")" }); continue; }
            if (cible.length) {
              cible.sort((a, b) => (b.stu?.origin || 0) - (a.stu?.origin || 0));
              cible.forEach((l, i) => { const it = brut(l); const v = i === 0 ? q : 0; it.endQuantity = v; it.endPackagings = v; it.comment = `Appli MP ${corps.date} zone ${corps.zone}${corps.who ? " – " + corps.who : ""}`; modifie.set(l.id, it); });
            } else {
              const fid = await idFournisseur(env, p.pid, four);
              if (!fid) { ignores.push({ pid: p.pid, f: p.parts.find(x => nomFour(x.f) === four)?.f, motif: "fournisseur sans stock ni historique dans HH" }); continue; }
              const l0 = L[0];
              items.push({ movement: null, product: p.pid, handlingUnit: l0.handlingUnit.id, location: l0.location.id, supplier: fid, endValue: l0.lastPurchasePrice || 0,
                endQuantity: q, endPackagings: q, batchNumber: "", expirationDate: "", comment: `Appli MP ${corps.date} zone ${corps.zone} – fournisseur ajouté` });
            }
          }
        }
        for (const l of lignes) items.push(modifie.get(l.id) || brut(l));
        modifiees = modifie.size + items.filter(i => i.movement === null).length;

        // 3. écriture du brouillon (jamais de validation)
        const w = await hh(env, `/stock/inventory/${id}.json`, { method: "POST", headers: { ...XHR, "Content-Type": "application/json", "X-Lock-Identifier": verrou },
          body: JSON.stringify({ items, comment: `Appli inventaire MP – zone ${corps.zone} – ${corps.date}` }) });
        if (!w.ok) throw new Error("enregistrement refusé (" + w.status + ")");
        Object.assign(bilan, { produits: pids.length, lignesModifiees: modifiees, ignores });
        // verrou rendu pour que l'interface HH reste utilisable
        const q = new URLSearchParams({ resource: `Stock\\Inventory:${id}`, identifier: verrou, release_date: new Date().toLocaleString("sv-SE", { timeZone: "Europe/Paris" }), action: "release" });
        await hh(env, `/base/lock?${q}`, { method: "POST", headers: { "X-Requested-With": "XMLHttpRequest" } }).catch(() => {});
        if (corps.essai) { await hh(env, `/stock/inventory/${id}/cancel?confirm=1`); bilan.essai = "brouillon annulé après essai"; }
      } catch (e) {
        for (let k = 0; k < 3; k++) {   // pas de brouillon à moitié rempli (HH peut mettre un instant à accepter l'annulation)
          await new Promise(r => setTimeout(r, 1500)); await hh(env, `/stock/inventory/${id}/cancel?confirm=1`).catch(() => {});
          const p = (await (await hh(env, `/stock/inventory/${id}`).catch(() => null))?.text?.() || "").replace(/\\\//g, "/");
          if (!new RegExp(`/stock/inventory/${id}/cancel`).test(p)) break;
        }
        throw e;
      }
      return rep(req, { ok: true, ...bilan });
    } catch (e) {
      return rep(req, { ok: false, erreur: String(e.message || e) }, 502);
    }
  },
};
