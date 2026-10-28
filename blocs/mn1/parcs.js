// La maintenance de niveau 1 par parc : les vignettes (charge des opérateurs, pertinence, tendance, alertes) et
// la fiche MN1 d'un parc (ses fiches, sa charge par ETH, le Pareto de ses pannes, l'avant / après de chaque fiche).
//
// Le Pareto : les pannes qui reviennent (même symptôme, 3 cas au moins) sur les machines de maintenance du parc,
// comptées sur 12 mois, de la plus fréquente à la moins fréquente.

import crypto from 'node:crypto'
import { db, reglage } from '../../lib/base.js'
import { etatPartage } from 'ktec/partage.js'
import { lireParcs, NON_CLASSE } from '../../lib/parcs.js'
import { familleDe, sqlFamille } from '../../lib/types.js'
import { pannesDeLaMachine } from '../pannes/serveur.js'
import { chargeDuParc, etatLecture, parSemaine, periodicite } from './fi.js'
import { reglagesDuParc } from './gmao.js'
import { lireDemandes, close } from './demandes.js'

export const SEUIL_PERTINENCE = 0.6 // par défaut : alerte sous 60 % du Pareto couvert
export const seuilPertinence = () => Number(reglage('mn1_seuil_pertinence', '')) || SEUIL_PERTINENCE
const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
const sansPrefixe = (code) => String(code || '').replace(/^[A-Z]{1,3}_/i, '').toLowerCase()

// ---------------------------------------------------------------- fiches d'un parc

// Une fiche est dans un parc si on l'y a rangée ; sinon d'après sa machine, son équipement ou le nom de sa ligne.
export function fichesDesParcs(p, { archivees = false } = {}) {
  const fiches = db().prepare(`SELECT f.*, m.repere, m.designation FROM fiches_mn1 f LEFT JOIN machines m ON m.id = f.machine_id WHERE f.archivee = ? ORDER BY f.eth, coalesce(m.repere, f.machine_nom), f.etiquette, f.id`).all(archivees ? 1 : 0)
  const parcs = p.parcs.filter((x) => !x.nonClasse)
  const codes = new Map(parcs.map((x) => [x.id, new Set([x.nom.toLowerCase(), ...[...x.production, ...x.maintenance, ...x.autres].map((id) => sansPrefixe(p.racines.find((r) => r.id === id)?.code))])]))
  const parcDe = (f) => {
    if (f.parc && parcs.some((x) => x.id === f.parc)) return f.parc
    const parMachine = parcs.find((x) => (f.machine_prod && x.machines.has(f.machine_prod)) || (f.machine_id && x.machines.has(f.machine_id)))
    if (parMachine) return parMachine.id
    const ligne = sansPrefixe(f.ligne)
    return (ligne && parcs.find((x) => codes.get(x.id).has(ligne))?.id) || ''
  }
  const resultat = new Map(parcs.map((x) => [x.id, []]))
  const sans = []
  for (const f of fiches) {
    const id = parcDe(f)
    if (id) resultat.get(id).push({ ...f, parc: id })
    else sans.push(f)
  }
  return { parParc: resultat, sansParc: sans }
}

// ---------------------------------------------------------------- Pareto des pannes

let cachePareto = new Map() // parc → { cle, pareto }

// Les machines de maintenance d'un parc (à défaut : toutes ses machines).
const machinesMaintenance = (parc) => [...(parc.machinesMaintenance.size ? parc.machinesMaintenance : parc.machines)]

