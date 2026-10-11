// Import des exports de GMAO : choix du fichier, vérification des colonnes, import.

import { h, vider, ic, essayer, nombreFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { estAdmin } from '/socle/etat.js'

export default {
  chemin: 'import',
  titre: 'Import GMAO',
  icone: 'tableur',
  menu: false,
  aide: 'import-gmao',

  async afficher(zone) {
    if (!estAdmin()) {
      vider(zone, h('div', { class: 'bandeau' }, ic('cadenas'), 'L’import est réservé au mode administrateur (bouton « Consultation » en haut à droite).'))
      return
    }
    const cibles = await api('/api/import/cibles')
    const etape = h('div')
    const choix = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.xls,.xlsx,.xlsm,.ods', style: { display: 'none' }, onchange: (e) => e.target.files[0] && lire(e.target.files[0]) })

    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Import GMAO'), h('p', { class: 'sous-titre' }, 'Machines et historique des interventions, depuis un export CSV, Excel ou LibreOffice'))),
      h(
        'div',
        { class: 'carte', style: { marginBottom: '16px' } },
        h('div', { class: 'depot', onclick: () => choix.click() }, ic('tableur', 30), h('div', {}, h('strong', {}, 'Choisir un export de la GMAO')), h('div', { class: 'discret', style: { fontSize: '13px' } }, 'CSV, XLS, XLSX ou ODS. La première ligne doit contenir les noms des colonnes.'), choix),
      ),
      etape,
    )

    async function lire(fichier) {
      vider(etape, h('p', { class: 'discret curseur' }, 'Lecture du fichier'))
      const resultat = await essayer(() => api('/api/import/lire', { methode: 'POST', fichier, entetes: { 'X-Nom': encodeURIComponent(fichier.name) } }))
      choix.value = ''
      if (!resultat) return vider(etape)
      afficherCorrespondance(etape, resultat, cibles, fichier.name)
    }
  },
}

function afficherCorrespondance(zone, lecture, cibles, nomFichier) {
  let feuille = 0
  let cible = lecture.feuilles[0].cible
  let correspondances = { ...lecture.feuilles[0].correspondances[cible] }
  const mettreAJour = h('input', { type: 'checkbox', checked: true })

  function dessiner() {
    const f = lecture.feuilles[feuille]
    const choixColonne = (champ) =>
      h(
        'select',
        { onchange: (e) => (correspondances[champ.nom] = e.target.value === '' ? null : Number(e.target.value)) },
        h('option', { value: '' }, '— ne pas importer —'),
        f.colonnes.map((c, i) => h('option', { value: i, selected: correspondances[champ.nom] === i }, c)),
      )

    vider(
      zone,
      h(
        'div',
        { class: 'carte', style: { marginBottom: '16px' } },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('tableur', 18), nomFichier), h('span', { class: 'discret' }, `${nombreFr(f.total)} lignes`)),
        lecture.feuilles.length > 1
          ? h('div', { style: { marginBottom: '14px' } }, h('div', { class: 'texte-2', style: { marginBottom: '6px' } }, 'Feuille'), h('div', { class: 'segments' }, lecture.feuilles.map((x, i) => h('button', { class: i === feuille ? 'choisi' : '', onclick: () => { feuille = i; cible = x.cible; correspondances = { ...x.correspondances[cible] }; dessiner() } }, x.nom))))
          : null,
        h('div', { class: 'texte-2', style: { marginBottom: '6px' } }, 'Ce fichier contient des…'),
        h('div', { class: 'segments' }, Object.entries(cibles).map(([cle, c]) => h('button', { class: cle === cible ? 'choisi' : '', onclick: () => { cible = cle; correspondances = { ...f.correspondances[cle] }; dessiner() } }, c.libelle))),
      ),
      h(
        'div',
        { class: 'grille grille-2' },
        h(
          'div',
          { class: 'carte' },
          h('div', { class: 'carte-entete' }, h('h2', {}, 'Correspondance des colonnes')),
          h('p', { class: 'texte-2', style: { fontSize: '14px' } }, 'IASSITEC a reconnu les colonnes ci-dessous. Vérifiez-les : les champs marqués * sont obligatoires.'),
          h('div', { class: 'formulaire' }, cibles[cible].champs.map((champ) => h('label', { class: 'champ' }, h('span', {}, champ.libelle + (champ.obligatoire ? ' *' : '')), choixColonne(champ)))),
          h('label', { class: 'actions texte-2', style: { marginTop: '16px' } }, h('span', { class: 'interrupteur' }, mettreAJour, h('span')), 'Mettre à jour les lignes déjà présentes (même repère, référence ou n°)'),
          h('div', { class: 'actions', style: { marginTop: '18px' } }, h('button', { class: 'principal', onclick: importer }, ic('envoyer', 16), `Importer ${nombreFr(f.total)} lignes`)),
        ),
        h(
          'div',
          { class: 'carte', style: { overflow: 'hidden' } },
          h('div', { class: 'carte-entete' }, h('h2', {}, 'Aperçu'), h('span', { class: 'discret' }, 'premières lignes')),
          h('div', { class: 'tableau-conteneur', style: { maxHeight: '520px', overflow: 'auto' } }, h('table', {}, h('thead', {}, h('tr', {}, f.colonnes.map((c) => h('th', {}, c)))), h('tbody', {}, f.apercu.map((ligne) => h('tr', {}, f.colonnes.map((_, i) => h('td', { style: { whiteSpace: 'nowrap' } }, ligne[i] ?? ''))))))),
        ),
      ),
    )
  }

  async function importer(e) {
    e.target.disabled = true
    e.target.textContent = 'Import en cours…'
    const bilan = await essayer(() => api('/api/import/valider', { methode: 'POST', corps: { jeton: lecture.jeton, feuille, cible, correspondances, mettreAJour: mettreAJour.checked } }))
    if (!bilan) {
      e.target.disabled = false
      e.target.textContent = 'Importer'
      return
    }
    vider(
      zone,
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('coche', 18), 'Import terminé')),
        h('div', { class: 'grille grille-4' },
          h('div', { class: 'tuile' }, h('div', { class: 'libelle' }, 'Créées'), h('div', { class: 'valeur' }, nombreFr(bilan.crees))),
          h('div', { class: 'tuile' }, h('div', { class: 'libelle' }, 'Mises à jour'), h('div', { class: 'valeur' }, nombreFr(bilan.modifies))),
          h('div', { class: 'tuile' }, h('div', { class: 'libelle' }, 'Ignorées'), h('div', { class: 'valeur' }, nombreFr(bilan.ignores))),
          h('div', { class: 'tuile' }, h('div', { class: 'libelle' }, 'Machines ajoutées'), h('div', { class: 'valeur' }, nombreFr(bilan.machinesCreees))),
        ),
        bilan.erreurs.length ? h('div', { style: { marginTop: '16px' } }, h('h3', {}, 'Lignes non importées'), h('ul', { class: 'texte-2' }, bilan.erreurs.map((e) => h('li', {}, e)))) : null,
        h('p', { class: 'texte-2', style: { marginTop: '16px' } }, 'La correspondance des colonnes est retenue : le prochain export du même logiciel sera reconnu directement. L’IA prépare la recherche dans ces nouvelles données en arrière-plan.'),
        h('div', { class: 'actions' }, h('a', { class: 'bouton', href: '#/tableau-de-bord' }, 'Voir le tableau de bord'), h('a', { class: 'bouton principal', href: '#/assistant' }, 'Poser une question à l’IA')),
      ),
    )
  }

  dessiner()
}
