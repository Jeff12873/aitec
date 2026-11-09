// PREVTEC : le registre des décisions prises sur le plan de maintenance, leur bilan et les gains.
// Retirer du préventif est un gain : ce registre le prouve, chiffres à l'appui, et protège ce qui ne doit pas être retiré.
//   réglage « prev_decisions »   : [{ id, le, qui, parc, machine, repere, equipement, equipementRepere, pose, titre, fi, action, detail, heures, annulee }]
//   réglage « prev_protections » : { 'machine|pose|titre': true ou false }, ce que l'administrateur a corrigé
//   réglage « prev_phrases »     : les phrases du responsable, une par ligne

import { db, reglage, reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { exigerEcriture } from 'ktec/partage.js'
import { reglagesPoste } from 'ktec/installation.js'
import { familleDe } from '../../lib/types.js'
import { visitesDuParc, resultatDuPassage, texteSeul } from './visites.js'

export const cleVisite = (machine, pose, titre) => `${machine}|${pose}|${titre}`
export const lireDecisions = () => reglageJson('prev_decisions', []) || []
const MOIS_BILAN = 3 // assez de recul pour comparer, en mois terminés
export const SEUIL_RAS = 0.8
export const ECRITS_MIN = 3

export function noterDecision(decision) {
  exigerEcriture()
  const liste = lireDecisions()
  liste.push({ id: Math.max(0, ...liste.map((x) => x.id)) + 1, le: new Date().toISOString(), qui: reglagesPoste().nomAgent || '', ...decision })
  modifierReglage('prev_decisions', liste)
  noterModification()
}

export function annulerDecision(id) {
  exigerEcriture()
  modifierReglage('prev_decisions', lireDecisions().map((x) => (x.id === Number(id) ? { ...x, annulee: new Date().toISOString() } : x)))
  noterModification()
}

export const visitesRetirees = (machine) => new Set(lireDecisions().filter((x) => x.action === 'supprimer' && !x.annulee && x.machine === machine).map((x) => cleVisite(x.machine, x.pose, x.titre)))
export const espaceeLe = (machine, pose, titre) => lireDecisions().find((x) => x.action === 'espacer' && !x.annulee && x.machine === machine && x.pose === pose && x.titre === titre)?.le || null

// ---------------------------------------------------------------- les visites à ne pas retirer

// Sur un contrôle de sécurité, ne rien trouver est le résultat espéré : un RAS n'y prouve pas l'inutilité.
const MOTS_PROTEGES = /arr[eê]ts? d.urgence|s[eé]curit[eé]|levage|soupape|pression|r[eé]glementaire|incendie|extincteur|v[eé]rification p[eé]riodique/i

// Seul le titre compte : le mot « sécurité » apparaît dans le texte de beaucoup de FI ordinaires.
export function protection(machine, g) {
  const choix = (reglageJson('prev_protections', {}) || {})[cleVisite(machine, g.pose, g.titre)]
  const mot = MOTS_PROTEGES.exec(g.titre)?.[0]
  const raison = g.jamaisEspacer ? 'type de visite à ne jamais espacer' : mot ? `mot repéré : ${mot.toLowerCase()}` : ''
  return { protegee: choix ?? Boolean(raison), raison: choix === undefined ? raison : 'choix de l’administrateur' }
}

export function enregistrerProtection(machine, pose, titre, valeur) {
  exigerEcriture()
  modifierReglage('prev_protections', { ...(reglageJson('prev_protections', {}) || {}), [cleVisite(machine, pose, titre)]: Boolean(valeur) })
  noterModification()
}

// ---------------------------------------------------------------- bilan et gains

const dateIso = (annee, mois) => { const d = new Date(annee, mois, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

// Les pannes de l'équipement avant et après la décision, sur autant de mois terminés de chaque côté.
function bilan(v, d) {
  const le = new Date(d.le)
  const maintenant = new Date()
  const ecoules = (maintenant.getFullYear() - le.getFullYear()) * 12 + maintenant.getMonth() - le.getMonth() - 1
  if (ecoules < MOIS_BILAN) return { attente: MOIS_BILAN - Math.max(0, ecoules) }
  const n = Math.min(ecoules, 12)
  const [annee, mois] = [le.getFullYear(), le.getMonth()]
  const couvre = (l) => (d.equipement === d.machine ? (v.places.get(l.machine_id)?.machine ?? l.machine_id) === d.machine : l.machine_id === d.equipement)
  const pannes = v.lignes.filter((l) => familleDe(l.type) === 'Correctif' && couvre(l))
  const entre = (a, b) => pannes.filter((l) => l.date >= a && l.date < b).length
  return { mois: n, avant: entre(dateIso(annee, mois - n), dateIso(annee, mois)), apres: entre(dateIso(annee, mois + 1), dateIso(annee, mois + 1 + n)) }
}

// Les visites qui ne trouvent rien, sur un équipement sans panne, et qu'on pourrait donc alléger.
function potentiel(v) {
  const depuis = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const avecPanne = new Set()
  for (const l of v.lignes) {
    if (familleDe(l.type) !== 'Correctif' || l.date < depuis) continue
    avecPanne.add(l.machine_id)
    const m = v.places.get(l.machine_id)?.machine
    if (m) avecPanne.add(m)
  }
  const groupes = new Map()
  for (const x of v.pourEcran('demonstrateur').filter((l) => l.recente && !avecPanne.has(l.machine_id))) {
    const titre = x.code?.titre || texteSeul(x.description).split(' - ')[0].slice(0, 100)
    const cle = `${x.machine_id}|${titre}`
    const g = groupes.get(cle) || { pose: x.machine_id, titre, jamaisEspacer: Boolean(x.code?.jamaisEspacer), machine: x.place?.machine ?? x.machine_id, passages: 0, ecrits: 0, rien: 0, heures: 0 }
    g.passages++
    const resultat = resultatDuPassage(x.description)
    if (resultat) g.ecrits++
    if (resultat === 'rien') g.rien++
    g.heures += Number(x.duree_h) > 0 ? Number(x.duree_h) : 0
    groupes.set(cle, g)
  }
  const retenues = [...groupes.values()].filter((g) => g.ecrits >= ECRITS_MIN && g.rien / g.ecrits >= SEUIL_RAS && !visitesRetirees(g.machine).has(cleVisite(g.machine, g.pose, g.titre)) && !protection(g.machine, g).protegee)
  const nom = db().prepare('SELECT repere FROM machines WHERE id = ?')
  const liste = retenues.sort((a, b) => b.heures - a.heures).map((g) => ({ machine: g.machine, pose: g.pose, titre: g.titre, repere: nom.get(g.pose)?.repere || '', passages: g.passages, ecrits: g.ecrits, ras: Math.round((g.rien / g.ecrits) * 100), heures: Math.round(g.heures * 10) / 10 }))
  return { visites: retenues.length, heures: Math.round(retenues.reduce((s, g) => s + g.heures, 0)), liste }
}

const somme = (liste) => ({
  retirees: liste.filter((x) => x.action === 'supprimer').length,
  espacees: liste.filter((x) => x.action === 'espacer').length,
  heures: Math.round(liste.reduce((s, x) => s + (x.heures || 0), 0)),
})

// Une phrase du responsable, la même toute la journée.
export const lirePhrases = () => String(reglage('prev_phrases', '') || '')
function phraseDuJour() {
  const phrases = lirePhrases().split('\n').map((x) => x.trim()).filter(Boolean)
  return phrases.length ? phrases[Math.floor(Date.now() / 86_400_000) % phrases.length] : ''
}
export function enregistrerPhrases(texte) {
  exigerEcriture()
  modifierReglage('prev_phrases', String(texte || '').trim() || null)
  noterModification()
  return { texte: lirePhrases() }
}

export function gainsDuSite() {
  return { ...somme(lireDecisions().filter((x) => !x.annulee)), phrase: phraseDuJour() }
}

export async function gainsDuParc(parcId) {
  const v = await visitesDuParc(parcId)
  const decisions = lireDecisions().filter((x) => x.parc === parcId).map((x) => ({ ...x, bilan: bilan(v, x) })).reverse()
  const faites = decisions.filter((x) => !x.annulee)
  return { ...somme(faites), verifiees: faites.filter((x) => ['supprimer', 'espacer'].includes(x.action) && 'apres' in x.bilan && x.bilan.apres <= x.bilan.avant).length, potentiel: potentiel(v), decisions, phrase: phraseDuJour() }
}
