// Données de la GMAO : synchronisation directe avec la base MySQL (le plus simple, toujours à jour),
// ou import d'un export : choix du fichier, vérification des colonnes, import.

import { h, vider, ic, essayer, nombreFr, notifier, dateHeureFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier, etat } from '/socle/etat.js'
import { demanderMotDePasse } from '/socle/connexion.js'
import { boutonAssistant, CHAMPS } from '../../interface/requetes-assistees.js'

export default {
  chemin: 'import',
  titre: 'Import GMAO',
  icone: 'tableur',
  menu: false,
  admin: true,
  aide: 'import-gmao',

  async afficher(zone) {
    if (!peutModifier()) {
      vider(zone, h('div', { class: 'bandeau' }, ic('cadenas'), 'L’import est réservé au mode administrateur (bouton « Consultation » en haut à droite).'))
      return
    }
    const cibles = await api('/api/import/cibles')
    const etape = h('div')
    const choix = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.xls,.xlsx,.xlsm,.ods', style: { display: 'none' }, onchange: (e) => e.target.files[0] && lire(e.target.files[0]) })

    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Données de la GMAO'), h('p', { class: 'sous-titre' }, 'Machines et historique des interventions : directement depuis la base, ou depuis un export CSV, Excel ou LibreOffice'))),
      await carteSynchronisation(),
      h('h2', { style: { margin: '24px 0 10px' } }, 'Ou depuis un export'),
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
          h('p', { class: 'texte-2', style: { fontSize: '14px' } }, 'AITEC a reconnu les colonnes ci-dessous. Vérifiez-les : les champs marqués * sont obligatoires.'),
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

// ---------------------------------------------------------------- synchronisation avec la base

async function carteSynchronisation() {
  const s = await api('/api/gmao/synchronisation')
  const machines = h('textarea', { class: 'sql', rows: 8, spellcheck: false, placeholder: 'SELECT … AS repere, … AS designation, … AS famille, … AS emplacement … FROM …' }, s.requetes.machines)
  const interventions = h('textarea', { class: 'sql', rows: 8, spellcheck: false, placeholder: 'SELECT … AS numero, … AS date, … AS machine, … AS type, … AS description … FROM …' }, s.requetes.interventions)
  const demandes = h('textarea', { class: 'sql', rows: 8, spellcheck: false, placeholder: 'SELECT … AS numero, … AS date, … AS machine, … AS type, … AS description, … AS demandeur, … AS etat, … AS arret FROM …' }, s.requetes.demandes || '')
  const corpsRequetes = () => ({ machines: machines.value, interventions: interventions.value, demandes: demandes.value })
  const bilan = h('div')
  const montrer = (b) => {
    if (!b) return vider(bilan, h('p', { class: 'discret' }, 'Pas encore de synchronisation.'))
    const ligne = (cle, titre) => b[cle] ? h('li', {}, `${titre} : ${nombreFr(b[cle].lignes)} lues, ${nombreFr(b[cle].crees)} nouvelles, ${nombreFr(b[cle].modifies)} modifiées, ${nombreFr(b[cle].inchanges)} inchangées${b[cle].ignores ? `, ${nombreFr(b[cle].ignores)} ignorées` : ''}`, b[cle].erreurs?.length ? h('div', { class: 'discret', style: { fontSize: '12px' } }, b[cle].erreurs.join(' ; ')) : null) : null
    vider(bilan, h('p', { class: 'texte-2', style: { margin: '8px 0 4px' } }, `Dernière synchronisation avec des changements : ${dateHeureFr(b.date)}`), h('ul', { style: { margin: 0 } }, ligne('machines', 'Machines'), ligne('interventions', 'Interventions')))
  }
  montrer(s.derniere)
  async function synchroniser() {
    // Requêtes modifiées dans les cases mais pas encore enregistrées : on les enregistre d'abord.
    if (machines.value.trim() !== (s.requetes.machines || '').trim() || interventions.value.trim() !== (s.requetes.interventions || '').trim() || demandes.value.trim() !== (s.requetes.demandes || '').trim()) {
      const ok = await essayer(() => api('/api/gmao/requetes', { methode: 'POST', corps: corpsRequetes() }))
      if (!ok) return
      s.requetes = ok
    }
    if (!etat.connexion?.ouverte) await demanderMotDePasse()
    vider(bilan, h('p', { class: 'discret curseur' }, 'Lecture de la base et mise à jour'))
    const b = await essayer(() => api('/api/gmao/synchroniser', { methode: 'POST' }))
    if (b) {
      montrer(b)
      notifier('Données de la GMAO à jour.')
    } else montrer(s.derniere)
  }
  return h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('base', 18), 'Directement depuis la base de la GMAO')),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'AITEC lit le parc et les interventions dans la base de la GMAO (la connexion MySQL de KTEC, réglée une fois dans les Réglages du portail), puis se tient à jour tout seul tous les quarts d’heure.'),
    h('ol', { class: 'texte-2', style: { fontSize: '14px', marginTop: 0 } },
      h('li', {}, 'Deux requêtes SELECT disent où trouver les données : une ligne par machine, une ligne par intervention. Leurs colonnes portent les noms des champs d’AITEC (« AS repere », « AS date »…). La colonne « machine » des interventions (le repère de la machine) rattache chaque intervention à sa machine : sans elle, l’IA ne sait pas sur quoi porte une intervention.'),
      h('li', {}, '« Synchroniser maintenant » enregistre les requêtes dans le fichier de connaissances et lit la base une première fois. Ensuite, c’est automatique.')),
    s.requetes.machines || s.requetes.interventions ? null : h('div', { class: 'bandeau info' }, ic('base'), 'Aucune requête pour l’instant : ouvrez « Les requêtes » ci-dessous.'),
    h('details', { open: !(s.requetes.machines && s.requetes.interventions) },
      h('summary', { class: 'discret' }, 'Les requêtes (rangées dans le fichier de connaissances)'),
      h('div', { class: 'champ', style: { marginTop: '10px' } }, h('span', { class: 'tete-requete' }, h('span', {}, 'Machines — colonnes : repere, designation, famille, marque, modele, numero_serie, emplacement, mise_en_service, etat, notes'), boutonAssistant(machines, { titre: 'Requête des machines', champs: CHAMPS.machines, consigne: 'Une ligne par machine du parc.' })), machines),
      h('div', { class: 'champ', style: { marginTop: '10px' } }, h('span', { class: 'tete-requete' }, h('span', {}, 'Interventions — colonnes : numero, date, machine (repère), type, description, cause, intervenant, duree_h, statut'), boutonAssistant(interventions, { titre: 'Requête des interventions', champs: CHAMPS.interventions, consigne: 'Une ligne par intervention (bon de travail réalisé).' })), interventions),
      h('div', { class: 'champ', style: { marginTop: '10px' } }, h('span', { class: 'tete-requete' }, h('span', {}, 'Demandes d’intervention (facultatif, pour le tableau de bord de la maintenance de niveau 1, lu en direct) — colonnes : numero, date, machine (repère), type, description, demandeur, etat, arret'), boutonAssistant(demandes, { titre: 'Requête des demandes d’intervention', champs: CHAMPS.demandes, consigne: 'Une ligne par demande d’intervention.' })), demandes),
      h('div', { class: 'actions', style: { marginTop: '10px' } },
        h('button', { onclick: () => essayer(() => api('/api/gmao/requetes', { methode: 'POST', corps: corpsRequetes() }), 'Requêtes enregistrées') }, ic('coche', 16), 'Enregistrer les requêtes')),
    ),
    h('div', { class: 'actions', style: { marginTop: '12px' } }, h('button', { class: 'principal', onclick: synchroniser, title: 'Enregistre les requêtes si elles ont changé, puis lit la base' }, ic('rafraichir', 16), 'Synchroniser maintenant')),
    bilan,
  )
}
