// Tests du moteur de calcul : node --test (depuis le dossier immo/)
// Les valeurs attendues sont calculées à la main ; le détail du calcul figure en commentaire.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../moteur.js");
const REGLES = require("../regles.js");

const proche = (reel, attendu, tolerance = 0.01, msg) =>
  assert.ok(Math.abs(reel - attendu) <= tolerance, `${msg || ""} attendu ${attendu}, obtenu ${reel}`);

const EXEMPLE = {
  type: "ancien", prix: 200000, notairePct: 7.5, agence: 0, travaux: 60000, mobilier: 6000, terrainPct: 15,
  apport: 30000, typePret: "amortissable", taux: 3.4, duree: 20, differe: 0, typeDiffere: "partiel",
  nanti: 0, nantiRend: 2.5, assurPct: 0.3, fraisBancaires: 2500, ira: true,
  loyerNu: 1050, majMeuble: 12, vacance: 0.5, irl: 1.5,
  copro: 800, tf: 1100, pno: 180, entretien: 500, gestionPct: 7, gliPct: 3, inflation: 2,
  comptaLmnp: 600, cfe: 300, renouvMobilier: true, creationSci: 1500, banqueSci: 200, comptaSciIr: 500, comptaSciIs: 1500,
  situation: "couple", parts: 2, revenuImposable: 60000, revenusMensuels: 5000, creditsExistants: 0,
  regNu: "auto", regLmnp: "auto", durBati: 30, durTrav: 15, durMob: 7,
  jbCat: "inter", decote: 15, jbReint: true,
  horizon: 15, valo: 1.5, fraisRevente: 4, sciDistrib: true
};
const avec = changements => Object.assign({}, EXEMPLE, changements);

test("règles : chaque bloc indique sa source et son statut", () => {
  Object.entries(REGLES).forEach(([cle, bloc]) => {
    if (typeof bloc !== "object") return;
    assert.ok(bloc.source, `${cle} sans source`);
    assert.ok(["officiel", "a_verifier"].includes(bloc.statut), `${cle} sans statut`);
  });
  const seuils = REGLES.impotRevenu.bareme.map(t => t[0]);
  assert.deepEqual(seuils, [...seuils].sort((a, b) => a - b));
});

test("prêt amortissable : 100 000 € à 3,6 % sur 20 ans", () => {
  const p = M.pret(100000, 3.6, 20, "amortissable", 0, "partiel");
  // r = 0,3 %/mois ; m = 100 000 × 0,003 / (1 − 1,003^−240) = 585,11 €
  proche(p.mensualite, 585.11, 0.01);
  proche(p.capital.reduce((s, v) => s + v, 0), 100000, 0.01);
  proche(p.crd[19], 0, 0.01);
  proche(p.verse.reduce((s, v) => s + v, 0), p.mensualite * 240, 0.05);
});

test("prêt in fine : intérêts seuls puis capital au terme", () => {
  const p = M.pret(100000, 3.6, 10, "infine", 0, "partiel");
  proche(p.interets[0], 3600, 0.001);
  proche(p.crd[8], 100000, 0.001);
  proche(p.capital[9], 100000, 0.001);
  proche(p.crd[9], 0, 0.001);
});

test("différé de 12 mois : partiel puis total", () => {
  const partiel = M.pret(100000, 3.6, 20, "amortissable", 12, "partiel");
  proche(partiel.verse[0], 3600, 0.01);
  proche(partiel.crd[0], 100000, 0.01);
  const total = M.pret(100000, 3.6, 20, "amortissable", 12, "total");
  // 100 000 × 1,003^12 = 103 660,0
  proche(total.verse[0], 0, 0.001);
  proche(total.crd[0], 103660.0, 0.5);
  proche(total.crd[19], 0, 0.01);
});

test("impôt sur le revenu : barème 2026", () => {
  // Célibataire, 30 000 € : 17 979 × 11 % + 421 × 30 % = 2 103,99 €
  proche(M.impotRevenu(30000, 1, false).impot, 2103.99);
  // Couple, 60 000 €, 2 parts : 2 × 2 103,99 = 4 207,98 €
  proche(M.impotRevenu(60000, 2, true).impot, 4207.98);
  proche(M.impotRevenu(0, 1, false).impot, 0);
  assert.equal(M.tmi(60000, 2), 0.30);
  assert.equal(M.tmi(20000, 2), 0);
});

test("impôt sur le revenu : décote", () => {
  // Célibataire, 20 000 € : brut 8 400 × 11 % = 924 ; décote 897 − 45,25 % × 924 = 478,89 ; net 445,11
  const r = M.impotRevenu(20000, 1, false);
  proche(r.brut, 924);
  proche(r.decote, 478.89);
  proche(r.impot, 445.11);
});

