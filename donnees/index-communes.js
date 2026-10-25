#!/usr/bin/env node
/*
 * Construit donnees/marche/communes.json : index national des communes pour la recherche par nom.
 * Chaque entrée : [nom, code INSEE, département, codes postaux, nombre de ventes]. Le nombre de ventes
 * sert à classer les suggestions (les communes actives d'abord).
 *
 * Appelé par construire.js ; exécutable seul à partir des fichiers départementaux déjà générés :
 *   node donnees/index-communes.js
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

function construireIndex(dossier) {
  const communes = [];
  fs.readdirSync(dossier).filter(f => /^\w{2,3}\.json$/.test(f)).sort().forEach(f => {
    const d = JSON.parse(fs.readFileSync(path.join(dossier, f), "utf8"));
    const cpParCommune = {};
    Object.entries(d.codesPostaux || {}).forEach(([cp, codes]) => codes.forEach(c => { (cpParCommune[c] = cpParCommune[c] || []).push(cp); }));
    Object.entries(d.communes).forEach(([code, c]) => {
      const ventes = Object.values(c.prix || {}).reduce((s, p) => s + (p.n || 0), 0);
      communes.push([c.nom, code, d.departement, (cpParCommune[code] || []).sort(), ventes]);
    });
  });
  communes.sort((a, b) => a[0].localeCompare(b[0], "fr"));
  fs.writeFileSync(path.join(dossier, "communes.json"), JSON.stringify({ genereLe: new Date().toISOString(), communes }));
  return communes.length;
}

module.exports = { construireIndex };

if (require.main === module) {
  const n = construireIndex(path.join(__dirname, "marche"));
  console.log(`communes.json : ${n} communes`);
}