export function pareto(parc) {
  const cle = `${etatPartage().version}`
  const garde = cachePareto.get(parc.id)
  if (garde?.cle === cle) return garde.pareto
  const depuis = ilYa(365)
  const reperes = new Map(db().prepare('SELECT id, repere, designation FROM machines').all().map((m) => [m.id, m]))
  const plusFrequent = (valeurs) => [...valeurs.reduce((c, v) => c.set(v, (c.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  const items = []
  for (const id of machinesMaintenance(parc)) {
    for (const g of pannesDeLaMachine(id)) {
      const recents = g.cas.filter((c) => c.date >= depuis)
      if (!recents.length) continue
      const m = reperes.get(id)
      items.push({ machine: id, repere: m?.repere || '', designation: m?.designation || '', symptome: plusFrequent(g.cas.map((c) => c.symptome)).slice(0, 160), nombre: recents.length, total: g.cas.length, derniere: g.cas[0]?.date || '', cas: g.cas.map((c) => c.id), datesCas: g.cas.map((c) => c.date) })
    }
  }
  items.sort((a, b) => b.nombre - a.nombre || b.total - a.total)
  const somme = items.reduce((s, x) => s + x.nombre, 0)
  let cumul = 0
  const liste = items.slice(0, 30).map((x, i) => {
    cumul += x.nombre
    return { ...x, rang: i + 1, code: `P${i + 1}`, part: somme ? x.nombre / somme : 0, cumul: somme ? cumul / somme : 0 }
  })
  cachePareto.set(parc.id, { cle, pareto: liste })
  return liste
}

// Les correctifs du parc, par mois, sur 12 mois (la petite courbe de la vignette).
function tendance(parc) {
  const ids = machinesMaintenance(parc)
  if (!ids.length) return []
  const lignes = db().prepare(`SELECT substr(date, 1, 7) AS mois, count(*) AS n FROM interventions WHERE machine_id IN (${ids.join(',')}) AND ${sqlFamille('Correctif')} AND date >= date('now', 'start of month', '-11 months') GROUP BY mois`).all()
  const parMois = new Map(lignes.map((l) => [l.mois, l.n]))
  const mois = []
  const d0 = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1)
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    mois.push({ mois: cle, n: parMois.get(cle) || 0 })
  }
  return mois
}

// ---------------------------------------------------------------- analyse de corrélation (lue)

// La signature de ce qui a été analysé : différente = de nouvelles pannes ou fiches depuis, analyse à refaire.
export function signature(listePareto, fiches) {
  const texte = JSON.stringify([listePareto.slice(0, 15).map((x) => [x.machine, x.symptome, x.nombre]), fiches.map((f) => [f.id, f.modifie_le])])
  return crypto.createHash('sha256').update(texte).digest('hex').slice(0, 16)
}

export function lireAnalyse(parcId) {
  const l = db().prepare('SELECT * FROM mn1_analyses WHERE parc = ?').get(parcId)
  if (!l) return null
  try {
    return { date: l.date, signature: l.signature, ...JSON.parse(l.resultat) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- avant / après

// Les correctifs visés par une fiche, 12 mois avant et après le début de sa fiche dans une FI (par mois, pour
// comparer une période d'après encore courte). Sans analyse : tous les correctifs de sa machine de maintenance.
function avantApres(f, debut, liens, analyse, listePareto) {
  if (!debut) return null
  const maint = (f.machine_prod && liens[f.machine_prod]) || f.machine_id || null
  if (!maint) return { sansMachine: true, debut }
  const visees = (analyse?.pareto || []).filter((x) => (x.fiches || []).includes(f.id)).map((x) => listePareto.find((p) => p.code === x.code)).filter(Boolean)
  const d = new Date(`${debut}T00:00:00`)
  const avant = new Date(d.getTime() - 365 * 86_400_000).toISOString().slice(0, 10)
  const apres = new Date(Math.min(Date.now(), d.getTime() + 365 * 86_400_000)).toISOString().slice(0, 10)
  const moisApres = Math.max(0, (new Date(apres) - d) / (30.44 * 86_400_000))
  let nAvant
  let nApres
  if (visees.length) {
    const dates = visees.flatMap((x) => x.datesCas)
    nAvant = dates.filter((x) => x >= avant && x < debut).length
    nApres = dates.filter((x) => x >= debut && x <= apres).length
  } else {
    const compter = (de, a) => db().prepare('SELECT type FROM interventions WHERE machine_id = ? AND date >= ? AND date < ?').all(maint, de, a).filter((i) => familleDe(i.type) === 'Correctif').length
    nAvant = compter(avant, debut)
    nApres = compter(debut, apres + 'z')
  }
  const parMoisAvant = nAvant / 12
  const parMoisApres = moisApres >= 1 ? nApres / moisApres : null
  return { debut, avant: nAvant, apres: nApres, moisApres: Math.round(moisApres * 10) / 10, evolution: parMoisApres === null || !parMoisAvant ? null : (parMoisApres - parMoisAvant) / parMoisAvant, cible: visees.length ? 'pannes visées' : 'tous les correctifs de la machine' }
}

// La fréquence d'une fiche importée est provisoire tant que sa machine n'a pas été analysée (ou que l'admin ne l'a
// pas confirmée).
export const aAnalyserFiche = (f) => !['analyse', 'manuelle'].includes(f.frequence_source)

const debutDe = (ficheId) => db().prepare('SELECT debut FROM fiches_mn1_fi WHERE fiche_id = ? AND fin IS NULL ORDER BY debut DESC LIMIT 1').get(ficheId)?.debut || null

// ---------------------------------------------------------------- vignettes

async function demandesDuParc(parc) {
  let demandes = null
  try {
    demandes = await lireDemandes()
  } catch {
    return null
  }
  if (!demandes) return null
  const voulu = reglage('mn1_type_demande', '')
  const types = [...new Set(demandes.map((d) => d.type))]
  const type = voulu && types.includes(voulu) ? voulu : types.find((t) => /maint/i.test(t)) || ''
  const parRepere = new Map(db().prepare('SELECT id, repere FROM machines').all().map((m) => [m.repere, m.id]))
  return demandes.filter((d) => d.type === type && d.date >= ilYa(365)).map((d) => ({ ...d, machineId: parRepere.get(d.machine) ?? null, close: close(d.etat) })).filter((d) => d.machineId && parc.machines.has(d.machineId))
}

// Les indicateurs d'un parc : { charge: { taux, eths: [...] }, pertinence, analyse, alertes, … }
async function indicateurs(p, parc, fiches) {
  const liste = pareto(parc)
  const analyse = lireAnalyse(parc.id)
  const seuil = seuilPertinence()
  let charge = null
  let erreurCharge = null
  try {
    const c = await chargeDuParc(parc.id)
    const eths = c.eths.filter((e) => e.fi.length || fiches.some((f) => f.noeud && e.eth))
    const tauxMax = c.eths.reduce((m, e) => Math.max(m, e.taux || 0), 0)
    charge = { max: c.reglages.parSemaine, taux: tauxMax, actives: c.eths.reduce((s, e) => s + e.fi.filter((x) => x.actif).length, 0), suspendues: c.eths.reduce((s, e) => s + e.fi.filter((x) => !x.actif).length, 0), surcharges: c.eths.filter((e) => e.taux > 1 + 1e-9).map((e) => e.libelle), eths: eths.length }
  } catch (e) {
    erreurCharge = e.message
  }
  const perimee = Boolean(analyse && analyse.signature !== signature(liste, fiches))
  const alertes = []
  if (charge?.surcharges.length) alertes.push({ niveau: 'rouge', texte: `Charge dépassée : ${charge.surcharges.join(', ')}` })
  if (analyse && analyse.pertinence !== null && analyse.pertinence < seuil) alertes.push({ niveau: 'orange', texte: `Pertinence sous ${Math.round(seuil * 100)} %` })
  if (perimee) alertes.push({ niveau: 'gris', texte: 'Analyse à refaire' })
  const aAnalyser = fiches.filter(aAnalyserFiche).length
  return {
    charge, erreurCharge,
    pertinence: analyse ? { taux: analyse.pertinence, date: analyse.date, perimee } : null,
    alertes, aAnalyser,
    pareto: { nombre: liste.length, cas: liste.reduce((s, x) => s + x.nombre, 0) },
    tendance: tendance(parc),
  }
}

export async function vignettes() {
  const p = await lireParcs()
  if (!p) return { parcs: [], lecture: etatLecture(), sansArborescence: true }
  const { parParc, sansParc } = fichesDesParcs(p)
  const parcs = []
  for (const parc of p.parcs.filter((x) => !x.nonClasse)) {
    const fiches = parParc.get(parc.id) || []
    parcs.push({ id: parc.id, nom: parc.nom, machines: parc.machines.size, fiches: fiches.length, avecFi: fiches.filter((f) => f.fi_gmao).length, ...(await indicateurs(p, parc, fiches)) })
  }
  return { parcs, sansParc: sansParc.length, seuil: seuilPertinence(), lecture: etatLecture(), nonClasse: p.parcs.some((x) => x.nonClasse) }
}

// La fiche MN1 d'un parc : tout le détail.
export async function detailDuParc(parcId) {
  const p = await lireParcs()
  const parc = p?.parcs.find((x) => x.id === parcId && x.id !== NON_CLASSE)
  if (!parc) return null
  const { parParc } = fichesDesParcs(p)
  const fiches = parParc.get(parc.id) || []
  const liste = pareto(parc)
  const analyse = lireAnalyse(parc.id)
  const r = reglagesDuParc(parc.id)
  let charge = null
  let erreurCharge = null
  try {
    charge = await chargeDuParc(parc.id)
  } catch (e) {
    erreurCharge = e.message
  }
  const demandes = await demandesDuParc(parc)
  // Les machines (de production ou de maintenance) qui ont une fiche : une demande sur l'une d'elles est signalée.
  const machinesAvecFiche = new Map()
  for (const f of fiches) {
    for (const id of [f.machine_prod, f.machine_id, f.machine_prod && p.liens[f.machine_prod]].filter(Boolean)) machinesAvecFiche.set(id, f)
  }
  const sansCible = new Set(analyse?.fichesSansCible || [])
  const fichesDetail = fiches.map((f) => {
    const per = periodicite(f.frequence, r)
    const poids = per ? parSemaine(per[0], per[1], r) : null
    const suggestion = sansCible.has(f.id) ? suggestionEspacement(f.frequence, r, poids) : null
    return {
      ...f,
      poids: poids === null ? null : Math.round(poids * 100) / 100,
      aAnalyser: aAnalyserFiche(f),
      sansCible: sansCible.has(f.id),
      suggestion,
      avantApres: avantApres(f, debutDe(f.id), p.liens, analyse, liste),
      demandes: demandes ? demandes.filter((d) => machinesAvecFiche.get(d.machineId)?.id === f.id).length : null,
    }
  })
  return {
    parc: { id: parc.id, nom: parc.nom, machines: parc.machines.size, production: parc.machinesProduction.size, maintenance: parc.machinesMaintenance.size },
    fiches: fichesDetail,
    archivees: db().prepare('SELECT count(*) AS n FROM fiches_mn1 WHERE archivee = 1 AND parc = ?').get(parc.id).n,
    charge, erreurCharge, lecture: etatLecture(),
    pareto: liste.map(({ cas, datesCas, ...x }) => x),
    analyse: analyse ? { ...analyse, perimee: analyse.signature !== signature(liste, fiches) } : null,
    seuil: seuilPertinence(),
    demandes: demandes ? { total: demandes.length, ouvertes: demandes.filter((d) => !d.close).length, surMachineAvecFiche: demandes.filter((d) => machinesAvecFiche.has(d.machineId)).length, dernieres: demandes.slice(0, 15).map((d) => ({ ...d, fiche: machinesAvecFiche.get(d.machineId) ? { id: machinesAvecFiche.get(d.machineId).id, etiquette: machinesAvecFiche.get(d.machineId).etiquette } : null })) } : null,
    reglages: { parSemaine: r.parSemaine, propres: r.propres },
    tendance: tendance(parc),
  }
}

// Une fiche qui ne vise aucune panne du Pareto : espacer sa fréquence d'un cran, et ce que la charge y gagne.
const ORDRE = ['Hebdomadaire', 'Mensuelle', 'Trimestrielle', 'Semestrielle', 'Annuelle']
function suggestionEspacement(frequence, r, poids) {
  const i = ORDRE.indexOf(frequence)
  if (i < 0 || i === ORDRE.length - 1) return null
  const suivante = ORDRE[i + 1]
  const per = periodicite(suivante, r)
  const nouveau = per ? parSemaine(per[0], per[1], r) : null
  return { frequence: suivante, gain: poids !== null && nouveau !== null ? Math.round((poids - nouveau) * 100) / 100 : null }
}
