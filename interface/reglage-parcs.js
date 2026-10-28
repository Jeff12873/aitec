// Administration › Parcs machines : on range les racines de l'arborescence dans des parcs (glisser-déposer, ou
// clic sur une racine pour choisir où l'envoyer), en production, maintenance ou autre ; on masque celles qui ne
// doivent compter nulle part ; on relie les machines de production à leur machine de maintenance.
// Chaque changement est enregistré tout seul.

import { h, vider, ic, notifier, essayer, confirmer, fenetre, nombreFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { rafraichirParcs } from './parcs.js'

const ROLES = [['production', 'Production', 'fiches et FI de niveau 1'], ['maintenance', 'Maintenance', 'les pannes'], ['autres', 'Autres', 'comptées dans le parc']]

export async function afficherReglageParcs(zone) {
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture de l’arborescence'))
  let donnees
  try {
    donnees = await api('/api/parcs/reglages')
  } catch (erreur) {
    return vider(zone, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
  }
  const racines = new Map(donnees.racines.map((r) => [r.id, r]))
  const etat = { groupes: donnees.groupes, masques: donnees.masques.filter((id) => racines.has(id)), liens: donnees.liens }
  let minuterie = null
  let glisse = null // la racine en cours de déplacement

  const enregistrer = () => {
    clearTimeout(minuterie)
    minuterie = setTimeout(async () => {
      const r = await essayer(() => api('/api/parcs/reglages', { methode: 'POST', corps: etat }))
      if (r) {
        Object.assign(etat, { groupes: r.groupes, masques: r.masques, liens: r.liens })
        rafraichirParcs()
      }
    }, 600)
  }

  // Retire une racine de partout, puis la pose à sa nouvelle place (null : non classée).
  function deplacer(id, destination) {
    for (const g of etat.groupes) for (const [role] of ROLES) g[role] = g[role].filter((x) => x !== id)
    etat.masques = etat.masques.filter((x) => x !== id)
    if (destination?.masque) etat.masques.push(id)
    else if (destination) etat.groupes.find((g) => g.id === destination.parc)?.[destination.role].push(id)
    enregistrer()
    dessiner()
  }

  const rangees = () => new Set([...etat.masques, ...etat.groupes.flatMap((g) => ROLES.flatMap(([role]) => g[role]))])

  // Une racine : glissable, et un clic propose les destinations.
  function puce(id) {
    const r = racines.get(id)
    if (!r) return null
    return h('button', {
      class: 'puce-racine',
      draggable: 'true',
      title: `${r.designation || r.code} — ${nombreFr(r.machines)} machines. Glisser, ou cliquer pour choisir où la ranger.`,
      ondragstart: (e) => { glisse = id; e.dataTransfer.setData('text/plain', id); e.currentTarget.classList.add('glisse') },
      ondragend: (e) => e.currentTarget.classList.remove('glisse'),
      onclick: () => choisirDestination(id),
    }, r.code, h('small', {}, nombreFr(r.machines)))
  }

  // Une zone où déposer : { parc, role } ou { masque: true } ou null (non classées).
  function zoneDepot(destination, titre, aide, ids, classe = '') {
    const zoneEl = h('div', {
      class: `zone-depot ${classe}`,
      ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('survol') },
      ondragleave: (e) => e.currentTarget.classList.remove('survol'),
      ondrop: (e) => {
        e.preventDefault()
        e.currentTarget.classList.remove('survol')
        const id = e.dataTransfer.getData('text/plain') || glisse
        if (id) deplacer(id, destination)
      },
    },
    h('div', { class: 'zone-depot-titre' }, h('b', {}, titre), aide ? h('span', { class: 'discret' }, aide) : null),
    h('div', { class: 'puces-racines' }, ids.length ? ids.map(puce) : h('span', { class: 'discret vide-depot' }, 'Déposer ici')))
    return zoneEl
  }

  async function choisirDestination(id) {
    const r = racines.get(id)
    const choix = [
      ...etat.groupes.flatMap((g) => ROLES.map(([role, libelle]) => ({ texte: `${g.nom} › ${libelle}`, destination: { parc: g.id, role } }))),
      { texte: 'Masquer (ne compte nulle part)', destination: { masque: true } },
      { texte: 'Non classée', destination: null },
    ]
    const resultat = await fenetre({
      titre: `Ranger « ${r.code} »`,
      contenu: h('div', { class: 'liste-destinations' }, choix.map((c, i) => h('label', { class: 'destination' }, h('input', { type: 'radio', name: 'destination', value: String(i) }), c.texte))),
      boutons: [
        { texte: 'Annuler', classe: 'discret', valeur: null },
        { texte: 'Ranger', classe: 'principal', action: () => {
          const coche = document.querySelector('.liste-destinations input:checked')
          if (!coche) throw new Error('Choisissez une destination.')
          return { i: Number(coche.value) }
        } },
      ],
    })
    if (resultat) deplacer(id, choix[resultat.i].destination)
  }

  async function nouveauParc() {
    const champ = h('input', { type: 'text', placeholder: 'ex. USINAGE, PEINTURE', maxlength: 40 })
    const nom = await fenetre({
      titre: 'Nouveau parc',
      contenu: h('label', { class: 'champ' }, h('span', {}, 'Nom du parc'), champ),
      boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Créer', classe: 'principal', action: () => champ.value.trim() || Promise.reject(new Error('Donnez un nom au parc.')) }],
    })
    if (!nom) return
    etat.groupes.push({ id: `parc-${Date.now().toString(36)}`, nom, production: [], maintenance: [], autres: [] })
    enregistrer()
    dessiner()
  }

  async function renommer(g) {
    const champ = h('input', { type: 'text', value: g.nom, maxlength: 40 })
    const nom = await fenetre({
      titre: 'Renommer le parc',
      contenu: h('label', { class: 'champ' }, h('span', {}, 'Nom du parc'), champ),
      boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Renommer', classe: 'principal', action: () => champ.value.trim() || Promise.reject(new Error('Donnez un nom au parc.')) }],
    })
    if (!nom) return
    g.nom = nom
    enregistrer()
    dessiner()
  }

  async function supprimer(g) {
    if (!(await confirmer(`Supprimer le parc « ${g.nom} » ? Ses racines redeviennent non classées.`, { texte: 'Supprimer', danger: true }))) return
    etat.groupes = etat.groupes.filter((x) => x !== g)
    enregistrer()
    dessiner()
  }

  function dessiner() {
    const deja = rangees()
    const libres = [...racines.keys()].filter((id) => !deja.has(id))
    vider(zone,
      h('div', { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('usine', 18), 'Parcs machines'),
          h('button', { class: 'principal petit', onclick: nouveauParc }, ic('plus', 15), 'Nouveau parc')),
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Rangez les racines de l’arborescence dans des parcs (USINAGE, PEINTURE…) : glissez-les, ou cliquez dessus. Dans chaque parc, la production porte les fiches et les FI de niveau 1, la maintenance porte les pannes. Une racine masquée ne compte plus nulle part dans AITEC ; une racine non classée reste visible, dans « Non classé ». Tout est enregistré au fur et à mesure.'),
        libres.length ? h('div', { class: 'bandeau', style: { marginBottom: '12px' } }, ic('alerte'), `${libres.length} racine${libres.length > 1 ? 's' : ''} à ranger ou à masquer.`) : null),
      h('div', { class: 'grille-parcs' },
        etat.groupes.map((g) => h('div', { class: 'carte carte-parc' },
          h('div', { class: 'carte-entete' }, h('h2', {}, g.nom),
            h('div', { class: 'actions' },
              h('button', { class: 'petit', title: 'Relier chaque machine de production à sa machine de maintenance', onclick: () => ouvrirLiens(g, etat, enregistrer) }, ic('lien', 15), 'Production ↔ maintenance'),
              h('button', { class: 'discret icone-seule petit', title: 'Renommer', onclick: () => renommer(g) }, ic('crayon', 15)),
              h('button', { class: 'discret icone-seule petit', title: 'Supprimer le parc', onclick: () => supprimer(g) }, ic('poubelle', 15)))),
          ROLES.map(([role, libelle, aide]) => zoneDepot({ parc: g.id, role }, libelle, aide, g[role], `role-${role}`))))),
      h('div', { class: 'grille grille-2', style: { marginTop: '16px' } },
        zoneDepot(null, 'Non classées', 'visibles, dans « Non classé »', libres, 'zone-libres'),
        zoneDepot({ masque: true }, 'Masquées', 'ne comptent nulle part', etat.masques, 'zone-masquees')))
  }
  dessiner()
}