test("impôt sur le revenu : plafonnement du quotient familial", () => {
  // Couple, 1 enfant à charge (3 parts), 150 000 €
  // Avec QF : 3 × impôt(50 000) = 3 × 8 103,99 = 24 311,97
  // Sans QF : 2 × impôt(75 000) = 31 207,98 − 2 demi-parts × 1 807 = 27 593,98 → retenu
  const r = M.impotRevenu(150000, 3, true);
  proche(r.brut, 27593.98);
  assert.equal(r.plafonnementQF, true);
});

test("contribution exceptionnelle sur les hauts revenus", () => {
  // Célibataire, 300 000 € : (300 000 − 250 000) × 3 % = 1 500 €
  proche(M.impotRevenu(300000, 1, false).cehr, 1500);
  proche(M.impotRevenu(300000, 2, true).cehr, 0);
});

test("impôt sur les sociétés", () => {
  // 42 500 × 15 % + 7 500 × 25 % = 8 250 €
  proche(M.impotSocietes(50000), 8250);
  assert.equal(M.impotSocietes(-1000), 0);
});

test("plus-value : abattements pour durée de détention", () => {
  assert.equal(M.abattementIR(5), 0);
  proche(M.abattementIR(6), 0.06, 1e-9);
  proche(M.abattementIR(15), 0.60, 1e-9);
  assert.equal(M.abattementIR(22), 1);
  proche(M.abattementPS(15), 0.165, 1e-9);
  proche(M.abattementPS(22), 0.28, 1e-9);
  proche(M.abattementPS(25), 0.55, 1e-9);
  assert.equal(M.abattementPS(30), 1);
});

test("plus-value : surtaxe avec lissage", () => {
  assert.equal(M.surtaxePV(50000), 0);
  proche(M.surtaxePV(55000), 850);      // 2 % × 55 000 − (60 000 − 55 000) / 20
  proche(M.surtaxePV(80000), 1600);     // 2 % × 80 000
  proche(M.surtaxePV(105000), 2650);    // 3 % × 105 000 − (110 000 − 105 000) / 10
  proche(M.surtaxePV(300000), 18000);   // 6 % × 300 000
});

test("plus-value des particuliers : cas complet et réintégration des amortissements", () => {
  // Prix 200 000, frais 15 000, forfait travaux 30 000 (> 5 ans), cession 300 000 → PV 55 000
  // IR : 55 000 × 40 % × 19 % = 4 180 ; PS : 55 000 × 83,5 % × 17,2 % = 7 899,10
  const base = { duree: 15, prix: 200000, fraisAcquisition: 15000, travauxRetenus: 0, amortReintegre: 0, prixCession: 300000 };
  const r = M.plusValueParticuliers(base);
  proche(r.pv, 55000);
  proche(r.impot, 12079.10);
  // 20 000 € d'amortissements réintégrés : PV 75 000 → 5 700 + 10 771,50
  const r2 = M.plusValueParticuliers(Object.assign({}, base, { amortReintegre: 20000 }));
  proche(r2.pv, 75000);
  proche(r2.impot, 16471.50);
});

test("déficits reportables : ordre d'imputation et expiration", () => {
  const a = M.creerReport(10);
  a.ajouter(1, 100); a.ajouter(2, 100);
  proche(a.utiliser(3, 150), 150);
  proche(a.solde(), 50);
  const b = M.creerReport(10);
  b.ajouter(1, 1000);
  proche(b.utiliser(11, 400), 400);   // encore utilisable la 10e année suivante
  proche(b.utiliser(12, 400), 0);     // périmé ensuite
  proche(b.expire(), 600);
  const c = M.creerReport(null);
  c.ajouter(1, 1000);
  proche(c.utiliser(40, 1000), 1000); // déficit d'IS : sans limite
});

test("TRI", () => {
  proche(M.irr([-100, 110]), 0.10, 1e-6);
  proche(M.irr([-100, 0, 121]), 0.10, 1e-6);
  assert.equal(M.irr([100, 100]), null);
});

test("simulation : cohérence des flux pour chaque régime", () => {
  M.comparer(EXEMPLE).forEach(r => {
    proche(r.emprunt, r.cout - r.apport, 0.01, r.code);
    proche(r.flux.reduce((s, v) => s + v, 0), r.enrichissement, 0.5, r.code);
    r.years.forEach(o => proche(o.cfApres, o.cfAvant - o.impot, 0.001, r.code));
    assert.ok(r.tri != null, `${r.code} : TRI non calculé`);
    assert.ok(r.trace.impotSortie.length > 0);
  });
});

test("simulation : achat comptant sans crédit", () => {
  M.comparer(avec({ apport: Infinity })).forEach(r => {
    assert.equal(r.emprunt, 0);
    assert.equal(r.mensualite, 0);
    assert.equal(r.crdFinal, 0);
    assert.equal(r.coutCredit, 0);
  });
});

test("LMNP réel : l'amortissement ne crée jamais de déficit", () => {
  const r = M.simuler("lmnp", EXEMPLE, "reel");
  r.years.forEach(o => {
    assert.ok(o.imposable >= 0);
    if (o.loyers - o.charges - o.interets > 0 && o.y > 1) assert.ok(o.resultat >= -1e-6, `année ${o.y}`);
  });
});

