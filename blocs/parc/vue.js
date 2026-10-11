// Le parc : liste des machines et fiche de chaque machine.

import { h, vider, ic, tableau, fenetre, formulaire, confirmer, essayer, dateFr, nombreFr, tailleFr, apresPause } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { estAdmin } from '/socle/etat.js'

export const ETATS = ['En service', 'En panne', 'En réserve', 'Hors service', 'Réformée']

export default {
  chemin: 'parc',
  titre: 'Parc',
  icone: 'usine',
  menu: false,
  aide: 'assistant',

  async afficher(zone, { id, query }) {
    if (id) return afficherFiche(zone, id)

    const [valeurs] = await Promise.all([api('/api/machines-valeurs')])
    const liste = h('div')
    const recherche = h('input', { type: 'search', placeholder: 'Repère, désignation, marque, emplacement…', value: query.q || '' })
    const famille = h('select', {}, h('option', { value: '' }, 'Toutes les familles'), valeurs.familles.map((f) => h('option', { value: f, selected: f === query.famille }, f)))

    async function charger() {
      const parametres = new URLSearchParams({ q: recherche.value, famille: famille.value })
      const machines = await api('/api/machines?' + parametres)
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
        estAdmin() ? h('button', { class: 'principal', onclick: () => modifierMachine(null, valeurs) }, ic('plus', 16), 'Ajouter une machine') : null,
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

async function afficherFiche(zone, id) {
  const [m, valeurs] = await Promise.all([api(`/api/machines/${id}`), api('/api/machines-valeurs')])
  const info = (libelle, valeur) => (valeur ? h('div', {}, h('div', { class: 'discret', style: { fontSize: '13px' } }, libelle), h('div', {}, valeur)) : null)

  vider(
    zone,
    h(
      'div',
      { class: 'entete-page' },
      h('button', { class: 'discret icone-seule', title: 'Retour', onclick: () => history.back() }, ic('retour')),
      h('div', { style: { flex: 1 } }, h('h1', {}, h('span', { class: 'mono', style: { fontSize: '22px' } }, m.repere), ' — ', m.designation), h('p', { class: 'sous-titre' }, [m.famille, m.emplacement].filter(Boolean).join(' · '))),
      etiquetteEtat(m.etat),
      h('a', { class: 'bouton principal', href: `#/assistant?machine=${m.id}` }, ic('etincelle', 16), "Demander à l'IA"),
      estAdmin() ? h('button', { onclick: () => modifierMachine(m, valeurs) }, ic('crayon', 16), 'Modifier') : null,
      estAdmin() ? h('button', { class: 'danger', onclick: () => supprimerMachine(m) }, ic('poubelle', 16)) : null,
    ),
    h(
      'div',
      { class: 'grille grille-2' },
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('usine', 18), 'Informations')),
        h('div', { class: 'grille grille-2' }, info('Marque', m.marque), info('Modèle', m.modele), info('N° de série', m.numero_serie), info('Mise en service', dateFr(m.mise_en_service)), info('Emplacement', m.emplacement), info('Famille', m.famille)),
        m.notes ? h('p', { class: 'texte-2', style: { marginTop: '14px', whiteSpace: 'pre-wrap' } }, m.notes) : null,
      ),
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('document', 18), 'Documents'), estAdmin() ? h('a', { class: 'bouton petit', href: `#/administration/documents?machine=${m.id}` }, ic('plus', 14), 'Ajouter') : null),
        m.documents.length
          ? h('div', { class: 'legende' }, m.documents.map((d) => h('a', { href: `/api/documents/${d.id}/fichier`, target: '_blank', style: { display: 'flex', gap: '10px', alignItems: 'center', color: 'inherit' } }, ic('document', 16), h('span', { style: { flex: 1 } }, d.nom), h('span', { class: 'discret' }, tailleFr(d.taille)))))
          : h('div', { class: 'vide' }, 'Aucun document pour cette machine. Déposez sa notice dans Documents.'),
      ),
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('boite', 18), 'Pièces de rechange')),
        tableau({
          lignes: m.pieces,
          surClic: (p) => (location.hash = `#/pieces/${p.id}`),
          vide: 'Aucune pièce rattachée.',
          colonnes: [
            { titre: 'Référence', valeur: (p) => h('span', { class: 'mono' }, p.reference) },
            { titre: 'Désignation', valeur: (p) => p.designation },
            { titre: 'Stock', classe: 'nombre', valeur: (p) => h('span', { class: p.stock <= p.seuil ? 'etiquette orange' : '' }, `${nombreFr(p.stock, 2)} ${p.unite}`) },
          ],
        }),
      ),
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('cle', 18), 'Interventions'), h('a', { class: 'bouton petit', href: `#/interventions?machine=${m.id}` }, 'Tout voir')),
        tableau({
          lignes: m.interventions.slice(0, 12),
          surClic: (i) => (location.hash = `#/interventions/${i.id}`),
          vide: 'Aucune intervention enregistrée.',
          colonnes: [
            { titre: 'Date', valeur: (i) => dateFr(i.date) },
            { titre: 'Type', valeur: (i) => i.type },
            { titre: 'Description', valeur: (i) => i.description },
          ],
        }),
      ),
    ),
  )
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
          if (machine) window.iassitec.recharger()
          else location.hash = `#/parc/${id}`
        },
      },
    ],
  })
}

async function supprimerMachine(m) {
  if (!(await confirmer(`Supprimer la machine ${m.repere} ? Ses interventions et documents sont gardés, mais ne seront plus rattachés à une machine.`, { texte: 'Supprimer', danger: true }))) return
  if (await essayer(() => api(`/api/machines/${m.id}`, { methode: 'DELETE' }), 'Machine supprimée')) history.back()
}
