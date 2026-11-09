// Les visites préparées dans PREVTEC (rien dans la GMAO) : une ligne de plus dans le Démonstrateur d'une machine ; à sa
// croisée avec un équipement, une fiche pour le mainteneur, proposée par l'IA à partir des pannes de cet équipement.
// Tant que personne ne la fait, une telle visite ne compte dans aucun diagnostic. Réglage « prev_visites_locales » :
//   [{ id, machine, titre, cree_le, fiches: { idEquipement: { points: [...], frequence, pourquoi, format, cree_le } } }]

import { db, reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { familleDe } from '../../lib/types.js'
import { texteSeul } from './visites.js'
import { lireJson } from './correlation.js'
import { FORMAT_POINT, symptomesPour, commenceParAction, nettoyerPoint, garderSymptomes } from './symptomes.js'
import * as mysql from 'ktec/mysql.js'
import { machineEtPannes, noeudDe } from './demonstrateur.js'
import { reglagesDuParc, valeursSql, instructions } from './gmao.js'
import { noterDecision } from './decisions.js'

const toutes = () => reglageJson('prev_visites_locales', []) || []
export const visitesLocales = (machine) => toutes().filter((l) => l.machine === Number(machine))
export const visiteLocale = (id) => toutes().find((l) => l.id === id) || null

function ecrire(liste) {
  exigerEcriture()
  modifierReglage('prev_visites_locales', liste)
  noterModification()
}
function changer(id, action) {
  const liste = toutes()
  const l = liste.find((x) => x.id === id)
  if (!l) throw new ErreurHttp(404, 'Visite introuvable')
  action(l)
  ecrire(liste)
  return l
}

// Le titre au standard des visites du site : en majuscules, sans accents, sans ancien numéro en tête.
export function titreStandard(titre, repere = '') {
  let t = String(titre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/^[\s\d.-]+/, '').replace(/\bMAINTENANCE PREVENTIVE\b\s*(DE|DU|DES)?\s*/, '').replace(/\s+/g, ' ').trim()
  if (t && !/^(VISITE|CONTROLE)\b/.test(t)) t = `VISITE ${t}`
  t = t.replace(/\s+([\d.]+)$/, (m, n) => (repere.toUpperCase().startsWith(n) ? '' : m)) // « … 670 » suivi du repère 670.2
  return repere && t && !t.includes(repere.toUpperCase()) ? `${t} ${repere.toUpperCase()}` : t
}

export function creerVisiteLocale(machine) {
  const l = { id: `v${Date.now().toString(36)}`, machine: Number(machine), titre: '', cree_le: new Date().toISOString(), fiches: {} }
  ecrire([...toutes(), l])
  return l
}
export function retirerVisiteLocale(id) {
  if (Object.values(visiteLocale(id)?.fiches || {}).some((f) => f.validee)) throw new ErreurHttp(409, 'Cette visite a une fiche validée dans la GMAO.')
  ecrire(toutes().filter((l) => l.id !== id))
  return { ok: true }
}

// { equipement, titre, points, frequence, pourquoi } ; le titre de la fiche devient celui de la visite s'il n'y en a pas.
export function enregistrerFiche(id, { equipement, titre = '', points = [], frequence = '', pourquoi = '', format = 'html' }) {
  garderSymptomes()
  const propres = (Array.isArray(points) ? points : []).map((p) => String(p).trim()).filter(Boolean)
  if (!propres.length) throw new ErreurHttp(400, 'Écrivez au moins un point à contrôler.')
  return changer(id, (l) => {
    if (l.fiches[Number(equipement)]?.validee) throw new ErreurHttp(409, 'Cette fiche est déjà validée dans la GMAO.')
    if (String(titre).trim()) l.titre = titreStandard(titre)
    l.fiches[Number(equipement)] = { points: propres, frequence: String(frequence).slice(0, 40), pourquoi: String(pourquoi), format: format === 'texte' ? 'texte' : 'html', cree_le: new Date().toISOString() }
  })
}
export const retirerFiche = (id, equipement) => changer(id, (l) => {
  if (l.fiches[Number(equipement)]?.validee) throw new ErreurHttp(409, 'Cette fiche est validée dans la GMAO.')
  delete l.fiches[Number(equipement)]
})

// Valider une fiche préparée : créer sa FI dans la GMAO (simulée d'abord). Le titre prend le code le plus courant des
// visites de la machine, pour que ses passages soient reconnus comme du plan de maintenance.
export async function validerDansGmao(parcId, machineId, id, { equipement, valider = false }) {
  const l = visiteLocale(id)
  const f = l?.fiches[Number(equipement)]
  if (!f) throw new ErreurHttp(404, 'Fiche introuvable')
  if (f.validee) throw new ErreurHttp(409, 'Cette fiche est déjà validée dans la GMAO.')
  const r = reglagesDuParc(parcId)
  if (!r.sqlVisite) throw new ErreurHttp(409, 'Le SQL de création d’une visite n’est pas réglé (Administration › Réglages › Requêtes de PREVTEC).')
  const { v, repere, equipements, machine } = await machineEtPannes(parcId, machineId)
  const repereMachine = machine.repere
  const code = repere.get(Number(equipement))
  const noeud = noeudDe(v, code)
  if (noeud === null) throw new ErreurHttp(404, 'Cet équipement est introuvable dans l’arborescence de la GMAO.')
  const comptes = v.visites.filter((x) => equipements.has(x.machine_id) && x.code).reduce((m, x) => m.set(x.code.code, (m.get(x.code.code) || 0) + 1), new Map())
  const prefixe = [...comptes].sort((a, b) => b[1] - a[1])[0]?.[0]
  const titre = prefixe ? `${prefixe}-${l.titre}` : l.titre
  const numero = `FI-P-${l.id.slice(1)}-${Number(equipement).toString(36)}`.toUpperCase() // 20 caractères au plus dans la GMAO
  const [periot, valPeriot] = r.frequences?.[f.frequence] || [r.periot, r.valPeriot]
  const obser = f.format === 'texte' ? f.points.join('\n') : `<ol>${f.points.map((p) => `<li>${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</li>`).join('')}</ol>`
  const lot = instructions(r.sqlVisite, { ...valeursSql(r, { numero, titre, obser, parc: parcId, periot, valPeriot }), equipement: noeud, equipement_code: code })
  const reponse = await mysql.ecrireDansLaBase(lot, { valider: Boolean(valider) })
  const modifiees = reponse.resultats.filter((x) => 'modifiees' in x).reduce((s, x) => s + x.modifiees, 0)
  if (valider && modifiees) {
    changer(id, (x) => { x.fiches[Number(equipement)].validee = { numero, le: new Date().toISOString() } })
    noterDecision({ parc: parcId, machine: Number(machineId), repere: repereMachine, equipement: Number(equipement), equipementRepere: code, pose: Number(equipement), titre, fi: numero, action: 'creer', detail: f.frequence })
  }
  return { valide: reponse.valide, modifiees, numero, titre, repere: code }
}

const CONSIGNES = () => `Tu rédiges une nouvelle visite de maintenance préventive, faite par un technicien, pour voir venir les pannes décrites.
Réponds seulement avec un objet JSON, sans texte autour :
{"points":["une phrase par contrôle"],"frequence":"Mensuelle | Trimestrielle | Semestrielle | Annuelle","pourquoi":"les pannes visées, une phrase"}
De 3 à 8 points, chacun une simple phrase entre guillemets, jamais un objet. ${FORMAT_POINT}
Les contrôles viennent des rapports ; n'invente aucune valeur ni aucun repère.`

// Un point rendu par l'IA : une phrase, ou parfois un objet { organe, contrôle… } dont on recolle les morceaux.
const enTexte = (p) => {
  if (typeof p !== 'object' || p === null) return String(p ?? '').trim()
  const [premier, ...reste] = Object.values(p).map((x) => String(x ?? '').trim()).filter(Boolean)
  return reste.length ? `${premier} : ${reste.join(', ')}` : premier || ''
}

// Le brouillon de l'IA pour cet équipement, d'après ses pannes des 12 derniers mois et ce qui a été remarqué sur place.
export async function proposerFiche(parcId, machineId, equipement) {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  const { v, machine, repere } = await machineEtPannes(parcId, machineId)
  const id = Number(equipement)
  if (!repere.has(id)) throw new ErreurHttp(404, 'Équipement introuvable sur cette machine')
  const depuis = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const pannes = v.lignes.filter((l) => l.machine_id === id && l.date >= depuis && familleDe(l.type) === 'Correctif').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20)
  const remarques = [...v.remontees, ...v.ponctuels].filter((l) => l.machine_id === id && l.date >= depuis).slice(0, 6)
  const organeSien = db().prepare('SELECT designation FROM machines WHERE id = ?').get(id)?.designation || repere.get(id)
  // L'IA locale varie d'une fois à l'autre : on lui redemande si sa réponse est illisible ou trop courte.
  let lu = null
  let points = []
  const bonnes = (l) => l.length >= 3 && l.filter(commenceParAction).length >= l.length * 0.7
  for (let essai = 0; essai < 3 && !bonnes(points); essai++) {
    lu = lireJson(await discuter([{ role: 'system', content: CONSIGNES() }, { role: 'user', content: `Machine : ${machine.repere} ${machine.designation}\nÉquipement : ${repere.get(id)}\nRapports de panne (12 mois) :\n${pannes.map((l) => `- ${l.date} : ${texteSeul(l.description).slice(0, 300)}`).join('\n') || '- aucun'}\nDéjà remarqué sur place :\n${remarques.map((l) => `- ${texteSeul(l.description).slice(0, 200)}`).join('\n') || '- rien'}\nSymptômes classiques par élément :\n${symptomesPour(`${organeSien} ${pannes.map((l) => texteSeul(l.description)).join(' ')}`) || '- aucun'}` }], { temperature: 0.3, maxMots: 1200 }))
    if (Array.isArray(lu?.points)) points = lu.points.map(enTexte).map(nettoyerPoint).filter(Boolean)
  }
  if (!points.length) throw new ErreurHttp(502, 'Réponse de l’IA illisible : réessayez.')
  // Le titre vient de l'arborescence, pas de l'IA : VISITE, le nom de l'équipement, le repère de la machine.
  const nom = String(organeSien).split('/').pop().trim()
  return { titre: titreStandard(`VISITE ${nom}`, machine.repere), points, frequence: String(lu.frequence || ''), pourquoi: String(lu.pourquoi || '') }
}
