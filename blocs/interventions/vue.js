// L'historique des interventions.

import { h, vider, ic, tableau, fenetre, formulaire, confirmer, essayer, dateFr, nombreFr, apresPause } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { estAdmin } from '/socle/etat.js'

export default {
  chemin: 'interventions',
  titre: 'Interventions',
  icone: 'cle',
  menu: false,
  aide: 'assistant',

  async afficher(zone, { id, query }) {
    if (id) return afficherFiche(zone, id)

    const [machines, types] = await Promise.all([api('/api/machines'), api('/api/interventions-types')])
    const liste = h('div')
    const recherche = h('input', { type: 'search', placeholder: 'Description, cause, n° d’OT, intervenant…' })
    const machine = h('select', {}, h('option', { value: '' }, 'Toutes les machines'), machines.map((m) => h('option', { value: m.id, selected: String(m.id) === query.machine }, `${m.repere} — ${m.designation}`)))
    const type = h('select', {}, h('option', { value: '' }, 'Tous les types'), types.map((t) => h('option', { value: t }, t)))

    async function charger() {
      const parametres = new URLSearchParams({ q: recherche.value, machine: machine.value, type: type.value })
      const interventions = await api('/api/interventions?' + parametres)
      vider(
        liste,
        interventions.length === 500 ? h('p', { class: 'discret' }, 'Les 500 plus récentes sont affichées : précisez la recherche pour voir les autres.') : null,
        tableau({
          lignes: interventions,
          surClic: (i) => (location.hash = `#/interventions/${i.id}`),
          vide: 'Aucune intervention. Importez l’historique depuis la GMAO (menu Import GMAO).',
          colonnes: [
            { titre: 'Date', valeur: (i) => dateFr(i.date) },
            { titre: 'N°', valeur: (i) => h('span', { class: 'mono discret' }, i.numero || '') },
            { titre: 'Machine', valeur: (i) => (i.repere ? h('b', { class: 'mono' }, i.repere) : '') },
            { titre: 'Type', valeur: (i) => h('span', { class: `etiquette ${i.type === 'Correctif' ? 'violet' : ''}` }, i.type) },
            { titre: 'Description', valeur: (i) => i.description },
            { titre: 'Cause', valeur: (i) => h('span', { class: 'texte-2' }, i.cause) },
            { titre: 'Durée', classe: 'nombre', valeur: (i) => (i.duree_h !== null ? `${nombreFr(i.duree_h, 2)} h` : '') },
          ],
        }),
      )
    }
    recherche.addEventListener('input', apresPause(charger))
    machine.addEventListener('change', charger)
    type.addEventListener('change', charger)

    vider(
      zone,
      h(
        'div',
        { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Interventions'), h('p', { class: 'sous-titre' }, 'L’historique des pannes, entretiens et réglages')),
        estAdmin() ? h('button', { class: 'principal', onclick: () => modifierIntervention(null, machines, types, query.machine) }, ic('plus', 16), 'Ajouter une intervention') : null,
      ),
      h('div', { class: 'filtres' }, recherche, machine, type),
      liste,
    )
    await charger()
  },
}

async function afficherFiche(zone, id) {
  const [i, machines, types] = await Promise.all([api(`/api/interventions/${id}`), api('/api/machines'), api('/api/interventions-types')])
  const info = (libelle, valeur) => h('div', {}, h('div', { class: 'discret', style: { fontSize: '13px' } }, libelle), h('div', {}, valeur || '—'))
  vider(
    zone,
    h(
      'div',
      { class: 'entete-page' },
      h('button', { class: 'discret icone-seule', title: 'Retour', onclick: () => history.back() }, ic('retour')),
      h('div', { style: { flex: 1 } }, h('h1', {}, `Intervention du ${dateFr(i.date)}`), h('p', { class: 'sous-titre' }, i.numero ? `N° ${i.numero}` : '')),
      h('span', { class: `etiquette ${i.type === 'Correctif' ? 'violet' : ''}` }, i.type),
      estAdmin() ? h('button', { onclick: () => modifierIntervention(i, machines, types) }, ic('crayon', 16), 'Modifier') : null,
      estAdmin() ? h('button', { class: 'danger', onclick: () => supprimerIntervention(i) }, ic('poubelle', 16)) : null,
    ),
    h(
      'div',
      { class: 'carte' },
      h('div', { class: 'grille grille-4', style: { marginBottom: '18px' } },
        info('Machine', i.repere ? h('a', { href: `#/parc/${i.machine_id}` }, `${i.repere} — ${i.machine}`) : ''),
        info('Intervenant', i.intervenant), info('Durée', i.duree_h !== null ? `${nombreFr(i.duree_h, 2)} h` : ''), info('Statut', i.statut),
      ),
      h('h3', {}, 'Description'),
      h('p', { style: { whiteSpace: 'pre-wrap' } }, i.description),
      i.cause ? [h('h3', { style: { marginTop: '14px' } }, 'Cause / symptôme'), h('p', { style: { whiteSpace: 'pre-wrap' } }, i.cause)] : null,
    ),
  )
}

async function modifierIntervention(intervention, machines, types, machineParDefaut) {
  const form = formulaire(
    [
      { nom: 'date', libelle: 'Date', type: 'date', obligatoire: true, defaut: new Date().toISOString().slice(0, 10) },
      { nom: 'machine_id', libelle: 'Machine', type: 'choix', choix: [['', '— aucune —'], ...machines.map((m) => [m.id, `${m.repere} — ${m.designation}`])], defaut: machineParDefaut || '' },
      { nom: 'type', libelle: 'Type', type: 'choix', choix: types, defaut: 'Correctif' },
      { nom: 'numero', libelle: 'N° (ordre de travail)' },
      { nom: 'description', libelle: 'Description', type: 'zone', obligatoire: true },
      { nom: 'cause', libelle: 'Cause / symptôme', type: 'zone' },
      { nom: 'intervenant', libelle: 'Intervenant' },
      { nom: 'duree_h', libelle: 'Durée (heures)', type: 'nombre' },
      { nom: 'statut', libelle: 'Statut', type: 'choix', choix: ['Terminée', 'En cours', 'En attente de pièce', 'Planifiée'], defaut: 'Terminée' },
    ],
    intervention || {},
  )
  await fenetre({
    titre: intervention ? 'Modifier l’intervention' : 'Nouvelle intervention',
    large: true,
    contenu: form.element,
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      {
        texte: 'Enregistrer',
        classe: 'principal',
        action: async () => {
          const donnees = form.lire()
          donnees.machine_id = Number(donnees.machine_id) || null
          if (!donnees.numero) donnees.numero = null
          const { id } = await api(intervention ? `/api/interventions/${intervention.id}` : '/api/interventions', { methode: intervention ? 'PUT' : 'POST', corps: donnees })
          if (intervention) window.iassitec.recharger()
          else location.hash = `#/interventions/${id}`
        },
      },
    ],
  })
}

async function supprimerIntervention(i) {
  if (!(await confirmer('Supprimer cette intervention ?', { texte: 'Supprimer', danger: true }))) return
  if (await essayer(() => api(`/api/interventions/${i.id}`, { methode: 'DELETE' }), 'Intervention supprimée')) history.back()
}
