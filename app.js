/* =========================================================================
   LE FACE-À-FACE — application
   ========================================================================= */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = FFM.esc;
  const app = () => $("#app");

  /* ---------------- état ---------------- */
  const DEF = {
    xp: 0, jour: null, streak: 0, dernier: null,
    scen: {},           // id -> {n, best, issue, date}
    dr: { riposte: { n: 0, best: 0, tot: 0 }, degraisser: { n: 0, tot: 0 }, demande: { n: 0, tot: 0 } },
    seance: {},         // aaaa-mm-jj -> {sc:bool, dr:bool}
    reg: { libre: true, chrono: false, durete: 2, auto: true },
    marqueurs: {},      // id de marqueur mou -> nb de fois attrapé
  };
  let S = load();
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem("faceaface") || "{}");
      const s = Object.assign({}, DEF, raw);
      s.dr = Object.assign({}, DEF.dr, raw.dr || {});
      s.reg = Object.assign({}, DEF.reg, raw.reg || {});
      return s;
    } catch (e) { return JSON.parse(JSON.stringify(DEF)); }
  }
  function save() { try { localStorage.setItem("faceaface", JSON.stringify(S)); } catch (e) {} }
  const today = () => new Date().toISOString().slice(0, 10);

  const RANGS = [
    [0, "Ça se voit"], [80, "Ça tremble moins"], [200, "Tenue correcte"],
    [400, "Solide"], [700, "Difficile à bouger"], [1100, "Imperturbable 🗿"],
  ];
  function rang(xp) {
    let r = RANGS[0], next = null;
    for (let i = 0; i < RANGS.length; i++) if (xp >= RANGS[i][0]) { r = RANGS[i]; next = RANGS[i + 1] || null; }
    return { nom: r[1], sol: r[0], next };
  }
  function xp(n) {
    const t = today();
    if (S.dernier !== t) {
      const hier = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      S.streak = S.dernier === hier ? (S.streak || 0) + 1 : 1;
      S.dernier = t;
    }
    S.xp += n; save(); paintHeader();
  }
  function paintHeader() {
    const r = rang(S.xp);
    $("#rankName").textContent = r.nom;
    $("#xpNum").textContent = S.xp + " xp";
    const span = r.next ? r.next[0] - r.sol : 1;
    $("#xpBar").style.width = Math.round(Math.min(100, ((S.xp - r.sol) / span) * 100)) + "%";
  }
  function marquerSeance(quoi) {
    const t = today();
    S.seance[t] = Object.assign({ sc: false, dr: false }, S.seance[t] || {});
    S.seance[t][quoi] = true; save();
  }

  /* ---------------- helpers d'affichage ---------------- */
  const SC = () => window.SCEN;
  const scById = (id) => SC().find((s) => s.id === id);
  const FAM = { argent: ["💰", "Argent"], pro: ["🏢", "Travail"], conflit: ["⚡", "Conflit"], limite: ["🚧", "Limites"], perso: ["🫀", "À découvert"] };
  function nivDots(n) { return '<span class="niv">' + [1, 2, 3].map((i) => '<i class="' + (i <= n ? "on" : "") + '"></i>').join("") + "</span>"; }
  function dit(t) {
    if (typeof t === "string") return t;
    const d = S.reg.durete;
    return t[d] || t[2] || t[1] || t[3] || "";
  }
  function scrollBas() { setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), 60); }

  /* =======================================================================
     PARTIE — le moteur de scène
     ======================================================================= */
  let P = null;
  let chrono = null;

  function jouer(id) {
    const sc = scById(id);
    if (!sc) return;
    P = { sc, i: 0, j: Object.assign({}, sc.jauges), hist: [], fil: [], qTot: 0, qMax: 0, attente: false, fini: false, mous: [] };
    ouvrirTour();
    vue = "partie"; render();
  }
  function ouvrirTour() {
    const t = P.sc.tours[P.i];
    if (t.didasc) P.fil.push({ k: "didasc", t: t.didasc });
    P.fil.push({ k: "said", qui: t.qui, t: dit(t.dit) });
  }
  function jouerOption(k, txtLibre, analyse) {
    const t = P.sc.tours[P.i], o = t.opts[k];
    const av = P.j;
    P.j = FFM.appliquer(P.j, o);
    P.qTot += o.q; P.qMax += 3;
    P.fil.push({ k: "mine", t: txtLibre ? txtLibre : o.t.replace(/^«\s*|\s*»$/g, "") });
    if (o.rep) P.fil.push({ k: "reac", t: o.rep });
    P.hist.push({ tour: P.i, opt: k, o, libre: txtLibre || null, analyse: analyse || null, tac: t.tac || null, modele: t.modele, d: { pos: P.j.pos - av.pos, lien: P.j.lien - av.lien, tenue: P.j.tenue - av.tenue } });
    if (analyse) analyse.faibles.forEach((f) => { S.marqueurs[f.id] = (S.marqueurs[f.id] || 0) + 1; });
    P.i++;
    if (P.i >= P.sc.tours.length) { finir(); } else { ouvrirTour(); }
    save(); render(); scrollBas();
  }
  function finir() {
    P.fini = true;
    const v = FFM.verdict(P.sc, P.j, P.qTot, P.qMax);
    P.v = v;
    const rec = S.scen[P.sc.id] || { n: 0, best: 0 };
    rec.n++; rec.best = Math.max(rec.best || 0, v.note); rec.issue = v.issue; rec.date = today();
    S.scen[P.sc.id] = rec;
    xp(Math.round(v.note / 3) + (v.issue === "gagne" ? 15 : 5));
    marquerSeance("sc");
    if (S.reg.auto && v.note >= 82 && S.reg.durete < 3) S.reg.durete++;
    if (S.reg.auto && v.note < 45 && S.reg.durete > 1) S.reg.durete--;
    save();
  }

  function vuePartie() {
    const sc = P.sc, t = P.sc.tours[P.i];
    let h = "";
    // jauges
    h += '<div id="gauges"><div class="g-row">' +
      jauge("pos", "🎯 Position", P.j.pos) + jauge("lien", "🤝 Lien", P.j.lien) + jauge("tenue", "🪨 Tenue", P.j.tenue) +
      "</div></div>";
    if (P.fini) return h + debrief();
    h += '<div id="fil">' + P.fil.map(beat).join("") + "</div>";
    // zone de jeu
    if (P.attente) {
      const a = P.attente, o = P.sc.tours[P.i].opts[a.k];
      h += '<div class="card"><div class="lbl">Ce que l\'app a lu dans ta réponse</div>' + analyseHTML(a.an);
      h += a.reconnu
        ? '<div class="hint"><b>Direction jouée : ' + esc(o.tag) + '.</b> C\'est de cette réplique que l\'autre va tenir compte.</div>'
        : '<div class="an-item ko"><span class="ic">🌫️</span><div><b>Aucune direction reconnue</b><span class="why">Ta réplique ne prend parti sur rien de saillant : l\'app joue donc la version tiède. Dans la vraie vie, c\'est exactement ce qui arrive — l\'autre entend une hésitation et continue son chemin.</span></div></div>';
      h += '<div class="hint"><b>La réplique modèle :</b><br>' + esc(a.modele) + "</div>" +
        '<button class="btn primary big" data-suite="1">Continuer →</button></div>';
      return h;
    }
    const libre = S.reg.libre;
    h += '<div class="card">';
    h += '<div class="row" style="margin-bottom:10px"><div class="lbl" style="margin:0">' + (libre ? "À toi" : "Ta réplique") + '</div><div style="flex:1"></div>' +
      '<button class="btn sm ghost" data-mode="1">' + (libre ? "🎭 Options" : "✍️ À découvert") + "</button></div>";
    if (libre) {
      h += '<div id="libre"><textarea id="rep" placeholder="Ce que tu dirais, mot pour mot…"></textarea>' +
        '<div class="row" style="margin-top:9px"><span class="chrono" id="chr"></span><div style="flex:1"></div>' +
        '<button class="btn primary" data-envoi="1">Envoyer</button></div></div>';
    } else {
      h += '<div class="opts">' + t.opts.map((o, k) =>
        '<button class="opt" data-opt="' + k + '"><span class="oi">' + "ABCD"[k] + "</span>" + esc(o.t) + "</button>").join("") + "</div>";
    }
    h += "</div>";
    h += '<div class="btnrow"><button class="btn sm ghost" data-brief="1">📋 Revoir le contexte</button><button class="btn sm ghost" data-quit="1">Abandonner</button></div>';
    return h;
  }
  function jauge(cl, n, v) {
    return '<div class="g ' + cl + '"><div class="g-top"><span class="g-n">' + n + '</span><span class="g-v">' + Math.round(v) + "</span></div>" +
      '<div class="g-track"><i class="g-fill" style="width:' + Math.round(v) + '%"></i></div></div>';
  }
  function beat(b) {
    if (b.k === "didasc") return '<div class="beat didasc">' + esc(b.t) + "</div>";
    if (b.k === "said") return '<div class="beat said"><div class="who">' + esc(b.qui) + "</div><p>" + esc(b.t) + "</p></div>";
    if (b.k === "mine") return '<div class="beat mine"><div class="who">Toi</div><p>' + esc(b.t) + "</p></div>";
    return '<div class="beat reac">' + esc(b.t) + "</div>";
  }
  function analyseHTML(an) {
    let h = '<div class="row" style="gap:14px; margin-bottom:10px"><div><div class="score-big">' + an.note + '</div><div class="muted">sur 100 · langage</div></div>' +
      '<div class="muted" style="flex:1">' + an.mots + " mots. " +
      (an.forts.length ? an.forts.length + " appui" + (an.forts.length > 1 ? "s" : "") : "aucun appui") + ", " +
      (an.faibles.length ? an.faibles.length + " fuite" + (an.faibles.length > 1 ? "s" : "") : "aucune fuite") + ".</div></div>";
    h += '<div class="an">';
    an.trouves.slice(0, 7).forEach((f) => {
      h += '<div class="an-item ' + (f.ok ? "ok" : "ko") + '"><span class="ic">' + (f.ok ? "✓" : "✗") + "</span><div><b>" +
        esc((f.ok ? "" : "") + f.quoi + (f.n > 1 ? " ×" + f.n : "")) + '</b><span class="why">' + esc(f.dit) + "</span></div></div>";
    });
    if (!an.trouves.length) h += '<div class="an-item ko"><span class="ic">–</span><div><b>Rien de saillant</b><span class="why">Ni appui, ni fuite : une réplique tiède. Ce n\'est pas neutre — c\'est invisible.</span></div></div>';
    h += "</div>";
    return h;
  }

  function debrief() {
    const sc = P.sc, v = P.v, I = FFM.ISSUES[v.issue];
    let h = '<div class="card verdict"><span class="e">' + I.e + '</span><div class="t">' + esc(I.t) + '</div><div class="d">' + esc(I.d) + "</div>" +
      '<div style="margin-top:14px"><span class="score-big">' + v.note + '</span><span class="muted"> / 100</span></div>';
    const rec = S.scen[sc.id];
    if (rec && rec.best > v.note) h += '<div class="muted" style="margin-top:4px">Ton record sur ce scénario : ' + rec.best + "</div>";
    else if (rec && rec.n > 1) h += '<div class="muted" style="margin-top:4px">Nouveau record 🔥</div>';
    h += "</div>";

    h += '<div class="card"><div class="lbl">Tour par tour</div>';
    P.hist.forEach((x, i) => {
      const o = x.o;
      h += '<div class="tour-rev"><div class="row"><span class="tq q' + o.q + '">' + ["✗ raté", "· faible", "· correct", "✓ juste"][o.q] + " — " + esc(o.tag) + "</span></div>";
      h += '<div class="played">' + (x.libre ? "« " + esc(x.libre) + " »" : esc(o.t)) + "</div>";
      h += '<div class="why">' + esc(o.why) + "</div>";
      if (x.tac) h += '<div class="why"><b style="color:var(--amb)">En face — ' + esc(x.tac.n) + " :</b> " + esc(x.tac.q) + "</div>";
      if (o.q < 3 && x.modele) h += '<div class="best">La réplique modèle : ' + esc(x.modele) + "</div>";
      h += "</div>";
    });
    h += "</div>";

    // marqueurs de langage récurrents sur cette partie
    const mous = {};
    P.hist.forEach((x) => { if (x.analyse) x.analyse.faibles.forEach((f) => { mous[f.id] = mous[f.id] || { n: 0, q: f.quoi, d: f.dit }; mous[f.id].n++; }); });
    const cles = Object.keys(mous);
    if (cles.length) {
      h += '<div class="card"><div class="lbl">Ce que ton langage a trahi</div>';
      cles.sort((a, b) => mous[b].n - mous[a].n).slice(0, 4).forEach((k) => {
        h += '<div class="an-item ko"><span class="ic">✗</span><div><b>' + esc(mous[k].q) + " × " + mous[k].n + '</b><span class="why">' + esc(mous[k].d) + "</span></div></div>";
      });
      h += "</div>";
    }

    h += '<div class="card"><div class="lbl">La leçon</div><div style="font-size:14px; line-height:1.6">' + esc(sc.lecon) + "</div></div>";
    h += '<div class="btnrow"><button class="btn primary big" data-rejouer="' + esc(sc.id) + '">Rejouer (dureté ' + S.reg.durete + "/3)</button></div>";
    h += '<div class="btnrow"><button class="btn big" data-quit="1">Retour aux scénarios</button></div>';
    return h;
  }

  function briefHTML(sc) {
    let h = '<div class="card"><div class="lbl">La situation</div><div style="font-size:14.5px; line-height:1.55; margin-bottom:12px">' + esc(sc.pitch) + "</div>";
    h += '<div class="hint"><b>En face :</b> ' + esc(sc.brief.qui) + "</div>";
    h += '<div class="hint"><b>Ce que l\'autre veut :</b> ' + esc(sc.brief.elleVeut) + "</div>";
    h += '<div class="hint"><b>Ce que tu veux :</b> ' + esc(sc.brief.tuVeux) + "</div>";
    h += '<div class="lbl" style="margin-top:12px">Ce que tu sais</div><ul style="margin:0 0 4px; padding-left:18px; color:var(--mut); font-size:13px; line-height:1.65">' +
      sc.brief.sais.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";
    h += '<div class="an-item ko" style="margin-top:12px"><span class="ic">⚠️</span><div><b>Le piège, pour toi</b><span class="why">' + esc(sc.brief.piege) + "</span></div></div>";
    h += "</div>";
    return h;
  }

  /* =======================================================================
     VUES
     ======================================================================= */
  let vue = "today", filtre = "tous", scenOuvert = null, drill = null;

  function vueToday() {
    const t = today(), s = S.seance[t] || {};
    const sc = scenoDuJour();
    let h = '<h1>Aujourd\'hui</h1><div class="v-sub">Une conversation difficile par jour. C\'est tout ce qu\'il faut pour que ça devienne normal.</div>';
    h += '<div class="card"><div class="row"><div><div class="streakbig">' + (S.streak || 0) + ' <span style="font-size:15px">jour' + ((S.streak || 0) > 1 ? "s" : "") + " d'affilée</span></div>" +
      '<div class="muted">' + (function () { const n = Object.keys(S.scen).reduce((a, k) => a + (S.scen[k].n || 0), 0); return n + " confrontation" + (n > 1 ? "s jouées" : " jouée"); })() + " · dureté " + S.reg.durete + "/3</div></div></div></div>";

    h += '<div class="card' + (s.sc ? " fait" : "") + '"><div class="lbl">' + (s.sc ? "<span style=\"color:var(--grn)\">✓ séance faite</span> · une scène de plus ?" : "1 · La scène du jour") + "</div>" +
      '<div class="row"><span style="font-size:26px">' + sc.emoji + '</span><div style="flex:1"><div style="font-weight:700; font-size:15px">' + esc(sc.titre) + "</div>" +
      '<div class="muted">' + esc(sc.pitch) + "</div></div></div>" +
      '<button class="btn primary big" style="margin-top:12px" data-go="' + esc(sc.id) + '">' + (s.sc ? "Rejouer" : "Entrer dans la scène") + "</button></div>";

    h += '<div class="card' + (s.dr ? " fait" : "") + '"><div class="lbl">' + (s.dr ? "<span style=\"color:var(--grn)\">✓ drill fait</span> · une série de plus ?" : "2 · Le drill (2 minutes)") + "</div>" +
      '<div class="muted" style="margin-bottom:10px">Une pique arrive. Tu as quelques secondes pour répondre — comme dans la vraie vie.</div>' +
      '<button class="btn cool big" data-drill="riposte">⚡ La riposte · 5 attaques</button></div>';

    const faible = pireMarqueur();
    if (faible) {
      h += '<div class="card"><div class="lbl">Ton tic de langage</div><div class="an-item ko"><span class="ic">✗</span><div><b>' + esc(faible.q) + " · " + faible.n + " fois</b><span class=\"why\">" + esc(faible.d) + "</span></div></div>" +
        '<button class="btn big" data-drill="degraisser" style="margin-top:4px">🧽 Dégraisser une phrase</button></div>';
    }
    return h;
  }
  function scenoDuJour() {
    const t = today();
    const rest = SC().filter((s) => !S.scen[s.id]);
    if (rest.length) {
      let seed = 0; for (let i = 0; i < t.length; i++) seed += t.charCodeAt(i);
      return rest[seed % rest.length];
    }
    // sinon : le plus faible score, à rejouer
    return SC().slice().sort((a, b) => (S.scen[a.id].best || 0) - (S.scen[b.id].best || 0))[0];
  }
  function pireMarqueur() {
    const ks = Object.keys(S.marqueurs || {});
    if (!ks.length) return null;
    ks.sort((a, b) => S.marqueurs[b] - S.marqueurs[a]);
    const def = FFM.MOU.find((m) => m.id === ks[0]);
    if (!def || S.marqueurs[ks[0]] < 2) return null;
    return { q: def.quoi, d: def.dit, n: S.marqueurs[ks[0]] };
  }

  function vueScen() {
    if (scenOuvert) {
      const sc = scById(scenOuvert);
      let h = '<div class="btnrow" style="margin:14px 0 4px"><button class="btn sm ghost" data-back="1">← Tous les scénarios</button></div>';
      h += "<h1>" + sc.emoji + " " + esc(sc.titre) + '</h1><div class="v-sub">' + FAM[sc.fam][1] + " · niveau " + sc.niv + "/3 · ~" + sc.min + " min</div>";
      h += briefHTML(sc);
      const rec = S.scen[sc.id];
      if (rec) h += '<div class="card tight"><div class="stat"><span>Parties jouées</span><b>' + rec.n + '</b></div><div class="stat"><span>Meilleur score</span><b>' + rec.best + "/100</b></div></div>";
      h += '<div class="card tight"><div class="toggle"><div><div class="tt">' + (S.reg.libre ? "✍️ Mode à découvert" : "🎭 Mode options") + '</div><div class="td">' +
        (S.reg.libre ? "Tu écris tes répliques. L'app lit ce que tu écris." : "Tu choisis parmi 3-4 répliques. Plus doux pour commencer.") + '</div></div><div class="sw ' + (S.reg.libre ? "on" : "") + '" data-t="libre"><i></i></div></div></div>';
      h += '<button class="btn primary big" data-go="' + esc(sc.id) + '">Entrer dans la scène</button>';
      return h;
    }
    let h = '<h1>Les scènes</h1><div class="v-sub">Quatorze situations que tu vas vivre pour de vrai. Autant les rater ici d\'abord.</div>';
    h += '<div class="filters"><button class="btn sm ' + (filtre === "tous" ? "on" : "ghost") + '" data-f="tous">Tout</button>' +
      Object.keys(FAM).map((f) => '<button class="btn sm ' + (filtre === f ? "on" : "ghost") + '" data-f="' + f + '">' + FAM[f][0] + " " + FAM[f][1] + "</button>").join("") + "</div>";
    SC().filter((s) => filtre === "tous" || s.fam === filtre).forEach((s) => {
      const rec = S.scen[s.id];
      h += '<button class="item" data-open="' + esc(s.id) + '"><span class="em">' + s.emoji + '</span><div style="flex:1"><div class="ti">' + esc(s.titre) + '</div><div class="de">' + esc(s.pitch) + "</div>" +
        '<div class="meta">' + nivDots(s.niv) + '<span class="pill">' + FAM[s.fam][1] + "</span>" +
        (rec ? '<span class="pill ' + (rec.best >= 78 ? "grn" : rec.best >= 55 ? "amb" : "hot") + '">record ' + rec.best + "</span>" : '<span class="pill cool">jamais jouée</span>') +
        "</div></div></button>";
    });
    return h;
  }

  /* ---------------- drills ---------------- */
  function vueDrills() {
    if (drill) return drillHTML();
    let h = '<h1>Les drills</h1><div class="v-sub">Trois minutes. Le muscle, pas la théorie.</div>';
    h += '<button class="item" data-drill="riposte"><span class="em">⚡</span><div style="flex:1"><div class="ti">La riposte</div><div class="de">Une pique arrive. Tu as quelques secondes pour répondre sans t\'effondrer ni exploser.</div>' +
      '<div class="meta"><span class="pill hot">chrono</span><span class="pill">' + (S.dr.riposte.n || 0) + ' faites</span>' + (S.dr.riposte.best ? '<span class="pill amb">record ' + S.dr.riposte.best + "</span>" : "") + "</div></div></button>";
    h += '<button class="item" data-drill="degraisser"><span class="em">🧽</span><div style="flex:1"><div class="ti">Dégraisser</div><div class="de">Une phrase molle. Tu la réécris sans coton : ni excuse, ni « un peu », ni permission mendiée.</div>' +
      '<div class="meta"><span class="pill">' + (S.dr.degraisser.n || 0) + " faites</span></div></div></button>";
    h += '<button class="item" data-drill="demande"><span class="em">🎯</span><div style="flex:1"><div class="ti">La demande</div><div class="de">Une situation. Tu formules la demande en une phrase : un verbe, un chiffre, une date.</div>' +
      '<div class="meta"><span class="pill">' + (S.dr.demande.n || 0) + " faites</span></div></div></button>";
    return h;
  }
  function lancerDrill(type) {
    const src = type === "riposte" ? window.RIPOSTES : type === "degraisser" ? window.DEGRAISSER : window.DEMANDES;
    const items = src.slice().sort(() => Math.random() - 0.5).slice(0, 5);
    drill = { type, items, i: 0, notes: [], rep: null, an: null };
    vue = "drills"; render();
  }
  function drillHTML() {
    const d = drill, it = d.items[d.i];
    if (d.i >= d.items.length) {
      const moy = Math.round(d.notes.reduce((a, b) => a + b, 0) / d.notes.length);
      let h = '<div class="card verdict"><span class="e">' + (moy >= 70 ? "🗿" : moy >= 50 ? "💪" : "🌫️") + '</span><div class="t">' + moy + " / 100</div>" +
        '<div class="d">' + (moy >= 70 ? "Langage tenu. Rien à rattraper." : moy >= 50 ? "Ça tient, mais il reste du coton." : "Trop d'adoucisseurs. Reprends la même série.") + "</div></div>";
      h += '<div class="btnrow"><button class="btn primary big" data-drill="' + d.type + '">Nouvelle série</button></div>' +
        '<div class="btnrow"><button class="btn big" data-dquit="1">Retour</button></div>';
      return h;
    }
    let h = '<div class="row" style="margin:14px 0 10px"><button class="btn sm ghost" data-dquit="1">← Quitter</button><div style="flex:1"></div><span class="muted">' + (d.i + 1) + " / " + d.items.length + "</span></div>";
    if (d.type === "riposte") {
      h += '<div class="card"><div class="lbl">' + esc(it.ctx) + '</div><div class="said" style="border-left-color:var(--hot)"><div class="who">En face</div><p>' + esc(it.p) + "</p></div></div>";
    } else if (d.type === "degraisser") {
      h += '<div class="card"><div class="lbl">La phrase molle</div><div class="said" style="border-left-color:var(--dim)"><p>' + esc(it.mou) + "</p></div>" +
        '<div class="hint"><b>Ce qu\'il faut obtenir :</b> ' + esc(it.cible) + "</div></div>";
    } else {
      h += '<div class="card"><div class="lbl">La situation</div><div style="font-size:15px; line-height:1.5">' + esc(it.s) + "</div>" +
        '<div class="hint"><b>Ta phrase doit contenir :</b> ' + it.doit.map(esc).join(" · ") + "</div></div>";
    }
    if (d.an) {
      h += '<div class="card"><div class="mine" style="max-width:100%; margin-bottom:12px"><div class="who">Ta réponse</div><p>' + esc(d.rep) + "</p></div>" +
        analyseHTML(d.an) +
        '<div class="hint"><b>' + (d.type === "riposte" ? "La parade : " + esc(it.parade) : "Une version qui tient") + "</b><br>" + esc(it.mod) + "</div>" +
        '<button class="btn primary big" data-dnext="1">Suivante →</button></div>';
    } else {
      h += '<div class="card"><div id="libre"><textarea id="rep" placeholder="' + (d.type === "riposte" ? "Ta réponse, tout de suite…" : "Réécris-la…") + '"></textarea>' +
        '<div class="row" style="margin-top:9px"><span class="chrono" id="chr"></span><div style="flex:1"></div><button class="btn primary" data-dsend="1">Valider</button></div></div></div>';
    }
    return h;
  }

  /* ---------------- répertoire ---------------- */
  let fCat = "tous";
  function vueFiches() {
    const cats = ["tous"].concat(Array.from(new Set(window.FICHES.map((f) => f.cat))));
    let h = '<h1>Le répertoire</h1><div class="v-sub">Vingt gestes. Aucun ne demande du charisme — seulement d\'accepter quelques secondes d\'inconfort.</div>';
    h += '<div class="filters">' + cats.map((c) => '<button class="btn sm ' + (fCat === c ? "on" : "ghost") + '" data-fc="' + esc(c) + '">' + (c === "tous" ? "Tout" : esc(c)) + "</button>").join("") + "</div>";
    window.FICHES.filter((f) => fCat === "tous" || f.cat === fCat).forEach((f) => {
      h += '<details class="fiche"><summary>' + esc(f.n) + '<span class="pill cat">' + esc(f.cat) + '</span></summary><div class="body">' +
        "<b>Pourquoi ça marche.</b> " + esc(f.q) + "<br><br><b>Comment.</b> " + esc(f.faire) +
        '<div class="ex">✓ ' + esc(f.ex) + '</div><div class="pas">✗ ' + esc(f.pas) + "</div>" +
        '<div class="muted" style="margin-top:9px">Scènes : ' + esc(f.ou) + "</div></div></details>";
    });
    return h;
  }

  /* ---------------- profil ---------------- */
  function vueProfil() {
    const r = rang(S.xp);
    const joues = Object.keys(S.scen).length, parties = Object.keys(S.scen).reduce((a, k) => a + S.scen[k].n, 0);
    const moy = joues ? Math.round(Object.keys(S.scen).reduce((a, k) => a + S.scen[k].best, 0) / joues) : 0;
    let h = '<h1>Toi</h1><div class="v-sub">' + esc(r.nom) + " · " + S.xp + " xp</div>";
    h += '<div class="card"><div class="stat"><span>Scènes découvertes</span><b>' + joues + " / " + SC().length + '</b></div>' +
      '<div class="stat"><span>Confrontations jouées</span><b>' + parties + '</b></div>' +
      '<div class="stat"><span>Score moyen (records)</span><b>' + moy + '/100</b></div>' +
      '<div class="stat"><span>Jours d\'affilée</span><b>' + (S.streak || 0) + '</b></div>' +
      '<div class="stat"><span>Ripostes / dégraissages / demandes</span><b>' + (S.dr.riposte.n || 0) + " · " + (S.dr.degraisser.n || 0) + " · " + (S.dr.demande.n || 0) + "</b></div></div>";

    const ks = Object.keys(S.marqueurs || {}).sort((a, b) => S.marqueurs[b] - S.marqueurs[a]);
    if (ks.length) {
      h += '<div class="card"><div class="lbl">Tes fuites de langage, comptées</div>';
      ks.slice(0, 5).forEach((k) => {
        const def = FFM.MOU.find((m) => m.id === k);
        if (def) h += '<div class="stat"><span>' + esc(def.quoi) + "</span><b>" + S.marqueurs[k] + "</b></div>";
      });
      h += "</div>";
    }

    h += '<div class="card"><div class="lbl">Réglages</div>' +
      '<div class="toggle"><div><div class="tt">Mode à découvert</div><div class="td">Tu écris tes répliques au lieu de choisir. C\'est là que ça sert vraiment.</div></div><div class="sw ' + (S.reg.libre ? "on" : "") + '" data-t="libre"><i></i></div></div>' +
      '<div class="toggle"><div><div class="tt">Chrono</div><div class="td">25 secondes pour répondre. Parce que dans la vraie vie, personne n\'attend que tu trouves la phrase parfaite.</div></div><div class="sw ' + (S.reg.chrono ? "on" : "") + '" data-t="chrono"><i></i></div></div>' +
      '<div class="toggle"><div><div class="tt">Dureté adaptative</div><div class="td">L\'app monte la dureté quand tu réussis, la baisse quand tu prends cher.</div></div><div class="sw ' + (S.reg.auto ? "on" : "") + '" data-t="auto"><i></i></div></div>' +
      '<div class="lbl" style="margin-top:14px">Dureté de l\'interlocuteur</div><div class="seg">' +
      [1, 2, 3].map((n) => '<button class="' + (S.reg.durete === n ? "on" : "") + '" data-dur="' + n + '">' + ["Cordial", "Normal", "Rude"][n - 1] + "</button>").join("") + "</div></div>";

    h += '<div class="card"><div class="lbl">Comment on note</div><div class="muted" style="line-height:1.65">' +
      "<b>🎯 Position</b> : ce que tu obtiens.<br><b>🤝 Lien</b> : l'état de la relation en sortant.<br><b>🪨 Tenue</b> : est-ce que tu es resté debout.<br><br>" +
      "Maximiser une seule jauge n'est pas gagner : écraser l'autre (Position sans Lien) et se faire aimer les mains vides (Lien sans Position) comptent tous les deux comme des échecs.</div></div>";

    h += '<div class="btnrow"><button class="btn ghost sm" data-reset="1">Tout effacer</button></div>';
    return h;
  }

  /* =======================================================================
     RENDU + ÉVÉNEMENTS
     ======================================================================= */
  const TABS = [["today", "🎬", "Aujourd'hui"], ["scen", "🎭", "Scènes"], ["drills", "⚡", "Drills"], ["fiches", "📓", "Répertoire"], ["profil", "👤", "Toi"]];

  function render() {
    if (chrono) { clearInterval(chrono); chrono = null; }
    let h = "";
    if (vue === "partie" && P) h = vuePartie();
    else if (vue === "today") h = vueToday();
    else if (vue === "scen") h = vueScen();
    else if (vue === "drills") h = vueDrills();
    else if (vue === "fiches") h = vueFiches();
    else h = vueProfil();
    app().innerHTML = h;
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === (vue === "partie" ? "scen" : vue)));
    wire();
    paintHeader();
  }

  function lanceChrono(sec, onEnd) {
    const el = $("#chr"); if (!el) return;
    let n = sec;
    el.textContent = "⏱ " + n + " s";
    chrono = setInterval(() => {
      n--;
      if (!$("#chr")) { clearInterval(chrono); chrono = null; return; }
      $("#chr").textContent = "⏱ " + n + " s";
      $("#chr").classList.toggle("warn", n <= 8);
      if (n <= 0) { clearInterval(chrono); chrono = null; onEnd(); }
    }, 1000);
  }

  function wire() {
    $$("[data-tab]").forEach((b) => b.onclick = () => { vue = b.dataset.tab; scenOuvert = null; drill = null; if (vue !== "partie") P = P && P.fini ? null : P; window.scrollTo(0, 0); render(); });
    $$("[data-f]").forEach((b) => b.onclick = () => { filtre = b.dataset.f; render(); });
    $$("[data-fc]").forEach((b) => b.onclick = () => { fCat = b.dataset.fc; render(); });
    $$("[data-open]").forEach((b) => b.onclick = () => { scenOuvert = b.dataset.open; vue = "scen"; window.scrollTo(0, 0); render(); });
    $$("[data-back]").forEach((b) => b.onclick = () => { scenOuvert = null; render(); });
    $$("[data-go]").forEach((b) => b.onclick = () => { jouer(b.dataset.go); window.scrollTo(0, 0); });
    $$("[data-rejouer]").forEach((b) => b.onclick = () => { jouer(b.dataset.rejouer); window.scrollTo(0, 0); });
    $$("[data-quit]").forEach((b) => b.onclick = () => { P = null; scenOuvert = null; vue = "scen"; window.scrollTo(0, 0); render(); });
    $$("[data-opt]").forEach((b) => b.onclick = () => jouerOption(+b.dataset.opt, null, null));
    $$("[data-mode]").forEach((b) => b.onclick = () => { S.reg.libre = !S.reg.libre; save(); render(); });
    $$("[data-suite]").forEach((b) => b.onclick = () => {
      const a = P.attente; P.attente = null;
      jouerOption(a.k, a.txt, a.an);
    });
    $$("[data-brief]").forEach((b) => b.onclick = () => {
      const d = document.createElement("div"); d.innerHTML = briefHTML(P.sc);
      b.parentNode.parentNode.insertBefore(d, b.parentNode); b.parentNode.remove();
    });
    const envoi = $("[data-envoi]");
    if (envoi) {
      const go = (fini) => {
        const txt = ($("#rep") && $("#rep").value || "").trim();
        const t = P.sc.tours[P.i];
        if (!txt) {
          if (fini !== true) { const z = $("#rep"); if (z) { z.focus(); z.placeholder = "Écris quelque chose — même maladroit. Le vide, c'est déjà une réponse : la pire."; } return; }
          const d = t.opts.findIndex((o) => o.def);
          P.attente = { k: d >= 0 ? d : t.opts.length - 1, txt: "(temps écoulé — tu n'as rien dit)", an: FFM.analyser(""), modele: t.modele, reconnu: false };
          render(); scrollBas(); return;
        }
        const an = FFM.analyser(txt);
        const r = FFM.router(txt, t.opts);
        P.attente = { k: r.i, txt, an, modele: t.modele, reconnu: r.reconnu };
        render(); scrollBas();
      };
      envoi.onclick = () => go(false);
      if (S.reg.chrono) lanceChrono(30, () => go(true));
      const ta = $("#rep"); if (ta) ta.focus();
    }
    // drills
    $$("[data-drill]").forEach((b) => b.onclick = () => lancerDrill(b.dataset.drill));
    $$("[data-dquit]").forEach((b) => b.onclick = () => { drill = null; render(); });
    $$("[data-dnext]").forEach((b) => b.onclick = () => { drill.i++; drill.rep = null; drill.an = null; window.scrollTo(0, 0); render(); });
    const dsend = $("[data-dsend]");
    if (dsend) {
      const go = (fini) => {
        let txt = ($("#rep") && $("#rep").value || "").trim();
        if (!txt) {
          if (fini !== true) { const z = $("#rep"); if (z) { z.focus(); z.placeholder = "Même une réponse ratée vaut mieux que le blanc. Écris."; } return; }
          txt = "(temps écoulé — tu t'es figé)";
        }
        const an = FFM.analyser(txt === "(temps écoulé — tu t'es figé)" ? "" : txt);
        drill.rep = txt; drill.an = an; drill.notes.push(an.note);
        an.faibles.forEach((f) => { S.marqueurs[f.id] = (S.marqueurs[f.id] || 0) + 1; });
        const d = S.dr[drill.type]; d.n = (d.n || 0) + 1; d.tot = (d.tot || 0) + an.note;
        if (drill.i === drill.items.length - 1) {
          const moy = Math.round(drill.notes.reduce((a, b) => a + b, 0) / drill.notes.length);
          if (drill.type === "riposte") S.dr.riposte.best = Math.max(S.dr.riposte.best || 0, moy);
          marquerSeance("dr"); xp(8);
        }
        save(); render(); scrollBas();
      };
      dsend.onclick = () => go(false);
      if (S.reg.chrono && drill.type === "riposte") lanceChrono(25, () => go(true));
      const ta = $("#rep"); if (ta) ta.focus();
    }
    // réglages
    $$("[data-t]").forEach((b) => b.onclick = () => { S.reg[b.dataset.t] = !S.reg[b.dataset.t]; save(); render(); });
    $$("[data-dur]").forEach((b) => b.onclick = () => { S.reg.durete = +b.dataset.dur; save(); render(); });
    $$("[data-reset]").forEach((b) => b.onclick = () => {
      if (confirm("Effacer toute ta progression sur LE FACE-À-FACE ?")) { S = JSON.parse(JSON.stringify(DEF)); save(); vue = "today"; render(); }
    });
  }

  /* ================= INIT ================= */
  function majHauteurHeader() {
    const h = document.querySelector("header");
    if (h) document.documentElement.style.setProperty("--hh", h.offsetHeight + "px");
  }
  function init() {
    majHauteurHeader();
    window.addEventListener("resize", majHauteurHeader);
    $("#nav").innerHTML = TABS.map((t) => '<button class="nav-item" data-tab="' + t[0] + '"><span class="ni-e">' + t[1] + '</span><span class="ni-t">' + t[2] + "</span></button>").join("");
    render();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  document.addEventListener("DOMContentLoaded", init);
})();
