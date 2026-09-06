/* =========================================================================
   LE FACE-À-FACE — moteur : analyse de langage + jauges + scoring
   Aucune IA, aucun réseau : de la linguistique de comptoir, mais honnête.
   ========================================================================= */
window.SCEN = window.SCEN || [];

const FFM = (function () {
  "use strict";

  /* ---------- utilitaires ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) {
    return String(s || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
  }
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const nbMots = (s) => (norm(s).match(/[a-z0-9'’-]+/g) || []).length;

  /* ---------- dictionnaires ---------- */
  // Marqueurs qui ABÎMENT (le flou, l'excuse, la permission mendiée)
  const MOU = [
    { id: "hedge", quoi: "des adoucisseurs", pen: 4, plafond: 3,
      re: /\b(un peu|un petit peu|peut-?etre|je pense que|je crois que|je me demandais|je me disais|il me semble|eventuellement|si possible|en quelque sorte|genre|plutot|assez|dans l'idee|a priori|globalement|un truc|des trucs|quelque chose comme ca|voila quoi|enfin bref|si tu vois ce que je veux dire|je voulais juste|juste savoir|si jamais|un de ces quatre|je (ne )?sais pas trop|enfin,? )/g,
      dit: "Chaque adoucisseur retire 10 % à ta phrase. Trois, et il n'en reste rien." },
    { id: "excuse", quoi: "des excuses non demandées", pen: 7, plafond: 2,
      re: /\b(desole|desolee|pardon|je m'excuse|navre|excuse-?moi de|excusez-?moi de|je suis confus)\b/g,
      dit: "S'excuser d'exister avant de parler : tu paies un péage pour entrer dans ta propre phrase." },
    { id: "permission", quoi: "une demande de permission", pen: 8, plafond: 2,
      re: /\b(est-?ce que je peux me permettre|ca (vous|te) derangerait|serait-?il possible|ce serait (peut-?etre )?possible|si ca (ne )?(vous|te) derange pas|si jamais (vous|tu) (avez|as) (le temps|un moment)|si (vous|tu) (avez|as) (le temps|un moment)|je ne veux pas (vous|te) deranger|je (vous|te) derange|je me permets|sans pression|si ca te va)\b/g,
      dit: "Demander la permission de demander : tu donnes à l'autre un « non » gratuit avant même ta demande." },
    { id: "devalo", quoi: "de l'auto-dévalorisation", pen: 9, plafond: 2,
      re: /\b(je sais que c'est beaucoup demander|c'est peut-?etre (bete|idiot|stupide)|je suis (peut-?etre )?(pas |mal )?(legitime|nul|nulle)|je (ne )?merite peut-?etre pas|je (ne )?suis pas sur d'etre|j'ai pas vraiment d'experience|je (ne )?vaux pas)\b/g,
      dit: "Tu plaides contre toi avant que l'autre n'ait ouvert la bouche. Il n'aura plus qu'à recopier." },
    { id: "absolu", quoi: "des absolus accusateurs", pen: 6, plafond: 2,
      re: /\b(tu fais toujours|vous faites toujours|tu (ne )?(m'ecoutes|fais) jamais|c'est toujours pareil|comme d'habitude|tu es (vraiment |juste )?(chiant|penible|egoiste|nul)|vous etes (vraiment )?(de mauvaise foi|malhonnete))\b/g,
      dit: "« Toujours / jamais » : une seule contre-preuve et tout ton grief s'effondre. Reste sur un fait daté." },
  ];

  // Marqueurs qui TIENNENT (le concret, la demande nette, l'ouverture)
  const DUR = [
    { id: "chiffre", quoi: "un chiffre", bonus: 8, plafond: 2,
      re: /(\b\d{1,3}(?:[ .]\d{3})+\b|\b\d{1,2}\s?h\s?\d{2}\b|\b\d+\s?(?:k|€|euros?|%|h|heures?|jours?|semaines?|mois|fois)\b|\b\d{2,}\b)/g,
      dit: "Un chiffre, c'est une prise. On peut le discuter — donc on ne peut plus l'ignorer." },
    { id: "demande", quoi: "une demande directe", bonus: 9, plafond: 1,
      re: /\b(je (te |vous )?demande|j'ai besoin (de|d')|je veux|je souhaite|je propose|ce que je veux|ma demande (c'est|est)|je viens (te|vous) demander|il me faut)\b/g,
      dit: "Verbe de demande à la première personne : la phrase a un propriétaire." },
    { id: "ouverte", quoi: "une question ouverte", bonus: 7, plafond: 2,
      re: /\b(qu'est-?ce qui|qu'est-?ce que|comment (est-?ce que |on |vous |tu )|pourquoi|sur quelle base|en quoi|qu'est-?ce qu'il faudrait|de quoi (vous |tu )?(avez|as) besoin|comment vous voyez|comment tu vois|c'est quoi)\b/g,
      dit: "Une question ouverte rend la parole sans rendre le terrain. C'est l'inverse d'un aveu." },
    { id: "fait", quoi: "un fait daté", bonus: 7, plafond: 2,
      re: /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|hier|avant-?hier|la semaine derniere|mardi dernier|ce matin|le mois dernier|en (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)|d'ici (lundi|demain|vendredi|la fin)|avant (lundi|vendredi|la fin))\b/g,
      dit: "Un fait daté ne se discute pas comme une impression. Tu sors du procès d'intention." },
    { id: "je", quoi: "un énoncé en « je »", bonus: 5, plafond: 2,
      re: /\b(je constate|j'ai (vu|remarque|note|compris)|de mon cote|ce que j'ai vecu|ca m'a (mis|fait|coute)|je (ne )?suis pas (d'accord|a l'aise)|mon probleme (c'est|est))\b/g,
      dit: "Le « je » factuel : indiscutable. Personne ne peut te dire que tu n'as pas ressenti ce que tu as ressenti." },
    { id: "contrepartie", quoi: "une contrepartie", bonus: 9, plafond: 1,
      re: /\b(si .{3,60}(alors|je peux|je suis pret|on peut)|en echange|a condition que|dans ce cas je|contre|je m'engage a)\b/g,
      dit: "« Si… alors » : tu ne mendies plus, tu échanges. C'est la phrase qui change un rapport de force." },
    { id: "recadre", quoi: "un recadrage", bonus: 7, plafond: 1,
      re: /\b(revenons a|restons sur|la question c'est|le sujet c'est|ce n'est pas (le sujet|la question)|j'entends,? (mais|et)|je note,? et|d'accord,? et (donc|maintenant))\b/g,
      dit: "Tu accuses réception sans avaler le cadre de l'autre. C'est le geste le plus rentable du répertoire." },
    { id: "silence", quoi: "une temporisation assumée", bonus: 6, plafond: 1,
      re: /\b(laissez-?moi (y reflechir|le temps)|je (te|vous) reponds (demain|lundi|d'ici)|je reviens vers (toi|vous)|j'ai besoin de (24h|48h|deux jours|reflechir)|je ne repondrai pas (la|maintenant))\b/g,
      dit: "Refuser de répondre tout de suite, c'est refuser le tempo de l'autre. Souvent, ça suffit." },
  ];

  /* ---------- analyse d'un texte libre ---------- */
  function analyser(txt) {
    const t = norm(txt);
    const m = nbMots(t);
    const trouves = [];
    let bonus = 0, malus = 0;

    DUR.forEach((d) => {
      const hits = (t.match(d.re) || []).length;
      if (hits) {
        const n = Math.min(hits, d.plafond);
        bonus += n * d.bonus;
        trouves.push({ ok: true, id: d.id, quoi: d.quoi, n: hits, dit: d.dit });
      }
    });
    MOU.forEach((d) => {
      const hits = (t.match(d.re) || []).length;
      if (hits) {
        const n = Math.min(hits, d.plafond);
        malus += n * d.pen;
        trouves.push({ ok: false, id: d.id, quoi: d.quoi, n: hits, dit: d.dit });
      }
    });

    // longueur : la tartine est une fuite, le monosyllabe aussi
    if (m === 0) {
      malus += 40;
      trouves.push({ ok: false, id: "mutisme", quoi: "le blanc", n: 1,
        dit: "Ne rien dire n'est pas neutre : c'est une réponse, et l'autre l'encaisse comme un accord. Une phrase bancale vaut mieux que le silence." });
    } else if (m >= 90) {
      malus += 10;
      trouves.push({ ok: false, id: "tartine", quoi: "une tartine (" + m + " mots)", n: 1,
        dit: "Au-delà de 80 mots, tu ne parles plus : tu te justifies. L'autre entend « il doute »." });
    } else if (m <= 3 && m > 0) {
      malus += 4;
      trouves.push({ ok: false, id: "vide", quoi: "une réplique trop courte", n: 1,
        dit: "Trop court n'est pas fort : c'est illisible. Une position tient en 15-40 mots." });
    } else if (m >= 8 && m <= 45) {
      bonus += 6;
      trouves.push({ ok: true, id: "calibre", quoi: "un format tenu (" + m + " mots)", n: 1,
        dit: "Format de combat : assez pour être clair, assez court pour ne pas s'excuser." });
    }

    // question fermée seule = piège à « non »
    DUR.forEach((d) => (d.re.lastIndex = 0));
    MOU.forEach((d) => (d.re.lastIndex = 0));
    const ouverte = (function () { DUR[2].re.lastIndex = 0; const r = DUR[2].re.test(t); DUR[2].re.lastIndex = 0; return r; })();
    if (/\?/.test(t) && !ouverte && /^(est-?ce que|tu (peux|pourrais)|vous (pouvez|pourriez)|ce serait|serait-?ce)/.test(t)) {
      malus += 5;
      trouves.push({ ok: false, id: "fermee", quoi: "une question fermée", n: 1,
        dit: "Une question fermée offre le « non » sur un plateau. Ouvre-la : « comment », « qu'est-ce qu'il faudrait »." });
    }
    DUR.forEach((d) => (d.re.lastIndex = 0));
    MOU.forEach((d) => (d.re.lastIndex = 0));

    const note = clamp(50 + bonus - malus, 0, 100);
    return { mots: m, note, bonus, malus, trouves,
      forts: trouves.filter((x) => x.ok), faibles: trouves.filter((x) => !x.ok) };
  }

  /* ---------- routage d'une réponse libre vers une option du scénario ---------- */
  function router(txt, opts) {
    const t = norm(txt);
    let best = null, bestScore = -1;
    opts.forEach((o, i) => {
      let s = 0;
      (o.mots || []).forEach((grp) => {
        const liste = Array.isArray(grp) ? grp : [grp];
        if (liste.some((w) => t.indexOf(norm(w)) >= 0)) s++;
      });
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (bestScore <= 0) {
      // rien de reconnu : on prend l'option "par défaut" (la tiède), pas la meilleure
      const d = opts.findIndex((o) => o.def);
      return { i: d >= 0 ? d : Math.min(1, opts.length - 1), reconnu: false };
    }
    return { i: best, reconnu: true, force: bestScore };
  }

  /* ---------- jauges ---------- */
  function appliquer(j, eff) {
    return {
      pos: clamp(j.pos + (eff.pos || 0), 0, 100),
      lien: clamp(j.lien + (eff.lien || 0), 0, 100),
      tenue: clamp(j.tenue + (eff.tenue || 0), 0, 100),
    };
  }

  /* ---------- verdict de fin ---------- */
  function verdict(sc, j, qTot, qMax) {
    const qual = qMax ? qTot / qMax : 0;
    const okPos = j.pos >= (sc.but.pos || 55);
    const okLien = j.lien >= (sc.but.lien || 40);
    const okTenue = j.tenue >= 45;
    const note = Math.round(clamp(qual * 62 + (j.pos / 100) * 16 + (j.lien / 100) * 11 + (j.tenue / 100) * 11, 0, 100));
    let issue;
    if (okPos && okLien && okTenue && note >= 78) issue = "gagne";
    else if (okPos && !okLien) issue = "pyrrhus";
    else if (!okPos && okLien) issue = "gentil";
    else if (!okTenue) issue = "efface";
    else issue = "moyen";
    return { note, issue, okPos, okLien, okTenue };
  }

  const ISSUES = {
    gagne: { t: "Tu as obtenu ET gardé la relation", e: "🏆", c: "grn",
      d: "Le seul vrai résultat : la chose obtenue, et l'autre qui te reparlera demain." },
    pyrrhus: { t: "Victoire à la Pyrrhus", e: "⚔️", c: "hot",
      d: "Tu as pris ce que tu voulais en cassant le lien. Ça marche une fois. La deuxième, on t'évite." },
    gentil: { t: "Tu as été apprécié — et tu repars les mains vides", e: "🫠", c: "amb",
      d: "L'autre est content de l'échange. Normal : il a tout gardé. Être aimé n'est pas un résultat." },
    efface: { t: "Tu t'es effacé", e: "🌫️", c: "dim",
      d: "Tu as cédé du terrain à chaque tour pour éviter la friction de trois secondes. C'est exactement ton pattern." },
    moyen: { t: "Match nul", e: "🤝", c: "cool",
      d: "Rien de cassé, rien d'obtenu. Le confort du milieu. Rejoue en visant une chose précise." },
  };

  return { esc, norm, clamp, nbMots, analyser, router, appliquer, verdict, ISSUES, MOU, DUR };
})();
