// Le parc : la liste des machines (une machine s'ouvre sur son analyse, il n'y a plus de fiche machine).

import { h, vider, ic, tableau, fenetre, formulaire, dateFr, apresPause } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier } from '/socle/etat.js'
import { avecParc } from '../../interface/parcs.js'

export const ETATS = ['En service', 'En panne', 'En réserve', 'Hors service', 'Réformée']

export default {
  chemin: 'parc',
  parcs: true, // le choix du parc sous le titre
  titre: 'Parc',
  icone: 'usine',
  menu: false,
  aide: 'assistant',

  async afficher(zone, { id, query }) {
    // Plus de fiche machine dans AITEC : une machine s'ouvre sur son analyse.
    if (id) return location.replace(`#/analyse/${id}`)

    const [valeurs] = await Promise.all([api('/api/machines-valeurs')])
    const liste = h('div')
    const recherche = h('input', { type: 'search', placeholder: 'Repère, désignation, marque, emplacement…', value: query.q || '' })
    const famille = h('select', {}, h('option', { value: '' }, 'Toutes les familles'), valeurs.familles.map((f) => h('option', { value: f, selected: f === query.famille }, f)))

    async function charger() {
      const parametres = new URLSearchParams({ q: recherche.value, famille: famille.value })
      const machines = await api(avecParc('/api/machines?' + parametres))
      vider(
        liste,
        tableau({
          lignes: machines,
          surClic: (m) => (location.hash = `#/parc/${m.id}`),
          vide: 'Aucune machine. Importez votre parc depuis la GMAO (menu Import GMAO) ou ajoutez une machine.',
          colonnes: [
            { titre: 'Repère', valeur: (m) => h('b', { class: 'mono' }, m.repere) },
            { titre: 'Désignation', valeur: (m) => m.designation },
            { titre: 'Famille', valeur: (m) => m.famille },
            { titre: 'Emplacement', valeur: (m) => m.emplacement },
            { titre: 'État', valeur: (m) => etiquetteEtat(m.etat) },
            { titre: 'Documents', classe: 'nombre', valeur: (m) => m.nb_documents || '' },
            { titre: 'Interventions', classe: 'nombre', valeur: (m) => m.nb_interventions || '' },
            { titre: 'Dernière', valeur: (m) => dateFr(m.derniere_intervention) },
          ],
        }),
      )
    }
    recherche.addEventListener('input', apresPause(charger))
    famille.addEventListener('change', charger)

    vider(
      zone,
      h(
        'div',
        { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Parc'), h('p', { class: 'sous-titre' }, 'Les machines et équipements suivis')),
        peutModifier() ? h('button', { class: 'principal', onclick: () => modifierMachine(null, valeurs) }, ic('plus', 16), 'Ajouter une machine') : null,
      ),
      h('div', { class: 'filtres' }, recherche, famille),
      liste,
    )
    await charger()
  },
}

export function etiquetteEtat(etat) {
  if (!etat) return ''
  const classe = /panne/i.test(etat) ? 'rouge' : /service/i.test(etat) && !/hors/i.test(etat) ? 'vert' : 'orange'
  return h('span', { class: `etiquette ${classe}` }, etat)
}

export async function modifierMachine(machine, valeurs) {
  const form = formulaire(
    [
      { nom: 'repere', libelle: 'Repère', obligatoire: true, aide: 'Le code de la machine dans la GMAO' },
      { nom: 'designation', libelle: 'Désignation', obligatoire: true },
      { nom: 'famille', libelle: 'Famille', suggestions: valeurs.familles },
      { nom: 'emplacement', libelle: 'Emplacement', suggestions: valeurs.emplacements },
      { nom: 'marque', libelle: 'Marque' },
      { nom: 'modele', libelle: 'Modèle' },
      { nom: 'numero_serie', libelle: 'N° de série' },
      { nom: 'mise_en_service', libelle: 'Mise en service', type: 'date' },
      { nom: 'etat', libelle: 'État', type: 'choix', choix: [...new Set([...ETATS, ...valeurs.etats])], defaut: 'En service' },
      { nom: 'notes', libelle: 'Notes', type: 'zone' },
    ],
    machine || {},
  )
  await fenetre({
    titre: machine ? `Modifier ${machine.repere}` : 'Nouvelle machine',
    large: true,
    contenu: form.element,
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      {
        texte: 'Enregistrer',
        classe: 'principal',
        action: async () => {
          const donnees = form.lire()
          const { id } = await api(machine ? `/api/machines/${machine.id}` : '/api/machines', { methode: machine ? 'PUT' : 'POST', corps: donnees })
          if (machine) window.ktec.recharger()
          else location.hash = `#/parc/${id}`
        },
      },
    ],
  })
}
