/*
 * Moteur de calcul du comparateur fiscal locatif.
 *
 * Fonctions pures, sans accès au DOM : utilisable dans le navigateur (global Moteur)
 * et sous Node (require) pour les tests. Les taux et plafonds viennent de regles.js.
 * Chaque résultat porte sa trace de calcul (champ `trace` et `detail` par année)
 * pour que l'interface puisse expliquer chaque chiffre.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./regles.js"));
  else root.Moteur = factory(root.REGLES);
})(typeof self !== "undefined" ? self : this, function (REGLES) {
  "use strict";

  const REGIMES = [
    { code: "nu", label: "Location nue" },
    { code: "lmnp", label: "LMNP" },
    { code: "sciir", label: "SCI à l'IR" },
    { code: "sciis", label: "SCI à l'IS" },
    { code: "jeanbrun", label: "Jeanbrun" }
  ];

  // ---------- Formatage des traces ----------

  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const e = v => nf0.format(Math.round(v) || 0) + " €";
  const pc = v => nf2.format(v * 100) + " %";

  // ---------- Prêt ----------

  // Échéancier annuel : intérêts courus, capital remboursé, sommes versées (hors assurance), capital restant dû
  function pret(capital, tauxAnnuel, dureeAns, type, differeMois, typeDiffere) {
    const n = dureeAns * 12;
    const out = { mensualite: 0, mensualiteDiffere: 0, differe: 0, interets: [], capital: [], verse: [], crd: [] };
    if (capital <= 0) return out;
    const r = tauxAnnuel / 100 / 12;
    const d = type === "infine" ? 0 : Math.max(0, Math.min(Math.round(differeMois) || 0, n - 1));
    out.differe = d;
    let crd = capital, m = 0;
    if (type === "infine") { m = capital * r; out.mensualite = m; }
    out.mensualiteDiffere = d > 0 ? (typeDiffere === "total" ? 0 : capital * r) : 0;
    for (let y = 0; y < dureeAns; y++) {
      let i = 0, c = 0, v = 0;
      for (let k = 0; k < 12; k++) {
        const mois = y * 12 + k;
        const ik = crd * r;
        i += ik;
        if (type === "infine") {
          const ck = mois === n - 1 ? crd : 0;
          c += ck; v += ik + ck; crd -= ck;
        } else if (mois < d) {
          if (typeDiffere === "total") crd += ik; else v += ik;
        } else {
          if (mois === d) {
            const reste = n - d;
            m = r > 0 ? crd * r / (1 - Math.pow(1 + r, -reste)) : crd / reste;
            out.mensualite = m;
          }
          const ck = Math.min(m - ik, crd);
          c += ck; v += ik + ck; crd -= ck;
        }
      }
      out.interets.push(i); out.capital.push(c); out.verse.push(v); out.crd.push(Math.max(0, crd));
    }
    return out;
  }

  // ---------- Impôt sur le revenu ----------

  function baremeParPart(quotient) {
    const b = REGLES.impotRevenu.bareme;
    let impot = 0;
    for (let i = 0; i < b.length; i++) {
      const bas = b[i][0], haut = i + 1 < b.length ? b[i + 1][0] : Infinity;
      if (quotient > bas) impot += (Math.min(quotient, haut) - bas) * b[i][1];
    }
    return impot;
  }

  function tmi(revenu, parts) {
    const q = Math.max(0, revenu) / parts;
    let t = 0;
    REGLES.impotRevenu.bareme.forEach(([bas, taux]) => { if (q > bas) t = taux; });
    return t;
  }

  // Impôt du foyer : barème, plafonnement du quotient familial, décote, contribution sur les hauts revenus
  function impotRevenu(revenu, parts, couple) {
    const R = Math.max(0, revenu);
    const partsBase = couple ? 2 : 1;
    const avecQF = baremeParPart(R / parts) * parts;
    const sansQF = baremeParPart(R / partsBase) * partsBase;
    const demiParts = Math.max(0, (parts - partsBase) * 2);
    const brut = Math.max(avecQF, sansQF - demiParts * REGLES.impotRevenu.plafondDemiPart);
    const D = REGLES.decote;
    const seuil = couple ? D.couple : D.seul;
    const decote = brut > 0 && brut < seuil / D.taux ? Math.min(brut, Math.max(0, seuil - D.taux * brut)) : 0;
    const tranches = couple ? REGLES.contributionHautsRevenus.couple : REGLES.contributionHautsRevenus.seul;
    let cehr = 0;
    tranches.forEach(([seuilBas, taux], i) => {
      const haut = i + 1 < tranches.length ? tranches[i + 1][0] : Infinity;
      if (R > seuilBas) cehr += (Math.min(R, haut) - seuilBas) * taux;
    });
    return { impot: brut - decote + cehr, brut, decote, cehr, plafonnementQF: brut > avecQF };
  }

  // ---------- Impôt sur les sociétés ----------

  function impotSocietes(base) {
    if (base <= 0) return 0;
    const IS = REGLES.impotSocietes;
    return Math.min(base, IS.seuilTauxReduit) * IS.tauxReduit + Math.max(0, base - IS.seuilTauxReduit) * IS.tauxNormal;
  }

  // ---------- Plus-value des particuliers ----------

  function abattementIR(n) {
    if (n < 6) return 0;
    if (n <= 21) return (n - 5) * 0.06;
    return 1;
  }
  function abattementPS(n) {
    if (n < 6) return 0;
    if (n <= 21) return (n - 5) * 0.0165;
    if (n === 22) return 0.28;
    if (n < 30) return 0.28 + (n - 22) * 0.09;
    return 1;
  }
  function surtaxePV(pvImposable) {
    for (const [bas, haut, taux, lissage] of REGLES.plusValueParticuliers.surtaxe) {
      if (pvImposable > bas && pvImposable <= haut) return Math.max(0, taux * pvImposable - (lissage ? lissage * (haut - pvImposable) : 0));
    }
    return 0;
  }

  function plusValueParticuliers(o) {
    const PV = REGLES.plusValueParticuliers;
    const n = o.duree;
    const fraisReels = o.fraisAcquisition;
    const fraisForfait = o.prix * PV.forfaitFraisAcquisition;
    const frais = Math.max(fraisReels, fraisForfait);
    const forfaitTravaux = n > PV.dureeMinForfaitTravaux ? o.prix * PV.forfaitTravaux : 0;
    const travaux = Math.max(forfaitTravaux, o.travauxRetenus);
    const prixAcquisition = o.prix + frais + travaux - o.amortReintegre;
    const pv = o.prixCession - prixAcquisition;
    const aIR = abattementIR(n), aPS = abattementPS(n);
    const res = { pv, prixAcquisition, frais, travaux, aIR, aPS, ir: 0, ps: 0, surtaxe: 0, impot: 0 };
    if (pv > 0) {
      const baseIR = pv * (1 - aIR), basePS = pv * (1 - aPS);
      res.ir = baseIR * PV.tauxIR;
      res.ps = basePS * REGLES.prelevementsSociaux.plusValueImmobiliere;
      res.surtaxe = surtaxePV(baseIR);
      res.impot = res.ir + res.ps + res.surtaxe;
    }
    res.trace = [
      `Prix de cession net de frais : ${e(o.prixCession)}`,
      `Prix d'acquisition corrigé : ${e(o.prix)} + frais ${e(frais)} (${frais === fraisForfait ? "forfait 7,5 %" : "frais réels"}) + travaux ${e(travaux)} (${travaux === 0 ? "aucun" : travaux === forfaitTravaux && forfaitTravaux >= o.travauxRetenus ? "forfait 15 %" : "montant réel"})` + (o.amortReintegre > 0 ? ` − amortissements réintégrés ${e(o.amortReintegre)}` : "") + ` = ${e(prixAcquisition)}`,
      `Plus-value brute : ${e(pv)}`
    ];
    if (pv > 0) {
      res.trace.push(
        `Détention ${n} ans : abattement ${pc(aIR)} pour l'impôt, ${pc(aPS)} pour les prélèvements sociaux`,
        `Impôt 19 % : ${e(res.ir)} ; prélèvements sociaux 17,2 % : ${e(res.ps)}` + (res.surtaxe > 0 ? ` ; surtaxe : ${e(res.surtaxe)}` : ""),
        `Total : ${e(res.impot)}`
      );
    } else res.trace.push("Pas d'impôt : la plus-value est nulle ou négative.");
    return res;
  }

  // ---------- Déficits reportables avec expiration ----------

  function creerReport(duree) {
    let items = [];
    let expire = 0;
    return {
      ajouter(annee, montant) { if (montant > 0) items.push({ annee, montant }); },
      // Retire les déficits périmés puis impute au plus ancien d'abord
      utiliser(annee, montant) {
        if (duree != null) {
          items = items.filter(it => { if (annee - it.annee > duree) { expire += it.montant; return false; } return true; });
        }
        let reste = montant, utilise = 0;
        for (const it of items) {
          if (reste <= 0) break;
          const u = Math.min(it.montant, reste);
          it.montant -= u; reste -= u; utilise += u;
        }
        items = items.filter(it => it.montant > 1e-9);
        return utilise;
      },
      solde() { return items.reduce((s, it) => s + it.montant, 0); },
      expire() { return expire; }
    };
  }

  // ---------- Jeanbrun ----------

  function jeanbrun(p) {
    const J = REGLES.jeanbrun;
    const eligible = p.type === "neuf" || p.travaux >= J.seuilTravauxAncien * p.prix;
    const taux = J.taux[p.type][p.jbCat];
    const plafond = J.plafonds[p.jbCat];
    const base = J.quotePartAmortissable * (p.prix + p.travaux);
    return { eligible, taux, plafond, base, annuel: Math.min(base * taux, plafond) };
  }

  // ---------- TRI ----------

  function irr(flux) {
    const npv = r => flux.reduce((s, f, t) => s + f / Math.pow(1 + r, t), 0);
    let lo = -0.99, hi = 1;
    const fLo = npv(lo), fHi = npv(hi);
    if (!isFinite(fLo) || !isFinite(fHi) || fLo * fHi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const f = npv(mid);
      if (Math.abs(f) < 1e-7) return mid;
      if (f * fLo > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------- Simulation d'un régime ----------

  function simuler(code, p, mode) {
    const H = p.horizon;
    const isNu = code === "nu", isLmnp = code === "lmnp", isSciIr = code === "sciir", isSciIs = code === "sciis", isJb = code === "jeanbrun";
    const foncier = isNu || isSciIr || isJb;
    const RF = REGLES.revenusFonciers, MN = REGLES.meubleNonProfessionnel, PS = REGLES.prelevementsSociaux;
    const couple = p.situation === "couple";
    const parts = Math.max(1, p.parts || 1);
    const R0 = Math.max(0, p.revenuImposable);
    const ir0 = impotRevenu(R0, parts, couple).impot;

    const notaire = p.prix * p.notairePct / 100;
    const mobilier = isLmnp ? p.mobilier : 0;
    const creation = isSciIr || isSciIs ? p.creationSci : 0;
    const cout = p.prix + notaire + p.agence + p.travaux + p.fraisBancaires + mobilier + creation;
    const emprunt = Math.max(0, cout - p.apport);
    const apport = cout - emprunt;
    const loan = pret(emprunt, p.taux, p.duree, p.typePret, p.differe, p.typeDiffere);
    const nanti = p.typePret === "infine" && emprunt > 0 ? p.nanti : 0;
    const placement = t => nanti * Math.pow(1 + p.nantiRend / 100, t);
    const assurance = emprunt * p.assurPct / 100;
    const loyerMensuel = isLmnp ? p.loyerNu * (1 + p.majMeuble / 100) : isJb ? p.loyerNu * (1 - p.decote / 100) : p.loyerNu;
    const fixesSpecifiques = isLmnp ? p.comptaLmnp + p.cfe : isSciIr ? p.comptaSciIr + p.banqueSci : isSciIs ? p.comptaSciIs + p.banqueSci : 0;
    const bati = p.prix * (1 - p.terrainPct / 100);
    const jb = jeanbrun(p);

    let regime = isSciIs ? "IS" : "Réel";
    if (isNu && mode === "micro") regime = "Micro-foncier";
    if (isLmnp && mode === "micro") regime = "Micro-BIC";
    const notes = [];

    const reportFoncier = creerReport(RF.dureeReportDeficit);
    const reportBIC = creerReport(MN.dureeReportDeficit);
    const reportIS = creerReport(null);
    let reportAmort = 0, cumAmortLmnp = 0, cumDispoBT = 0, cumJb = 0, cumAmB = 0, cumAmT = 0, cumNetIS = 0;
    const deficitsGlobaux = [];
    const mobilierLots = isLmnp ? [{ montant: p.mobilier, debut: 1 }] : [];

    const valeurVente = (p.prix + p.travaux) * Math.pow(1 + p.valo / 100, H);
    const venteNet = valeurVente * (1 - p.fraisRevente / 100);
    const years = [];
    let isPV = 0, pvSCI = 0, vnc = 0;
    let repriseDeficit = 0, repriseJb = 0;

    for (let y = 1; y <= H; y++) {
      const gL = Math.pow(1 + p.irl / 100, y - 1);
      const gC = Math.pow(1 + p.inflation / 100, y - 1);
      const loyers = loyerMensuel * (12 - p.vacance) * gL;
      const charges = (p.copro + p.tf + p.pno + p.entretien + fixesSpecifiques) * gC + loyers * (p.gestionPct + p.gliPct) / 100;
      const interets = loan.interets[y - 1] || 0;
      const capital = loan.capital[y - 1] || 0;
      const verse = loan.verse[y - 1] || 0;
      const assur = y <= p.duree && emprunt > 0 ? assurance : 0;
      const crd = y <= p.duree ? (loan.crd[y - 1] || 0) : 0;
      const deblocage = nanti > 0 && y === p.duree && y <= H ? placement(y) : 0;
      let investissement = 0;
      if (isLmnp && p.renouvMobilier && y > 1 && (y - 1) % p.durMob === 0) {
        investissement = p.mobilier * gC;
        mobilierLots.push({ montant: investissement, debut: y });
      }
      const cfAvant = loyers - charges - verse - assur + deblocage - investissement;
      const detail = [`Loyers encaissés : ${e(loyerMensuel * gL)} × ${nf2.format(12 - p.vacance)} mois = ${e(loyers)}`, `Charges : ${e(charges)} ; intérêts ${e(interets)} ; assurance ${e(assur)}`];
      if (investissement) detail.push(`Renouvellement du mobilier : ${e(investissement)}`);
      let resultat = 0, amort = 0, impot = 0, imposable = 0, deficitGlobal = 0, ps = 0, tauxPS = 0;

      if (foncier) {
        tauxPS = PS.foncier;
        if (regime === "Micro-foncier") {
          resultat = loyers * (1 - RF.abattementMicro);
          imposable = resultat;
          detail.push(`Micro-foncier : ${e(loyers)} × 70 % = ${e(resultat)} imposables`);
        } else {
          if (isJb && cumJb < jb.base) { amort = Math.min(jb.annuel, jb.base - cumJb); cumJb += amort; }
          const horsInterets = charges + assur + (y === 1 ? p.fraisBancaires + (isJb ? 0 : p.travaux) : 0) + amort;
          const r = loyers - horsInterets - interets;
          resultat = r;
          detail.push(`Résultat foncier : ${e(loyers)} − charges et assurance ${e(horsInterets - amort)}` + (amort ? ` − amortissement Jeanbrun ${e(amort)}` : "") + ` − intérêts ${e(interets)} = ${e(r)}`);
          if (r >= 0) {
            const u = reportFoncier.utiliser(y, r);
            imposable = r - u;
            if (u > 0) detail.push(`Déficits antérieurs imputés : ${e(u)}`);
          } else {
            const deficit = -r;
            const partInterets = Math.max(0, interets - loyers);
            deficitGlobal = Math.min(RF.plafondDeficitGlobal, Math.max(0, deficit - partInterets));
            reportFoncier.utiliser(y, 0);
            reportFoncier.ajouter(y, deficit - deficitGlobal);
            deficitsGlobaux.push({ annee: y, montant: deficitGlobal });
            detail.push(`Déficit ${e(deficit)} : ${e(deficitGlobal)} imputés sur le revenu global (plafond 10 700 €, hors intérêts), ${e(deficit - deficitGlobal)} reportés 10 ans`);
          }
        }
      } else if (isLmnp) {
        tauxPS = PS.bicMeuble;
        if (regime === "Micro-BIC") {
          resultat = loyers * (1 - MN.abattementMicro);
          imposable = resultat;
          detail.push(`Micro-BIC : ${e(loyers)} × 50 % = ${e(resultat)} imposables`);
        } else {
          const deductible = charges + assur + interets + (y === 1 ? notaire + p.agence + p.fraisBancaires : 0);
          const amB = y <= p.durBati ? bati / p.durBati : 0;
          const amT = y <= p.durTrav ? p.travaux / p.durTrav : 0;
          const amM = mobilierLots.reduce((s, l) => s + (y >= l.debut && y < l.debut + p.durMob ? l.montant / p.durMob : 0), 0);
          cumDispoBT += amB + amT;
          let r = loyers - deductible;
          if (r < 0) { reportBIC.utiliser(y, 0); reportBIC.ajouter(y, -r); r = 0; }
          else { const u = reportBIC.utiliser(y, r); r -= u; if (u > 0) detail.push(`Déficits antérieurs imputés : ${e(u)}`); }
          const stock = reportAmort + amB + amT + amM;
          amort = Math.min(r, stock);
          reportAmort = stock - amort;
          cumAmortLmnp += amort;
          resultat = loyers - deductible - amort;
          imposable = Math.max(0, r - amort);
          detail.push(`Résultat avant amortissement : ${e(loyers - deductible)} ; amortissements disponibles ${e(stock)}, déduits ${e(amort)} (sans créer de déficit), reportés ${e(reportAmort)}`);
        }
        if (y === 1 && loyers > MN.seuilLMP) notes.push("Recettes meublées supérieures à 23 000 € : le statut LMP peut s'appliquer et n'est pas simulé.");
      } else if (isSciIs) {
        const amB = y <= p.durBati ? bati / p.durBati : 0;
        const amT = y <= p.durTrav ? p.travaux / p.durTrav : 0;
        amort = amB + amT;
        cumAmB += amB; cumAmT += amT;
        const r = loyers - charges - assur - interets - amort - (y === 1 ? notaire + p.agence + p.fraisBancaires + creation : 0);
        resultat = r;
        let pvAnnee = 0;
        if (y === H) {
          vnc = p.prix + p.travaux - cumAmB - cumAmT;
          pvSCI = venteNet - vnc;
          pvAnnee = pvSCI;
        }
        const total = r + pvAnnee;
        let isTotal = 0, base = 0;
        if (total < 0) { reportIS.ajouter(y, -total); }
        else { base = total - reportIS.utiliser(y, total); isTotal = impotSocietes(base); }
        const isExploitation = pvAnnee !== 0 ? impotSocietes(Math.max(0, Math.min(base, r))) : isTotal;
        isPV = pvAnnee !== 0 ? isTotal - isExploitation : 0;
        impot = isExploitation;
        cumNetIS += total - isTotal;
        detail.push(`Résultat : ${e(loyers)} − charges, assurance et intérêts − amortissements ${e(amort)}` + (y === 1 ? " − frais d'acquisition" : "") + ` = ${e(r)} ; IS ${e(isExploitation)}`);
      }

      if (!isSciIs) {
        const avant = R0;
        const apres = Math.max(0, R0 + imposable - deficitGlobal);
        const irDiff = impotRevenu(apres, parts, couple).impot - ir0;
        ps = imposable * tauxPS;
        impot = irDiff + ps;
        detail.push(`Impôt sur le revenu du foyer : revenu ${e(avant)} → ${e(apres)}, écart d'impôt ${e(irDiff)} ; prélèvements sociaux ${pc(tauxPS)} × ${e(imposable)} = ${e(ps)}`);
      }

      years.push({ y, loyers, charges, interets: interets + assur, capital, deblocage, investissement, amort, resultat, imposable, deficitGlobal, impot, cfAvant, cfApres: cfAvant - impot, crd, detail });
    }

    // Reprises fiscales en fin de détention
    const derniere = years[H - 1];
    const reprises = [];
    if (foncier && regime === "Réel") {
      repriseDeficit = deficitsGlobaux.filter(d => d.annee + RF.dureeMaintienLocation > H).reduce((s, d) => s + d.montant, 0);
      if (repriseDeficit > 0) reprises.push(`Déficit imputé sur le revenu global repris (location arrêtée avant la fin de la 3e année suivant l'imputation) : ${e(repriseDeficit)}`);
    }
    if (isJb && H < REGLES.jeanbrun.dureeEngagement && cumJb > 0) {
      repriseJb = cumJb;
      reprises.push(`Engagement de 9 ans rompu : amortissements Jeanbrun repris ${e(repriseJb)}`);
      notes.push("Jeanbrun : détention inférieure à l'engagement de 9 ans, les amortissements déduits sont repris l'année de la vente.");
    }
    let impotReprise = 0;
    if (repriseDeficit + repriseJb > 0) {
      const base = Math.max(0, R0 + derniere.imposable - derniere.deficitGlobal);
      impotReprise = impotRevenu(base + repriseDeficit + repriseJb, parts, couple).impot - impotRevenu(base, parts, couple).impot + repriseJb * PS.foncier;
      reprises.push(`Impôt supplémentaire : ${e(impotReprise)}`);
    }

    // Sortie
    const crdFinal = derniere.crd;
    let impotSortie = 0, pv = 0, traceSortie = [];
    if (isSciIs) {
      pv = pvSCI;
      const flat = p.sciDistrib ? Math.max(0, cumNetIS) * PS.flatTaxDividendes : 0;
      impotSortie = isPV + flat;
      traceSortie = [
        `Valeur nette comptable : ${e(p.prix + p.travaux)} − amortissements ${e(cumAmB + cumAmT)} = ${e(vnc)}`,
        `Plus-value professionnelle : ${e(venteNet)} − ${e(vnc)} = ${e(pv)} ; IS sur la plus-value ${e(isPV)}`,
        p.sciDistrib ? `Bénéfices accumulés distribués : ${e(Math.max(0, cumNetIS))} × flat tax ${pc(PS.flatTaxDividendes)} = ${e(flat)}` : "Bénéfices conservés dans la société : pas de flat tax",
        `Total : ${e(impotSortie)}`
      ];
    } else {
      let travauxRetenus = 0, reintegre = 0;
      if (isLmnp) travauxRetenus = p.travaux;
      if (isLmnp && regime === "Réel" && MN.reintegrationAmortissements) reintegre = Math.min(cumAmortLmnp, cumDispoBT);
      if (isJb) { travauxRetenus = p.travaux; reintegre = p.jbReint ? cumJb : 0; }
      const r = plusValueParticuliers({ duree: H, prix: p.prix, fraisAcquisition: notaire + p.agence, travauxRetenus, amortReintegre: reintegre, prixCession: venteNet });
      pv = r.pv; impotSortie = r.impot; traceSortie = r.trace;
    }
    impotSortie += impotReprise;
    traceSortie = traceSortie.concat(reprises);
    const ira = p.ira && crdFinal > 0 ? Math.min(0.03 * crdFinal, crdFinal * p.taux / 100 / 2) : 0;
    const placementSortie = nanti > 0 && H < p.duree ? placement(H) : 0;
    const netSortie = venteNet - crdFinal - ira - impotSortie + placementSortie;

    let cum = 0, effortMax = 0;
    years.forEach(o => { cum += o.cfApres; effortMax = Math.min(effortMax, cum); });
    const coutCredit = emprunt > 0 ? years.reduce((s, o) => s + o.interets, 0) + p.fraisBancaires + ira : 0;
    const flux = [-apport - nanti].concat(years.map(o => o.cfApres));
    flux[H] += netSortie;
    const sumCfApres = years.reduce((s, o) => s + o.cfApres, 0);
    const sumCfAvant = years.reduce((s, o) => s + o.cfAvant, 0);
    const impotsAnnuels = years.reduce((s, o) => s + o.impot, 0);
    const impots = impotsAnnuels + impotSortie;
    const prixRevient = p.prix + notaire + p.agence + p.travaux;
    const y1 = years[0];
    const negatifs = years.reduce((s, o) => s + Math.max(0, -o.cfApres), 0);
    const positifs = years.reduce((s, o) => s + Math.max(0, o.cfApres), 0);
    const fondsInvestis = apport + nanti + negatifs;
    const mensualite = loan.mensualite + assurance / 12;
    const tri = irr(flux);

    if (isJb && !jb.eligible) notes.push("Jeanbrun : dans l'ancien, les travaux doivent atteindre au moins 30 % du prix d'acquisition.");
    const expireF = reportFoncier.expire() + reportBIC.expire();
    if (expireF > 0) notes.push(`${REGIMES.find(R => R.code === code).label} : ${e(expireF)} de déficits reportés expirent sans avoir été utilisés.`);

    const res = {
      code, regime, notes, eligible: !isJb || jb.eligible,
      cout, emprunt, apport, nanti, placementSortie, mensualite,
      mensualiteDiffere: loan.differe > 0 && emprunt > 0 ? loan.mensualiteDiffere + assurance / 12 : null,
      interetsTotaux: loan.interets.reduce((s, v) => s + v, 0),
      loyerMensuel, years, venteNet, crdFinal, ira, pv, impotSortie, netSortie, flux,
      coutCredit, effortMax: -effortMax, tauxApport: apport / cout,
      fondsInvestis, multiple: (netSortie + positifs) / fondsInvestis,
      rendBrut: y1.loyers / prixRevient,
      rendNet: (y1.loyers - y1.charges) / cout,
      rendNetNet: years.reduce((s, o) => s + (o.loyers - o.charges - o.impot), 0) / H / cout,
      cfMoyAvant: sumCfAvant / H / 12, cfMoyApres: sumCfApres / H / 12, cf1Apres: y1.cfApres / 12,
      impots, enrichissement: netSortie + sumCfApres - apport - nanti, tri,
      reportsRestants: reportFoncier.solde() + reportBIC.solde()
    };
    res.tauxEffort = tauxEffort(p, res);

    res.trace = {
      cout: [`Prix ${e(p.prix)} + notaire ${e(notaire)} + agence ${e(p.agence)} + travaux ${e(p.travaux)} + frais bancaires ${e(p.fraisBancaires)}` + (mobilier ? ` + mobilier ${e(mobilier)}` : "") + (creation ? ` + création SCI ${e(creation)}` : "") + ` = ${e(cout)}`],
      apport: [`Apport saisi ${e(p.apport)}, limité au coût de l'opération : ${e(apport)}`],
      emprunt: [`Coût ${e(cout)} − apport ${e(apport)} = ${e(emprunt)}`],
      mensualite: emprunt > 0 ? [
        p.typePret === "infine" ? `Prêt in fine : intérêts ${e(emprunt)} × ${nf2.format(p.taux)} % / 12 = ${e(loan.mensualite)}` : `Mensualité constante sur ${p.duree * 12 - loan.differe} mois au taux de ${nf2.format(p.taux)} % : ${e(loan.mensualite)}`,
        `Assurance : ${e(emprunt)} × ${nf2.format(p.assurPct)} % / 12 = ${e(assurance / 12)}`,
        `Total : ${e(mensualite)}`
      ] : ["Pas de crédit."],
      coutCredit: [`Intérêts et assurance payés sur ${H} ans ${e(coutCredit - p.fraisBancaires - ira)} + frais bancaires ${e(p.fraisBancaires)} + indemnités ${e(ira)} = ${e(coutCredit)}`],
      loyerMensuel: [isLmnp ? `Loyer nu ${e(p.loyerNu)} + majoration meublé ${nf2.format(p.majMeuble)} %` : isJb ? `Loyer nu ${e(p.loyerNu)} − décote ${nf2.format(p.decote)} % pour respecter le plafond` : "Loyer nu saisi", `= ${e(loyerMensuel)} par mois`],
      rendBrut: [`Loyers de l'année 1 ${e(y1.loyers)} / prix de revient ${e(prixRevient)} = ${pc(res.rendBrut)}`],
      rendNet: [`(Loyers ${e(y1.loyers)} − charges ${e(y1.charges)}) / coût total ${e(cout)} = ${pc(res.rendNet)}`],
      rendNetNet: [`Moyenne sur ${H} ans de (loyers − charges − impôts) / coût total = ${pc(res.rendNetNet)}`],
      cfMoyAvant: [`Somme des trésoreries avant impôt ${e(sumCfAvant)} / ${H * 12} mois = ${e(res.cfMoyAvant)}`],
      cf1Apres: [`Trésorerie après impôt de l'année 1 ${e(y1.cfApres)} / 12 = ${e(res.cf1Apres)}`].concat(y1.detail),
      cfMoyApres: [`Somme des trésoreries après impôt ${e(sumCfApres)} / ${H * 12} mois = ${e(res.cfMoyApres)}`],
      effortMax: [`Point le plus bas de la trésorerie cumulée après impôt : ${e(-effortMax)}`],
      venteNet: [`Valeur ${e(p.prix + p.travaux)} × (1 + ${nf2.format(p.valo)} %)^${H} = ${e(valeurVente)}, moins frais de revente ${nf2.format(p.fraisRevente)} % = ${e(venteNet)}`],
      crdFinal: [`Capital restant dû à la fin de l'année ${H} : ${e(crdFinal)}`],
      ira: p.ira ? [`min(3 % × ${e(crdFinal)} ; 6 mois d'intérêts) = ${e(ira)}`] : ["Option désactivée."],
      pv: traceSortie, impotSortie: traceSortie,
      impots: [`Impôts annuels cumulés ${e(impotsAnnuels)} + impôt de sortie ${e(impotSortie)} = ${e(impots)}`],
      enrichissement: [`Produit net de revente ${e(netSortie)} + trésoreries après impôt ${e(sumCfApres)} − apport ${e(apport)}` + (nanti ? ` − placement nanti ${e(nanti)}` : "") + ` = ${e(res.enrichissement)}`],
      fondsInvestis: [`Apport ${e(apport)}` + (nanti ? ` + placement ${e(nanti)}` : "") + ` + efforts d'épargne annuels ${e(negatifs)} = ${e(fondsInvestis)}`],
      multiple: [`(Produit net ${e(netSortie)} + excédents annuels ${e(positifs)}) / fonds investis ${e(fondsInvestis)}`],
      tri: [`Taux qui annule la valeur actuelle des flux : an 0 ${e(flux[0])}, années 1 à ${H} trésorerie après impôt, année ${H} + produit net ${e(netSortie)}`, `TRI = ${tri == null ? "non calculable" : pc(tri)}`],
      tauxEffort: res.tauxEffort ? res.tauxEffort.trace : []
    };
    return res;
  }

  // ---------- Faisabilité bancaire (HCSF) ----------

  function tauxEffort(p, r) {
    if (!(p.revenusMensuels > 0) || r.emprunt <= 0) return null;
    const H = REGLES.hcsf;
    const mensualite = Math.max(r.mensualite, r.mensualiteDiffere || 0);
    const loyersRetenus = r.loyerMensuel * H.partLoyersRetenue;
    const taux = ((p.creditsExistants || 0) + mensualite) / (p.revenusMensuels + loyersRetenus);
    const differeEligible = p.differe > 0 && (p.type === "neuf" || p.travaux >= 0.1 * r.cout);
    const dureeMax = differeEligible ? H.dureeMaxDiffere : H.dureeMax;
    const conforme = taux <= H.tauxEffortMax && p.duree <= dureeMax;
    return {
      taux, dureeMax, conforme,
      trace: [
        `(Crédits existants ${e(p.creditsExistants || 0)} + nouvelle mensualité ${e(mensualite)}) / (revenus ${e(p.revenusMensuels)} + 70 % des loyers ${e(loyersRetenus)}) = ${pc(taux)}`,
        `Plafond HCSF : ${pc(H.tauxEffortMax)} et ${dureeMax} ans` + (conforme ? " : conforme" : " : dépassé")
      ]
    };
  }

  // ---------- Comparaison des régimes ----------

  function comparer(p, options) {
    const opts = options || {};
    const res = REGIMES.map(R => {
      if (R.code !== "nu" && R.code !== "lmnp") return simuler(R.code, p, "reel");
      const sel = R.code === "nu" ? p.regNu : p.regLmnp;
      const plafond = R.code === "nu" ? REGLES.revenusFonciers.plafondMicro : REGLES.meubleNonProfessionnel.plafondMicro;
      const nom = R.code === "nu" ? "Micro-foncier" : "Micro-BIC";
      const reel = simuler(R.code, p, "reel");
      const microOk = reel.years[0].loyers <= plafond;
      if (sel === "reel" || !microOk) {
        if (sel === "micro" && !microOk) reel.notes.push(`${nom} impossible avec ce niveau de loyers : régime réel appliqué.`);
        reel.choixRegime = sel === "auto" && !microOk ? `${nom} impossible : loyers supérieurs à ${e(plafond)}.` : null;
        return reel;
      }
      const micro = simuler(R.code, p, "micro");
      if (sel === "micro") return micro;
      const retenu = micro.enrichissement > reel.enrichissement ? micro : reel;
      retenu.choixRegime = `Régime le plus favorable : ${retenu.regime} (enrichissement ${e(retenu.enrichissement)} contre ${e(retenu === micro ? reel.enrichissement : micro.enrichissement)}).`;
      return retenu;
    });
    if (!opts.sansComptant) {
      const comptant = comparer(Object.assign({}, p, { apport: Infinity }), { sansComptant: true });
      res.forEach((r, i) => {
        r.triComptant = comptant[i].tri;
        r.trace.triComptant = [`Mêmes hypothèses sans crédit : apport ${e(comptant[i].apport)}, TRI ${comptant[i].tri == null ? "non calculable" : pc(comptant[i].tri)}`];
        r.trace.levier = [`TRI avec crédit ${r.tri == null ? "—" : pc(r.tri)} − TRI comptant ${r.triComptant == null ? "—" : pc(r.triComptant)}`];
      });
    }
    return res;
  }

  // ---------- Contrôle des saisies ----------

  function valider(p) {
    const out = [];
    const err = (champ, message) => out.push({ niveau: "erreur", champ, message });
    const alerte = (champ, message) => out.push({ niveau: "alerte", champ, message });
    if (!(p.prix > 0)) err("prix", "Le prix doit être supérieur à zéro.");
    if (!(p.loyerNu > 0)) err("loyerNu", "Le loyer doit être supérieur à zéro.");
    if (p.vacance < 0 || p.vacance >= 12) err("vacance", "La vacance doit être comprise entre 0 et 12 mois.");
    else if (p.vacance > 3) alerte("vacance", "Plus de 3 mois de vacance par an : hypothèse très prudente, vérifiez-la.");
    if (p.taux < 0) err("taux", "Le taux ne peut pas être négatif.");
    else if (p.taux > 7) alerte("taux", "Taux supérieur à 7 % : au-dessus des conditions de marché actuelles, vérifiez le taux d'usure.");
    if (p.duree < 1 || p.duree > 30) err("duree", "La durée du prêt doit être comprise entre 1 et 30 ans.");
    if (p.typePret !== "infine" && p.differe >= p.duree * 12) err("differe", "Le différé doit être plus court que le prêt.");
    if (p.horizon < 1 || p.horizon > 40) err("horizon", "La durée de détention doit être comprise entre 1 et 40 ans.");
    if (p.terrainPct < 5 || p.terrainPct > 40) alerte("terrainPct", "Quote-part terrain inhabituelle : l'administration retient le plus souvent 10 à 30 %.");
    if (p.notairePct < 1.5 || p.notairePct > 9) alerte("notairePct", "Frais de notaire inhabituels : environ 7 à 8 % dans l'ancien, 2 à 3 % dans le neuf.");
    if (p.majMeuble > 30) alerte("majMeuble", "Majoration meublée supérieure à 30 % : rarement observée hors courte durée.");
    if (p.parts < 1 || p.parts > 10) err("parts", "Le nombre de parts doit être compris entre 1 et 10.");
    if (p.situation === "couple" && p.parts < 2) err("parts", "Un couple compte au moins 2 parts.");
    if (p.prix > 0) {
      const brut = p.loyerNu * 12 / (p.prix + p.prix * p.notairePct / 100 + p.agence + p.travaux);
      if (brut > 0.12) alerte("loyerNu", `Rendement brut de ${pc(brut)} : très élevé, vérifiez le loyer ou le prix.`);
      else if (brut < 0.02) alerte("loyerNu", `Rendement brut de ${pc(brut)} : très faible, vérifiez le loyer ou le prix.`);
    }
    if (p.valo > 4) alerte("valo", "Valorisation annuelle supérieure à 4 % : hypothèse optimiste sur 10 ans ou plus.");
    if (p.horizon < REGLES.jeanbrun.dureeEngagement) alerte("horizon", "Détention inférieure à 9 ans : l'engagement Jeanbrun n'est pas tenu.");
    if (p.typePret === "infine" && p.nanti <= 0) alerte("nanti", "Prêt in fine sans placement nanti : la banque en exige presque toujours un.");
    if (!(p.revenusMensuels > 0)) alerte("revenusMensuels", "Renseignez vos revenus mensuels pour vérifier la faisabilité bancaire.");
    return out;
  }

  return {
    REGLES, REGIMES, pret, impotRevenu, tmi, impotSocietes, abattementIR, abattementPS, surtaxePV,
    plusValueParticuliers, creerReport, jeanbrun, irr, simuler, comparer, tauxEffort, valider
  };
});
