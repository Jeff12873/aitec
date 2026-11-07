// Le tableau correctif × préventif d'une ligne (à côté du Pareto), en grosses cases : les pannes en hauteur, les
// visites d'observation en largeur, sur 12 mois. D'abord les ETH de la ligne ; un clic zoome sur les machines d'une ETH.
//   rouge  : beaucoup de pannes, peu de préventif (sous-entretien) ;
//   orange : beaucoup de préventif, peu de pannes (sur-entretien possible) ;
//   vert   : équilibré.
// Bascule Niveau 1 / Techniciens / Tout. Le préventif systématique (changer une pièce à date fixe) est écarté :
// l'IA classe chaque gamme, l'administrateur corrige (blocs/mn1/equilibre.js).

import { h, vider, ic, essayer } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { modeAdmin } from '/socle/etat.js'
import { lienMachine } from './prevtec.js'

const ECART = 2 // même règle que le serveur (equilibre.js, zone)
const MODES = [['tout', 'Tout', 'Le préventif de niveau 1 et celui des techniciens'], ['n1', 'Niveau 1', 'Les RI de niveau 1 (conducteurs, fiches MN1)'], ['techniciens', 'Techniciens', 'Le préventif des techniciens, hors niveau 1']]
const preventifsDe = (e, mode) => (mode === 'n1' ? e.n1 : mode === 'techniciens' ? e.techniciens : e.n1 + e.techniciens)

function zone({ correctifs, preventifs }, totaux, nombre) {
  if (!correctifs && !preventifs) return null
  const partC = totaux.correctifs ? correctifs / totaux.correctifs : 0
  const partP = totaux.preventifs ? preventifs / totaux.preventifs : 0
  const moyenne = 1 / Math.max(1, nombre)
  if (correctifs >= 2 && partC >= moyenne && partC >= ECART * partP) return 'rouge'
  if (preventifs >= 2 && partP >= moyenne && partP >= ECART * partC) return 'orange'
  return 'vert'
}

