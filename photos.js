/* Photos des produits — partagées par les deux onglets d'inventaire (même origine).
   - la photo est réduite sur le téléphone (480 px, JPEG) avant l'envoi : ~30 Ko ;
   - stockée sur le téléphone (IndexedDB) pour s'afficher sans réseau, et envoyée à la table n8n
     « Inventaire — photos des produits » pour apparaître sur les autres téléphones ;
   - un envoi raté est conservé et rejoué à la prochaine synchro. */
const Photos = (() => {
  const BASE = "https://n8n.srv994189.hstgr.cloud/webhook/", TOKEN = "6479e2122ab6";
  const mem = new Map();          // cle -> {image, maj}
  let db = null, attente = new Set(), onchange = () => {}, prete = null;

  const idb = () => new Promise(ok => {
    try {
      const r = indexedDB.open("photos-produits", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("p", {keyPath: "cle"}); r.result.createObjectStore("q", {keyPath: "cle"}); };
      r.onsuccess = () => ok(r.result); r.onerror = () => ok(null);
    } catch (e) { ok(null); }
  });
  const tx = (st, mode, fn) => new Promise(ok => { if (!db) return ok(null); try { const t = db.transaction(st, mode), s = t.objectStore(st), r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => ok(null); } catch (e) { ok(null); } });

  const hash = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };
  const cle = (pref, id) => pref === "mp" ? "mp:" + id : "c:" + hash(id);

  async function init(cb){
    if (cb) onchange = cb;
    if (prete) return prete;
    prete = (async () => {
      db = await idb();
      (await tx("p", "readonly", s => s.getAll()) || []).forEach(p => mem.set(p.cle, p));
      (await tx("q", "readonly", s => s.getAll()) || []).forEach(p => attente.add(p.cle));
      onchange(); await synchro();
    })();
    return prete;
  }
  async function synchro(){
    if (navigator.onLine === false) return;
    for (const k of [...attente]) { const p = mem.get(k); if (p && await envoyer(k, p)) { attente.delete(k); await tx("q", "readwrite", s => s.delete(k)); } }
    try {
      const depuis = [...mem.values()].reduce((m, p) => p.maj > m ? p.maj : m, "");
      const r = await (await fetch(BASE + "inventaire-photos-lire?token=" + TOKEN + "&depuis=" + encodeURIComponent(depuis))).json();
      let n = 0;
      for (const p of r.photos || []) { if (attente.has(p.cle)) continue; mem.set(p.cle, {cle: p.cle, image: p.image, maj: p.maj, par: p.par}); await tx("p", "readwrite", s => s.put(mem.get(p.cle))); n++; }
      if (n) onchange();
    } catch (e) {}
  }
  async function envoyer(k, p){
    try {
      const r = await (await fetch(BASE + "inventaire-photos-ecrire", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({token: TOKEN, cle: k, produit: p.produit || "", image: p.image, par: p.par || ""})})).json();
      return !!r.ok;
    } catch (e) { return false; }
  }
  function reduire(file){
    return new Promise((ok, ko) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u); ok(c.toDataURL("image/jpeg", 0.62)); };
      img.onerror = () => ko(new Error("image illisible")); img.src = u;
    });
  }
  function choisir(k, produit, qui, apres){
    const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.setAttribute("capture", "environment");
    i.onchange = async () => {
      const f = i.files && i.files[0]; if (!f) return;
      try {
        const image = await reduire(f), p = {cle: k, image, maj: new Date().toISOString(), par: qui || "", produit};
        mem.set(k, p); attente.add(k); await tx("p", "readwrite", s => s.put(p)); await tx("q", "readwrite", s => s.put({cle: k}));
        onchange(); if (apres) apres(); synchro();
      } catch (e) { alert("Photo non enregistrée : " + e.message); }
    };
    i.click();
  }
  const url = k => mem.get(k)?.image || "";
  const has = k => mem.has(k);
  const miniature = (k, extra = "") => has(k) ? `<img class="ph-th" data-phk="${k}" src="${url(k)}" alt="Photo du produit" ${extra}>` : "";

  /* visionneuse : toucher une miniature l'agrandit, avec « Remplacer » */
  function voir(k, produit, qui){
    let d = document.getElementById("ph-dlg");
    if (!d){ d = document.createElement("dialog"); d.id = "ph-dlg"; document.body.appendChild(d); }
    d.innerHTML = `<img src="${url(k)}" alt="Photo du produit"><div class="ph-b"><button id="ph-r">Remplacer la photo</button><button id="ph-f">Fermer</button></div>`;
    d.querySelector("#ph-f").onclick = () => d.close();
    d.querySelector("#ph-r").onclick = () => { d.close(); choisir(k, produit, qui); };
    d.showModal();
  }
  const st = document.createElement("style");
  st.textContent = `.ph-th{width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid #ccd1c6;flex:none;cursor:zoom-in;background:#fff}
  #ph-dlg{border:0;border-radius:10px;padding:10px;max-width:min(92vw,520px)}#ph-dlg::backdrop{background:rgba(18,33,29,.6)}#ph-dlg img{width:100%;height:auto;border-radius:6px;display:block}
  .ph-b{display:flex;gap:8px;margin-top:8px}.ph-b button{flex:1;min-height:44px;border:1px solid #ccd1c6;border-radius:6px;background:#fff;font:inherit;font-weight:600}
  .ph-btn{border:1px solid #ccd1c6;background:#fff;border-radius:99px;padding:5px 11px;font:inherit;font-size:12.5px;cursor:pointer}`;
  document.head.appendChild(st);
  setInterval(() => { if (document.visibilityState === "visible") synchro(); }, 60000);
  window.addEventListener("online", synchro);
  return {init, cle, url, has, miniature, choisir, voir, synchro};
})();
