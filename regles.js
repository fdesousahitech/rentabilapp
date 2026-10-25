/*
 * Règles fiscales et bancaires utilisées par le moteur de calcul.
 *
 * Chaque bloc indique sa source et son niveau de vérification :
 *   statut "officiel"  : vérifié sur un texte ou une publication de l'administration
 *   statut "a_verifier" : repris de sources secondaires ou extrapolé, à confirmer
 *
 * Mettre à jour ce fichier suffit pour appliquer une nouvelle loi de finances ;
 * les tests (tests/moteur.test.js) documentent les valeurs attendues.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.REGLES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  return {
    millesime: "Loi de finances 2026",
    verifieLe: "2026-10-25",

    impotRevenu: {
      statut: "officiel",
      source: "LF 2026, art. 197 CGI ; BOI-IR-LIQ-20-10 (actualité du 7 avril 2026)",
      // Barème par part, revenus 2025 : [seuil bas, taux]
      bareme: [
        [0, 0],
        [11600, 0.11],
        [29579, 0.30],
        [84577, 0.41],
        [181917, 0.45]
      ],
      plafondDemiPart: 1807
    },

    decote: {
      statut: "a_verifier",
      source: "Montants 2025 (889 € / 1 470 €) revalorisés de 0,9 %, non confirmés",
      seul: 897,
      couple: 1483,
      taux: 0.4525
    },

    contributionHautsRevenus: {
      statut: "officiel",
      source: "Art. 223 sexies CGI",
      seul: [[250000, 0.03], [500000, 0.04]],
      couple: [[500000, 0.03], [1000000, 0.04]]
    },

    prelevementsSociaux: {
      statut: "a_verifier",
      source: "LFSS 2026 : hausse de 1,4 point de la CSG sur les revenus du capital, revenus fonciers et plus-values immobilières exclus",
      foncier: 0.172,
      bicMeuble: 0.186,
      plusValueImmobiliere: 0.172,
      flatTaxDividendes: 0.314
    },

    revenusFonciers: {
      statut: "officiel",
      source: "Art. 32, 156 I-3° CGI",
      plafondMicro: 15000,
      abattementMicro: 0.30,
      plafondDeficitGlobal: 10700,
      dureeReportDeficit: 10,
      // Le déficit imputé sur le revenu global est repris si la location cesse
      // avant le 31 décembre de la 3e année suivant l'imputation
      dureeMaintienLocation: 3
    },

    meubleNonProfessionnel: {
      statut: "officiel",
      source: "Art. 50-0, 39 C, 150 VB CGI ; LF 2025 art. 84 (réintégration des amortissements)",
      plafondMicro: 77700,
      abattementMicro: 0.50,
      dureeReportDeficit: 10,
      seuilLMP: 23000,
      reintegrationAmortissements: true
    },

    impotSocietes: {
      statut: "officiel",
      source: "Art. 219 CGI",
      seuilTauxReduit: 42500,
      tauxReduit: 0.15,
      tauxNormal: 0.25
    },

    plusValueParticuliers: {
      statut: "officiel",
      source: "Art. 150 U à 150 VH, 1609 nonies G CGI",
      tauxIR: 0.19,
      forfaitFraisAcquisition: 0.075,
      forfaitTravaux: 0.15,
      dureeMinForfaitTravaux: 5,
      // Surtaxe sur les plus-values > 50 000 € : [borne basse, borne haute, taux, coefficient de lissage]
      // Dans une tranche de lissage : taux × PV − coefficient × (borne haute − PV)
      surtaxe: [
        [50000, 60000, 0.02, 1 / 20],
        [60000, 100000, 0.02, 0],
        [100000, 110000, 0.03, 1 / 10],
        [110000, 150000, 0.03, 0],
        [150000, 160000, 0.04, 15 / 100],
        [160000, 200000, 0.04, 0],
        [200000, 210000, 0.05, 20 / 100],
        [210000, 250000, 0.05, 0],
        [250000, 260000, 0.06, 25 / 100],
        [260000, Infinity, 0.06, 0]
      ]
    },

    jeanbrun: {
      statut: "a_verifier",
      source: "LF 2026, art. 31 CGI ; fiche FPI du 21 février 2026. Doctrine administrative non publiée.",
      quotePartAmortissable: 0.80,
      seuilTravauxAncien: 0.30,
      dureeEngagement: 9,
      taux: {
        neuf: { inter: 0.035, social: 0.045, tres: 0.055 },
        ancien: { inter: 0.030, social: 0.035, tres: 0.040 }
      },
      plafonds: { inter: 8000, social: 10000, tres: 12000 }
    },

    hcsf: {
      statut: "officiel",
      source: "Décision HCSF D-HCSF-2021-7 modifiée ; prise en compte de 70 % des loyers : pratique bancaire courante, pas une règle HCSF",
      tauxEffortMax: 0.35,
      dureeMax: 25,
      dureeMaxDiffere: 27,
      partLoyersRetenue: 0.70
    }
  };
});
