// Le démonstrateur d'une machine (PREVTEC, étapes 3 « Une machine » et 4 « Je décide »), réduit à une question :
// les pannes qui reviennent sur cette machine sont-elles regardées par une visite ?
//
// La machine : le nœud de niveau 3 de l'arborescence (un clic sur un sous-ensemble remonte à sa machine), avec tous
// ses sous-ensembles. Ses 5 premières pannes (12 mois), chacune avec une pastille, sans IA :
//   - « aucune »   : aucune visite sur son équipement ni sur la machine ;
//   - « revoir »   : une visite la regarde, et pourtant elle monte (ou apparaît, 3 cas au moins) ;
//   - « regardee » : une visite la regarde, et elle ne monte pas.
// Les visites : celles du plan (code reconnu, visites.js), regroupées par titre. Je décide : pour le rouge et
// l'orange, une fiche N1 ou un point N2 rédigés par l'IA.

import { db } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { pannesDeLaMachine } from '../pannes/serveur.js'
import { evolution } from './parcs.js'
import { visitesDuParc, regarde, texteSeul } from './visites.js'
import { redigerFiche, lireJson } from './correlation.js'

const NB_PANNES = 5
const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
const plusFrequent = (valeurs) => [...valeurs.reduce((c, v) => c.set(v, (c.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
const cleDe = (texte) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)

// La machine (niveau 3) et ses équipements, ses pannes des 12 derniers mois.
async function machineEtPannes(parcId, machineId) {
  const v = await visitesDuParc(parcId)
  const cliquee = Number(machineId)
  const id = v.places.get(cliquee)?.machine ?? cliquee
  const machine = db().prepare('SELECT id, repere, designation FROM machines WHERE id = ?').get(id)
  if (!machine) throw new ErreurHttp(404, 'Machine introuvable')
  const equipements = new Set([id, ...[...v.places].filter(([, p]) => p.machine === id).map(([e]) => e)])
  const repere = new Map(db().prepare(`SELECT id, repere FROM machines WHERE id IN (${[...equipements].join(',')})`).all().map((m) => [m.id, m.repere]))
  const depuis = ilYa(365)
  const avant = ilYa(730)
  const pannes = []
  for (const e of equipements) {
    for (const g of pannesDeLaMachine(e)) {
      const recents = g.cas.filter((c) => c.date >= depuis)
      if (!recents.length) continue
      const precedent = g.cas.filter((c) => c.date >= avant && c.date < depuis).length
      const symptome = plusFrequent(g.cas.map((c) => c.symptome)).slice(0, 160)
      pannes.push({ cle: `${e}:${cleDe(symptome)}`, equipement: e, surQuoi: repere.get(e) || '', symptome, repere: machine.repere, designation: machine.designation, nombre: recents.length, precedent, evolution: evolution(recents.length, precedent), cas: g.cas.map((c) => c.id) })
    }
  }
  pannes.sort((a, b) => b.nombre - a.nombre)
  return { v, machine, equipements, repere, pannes }
}

export async function demonstrateur(parcId, machineId) {
  const { v, machine, equipements, repere, pannes } = await machineEtPannes(parcId, machineId)
  const visites = v.visites.filter((x) => x.recente && equipements.has(x.machine_id))
  const titreDe = (x) => x.code?.titre || texteSeul(x.description).split(' - ')[0].slice(0, 100)
  const resultat = pannes.slice(0, NB_PANNES).map((p) => {
    const regardent = visites.filter((x) => regarde(x, p.equipement, v.places))
    const monte = p.evolution === 'monte' || (p.evolution === 'nouvelle' && p.nombre >= 3)
    const etat = !regardent.length ? 'aucune' : monte ? 'revoir' : 'regardee'
    return { cle: p.cle, symptome: p.symptome, surQuoi: p.surQuoi, nombre: p.nombre, precedent: p.precedent, evolution: p.evolution, etat, visites: [...new Set(regardent.map(titreDe))] }
  })
  // Les visites, regroupées par code, titre et équipement.
  const groupes = new Map()
  for (const x of visites) {
    const cle = `${x.code?.code || ''}|${titreDe(x)}|${x.machine_id}`
    const g = groupes.get(cle) || { code: x.code ? { code: x.code.code, niveau: x.code.niveau, type: x.code.nomType } : null, titre: titreDe(x), surQuoi: repere.get(x.machine_id) || '', passages: 0, derniere: '' }
    g.passages++
    if (x.date > g.derniere) g.derniere = x.date
    groupes.set(cle, g)
  }
  return {
    parc: { id: v.parc.id, nom: v.parc.nom },
    machine,
    pannes: resultat,
    visites: [...groupes.values()].sort((a, b) => b.passages - a.passages),
    conventionReglee: v.reglee,
    iaInstallee: iaInstallee(),
  }
}

// ---------------------------------------------------------------- je décide : fiche N1 ou point N2

const CONSIGNES_N2 = `Tu rédiges un point de maintenance préventive de niveau 2 (fait par un technicien de maintenance, avec outillage ou démontage léger), à reporter dans la GMAO. Il doit permettre de voir venir la panne décrite.
Réponds seulement avec un objet JSON, sans texte autour :
{"quoi":"le contrôle ou la mesure, concret, avec la valeur ou l'état attendu","ou":"organe ou sous-ensemble","frequence":"Mensuelle | Trimestrielle | Semestrielle | Annuelle","metier":"Mécanique | Électrique | Pneumatique | Hydraulique | Automatisme","pourquoi":"la panne visée et ce que le contrôle voit venir, une phrase"}`

async function panneDe(parcId, machineId, cle) {
  const { machine, pannes } = await machineEtPannes(parcId, machineId)
  const panne = pannes.find((x) => x.cle === cle)
  if (!panne) throw new ErreurHttp(404, 'Panne introuvable sur cette machine')
  return { machine, panne }
}

export async function proposerFicheMachine(parcId, machineId, cle) {
  const { panne } = await panneDe(parcId, machineId, cle)
  return redigerFiche(panne)
}

// visites : les visites qui regardent déjà la panne sans la voir venir (à revoir), facultatives.
export async function proposerN2(parcId, machineId, cle, visites = '') {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  const { machine, panne } = await panneDe(parcId, machineId, cle)
  const rapports = db().prepare(`SELECT date, description FROM interventions WHERE id IN (${panne.cas.slice(0, 8).join(',') || 'NULL'}) ORDER BY date DESC`).all()
  const texte = await discuter([{ role: 'system', content: CONSIGNES_N2 }, { role: 'user', content: `Machine : ${machine.repere} ${machine.designation}\nPanne : ${panne.symptome}${panne.surQuoi ? ` (sur ${panne.surQuoi})` : ''}, ${panne.nombre} cas en 12 mois${visites ? `\nVisite actuelle qui ne la voit pas venir : ${visites}` : ''}\nRapports :\n${rapports.map((r) => `- ${r.date} : ${texteSeul(r.description).slice(0, 300)}`).join('\n')}` }], { temperature: 0.3, maxMots: 400 })
  const lu = lireJson(texte)
  if (!lu?.quoi) throw new ErreurHttp(502, 'Réponse de l’IA illisible : réessayez.')
  const champ = (k, n = 300) => String(lu[k] || '').slice(0, n)
  return { quoi: champ('quoi'), ou: champ('ou', 120), frequence: champ('frequence', 40), metier: champ('metier', 40), pourquoi: champ('pourquoi'), machine: machine.repere, panne: panne.symptome }
}
