// Les visites préparées dans PREVTEC (rien dans la GMAO) : une ligne de plus dans le Démonstrateur d'une machine ; à sa
// croisée avec un équipement, une fiche pour le mainteneur, proposée par l'IA à partir des pannes de cet équipement.
// Tant que personne ne la fait, une telle visite ne compte dans aucun diagnostic. Réglage « prev_visites_locales » :
//   [{ id, machine, titre, cree_le, fiches: { idEquipement: { points: [...], frequence, pourquoi, cree_le } } }]

import { reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { familleDe } from '../../lib/types.js'
import { texteSeul } from './visites.js'
import { lireJson } from './correlation.js'
import { machineEtPannes } from './demonstrateur.js'

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

export function creerVisiteLocale(machine) {
  const l = { id: `v${Date.now().toString(36)}`, machine: Number(machine), titre: '', cree_le: new Date().toISOString(), fiches: {} }
  ecrire([...toutes(), l])
  return l
}
export function retirerVisiteLocale(id) {
  ecrire(toutes().filter((l) => l.id !== id))
  return { ok: true }
}

// { equipement, titre, points, frequence, pourquoi } ; le titre de la fiche devient celui de la visite s'il n'y en a pas.
export function enregistrerFiche(id, { equipement, titre = '', points = [], frequence = '', pourquoi = '' }) {
  const propres = (Array.isArray(points) ? points : []).map((p) => String(p).trim()).filter(Boolean)
  if (!propres.length) throw new ErreurHttp(400, 'Écrivez au moins un point à contrôler.')
  return changer(id, (l) => {
    if (String(titre).trim()) l.titre = String(titre).trim()
    l.fiches[Number(equipement)] = { points: propres, frequence: String(frequence).slice(0, 40), pourquoi: String(pourquoi), cree_le: new Date().toISOString() }
  })
}
export const retirerFiche = (id, equipement) => changer(id, (l) => { delete l.fiches[Number(equipement)] })

const CONSIGNES = `Tu rédiges une nouvelle visite de maintenance préventive, faite par un technicien, pour voir venir les pannes décrites.
Réponds seulement avec un objet JSON, sans texte autour :
{"titre":"le titre court de la visite","points":["un contrôle par entrée : l'organe, ce qu'on regarde, l'état attendu"],"frequence":"Mensuelle | Trimestrielle | Semestrielle | Annuelle","pourquoi":"les pannes visées, une phrase"}
De 3 à 8 points. Seulement ce que disent les rapports : n'invente aucune valeur ni aucun repère.`

// Le brouillon de l'IA pour cet équipement, d'après ses pannes des 12 derniers mois et ce qui a été remarqué sur place.
export async function proposerFiche(parcId, machineId, equipement) {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  const { v, machine, repere } = await machineEtPannes(parcId, machineId)
  const id = Number(equipement)
  if (!repere.has(id)) throw new ErreurHttp(404, 'Équipement introuvable sur cette machine')
  const depuis = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const pannes = v.lignes.filter((l) => l.machine_id === id && l.date >= depuis && familleDe(l.type) === 'Correctif').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20)
  const remarques = [...v.remontees, ...v.ponctuels].filter((l) => l.machine_id === id && l.date >= depuis).slice(0, 6)
  const texte = await discuter([{ role: 'system', content: CONSIGNES }, { role: 'user', content: `Machine : ${machine.repere} ${machine.designation}\nÉquipement : ${repere.get(id)}\nRapports de panne (12 mois) :\n${pannes.map((l) => `- ${l.date} : ${texteSeul(l.description).slice(0, 300)}`).join('\n') || '- aucun'}\nDéjà remarqué sur place :\n${remarques.map((l) => `- ${texteSeul(l.description).slice(0, 200)}`).join('\n') || '- rien'}` }], { temperature: 0.3, maxMots: 1200 })
  const lu = lireJson(texte)
  if (!Array.isArray(lu?.points) || !lu.points.length) throw new ErreurHttp(502, 'Réponse de l’IA illisible : réessayez.')
  return { titre: String(lu.titre || ''), points: lu.points.map(String), frequence: String(lu.frequence || ''), pourquoi: String(lu.pourquoi || '') }
}
