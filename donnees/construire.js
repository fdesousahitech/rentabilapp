#!/usr/bin/env node
/*
 * Construit les agrégats de marché par département à partir des données publiques :
 *   - DVF géolocalisées (ventes immobilières, DGFiP / Etalab) : prix au m² par commune et type de logement
 *   - Carte des loyers (ministère du Logement) : loyer d'annonce au m² par commune
 *
 * Sortie : donnees/marche/<département>.json, donnees/marche/meta.json et donnees/quartiers/<département>.json
 * (histogrammes de prix au m² par carré d'environ 300 m, pour les estimations à l'échelle du quartier)
 * Exécution : node donnees/construire.js (Node 20 ou plus, sans dépendance). Lancé par
 * .github/workflows/donnees.yml, l'environnement de développement n'ayant pas accès à data.gouv.fr.
 *
 * Seuls des agrégats sont publiés (médianes, quartiles, nombres de ventes), jamais de vente individuelle :
 * la réutilisation des DVF ne doit pas permettre de réidentifier les personnes.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const readline = require("node:readline");
const { Readable } = require("node:stream");
const { construireIndex } = require("./index-communes.js");

const SORTIE = path.join(__dirname, "marche");
const DVF_BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv";
const LOYERS_DATASET = "https://www.data.gouv.fr/api/1/datasets/693aa2feed1bf4da603faa49/";
const ANNEES_RECENTES = 3;
const VENTES_MIN_ANNEE = 10;
const SORTIE_QUARTIERS = path.join(__dirname, "quartiers");
// Carrés d'environ 300 m ; prix au m² répartis en 64 classes logarithmiques de 300 à 30 000 €/m².
// Un carré n'est publié qu'à partir de 5 ventes par type de logement : seuls des comptages sortent, jamais une vente.
const GRILLE = { lat: 0.0027, lon: 0.004 };
const BORNES = { min: 300, max: 30000, n: 64 };
const VENTES_MIN_CARRE = 5;
const GEOCODAGE_TEST = "https://data.geopf.fr/geocodage/search?q=20%20avenue%20de%20Segur%20Paris&autocomplete=1&limit=1";
const DEPARTEMENTS = [];
for (let i = 1; i <= 95; i++) {
  if (i === 20) DEPARTEMENTS.push("2A", "2B");
  else DEPARTEMENTS.push(String(i).padStart(2, "0"));
}
DEPARTEMENTS.push("971", "972", "973", "974", "976");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- Outils ----------

function decouperCSV(ligne, sep) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (q) {
      if (c === '"') { if (ligne[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const nombre = v => { const x = parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : null; };

function quantile(tri, q) {
  if (!tri.length) return null;
  const pos = (tri.length - 1) * q, b = Math.floor(pos), r = pos - b;
  return tri[b + 1] !== undefined ? tri[b] + r * (tri[b + 1] - tri[b]) : tri[b];
}

async function telecharger(url, essais = 3) {
  for (let i = 1; i <= essais; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (i === essais) throw new Error(`${url} : ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

async function parallele(taches, n) {
  const res = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < taches.length) { const k = i++; res[k] = await taches[k](); }
  }));
  return res;
}

// ---------- DVF ----------

async function anneesDVF() {
  const an = new Date().getFullYear();
  const annees = [];
  for (let a = an - 7; a <= an; a++) {
    const res = await telecharger(`${DVF_BASE}/${a}/departements/75.csv.gz`);
    if (res) { annees.push(a); res.body.cancel(); }
  }
  return annees;
}

// Lit un fichier département × année et renvoie les ventes d'un seul logement
async function lireDVF(annee, dep, communes) {
  const res = await telecharger(`${DVF_BASE}/${annee}/departements/${dep}.csv.gz`);
  if (!res) return [];
  const flux = Readable.fromWeb(res.body).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: flux, crlfDelay: Infinity });
  let idx = null;
  const mutations = new Map();
  for await (const ligne of rl) {
    if (!idx) {
      const h = decouperCSV(ligne, ",");
      idx = Object.fromEntries(h.map((k, i) => [k, i]));
      ["id_mutation", "nature_mutation", "valeur_fonciere", "code_postal", "code_commune", "nom_commune", "type_local", "surface_reelle_bati", "nombre_pieces_principales", "longitude", "latitude"]
        .forEach(k => { if (!(k in idx)) throw new Error(`Colonne DVF absente : ${k} (${h.join(",")})`); });
      continue;
    }
    const c = decouperCSV(ligne, ",");
    const com = c[idx.code_commune], cp = c[idx.code_postal];
    if (com) {
      const fiche = communes.get(com) || { nom: c[idx.nom_commune], cp: new Set() };
      if (cp) fiche.cp.add(cp.padStart(5, "0"));
      communes.set(com, fiche);
    }
    if (c[idx.nature_mutation] !== "Vente") continue;
    const id = c[idx.id_mutation];
    let m = mutations.get(id);
    if (!m) { m = { valeur: nombre(c[idx.valeur_fonciere]), com, lat: nombre(c[idx.latitude]), lon: nombre(c[idx.longitude]), locaux: new Map(), autre: false }; mutations.set(id, m); }
    const type = c[idx.type_local];
    if (type === "Appartement" || type === "Maison") {
      const surf = nombre(c[idx.surface_reelle_bati]);
      m.locaux.set(`${type}|${surf}|${c[idx.nombre_pieces_principales]}`, { type, surf });
    } else if (type && type !== "Dépendance") m.autre = true;
  }
  const ventes = [];
  for (const m of mutations.values()) {
    if (m.autre || m.locaux.size !== 1 || !(m.valeur > 1000)) continue;
    const [l] = m.locaux.values();
    if (!(l.surf >= 9)) continue;
    const m2 = m.valeur / l.surf;
    if (m2 < 200 || m2 > 30000) continue;
    ventes.push({ com: m.com, type: l.type === "Maison" ? "maison" : "appartement", annee, m2, lat: m.lat, lon: m.lon });
  }
  return ventes;
}

function agreger(ventes, anneesRecentes, toutesAnnees) {
  const recentes = ventes.filter(v => anneesRecentes.includes(v.annee)).map(v => v.m2).sort((a, b) => a - b);
  if (!recentes.length) return null;
  const out = {
    med: Math.round(quantile(recentes, 0.5)), q1: Math.round(quantile(recentes, 0.25)), q3: Math.round(quantile(recentes, 0.75)),
    n: recentes.length, periode: `${anneesRecentes[0]}-${anneesRecentes[anneesRecentes.length - 1]}`
  };
  // Évolution annuelle : pente des médianes annuelles (en logarithme) sur les années assez fournies
  const pts = toutesAnnees.map(a => {
    const s = ventes.filter(v => v.annee === a).map(v => v.m2).sort((x, y) => x - y);
    return s.length >= VENTES_MIN_ANNEE ? [a, Math.log(quantile(s, 0.5))] : null;
  }).filter(Boolean);
  if (pts.length >= 3) {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const pente = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    out.evolution = Math.round((Math.exp(pente) - 1) * 10000) / 10000;
    out.anneesEvolution = `${pts[0][0]}-${pts[pts.length - 1][0]}`;
  }
  return out;
}

// Histogrammes de prix par carré de la grille, sur la période récente
function quartiers(ventes, anneesRecentes) {
  const echelle = Math.log(BORNES.max / BORNES.min);
  const classe = m2 => Math.max(0, Math.min(BORNES.n - 1, Math.floor(Math.log(m2 / BORNES.min) / echelle * BORNES.n)));
  const carres = {};
  ventes.forEach(v => {
    if (v.lat == null || v.lon == null || !anneesRecentes.includes(v.annee)) return;
    const k = `${Math.floor(v.lat / GRILLE.lat)}:${Math.floor(v.lon / GRILLE.lon)}`;
    const t = carres[k] = carres[k] || {};
    const h = t[v.type] = t[v.type] || {};
    const b = classe(v.m2);
    h[b] = (h[b] || 0) + 1;
  });
  const sortie = {};
  for (const [k, t] of Object.entries(carres)) {
    const o = {};
    for (const [type, h] of Object.entries(t)) {
      const n = Object.values(h).reduce((s, c) => s + c, 0);
      if (n >= VENTES_MIN_CARRE) o[type === "maison" ? "m" : "a"] = Object.entries(h).map(([b, c]) => [+b, c]).sort((x, y) => x[0] - y[0]);
    }
    if (Object.keys(o).length) sortie[k] = o;
  }
  return sortie;
}

// Contrôle du service de géocodage utilisé par l'application : statut, en-tête CORS et forme de la réponse
async function verifierGeocodage() {
  try {
    const res = await fetch(GEOCODAGE_TEST, { headers: { Origin: "https://rentabilapp.github.io" } });
    const cors = res.headers.get("access-control-allow-origin");
    const d = await res.json();
    const f = d.features && d.features[0];
    log(`Géocodage : HTTP ${res.status}, CORS « ${cors} », ${d.features ? d.features.length : 0} résultat(s)`);
    if (f) log(`  propriétés : ${JSON.stringify(f.properties)} ; coordonnées : ${JSON.stringify(f.geometry && f.geometry.coordinates)}`);
    return { statut: res.status, cors, proprietes: f ? Object.keys(f.properties) : [] };
  } catch (e) {
    log(`Géocodage : échec du contrôle (${e.message})`);
    return { erreur: e.message };
  }
}

// ---------- Carte des loyers ----------

async function lireLoyers() {
  const res = await telecharger(LOYERS_DATASET);
  const ds = await res.json();
  log(`Carte des loyers : « ${ds.title} », ${ds.resources.length} ressources`);
  ds.resources.forEach(r => log(`  - ${r.title} | ${r.format} | ${r.url}`));
  const choisir = motif => ds.resources.find(r => /csv/i.test(r.format || r.url) && motif.test(`${r.title} ${r.url}`));
  const cibles = {
    appartement: choisir(/pred-app-|appartements?(?![^]*(t1|t3|1-2|3 ?pi))/i),
    maison: choisir(/pred-mai|maisons?/i)
  };
  const loyers = { appartement: new Map(), maison: new Map() };
  for (const [type, r] of Object.entries(cibles)) {
    if (!r) { log(`  ! aucune ressource trouvée pour ${type}`); continue; }
    const buf = await (await telecharger(r.url)).arrayBuffer();
    let texte;
    try { texte = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { texte = new TextDecoder("latin1").decode(buf); }
    const lignes = texte.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
    const sep = (lignes[0].match(/;/g) || []).length > (lignes[0].match(/,/g) || []).length ? ";" : ",";
    const h = decouperCSV(lignes[0], sep).map(x => x.trim());
    log(`  ${type} : ${r.title}, séparateur « ${sep} », colonnes ${h.join(" | ")}`);
    const col = re => h.findIndex(x => re.test(x));
    const iC = col(/^insee/i), iM = col(/loypredm2/i), iB = col(/lwr/i), iH = col(/upr/i), iT = col(/typpred/i), iN = col(/nbobs_com/i);
    if (iC < 0 || iM < 0) throw new Error(`Colonnes INSEE ou loypredm2 introuvables pour ${type}`);
    for (const l of lignes.slice(1)) {
      const c = decouperCSV(l, sep);
      const code = (c[iC] || "").trim().padStart(5, "0");
      const m2 = nombre(c[iM]);
      if (!code || !(m2 > 0)) continue;
      loyers[type].set(code, {
        m2: Math.round(m2 * 100) / 100,
        bas: iB >= 0 ? Math.round(nombre(c[iB]) * 100) / 100 : null,
        haut: iH >= 0 ? Math.round(nombre(c[iH]) * 100) / 100 : null,
        n: iN >= 0 ? nombre(c[iN]) : null,
        fiabilite: iT >= 0 ? (c[iT] || "").trim() : null
      });
    }
    log(`  ${type} : ${loyers[type].size} communes`);
  }
  return { titre: ds.title, page: ds.page, loyers, ressources: Object.values(cibles).filter(Boolean).map(r => r.url) };
}

// ---------- Programme principal ----------

(async () => {
  fs.mkdirSync(SORTIE, { recursive: true });
  fs.mkdirSync(SORTIE_QUARTIERS, { recursive: true });
  const geocodage = await verifierGeocodage();
  const loyers = await lireLoyers();
  const annees = await anneesDVF();
  if (annees.length < 2) throw new Error(`Années DVF introuvables (${annees.join(", ")})`);
  const recentes = annees.slice(-ANNEES_RECENTES);
  log(`DVF : années ${annees.join(", ")}, période récente ${recentes.join(", ")}`);

  let totalVentes = 0, communesAvecPrix = 0, communesAvecLoyer = 0, nbCommunes = 0, nbCarres = 0;
  const disponibles = [];
  await parallele(DEPARTEMENTS.map(dep => async () => {
    const communes = new Map();
    let ventes = [];
    for (const a of annees) ventes = ventes.concat(await lireDVF(a, dep, communes));
    if (!communes.size) { log(`  ${dep} : aucune donnée DVF`); return; }
    totalVentes += ventes.length;
    const parCommune = new Map();
    ventes.forEach(v => { const l = parCommune.get(v.com) || []; l.push(v); parCommune.set(v.com, l); });
    const sortie = { departement: dep, communes: {}, codesPostaux: {}, departementAgregat: { prix: {} } };
    for (const t of ["appartement", "maison"]) {
      const agg = agreger(ventes.filter(v => v.type === t), recentes, annees);
      if (agg) sortie.departementAgregat.prix[t] = agg;
    }
    for (const [code, fiche] of communes) {
      const vs = parCommune.get(code) || [];
      const c = { nom: fiche.nom, prix: {}, loyers: {} };
      for (const t of ["appartement", "maison"]) {
        const agg = agreger(vs.filter(v => v.type === t), recentes, annees);
        if (agg) c.prix[t] = agg;
        const l = loyers.loyers[t].get(code);
        if (l) c.loyers[t] = l;
      }
      if (Object.keys(c.prix).length) communesAvecPrix++;
      if (Object.keys(c.loyers).length) communesAvecLoyer++;
      nbCommunes++;
      sortie.communes[code] = c;
      fiche.cp.forEach(cp => { (sortie.codesPostaux[cp] = sortie.codesPostaux[cp] || []).push(code); });
    }
    Object.values(sortie.codesPostaux).forEach(l => l.sort());
    fs.writeFileSync(path.join(SORTIE, `${dep}.json`), JSON.stringify(sortie));
    const carres = quartiers(ventes, recentes);
    fs.writeFileSync(path.join(SORTIE_QUARTIERS, `${dep}.json`), JSON.stringify({ departement: dep, periode: `${recentes[0]}-${recentes[recentes.length - 1]}`, grille: GRILLE, bornes: BORNES, carres }));
    nbCarres += Object.keys(carres).length;
    disponibles.push(dep);
    log(`  ${dep} : ${communes.size} communes, ${ventes.length} ventes retenues`);
  }), 6);

  const meta = {
    genereLe: new Date().toISOString(),
    departements: DEPARTEMENTS,
    disponibles: DEPARTEMENTS.filter(d => disponibles.includes(d)),
    dvf: { source: "https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees/", annees, periodeRecente: `${recentes[0]}-${recentes[recentes.length - 1]}`, ventesRetenues: totalVentes },
    loyers: { source: loyers.page, titre: loyers.titre, ressources: loyers.ressources },
    quartiers: { grille: GRILLE, bornes: BORNES, ventesMinimumParCarre: VENTES_MIN_CARRE, carres: nbCarres },
    geocodage,
    couverture: { communes: nbCommunes, communesAvecPrix, communesAvecLoyer }
  };
  fs.writeFileSync(path.join(SORTIE, "meta.json"), JSON.stringify(meta, null, 2));
  log(`Index des communes : ${construireIndex(SORTIE)} communes`);
  log("Terminé", JSON.stringify(meta.couverture), `ventes retenues : ${totalVentes}`);
})().catch(e => { console.error(e); process.exit(1); });