// La fenêtre des liens : une ligne par machine de production, avec sa machine de maintenance.
async function ouvrirLiens(g, etat, enregistrer) {
  let d
  try {
    d = await api(`/api/parcs/${encodeURIComponent(g.id)}/liens`)
  } catch (erreur) {
    return notifier(erreur.message, 'erreur')
  }
  if (!d.production.length) return notifier(`Le parc « ${g.nom} » n’a pas encore de racine de production avec des machines.`, 'erreur')
  const choix = [{ valeur: '', libelle: '— non reliée —' }, ...d.maintenance.map((m) => ({ valeur: String(m.machine), libelle: `${m.code}${m.designation ? ' — ' + m.designation : ''}` }))]
  const selects = new Map()
  const ligneMachine = (p) => {
    const select = h('select', { class: 'fin' }, choix.map((c) => h('option', { value: c.valeur, selected: String(etat.liens[p.machine] ?? '') === c.valeur }, c.libelle)))
    selects.set(p.machine, select)
    return h('tr', {},
      h('td', { class: 'mono' }, p.code),
      h('td', {}, p.designation || ''),
      h('td', { class: 'discret' }, p.eth || ''),
      h('td', {}, select),
      h('td', { class: 'discret' }, p.proposition && String(p.proposition) !== select.value ? h('button', { class: 'petit discret', title: 'Reprendre la proposition', onclick: () => (select.value = String(p.proposition)) }, 'proposé : ' + (d.maintenance.find((m) => m.machine === p.proposition)?.code || '')) : ''))
  }
  const toutesPropositions = () => {
    let n = 0
    for (const p of d.production) {
      const s = selects.get(p.machine)
      if (p.proposition && !s.value) { s.value = String(p.proposition); n++ }
    }
    notifier(n ? `${n} proposition${n > 1 ? 's' : ''} reprise${n > 1 ? 's' : ''} : vérifiez, puis enregistrez.` : 'Aucune proposition de plus.')
  }
  const reliees = d.production.filter((p) => etat.liens[p.machine]).length
  const ok = await fenetre({
    titre: `${g.nom} : production ↔ maintenance`,
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, `Reliez chaque machine de production à la machine de maintenance qui porte ses pannes (${reliees} sur ${d.production.length} déjà reliées). Les propositions viennent des codes identiques sans le préfixe de l’arborescence ; rien n’est relié sans vous.`),
      h('div', { class: 'actions', style: { marginBottom: '10px' } }, h('button', { class: 'petit', onclick: toutesPropositions }, ic('etincelle', 15), 'Reprendre les propositions pour les machines non reliées')),
      h('div', { class: 'tableau-conteneur', style: { maxHeight: '55vh' } },
        h('table', { class: 'tableau' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Production'), h('th', {}, 'Désignation'), h('th', {}, 'ETH'), h('th', {}, 'Machine de maintenance'), h('th', {}, ''))),
          h('tbody', {}, d.production.map(ligneMachine))))),
    boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Enregistrer', classe: 'principal', valeur: true }],
  })
  if (!ok) return
  for (const p of d.production) {
    const v = selects.get(p.machine).value
    if (v) etat.liens[p.machine] = Number(v)
    else delete etat.liens[p.machine]
  }
  enregistrer()
  notifier('Liens enregistrés')
}