test("micro-foncier : 70 % des loyers imposables", () => {
  const r = M.simuler("nu", EXEMPLE, "micro");
  proche(r.years[0].imposable, r.years[0].loyers * 0.7, 0.01);
});

test("impôt différentiel : sous le seuil du barème, seuls les prélèvements sociaux s'appliquent", () => {
  const r = M.simuler("nu", avec({ revenuImposable: 0, parts: 2, travaux: 0, apport: Infinity }), "micro");
  const o = r.years[0];
  // Revenu foncier < 2 × 11 600 € : impôt sur le revenu nul
  proche(o.impot, o.imposable * 0.172, 0.01);
});

test("impôt différentiel : un revenu plus élevé augmente l'impôt de la location nue", () => {
  const bas = M.simuler("nu", avec({ revenuImposable: 40000, travaux: 0, apport: Infinity }), "reel");
  const haut = M.simuler("nu", avec({ revenuImposable: 250000, travaux: 0, apport: Infinity }), "reel");
  assert.ok(haut.impots > bas.impots);
});

test("déficit foncier : imputation plafonnée et reprise en cas de vente rapide", () => {
  const r = M.simuler("nu", avec({ horizon: 2 }), "reel");
  assert.ok(r.years[0].deficitGlobal > 0);
  assert.ok(r.years[0].deficitGlobal <= 10700);
  assert.ok(r.trace.impotSortie.some(l => l.includes("repris")), "reprise du déficit attendue");
  const long = M.simuler("nu", avec({ horizon: 15 }), "reel");
  assert.ok(!long.trace.impotSortie.some(l => l.includes("Déficit imputé")));
});

test("déficits perdus : signalés quand ils expirent", () => {
  const r = M.simuler("nu", avec({ travaux: 150000, loyerNu: 400, horizon: 20 }), "reel");
  assert.ok(r.notes.some(n => n.includes("expirent")));
});

test("Jeanbrun : reprise des amortissements si l'engagement de 9 ans est rompu", () => {
  const court = M.simuler("jeanbrun", avec({ horizon: 8 }), "reel");
  assert.ok(court.trace.impotSortie.some(l => l.includes("Engagement de 9 ans rompu")));
  const long = M.simuler("jeanbrun", avec({ horizon: 9 }), "reel");
  assert.ok(!long.trace.impotSortie.some(l => l.includes("Engagement")));
});

test("Jeanbrun : éligibilité dans l'ancien et plafond annuel", () => {
  assert.equal(M.jeanbrun(avec({ travaux: 50000 })).eligible, false);
  const j = M.jeanbrun(avec({ type: "neuf", travaux: 0, prix: 400000, jbCat: "inter" }));
  // 80 % × 400 000 × 3,5 % = 11 200 € plafonné à 8 000 €
  proche(j.annuel, 8000);
});

test("LMNP : renouvellement du mobilier", () => {
  const avecRenouv = M.simuler("lmnp", avec({ renouvMobilier: true }), "reel");
  const sans = M.simuler("lmnp", avec({ renouvMobilier: false }), "reel");
  assert.ok(avecRenouv.years[7].investissement > 0);   // année 8 = 1 + 7 ans
  assert.equal(sans.years[7].investissement, 0);
});

test("SCI à l'IS : plus-value imposée et flat tax à la distribution", () => {
  const distrib = M.simuler("sciis", EXEMPLE, "reel");
  const garde = M.simuler("sciis", avec({ sciDistrib: false }), "reel");
  assert.ok(distrib.pv > 0);
  assert.ok(distrib.impotSortie > garde.impotSortie);
});

test("faisabilité bancaire HCSF", () => {
  const r = M.simuler("nu", EXEMPLE, "reel");
  // (0 + 1 485) / (5 000 + 70 % × 1 050) = 25,9 %
  proche(r.tauxEffort.taux, r.mensualite / (5000 + 0.7 * 1050), 1e-9);
  assert.equal(r.tauxEffort.conforme, true);
  const long = M.simuler("nu", avec({ duree: 26 }), "reel");
  assert.equal(long.tauxEffort.conforme, false);
  const endette = M.simuler("nu", avec({ creditsExistants: 1500 }), "reel");
  assert.equal(endette.tauxEffort.conforme, false);
});

test("contrôle des saisies", () => {
  const champs = p => M.valider(p).map(v => v.niveau + ":" + v.champ);
  assert.deepEqual(champs(EXEMPLE), []);
  assert.ok(champs(avec({ prix: 0 })).includes("erreur:prix"));
  assert.ok(champs(avec({ differe: 240 })).includes("erreur:differe"));
  assert.ok(champs(avec({ loyerNu: 3000 })).includes("alerte:loyerNu"));
  assert.ok(champs(avec({ situation: "couple", parts: 1 })).includes("erreur:parts"));
});