// d : le détail du parc (pour son id). Renvoie l'élément ; les données se chargent à l'affichage.
export function nuageEquilibre(d) {
  parcCourant = d.parc.id
  const zoneNuage = h('div', { class: 'equilibre-mn1' }, h('p', { class: 'discret' }, 'Lecture des interventions…'))
  let donnees = null
  let mode = 'tout'
  let ethChoisi = null // null : les ETH de la ligne ; sinon l'id de l'ETH dont on voit les machines

  const charger = async () => {
    donnees = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/equilibre`))
    if (donnees) dessiner()
    else vider(zoneNuage, h('p', { class: 'discret' }, 'Lecture impossible.'))
  }

  const dessiner = () => {
    const tous = donnees.equipements.map((e) => ({ ...e, preventifs: preventifsDe(e, mode) })).filter((e) => e.correctifs || e.preventifs)
    // Deux niveaux : les ETH de la ligne, puis (clic) les machines d'un ETH, sous-ensembles regroupés.
    const regrouper = (equipements, cle, decrire) => {
      const groupes = new Map()
      for (const e of equipements) {
        const k = cle(e)
        const g = groupes.get(k) || { ...decrire(e), correctifs: 0, preventifs: 0, equipements: 0 }
        g.correctifs += e.correctifs
        g.preventifs += e.preventifs
        g.equipements++
        groupes.set(k, g)
      }
      return [...groupes.values()]
    }
    const eth = tous.find((e) => (e.eth?.id || '') === ethChoisi)?.eth
    const liste = ethChoisi === null
      ? regrouper(tous, (e) => e.eth?.id || '', (e) => ({ type: 'eth', id: e.eth?.id || '', repere: e.eth?.code || 'Hors ETH', designation: e.eth?.libelle || 'Équipements rangés hors des ETH' }))
      : regrouper(tous.filter((e) => (e.eth?.id || '') === ethChoisi), (e) => e.machine.id, (e) => ({ type: 'machine', id: e.machine.id, repere: e.machine.repere || e.repere, designation: e.machine.designation || e.designation, analyse: e.machine.id }))
    const totaux = { correctifs: liste.reduce((t, e) => t + e.correctifs, 0), preventifs: liste.reduce((t, e) => t + e.preventifs, 0) }
    for (const e of liste) e.zone = zone(e, totaux, liste.length)
    // Une ETH alerte par ce qu'elle contient : ses machines rouges (ou orange), comptées comme au zoom.
    if (ethChoisi === null) {
      for (const e of liste) {
        const machines = regrouper(tous.filter((x) => (x.eth?.id || '') === e.id), (x) => x.machine.id, () => ({}))
        const t2 = { correctifs: machines.reduce((s, m) => s + m.correctifs, 0), preventifs: machines.reduce((s, m) => s + m.preventifs, 0) }
        e.rouges = machines.filter((m) => zone(m, t2, machines.length) === 'rouge').length
        e.oranges = machines.filter((m) => zone(m, t2, machines.length) === 'orange').length
        e.machines = machines.length
      }
    }
    // Au niveau des ETH, la légende compte les machines (ce qui alerte), pas les ETH (presque toujours équilibrées).
    const compte = (z) => (ethChoisi === null ? liste.reduce((s, e) => s + (z === 'rouge' ? e.rouges : z === 'orange' ? e.oranges : e.machines - e.rouges - e.oranges), 0) : liste.filter((e) => e.zone === z).length)
    const aRegarder = liste.filter((e) => e.zone === 'rouge').sort((a, b) => b.correctifs - a.correctifs)
    const surEntretien = liste.filter((e) => e.zone === 'orange').sort((a, b) => b.preventifs - a.preventifs)
    const g = donnees.gammes

    const boutonClasser = h('button', { class: 'petit', title: 'L’IA lit le titre de chaque gamme de préventif de la ligne : observation (contrôle, vérification) ou systématique (échange, remplacement). Gardé dans le fichier.' }, ic('etincelle', 13), g.aClasser ? `Classer ${g.aClasser} gamme${g.aClasser > 1 ? 's' : ''} par l’IA` : 'Gammes classées')
    boutonClasser.disabled = !g.aClasser || !donnees.iaInstallee
    boutonClasser.onclick = async () => {
      boutonClasser.disabled = true
      vider(boutonClasser, ic('etincelle', 13), 'L’IA classe les gammes…')
      const r = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/gammes`, { methode: 'POST' }))
      if (r) await charger()
      else { boutonClasser.disabled = false; vider(boutonClasser, ic('etincelle', 13), 'Réessayer le classement') }
    }

    vider(zoneNuage,
      h('div', { class: 'tete-equilibre' },
        h('div', { class: 'segments petits' }, MODES.map(([cle, texte, aide]) => h('button', { class: mode === cle ? 'choisi' : '', title: aide, onclick: () => { mode = cle; dessiner() } }, texte))),
        h('div', { class: 'legende-equilibre' },
          ethChoisi === null ? h('span', { class: 'discret' }, 'machines : ') : null,
          h('span', { class: 'pastille-zone rouge' }), `${compte('rouge')} sous-entretenu${compte('rouge') > 1 ? 's' : ''}`,
          h('span', { class: 'pastille-zone orange' }), `${compte('orange')} sur-entretenu${compte('orange') > 1 ? 's' : ''} ?`,
          h('span', { class: 'pastille-zone vert' }), `${compte('vert')} équilibré${compte('vert') > 1 ? 's' : ''}`)),
      ethChoisi !== null ? h('div', { class: 'retour-tableau' }, h('button', { class: 'petit discret', onclick: () => { ethChoisi = null; dessiner() } }, ic('retour', 14), 'Toutes les ETH'), h('b', {}, eth?.libelle || 'Hors ETH'), h('span', { class: 'discret' }, ' : ses machines')) : null,
      liste.length
        ? tableauCases(liste, totaux, { niveau: ethChoisi === null ? 'eth' : 'machine', zoomer: (id) => { ethChoisi = id; dessiner() } })
        : h('p', { class: 'discret' }, 'Ni correctif ni préventif sur les machines de maintenance de cette ligne ces 12 derniers mois.'),
      h('p', { class: 'discret petit-texte' }, `${ethChoisi === null ? `${liste.length} ETH` : `${liste.length} machine${liste.length > 1 ? 's' : ''}`}, ${totaux.correctifs} pannes et ${totaux.preventifs} visites d’observation sur 12 mois. Rouge : beaucoup de pannes pour peu de visites ; orange : beaucoup de visites pour peu de pannes ; vert : équilibré.${ethChoisi === null ? ' Cliquez une ETH pour voir ses machines.' : ' Cliquez une machine pour l’étape 3.'}`),
      aRegarder.length || surEntretien.length ? h('div', { class: 'a-regarder' },
        aRegarder.length ? h('div', {}, h('b', {}, 'À regarder d’abord'), aRegarder.slice(0, 8).map(puce)) : null,
        surEntretien.length ? h('div', {}, h('b', {}, 'Préventif à alléger ?'), surEntretien.slice(0, 8).map(puce)) : null) : null,
      h('div', { class: 'gammes-equilibre' },
        h('div', { class: 'ligne-gammes' },
          h('span', { class: 'texte-2' }, `${g.total} gamme${g.total > 1 ? 's' : ''} de préventif, dont ${g.systematiques} systématique${g.systematiques > 1 ? 's' : ''}, écartée${g.systematiques > 1 ? 's' : ''} du nuage.`,
            g.aClasser ? h('span', { class: 'etiquette orange', title: 'Classées d’après les mots du titre seulement (échange, remplacement…), en attendant l’IA' }, `${g.aClasser} à classer`) : null),
          donnees.iaInstallee ? boutonClasser : h('span', { class: 'discret petit-texte' }, 'IA non installée : classement d’après les mots du titre.')),
        listeGammes(g)))
  }

  // Les gammes, la plus fréquente d'abord : l'administrateur corrige le classement d'un clic.
  const listeGammes = (g) => {
    const corps = h('div', { class: 'liste-gammes' })
    const details = h('details', {}, h('summary', {}, 'Voir le classement des gammes'), corps)
    details.addEventListener('toggle', () => {
      if (!details.open || corps.childElementCount) return
      const PAR = { ia: 'IA', admin: 'administrateur', mots: 'mots du titre' }
      for (const x of g.liste) {
        const choix = h('select', { class: 'fin', disabled: !modeAdmin(), title: modeAdmin() ? '' : 'Seul l’administrateur corrige le classement' },
          h('option', { value: 'observation', selected: x.classe === 'observation' }, 'Observation'),
          h('option', { value: 'systematique', selected: x.classe === 'systematique' }, 'Systématique'))
        const origine = h('small', { class: 'discret' }, PAR[x.par] || '')
        choix.onchange = async () => {
          const r = await essayer(() => api('/api/mn1/gammes', { methode: 'POST', corps: { cle: x.cle, gamme: x.gamme, classe: choix.value } }), 'Classement corrigé')
          if (r) { x.classe = r.classe; x.par = r.par; origine.textContent = PAR[r.par]; charger() }
        }
        corps.append(h('div', { class: `gamme ${x.classe}` }, h('span', {}, x.gamme || '(sans titre)'), h('small', { class: 'discret' }, `×${x.nombre}`), origine, choix))
      }
      if (g.total > g.liste.length) corps.append(h('p', { class: 'discret petit-texte' }, `Les ${g.liste.length} plus fréquentes sur ${g.total}.`))
    })
    return details
  }

  charger()
  return zoneNuage
}

