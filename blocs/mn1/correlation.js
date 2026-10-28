// L'analyse de corrélation d'un parc, par l'IA : pour chaque panne du Pareto, quelles fiches de niveau 1 et quelles
// demandes d'intervention la visent. On en tire :
//   - la pertinence : la part du Pareto couverte par au moins une fiche, chaque panne comptant pour son nombre de
//     cas (couvrir la 1re compte plus que couvrir la 10e) ;
//   - les fiches sans cible (aucune panne du Pareto) : à espacer pour libérer de la charge ;
//   - les trous : les pannes du haut du Pareto qu'aucune fiche ne vise (l'IA peut proposer une fiche).
// Le résultat est gardé dans le fichier (table mn1_analyses), daté et signé : une analyse lancée par un utilisateur
// est enregistrée aussi (écriture permise en consultation).
//
// resultat = { pertinence, pareto: [{ code, fiches: [id], demandes: [numéro], commentaire }], fichesSansCible: [id],
//              trous: [code], demandes: { couvertes, total }, resume }

import { db, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { lireParcs, NON_CLASSE } from '../../lib/parcs.js'
import { fichesDesParcs, pareto, signature } from './parcs.js'
import { lireDemandes } from './demandes.js'
import { points } from './textes.js'

const NB_PARETO = 15

const CONSIGNES = `Tu es un expert en maintenance autonome (TPM, maintenance de niveau 1). On te donne le Pareto des pannes d'un parc de machines (codes P1, P2…), les fiches de maintenance de niveau 1 que font les opérateurs (codes F…) et des demandes d'intervention récentes (codes D…).
Pour chaque panne du Pareto, dis quelles fiches visent cette panne : un point de contrôle de la fiche permettrait de la voir venir ou de l'éviter (même organe ou même mode de défaillance, sur la même machine ou une machine du même type). Fais de même pour les demandes qui décrivent cette panne ou ses signes avant-coureurs.
Sois strict : une fiche ne vise une panne que si le lien est concret. N'invente aucun code.
Réponds seulement avec un objet JSON, sans texte autour :
{"pareto":[{"code":"P1","fiches":["F3"],"demandes":["D2"],"commentaire":"phrase courte"}],"resume":"2 phrases au plus : ce que les fiches couvrent bien, ce qui manque"}`

function lireJson(texte) {
  const debut = texte.indexOf('{')
  const fin = texte.lastIndexOf('}')
  if (debut < 0 || fin < debut) return null
  try {
    return JSON.parse(texte.slice(debut, fin + 1))
  } catch {
    return null
  }
}

let enCours = new Set()

export async function analyser(parcId) {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  if (enCours.has(parcId)) throw new ErreurHttp(409, 'Analyse déjà en cours pour ce parc.')
  const p = await lireParcs()
  const parc = p?.parcs.find((x) => x.id === parcId && x.id !== NON_CLASSE)
  if (!parc) throw new ErreurHttp(404, 'Parc introuvable')
  const fiches = fichesDesParcs(p).parParc.get(parc.id) || []
  const liste = pareto(parc)
  if (!liste.length) throw new ErreurHttp(409, 'Pas de panne qui revient sur les machines de maintenance de ce parc (12 mois) : rien à corréler. Vérifiez les racines de maintenance du parc.')
  enCours.add(parcId)
  try {
    const haut = liste.slice(0, NB_PARETO)
    let demandes = []
    try {
      const reperes = new Set([...parc.machines].map((id) => db().prepare('SELECT repere FROM machines WHERE id = ?').get(id)?.repere).filter(Boolean))
      demandes = ((await lireDemandes()) || []).filter((d) => reperes.has(d.machine)).slice(0, 30)
    } catch {}
    const codeFiche = new Map(fiches.map((f, i) => [`F${i + 1}`, f.id]))
    const codeDemande = new Map(demandes.map((d, i) => [`D${i + 1}`, d.numero]))
    const pourIA = [
      'PARETO (pannes qui reviennent, 12 mois) :',
      ...haut.map((x) => `${x.code} · ${x.repere}${x.designation ? ` (${x.designation})` : ''} · ${x.symptome} · ${x.nombre} cas`),
      '', 'FICHES DE NIVEAU 1 :',
      ...fiches.map((f, i) => `F${i + 1} · ${[f.etiquette, f.machine_nom || f.repere, f.zone].filter(Boolean).join(' · ')} : ${points(f.action).map((x) => x.titre || x.point).join(' ; ').slice(0, 500)}`),
      '', 'DEMANDES D’INTERVENTION :',
      ...demandes.map((d, i) => `D${i + 1} · ${d.machine} · ${d.description.slice(0, 200)}`),
    ].join('\n')
    const texte = await discuter([{ role: 'system', content: CONSIGNES }, { role: 'user', content: pourIA }], { temperature: 0.1, maxMots: 2500 })
    const lu = lireJson(texte)
    if (!lu || !Array.isArray(lu.pareto)) throw new ErreurHttp(502, 'Réponse de l’IA illisible : relancez l’analyse.')
    const parCode = new Map(lu.pareto.map((x) => [String(x.code), x]))
    const resultatPareto = haut.map((x) => {
      const r = parCode.get(x.code) || {}
      return {
        code: x.code,
        fiches: (r.fiches || []).map((c) => codeFiche.get(String(c))).filter(Boolean),
        demandes: (r.demandes || []).map((c) => codeDemande.get(String(c))).filter(Boolean),
        commentaire: String(r.commentaire || '').slice(0, 300),
      }
    })
    // Pertinence pondérée : chaque panne compte pour son nombre de cas.
    const total = haut.reduce((s, x) => s + x.nombre, 0)
    const couvert = haut.reduce((s, x, i) => s + (resultatPareto[i].fiches.length ? x.nombre : 0), 0)
    const visees = new Set(resultatPareto.flatMap((x) => x.fiches))
    const resultat = {
      pertinence: total ? couvert / total : null,
      pareto: resultatPareto,
      fichesSansCible: fiches.filter((f) => !visees.has(f.id)).map((f) => f.id),
      trous: resultatPareto.filter((x) => !x.fiches.length).map((x) => x.code),
      demandes: { couvertes: new Set(resultatPareto.flatMap((x) => x.demandes)).size, total: demandes.length },
      resume: String(lu.resume || '').slice(0, 600),
    }
    exigerEcriture({ pourTous: true }) // une analyse peut être lancée en consultation
    db().prepare('INSERT INTO mn1_analyses (parc, date, signature, resultat) VALUES (?, ?, ?, ?) ON CONFLICT (parc) DO UPDATE SET date = excluded.date, signature = excluded.signature, resultat = excluded.resultat')
      .run(parc.id, new Date().toISOString(), signature(liste, fiches), JSON.stringify(resultat))
    noterModification()
    return resultat
  } finally {
    enCours.delete(parcId)
  }
}

// ---------------------------------------------------------------- proposer une fiche pour un trou du Pareto

const CONSIGNES_FICHE = `Tu rédiges une fiche de maintenance de niveau 1 (contrôle simple fait par un opérateur de production, machine en marche ou à l'arrêt, sans outillage spécial ni démontage). Elle doit permettre de voir venir la panne décrite ou de l'éviter.
Réponds seulement avec un objet JSON, sans texte autour :
{"zone":"organe ou zone de la machine","points":["point de contrôle court et concret (état, propreté, fixation, fuite, bruit, niveau…)","…"],"frequence":"Hebdomadaire | Mensuelle | Trimestrielle | Semestrielle | Annuelle","evite":"la panne évitée, en quelques mots"}
3 à 6 points. Pas de point dangereux pour un opérateur (pas d'intervention électrique, pas de consignation).`

export async function proposerFiche(parcId, code) {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  const p = await lireParcs()
  const parc = p?.parcs.find((x) => x.id === parcId)
  if (!parc) throw new ErreurHttp(404, 'Parc introuvable')
  const panne = pareto(parc).find((x) => x.code === code)
  if (!panne) throw new ErreurHttp(404, 'Panne introuvable dans le Pareto')
  const rapports = db().prepare(`SELECT date, description FROM interventions WHERE id IN (${panne.cas.slice(0, 8).join(',') || 'NULL'}) ORDER BY date DESC`).all()
  const texte = await discuter([{ role: 'system', content: CONSIGNES_FICHE }, { role: 'user', content: `Machine : ${panne.repere} ${panne.designation}\nPanne : ${panne.symptome} (${panne.nombre} cas en 12 mois)\nRapports :\n${rapports.map((r) => `- ${r.date} : ${String(r.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}` }], { temperature: 0.3, maxMots: 600 })
  const lu = lireJson(texte)
  if (!lu || !Array.isArray(lu.points)) throw new ErreurHttp(502, 'Réponse de l’IA illisible : réessayez.')
  const frequences = ['Hebdomadaire', 'Mensuelle', 'Trimestrielle', 'Semestrielle', 'Annuelle']
  return {
    machine_nom: panne.designation || panne.repere,
    zone: String(lu.zone || '').slice(0, 120),
    action: lu.points.map((x) => String(x).trim()).filter(Boolean).slice(0, 8).join('\n'),
    frequence: frequences.includes(lu.frequence) ? lu.frequence : 'Mensuelle',
    evite: String(lu.evite || panne.symptome).slice(0, 300),
    panne: { code: panne.code, symptome: panne.symptome, nombre: panne.nombre, repere: panne.repere },
  }
}
