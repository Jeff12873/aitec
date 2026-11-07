// Les visites préventives du plan de maintenance (PREVTEC) : reconnues par leur code, rattachées aux pannes par
// l'arborescence.
//
// Le code en tête du titre (convention du site, réglée par l'administrateur) : 3 caractères puis un tiret,
// « P2M-Contrôle des courroies… » : la 1re lettre dit le niveau (P = production, niveau 1 ; I = maintenance,
// niveau 2), la 2e la ligne (lettre réglée dans chaque parc), la 3e le type (Q qualité, S sécurité…). Un préventif
// sans code reconnu ne compte pas dans le plan de maintenance. Tant que la convention n'est pas réglée (fichier
// neuf), tous les préventifs comptent, comme avant.
//   réglage « prev_convention » : { niveaux: { P: 1, I: 2 }, types: { S: { nom, jamaisEspacer } } }
//   réglage « prev_lettres »    : { idParc: 'D' } (une ou plusieurs lettres)
//
// Rattachement : une visite regarde une panne si elle est posée sur le même équipement, ou sur la machine (le nœud
// de niveau 3 de l'arborescence, la racine étant le niveau 1) qui porte cet équipement. Les visites posées plus
// haut (racine, niveau 2) ne regardent aucune panne précise.

import { db, reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { lireParcs, NON_CLASSE } from '../../lib/parcs.js'
import { familleDe } from '../../lib/types.js'

export const NIVEAU_MACHINE = 3
const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
export const texteSeul = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- la convention

export function convention() {
  const c = reglageJson('prev_convention', null) || {}
  const lettre = (x) => String(x || '').trim().toUpperCase().slice(0, 1)
  const niveaux = Object.fromEntries(Object.entries(c.niveaux || {}).map(([l, n]) => [lettre(l), Number(n) === 1 ? 1 : 2]).filter(([l]) => l))
  const types = Object.fromEntries(Object.entries(c.types || {}).map(([l, t]) => [lettre(l), { nom: String(t?.nom || '').slice(0, 40), jamaisEspacer: Boolean(t?.jamaisEspacer) }]).filter(([l]) => l))
  return { niveaux, types, lettres: reglageJson('prev_lettres', {}) || {} }
}
export const conventionReglee = (c = convention()) => Object.keys(c.niveaux).length > 0 && Object.keys(c.types).length > 0

// Le code d'un titre : { code, niveau, ligne, type, nomType, titre } ou null s'il n'est pas reconnu.
export function lireCode(description, c = convention()) {
  const t = texteSeul(description)
  const m = /^([A-Za-z])([0-9A-Za-z])([A-Za-z])\s*-\s*(.*)$/.exec(t)
  if (!m) return null
  const [n, l, ty] = [m[1], m[2], m[3]].map((x) => x.toUpperCase())
  if (!c.niveaux[n] || !c.types[ty]) return null
  return { code: `${n}${l}${ty}`, niveau: c.niveaux[n], ligne: l, type: ty, nomType: c.types[ty].nom || ty, jamaisEspacer: c.types[ty].jamaisEspacer, titre: m[4] }
}

// Le préventif compte-t-il dans le plan ? (convention non réglée : oui, tout compte)
export const estDuPlan = (description, c = convention()) => !conventionReglee(c) || Boolean(lireCode(description, c))

export function enregistrerConvention({ niveaux = {}, types = {} }) {
  modifierReglage('prev_convention', { niveaux, types })
  noterModification()
  return convention()
}
export function enregistrerLettre(parc, lettres) {
  const l = reglageJson('prev_lettres', {}) || {}
  const propre = String(lettres || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 4)
  if (propre) l[parc] = propre
  else delete l[parc]
  modifierReglage('prev_lettres', l)
  noterModification()
  return l
}

// L'aperçu du réglage : préventifs des 12 derniers mois reconnus ou non, par parc, avec des exemples non reconnus.
export async function apercuConvention() {
  const c = convention()
  const p = await lireParcs()
  const lignes = db().prepare('SELECT machine_id, type, description FROM interventions WHERE date >= ?').all(ilYa(365)).filter((l) => familleDe(l.type) === 'Préventif')
  const parcs = (p?.parcs || []).filter((x) => x.id !== NON_CLASSE).map((parc) => {
    const ids = parc.machinesMaintenance.size ? parc.machinesMaintenance : parc.machines
    const du = lignes.filter((l) => ids.has(l.machine_id))
    const codes = du.map((l) => lireCode(l.description, c))
    const lettres = String(c.lettres[parc.id] || '')
    return {
      id: parc.id, nom: parc.nom, lettres,
      total: du.length,
      reconnus: codes.filter(Boolean).length,
      autreLigne: lettres ? codes.filter((x) => x && !lettres.includes(x.ligne)).length : 0,
    }
  })
  const exemples = lignes.filter((l) => !lireCode(l.description, c)).slice(0, 400).map((l) => texteSeul(l.description).slice(0, 70))
  return { convention: c, reglee: conventionReglee(c), parcs, exemples: [...new Set(exemples)].slice(0, 8) }
}

// ---------------------------------------------------------------- l'arborescence d'un parc

// Pour chaque machine d'AITEC sous les racines de maintenance du parc : { niveau, machine (id de son nœud de
// niveau 3, ou elle-même au-dessus) }. Machines rangées par leur repère (= code du nœud).
export function placesDuParc(p, parc) {
  const parRepere = new Map(db().prepare('SELECT id, repere FROM machines').all().map((m) => [m.repere, m.id]))
  const places = new Map()
  const parcourir = (n, niveau, machine3) => {
    const id = parRepere.get(n.code) ?? null
    const porteuse = niveau === NIVEAU_MACHINE ? id : machine3
    if (id !== null && !places.has(id)) places.set(id, { niveau, machine: niveau <= NIVEAU_MACHINE ? id : porteuse ?? id })
    n.enfants.forEach((e) => parcourir(e, niveau + 1, porteuse))
  }
  for (const r of p.racines.filter((x) => parc.maintenance.includes(x.id))) parcourir(r.noeud, 1, null)
  return places
}

// ---------------------------------------------------------------- les visites d'un parc

// Les visites du plan (12 derniers mois, et les 12 d'avant pour comparer) sur les machines de maintenance du parc.
export async function visitesDuParc(parcId) {
  const p = await lireParcs()
  const parc = p?.parcs.find((x) => x.id === parcId && x.id !== NON_CLASSE)
  if (!parc) throw new ErreurHttp(404, 'Ligne introuvable')
  const c = convention()
  const reglee = conventionReglee(c)
  const ids = parc.machinesMaintenance.size ? parc.machinesMaintenance : parc.machines
  const places = placesDuParc(p, parc)
  const depuis = ilYa(365)
  const lignes = db().prepare('SELECT id, date, machine_id, type, description, duree_h FROM interventions WHERE date >= ?').all(ilYa(730)).filter((l) => ids.has(l.machine_id))
  const visites = []
  let horsConvention = 0
  for (const l of lignes) {
    if (familleDe(l.type) !== 'Préventif') continue
    const code = lireCode(l.description, c)
    if (reglee && !code) {
      if (l.date >= depuis) horsConvention++
      continue
    }
    visites.push({ ...l, recente: l.date >= depuis, code, place: places.get(l.machine_id) || null })
  }
  return { p, parc, places, visites, horsConvention, reglee, convention: c, lignes }
}

// Une visite regarde-t-elle une panne posée sur l'équipement « machineId » ?
export function regarde(visite, machineId, places) {
  if (visite.machine_id === machineId) return true
  const porteuse = places.get(machineId)?.machine
  return porteuse !== undefined && visite.machine_id === porteuse
}

// ---------------------------------------------------------------- le bilan d'une ligne (« Ma ligne »)

const NB_HAUT = 5 // les pannes du haut du Pareto regardées une à une
const debutMois = (decalage) => {
  const d = new Date()
  const m = new Date(d.getFullYear(), d.getMonth() - decalage, 1)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`
}

// Le verdict du plan et les indicateurs de la ligne, sur les 12 derniers mois terminés face aux 12 d'avant (le mois
// en cours, à peine commencé, ferait baisser les chiffres). liste : le Pareto du parc (parcs.js).
// Verdict : les pannes de la ligne, et celles du haut du Pareto qui montent (ou apparaissent, 5 cas au moins),
// malgré une visite qui les regarde (elle ne les voit pas venir) ou sans aucune visite ; une baisse nette des
// pannes (10 % et plus) tempère le verdict.
export async function bilanLigne(parcId, liste, { classeDe } = {}) {
  const v = await visitesDuParc(parcId)
  const [debut, milieu, fin] = [debutMois(24), debutMois(12), debutMois(0)]
  const dans = (l, a, b) => l.date >= a && l.date < b
  const correctifs = v.lignes.filter((l) => familleDe(l.type) === 'Correctif')
  const compte = (liste2, a, b) => liste2.filter((l) => dans(l, a, b)).length
  const pannes = { recent: compte(correctifs, milieu, fin), precedent: compte(correctifs, debut, milieu) }
  const preventifs = { recent: compte(v.visites, milieu, fin), precedent: compte(v.visites, debut, milieu) }
  // Heures de dépannage : la durée notée sur les interventions (et la part des correctifs qui en ont une).
  const heures = (a, b) => {
    const du = correctifs.filter((l) => dans(l, a, b))
    const avec = du.filter((l) => Number(l.duree_h) > 0)
    return { total: Math.round(avec.reduce((s, l) => s + Number(l.duree_h), 0)), connues: du.length ? avec.length / du.length : null }
  }
  const part = (p, c) => (p + c ? p / (p + c) : null)
  const recentes = v.visites.filter((l) => dans(l, milieu, fin))
  const observation = classeDe && recentes.length ? recentes.filter((l) => classeDe(l.description) !== 'systematique').length / recentes.length : null
  // Les machines qui concentrent les pannes (remontées à leur machine de niveau 3).
  const parMachine = new Map()
  for (const l of correctifs.filter((x) => dans(x, milieu, fin))) {
    const m = v.places.get(l.machine_id)?.machine ?? l.machine_id
    parMachine.set(m, (parMachine.get(m) || 0) + 1)
  }
  const nom = db().prepare('SELECT repere, designation FROM machines WHERE id = ?')
  const top = [...parMachine].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ id, n, ...nom.get(id) }))
  const indicateurs = {
    pannes, heures: { recent: heures(milieu, fin), precedent: heures(debut, milieu) },
    preventif: { recent: part(preventifs.recent, pannes.recent), precedent: part(preventifs.precedent, pannes.precedent), observation },
    concentration: { machines: top, part: pannes.recent ? top.reduce((s, x) => s + x.n, 0) / pannes.recent : null },
    horsConvention: v.horsConvention, conventionReglee: v.reglee,
  }

  const recentesVisites = v.visites.filter((l) => l.recente)
  const regardee = (machine) => recentesVisites.some((x) => regarde(x, machine, v.places))
  const montent = liste.slice(0, NB_HAUT).filter((x) => x.evolution === 'monte' || (x.evolution === 'nouvelle' && x.nombre >= 5))
  const malgre = montent.filter((x) => regardee(x.machine))
  const sans = montent.filter((x) => !regardee(x.machine))
  const ecart = pannes.precedent ? (pannes.recent - pannes.precedent) / pannes.precedent : null
  const pct = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)} %`
  const codes = (l) => l.map((x) => x.code).join(', ')
  const pl = (l, un, plusieurs) => (l.length > 1 ? plusieurs : un)
  const raisons = []
  if (ecart !== null) raisons.push(Math.abs(ecart) >= 0.05 ? `Pannes de la ligne : ${pct(ecart)} sur 12 mois (${pannes.recent} contre ${pannes.precedent}).` : `Pannes de la ligne stables sur 12 mois (${pannes.recent} contre ${pannes.precedent}).`)
  if (malgre.length) raisons.push(`${codes(malgre)} : ${pl(malgre, 'monte', 'montent')} malgré une visite qui ${pl(malgre, 'la', 'les')} regarde : elle ne voit pas venir la panne.`)
  if (sans.length) raisons.push(`${codes(sans)} : ${pl(sans, 'monte', 'montent')} sans aucune visite sur ${pl(sans, 'son équipement', 'leur équipement')}.`)
  let verdict = 'bon'
  if ((ecart !== null && ecart > 0.15) || malgre.length >= 2) verdict = 'reevaluer'
  else if ((ecart !== null && ecart > 0.05) || malgre.length === 1 || sans.length >= 2) verdict = 'surveiller'
  if (ecart !== null && ecart <= -0.1 && verdict === 'reevaluer') verdict = 'surveiller'
  if (verdict === 'bon') raisons.push(ecart !== null && ecart < 0 ? 'Le plan va dans le bon sens : les pannes baissent.' : 'Pas de panne du haut du Pareto qui monte malgré une visite.')
  return { plan: { verdict, raisons, correctifs: pannes, preventifs, ecart }, indicateurs }
}