// Un équipement à regarder : son repère (lien vers son analyse, s'il en a une), ses correctifs / préventifs.
let parcCourant = null // le parc du nuage affiché, pour les liens vers ses machines
const lien = (e, contenu) => (e.analyse ? h('a', { href: lienMachine(parcCourant, e.analyse) }, contenu) : contenu)
function puce(e) {
  return h('span', { class: `puce-equipement ${e.zone}`, title: `${e.designation || e.repere} : ${e.correctifs} correctif${e.correctifs > 1 ? 's' : ''}, ${e.preventifs} préventif${e.preventifs > 1 ? 's' : ''}` },
    lien(e, h('span', { class: 'mono' }, e.repere || '?')), h('small', {}, ` ${e.correctifs} / ${e.preventifs}`))
}

// Le tableau en grosses cases : les pannes en hauteur (beaucoup en haut), les visites en largeur, par tranches
// (0, 1–2, 3–5, 6–10, 11–20…). Chaque case prend la couleur de sa zone : rouge sous la moitié de la pente de la
// ligne (beaucoup de pannes pour peu de visites), orange au-dessus du double, vert entre les deux.
const BORNES = [0, 1, 3, 6, 11, 21, 51, 101, 201, 501, 1001, 2001]
const tranches = (max) => {
  const b = BORNES.filter((x) => x <= max)
  return b.map((de, i) => ({ de, a: (b[i + 1] ?? Infinity) - 1, libelle: b[i + 1] === undefined ? (de ? `${de}+` : '0') : de === b[i + 1] - 1 ? String(de) : `${de}–${b[i + 1] - 1}` }))
}
const indiceDe = (lesTranches, v) => lesTranches.findIndex((t) => v >= t.de && v <= t.a)
// Les tranches adaptées à ce qu'on regarde (une poignée d'ETH aux grands nombres) : 5 tranches au plus, bornées sur
// les valeurs réelles, arrondies à des nombres ronds.
const rond = (x) => (x <= 10 ? Math.round(x) : x <= 50 ? Math.round(x / 5) * 5 : x <= 200 ? Math.round(x / 10) * 10 : Math.round(x / 50) * 50)
function tranchesAdaptees(valeurs) {
  const tri = [...valeurs].sort((a, b) => a - b)
  if (tri.length > 12) return tranches(Math.max(1, tri[tri.length - 1]))
  const bornes = [...new Set([0, ...[0.2, 0.4, 0.6, 0.8].map((q) => rond(tri[Math.floor(q * (tri.length - 1))])).filter((x) => x > 0)])].sort((a, b) => a - b)
  return bornes.map((de, i) => ({ de, a: (bornes[i + 1] ?? Infinity) - 1, libelle: bornes[i + 1] === undefined ? (de ? `${de}+` : '0') : de === bornes[i + 1] - 1 ? String(de) : `${de}–${bornes[i + 1] - 1}` }))
}

