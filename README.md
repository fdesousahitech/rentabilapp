# rentabilapp

Comparateur fiscal locatif, en ligne sur https://fdesousahitech.github.io/rentabilapp/

Application web autonome (sans dépendance ni build) qui compare la rentabilité d'un même investissement locatif selon cinq modes de détention : location nue (micro-foncier ou réel), LMNP (micro-BIC ou réel), SCI à l'IR, SCI à l'IS et dispositif Jeanbrun.

Intègre frais d'acquisition, financement, charges, vacance, fiscalité annuelle (déficit foncier, amortissements, IS), fiscalité de revente (plus-value des particuliers ou professionnelle, flat tax) et calcule rendements, trésorerie, enrichissement net et TRI.

L'application est un site statique : `index.html` à la racine, sans installation ni compilation. Les règles fiscales appliquées et leurs limites sont détaillées en bas de page.

Organisation :

- `regles.js` : taux, plafonds et barèmes, avec leur source et leur statut (officiel ou à vérifier). Une nouvelle loi de finances se traduit par une mise à jour de ce seul fichier.
- `moteur.js` : moteur de calcul pur (prêt, impôt du foyer, régimes fiscaux, plus-values, TRI, faisabilité bancaire, contrôle des saisies), avec la trace de chaque calcul.
- `index.html` : interface et export PDF. L'aide à la décision (verdict avec seuil de significativité, scénarios, sensibilité des hypothèses, seuils de prix, de loyer et de valorisation, durée de détention optimale, comparaison à un placement alternatif) s'appuie sur les fonctions du moteur. L'interface propose un mode rapide (hypothèses essentielles) et un mode expert, une vue mobile Hypothèses / Résultats, l'enregistrement de simulations dans le navigateur avec export et import d'un fichier JSON, la comparaison de plusieurs biens et la décomposition de l'enrichissement (« Où va l'argent »).
- `donnees/construire.js` : télécharge les ventes DVF géolocalisées (DGFiP) et la Carte des loyers (ministère du Logement) et publie des agrégats par département dans `donnees/marche/`, ainsi qu'un index national des communes (`communes.json`, produit par `donnees/index-communes.js`) pour la recherche par nom de ville (prix médian et quartiles au m², évolution annuelle, loyer d'annonce au m², codes postaux). Exécuté chaque mois par GitHub Actions (`.github/workflows/donnees.yml`). Seuls des agrégats sont publiés, jamais de vente individuelle. Les données se chargent par `fetch` : ouvrir l'application via un serveur web (GitHub Pages ou `python3 -m http.server`), pas en fichier local.
- `tests/` : tests sur des cas calculés à la main, exécutés par `npm test` à la racine (Node 20 ou plus, aucune dépendance) et par GitHub Actions à chaque modification.

