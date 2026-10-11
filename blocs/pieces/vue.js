// Les pièces de rechange : stock, seuil de commande, machines concernées.

import { h, vider, ic, tableau, fenetre, formulaire, confirmer, essayer, nombreFr, apresPause } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { estAdmin } from '/socle/etat.js'

export default {
  chemin: 'pieces',
  titre: 'Pièces',
  icone: 'boite',
  menu: false,
  aide: 'assistant',

  async afficher(zone, { id, query }) {
    if (id) return afficherFiche(zone, id)

    const liste = h('div')
    const recherche = h('input', { type: 'search', placeholder: 'Référence, désignation, fabricant, fournisseur…' })
    const aCommander = h('input', { type: 'checkbox', checked: Boolean(query.acommander) })

    async function charger() {
      const parametres = new URLSearchParams({ q: recherche.value })
      if (aCommander.checked) parametres.set('acommander', '1')
      const pieces = await api('/api/pieces?' + parametres)
      vider(
        liste,
        tableau({
          lignes: pieces,
          surClic: (p) => (location.hash = `#/pieces/${p.id}`),
          vide: aCommander.checked ? 'Aucune pièce sous le seuil de commande.' : 'Aucune pièce. Importez vos articles depuis la GMAO (menu Import GMAO).',
          colonnes: [
            { titre: 'Référence', valeur: (p) => h('b', { class: 'mono' }, p.reference) },
            { titre: 'Désignation', valeur: (p) => p.designation },
            { titre: 'Fabricant', valeur: (p) => p.fabricant },
            { titre: 'Fournisseur', valeur: (p) => p.fournisseur },
            { titre: 'Machines', valeur: (p) => h('span', { class: 'texte-2' }, p.machines || '') },
            { titre: 'Rangement', valeur: (p) => p.emplacement },
            { titre: 'Stock', classe: 'nombre', valeur: (p) => etiquetteStock(p) },
          ],
        }),
      )
    }
    recherche.addEventListener('input', apresPause(charger))
    aCommander.addEventListener('change', charger)

    vider(
      zone,
      h(
        'div',
        { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Pièces de rechange'), h('p', { class: 'sous-titre' }, 'Stock et seuils de commande')),
        estAdmin() ? h('button', { class: 'principal', onclick: () => modifierPiece(null) }, ic('plus', 16), 'Ajouter une pièce') : null,
      ),
      h('div', { class: 'filtres' }, recherche, h('label', { class: 'actions texte-2' }, h('span', { class: 'interrupteur' }, aCommander, h('span')), 'Seulement les pièces à commander')),
      liste,
    )
    await charger()
  },
}

function etiquetteStock(p) {
  const texte = `${nombreFr(p.stock, 2)} ${p.unite}`
  if (p.stock <= 0 && p.seuil > 0) return h('span', { class: 'etiquette rouge', title: `Seuil : ${nombreFr(p.seuil, 2)}` }, texte)
  if (p.stock <= p.seuil && p.seuil > 0) return h('span', { class: 'etiquette orange', title: `Seuil : ${nombreFr(p.seuil, 2)}` }, texte)
  return texte
}

async function afficherFiche(zone, id) {
  const p = await api(`/api/pieces/${id}`)
  const info = (libelle, valeur) => h('div', {}, h('div', { class: 'discret', style: { fontSize: '13px' } }, libelle), h('div', {}, valeur || '—'))
  vider(
    zone,
    h(
      'div',
      { class: 'entete-page' },
      h('button', { class: 'discret icone-seule', title: 'Retour', onclick: () => history.back() }, ic('retour')),
      h('div', { style: { flex: 1 } }, h('h1', {}, h('span', { class: 'mono', style: { fontSize: '22px' } }, p.reference), ' — ', p.designation)),
      etiquetteStock(p),
      estAdmin() ? h('button', { onclick: () => modifierPiece(p) }, ic('crayon', 16), 'Modifier') : null,
      estAdmin() ? h('button', { class: 'danger', onclick: () => supprimerPiece(p) }, ic('poubelle', 16)) : null,
    ),
    h(
      'div',
      { class: 'grille grille-2' },
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'grille grille-2' },
          info('Fabricant', p.fabricant), info('Fournisseur', p.fournisseur),
          info('Stock', `${nombreFr(p.stock, 2)} ${p.unite}`), info('Seuil de commande', nombreFr(p.seuil, 2)),
          info('Rangement', p.emplacement), info('Prix unitaire', p.prix !== null ? `${nombreFr(p.prix, 2)} €` : ''),
        ),
        p.notes ? h('p', { class: 'texte-2', style: { marginTop: '14px', whiteSpace: 'pre-wrap' } }, p.notes) : null,
      ),
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('usine', 18), 'Utilisée sur')),
        p.machines.length
          ? h('div', { class: 'legende' }, p.machines.map((m) => h('a', { href: `#/parc/${m.id}` }, h('b', { class: 'mono' }, m.repere), ' — ', m.designation)))
          : h('div', { class: 'vide' }, 'Rattachée à aucune machine.'),
      ),
    ),
  )
}

async function modifierPiece(piece) {
  const machines = await api('/api/machines')
  const form = formulaire(
    [
      { nom: 'reference', libelle: 'Référence', obligatoire: true },
      { nom: 'designation', libelle: 'Désignation', obligatoire: true },
      { nom: 'fabricant', libelle: 'Fabricant' },
      { nom: 'fournisseur', libelle: 'Fournisseur' },
      { nom: 'stock', libelle: 'Stock', type: 'nombre', defaut: 0 },
      { nom: 'seuil', libelle: 'Seuil de commande', type: 'nombre', defaut: 0, aide: 'À commander quand le stock descend à ce niveau' },
      { nom: 'unite', libelle: 'Unité', defaut: 'pce' },
      { nom: 'emplacement', libelle: 'Rangement' },
      { nom: 'prix', libelle: 'Prix unitaire (€)', type: 'nombre' },
      { nom: 'machines', libelle: 'Machines (repères séparés par des virgules)', large: true, suggestions: machines.map((m) => m.repere) },
      { nom: 'notes', libelle: 'Notes', type: 'zone' },
    ],
    { ...(piece || {}), machines: piece ? piece.machines.map((m) => m.repere).join(', ') : '' },
  )
  await fenetre({
    titre: piece ? `Modifier ${piece.reference}` : 'Nouvelle pièce',
    large: true,
    contenu: form.element,
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      {
        texte: 'Enregistrer',
        classe: 'principal',
        action: async () => {
          const donnees = form.lire()
          const reperes = donnees.machines.split(/[,;]+/).map((r) => r.trim()).filter(Boolean)
          const inconnus = reperes.filter((r) => !machines.some((m) => m.repere.toLowerCase() === r.toLowerCase()))
          if (inconnus.length) throw new Error(`Machine inconnue : ${inconnus.join(', ')}`)
          donnees.machines = reperes.map((r) => machines.find((m) => m.repere.toLowerCase() === r.toLowerCase()).id)
          const { id } = await api(piece ? `/api/pieces/${piece.id}` : '/api/pieces', { methode: piece ? 'PUT' : 'POST', corps: donnees })
          if (piece) window.iassitec.recharger()
          else location.hash = `#/pieces/${id}`
        },
      },
    ],
  })
}

async function supprimerPiece(p) {
  if (!(await confirmer(`Supprimer la pièce ${p.reference} ?`, { texte: 'Supprimer', danger: true }))) return
  if (await essayer(() => api(`/api/pieces/${p.id}`, { methode: 'DELETE' }), 'Pièce supprimée')) history.back()
}