function tableauCases(liste, totaux, { niveau, zoomer }) {
  // Peu d'éléments (les ETH) : des tranches adaptées ; beaucoup (les machines) : les tranches fixes.
  const lignesC = tranchesAdaptees(liste.map((e) => e.correctifs)).reverse() // beaucoup de pannes en haut
  const colonnesP = tranchesAdaptees(liste.map((e) => e.preventifs))
  const pente = totaux.correctifs ? totaux.preventifs / totaux.correctifs : 1
  const milieu = (t) => (t.a === Infinity ? t.de * 1.5 : (t.de + t.a) / 2)
  const fond = (tc, tp) => {
    const c = milieu(tc)
    const p = milieu(tp)
    if (!c && !p) return ''
    if (p * ECART <= c * pente) return 'rouge'
    if (p >= ECART * c * pente) return 'orange'
    return 'vert'
  }
  const cases = []
  lignesC.forEach((tc, r) => {
    cases.push(h('div', { class: 'etiquette-ligne-cases' }, tc.libelle))
    colonnesP.forEach((tp) => {
      const dedans = liste.filter((e) => indiceDe(lignesC, e.correctifs) === r && indiceDe(colonnesP, e.preventifs) === colonnesP.indexOf(tp))
      const puceCase = (e) => niveau === 'eth'
        ? h('button', { class: `puce-case puce-eth ${e.rouges ? 'rouge alerte' : e.oranges ? 'orange' : e.zone}`, title: `${e.designation} : ${e.correctifs} pannes, ${e.preventifs} visites, ${e.machines} machines — cliquer pour voir ses machines`, onclick: () => zoomer(e.id) },
          h('b', {}, e.repere), h('small', {}, `${e.correctifs} pannes · ${e.preventifs} visites`),
          e.rouges ? h('span', { class: 'a-regarder-eth' }, `${e.rouges} à regarder`) : e.oranges ? h('span', { class: 'a-alleger-eth' }, `${e.oranges} à alléger ?`) : h('span', { class: 'ok-eth' }, 'rien d’alarmant'))
        : e.analyse
          ? h('a', { class: `puce-case ${e.zone}`, href: lienMachine(parcCourant, e.analyse), title: `${e.designation || e.repere} : ${e.correctifs} pannes, ${e.preventifs} visites — étape 3` }, e.repere)
          : h('span', { class: `puce-case ${e.zone}`, title: `${e.designation || e.repere} : ${e.correctifs} pannes, ${e.preventifs} visites` }, e.repere)
      const montrees = dedans.sort((a, b) => b.correctifs - a.correctifs).slice(0, 4)
      cases.push(h('div', { class: `case-tableau ${fond(tc, tp)}${dedans.length ? ' occupee' : ''}`, title: dedans.length > 4 ? dedans.map((e) => `${e.repere} (${e.correctifs} / ${e.preventifs})`).join('\n') : '' },
        montrees.map(puceCase),
        dedans.length > 4 ? h('span', { class: 'reste-case' }, `+${dedans.length - 4}`) : null))
    })
  })
  return h('div', { class: 'tableau-cases-zone' },
    h('div', { class: 'axe-pannes' }, 'pannes (12 mois) ↑'),
    h('div', { class: 'tableau-cases', style: { gridTemplateColumns: `auto repeat(${colonnesP.length}, minmax(0, 1fr))` } },
      cases,
      h('div'), colonnesP.map((tp) => h('div', { class: 'etiquette-colonne-cases' }, tp.libelle))),
    h('div', { class: 'axe-visites' }, 'visites d’observation (12 mois) →'))
}
