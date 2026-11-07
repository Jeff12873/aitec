// Le démonstrateur d'une machine (PREVTEC, étapes 3 « Une machine » et 4 « Je décide ») : ses pannes qui reviennent
// face à TOUS ses préventifs des 12 derniers mois, gamme par gamme, et ce qu'on en décide.
//
// Rattacher une gamme à une panne : d'abord l'arborescence (le préventif fait sur la même machine que la panne),
// puis les mots communs (première idée), puis l'IA, qui dit quelle gamme regarde quelle panne (réglage « mn1_cibles »).
// Les fiches de niveau 1 qui visent une panne viennent de l'analyse de corrélation du parc.
//
// La GMAO n'a pas de résultat d'inspection A / B / C : l'IA lit chaque RI préventive une fois (réglage
// « mn1_lectures ») et en tire A (rien trouvé), B (anomalie corrigée sur place) ou C (anomalie laissée, demande).
// Le taux de détection d'une gamme = (B + C) / RI lues.
//
// Les diagnostics :
//   - panne « sans »      : aucun préventif ne la regarde ;
//   - panne « mauvais »   : regardée, mais elle monte, ou les passages lus n'ont jamais rien trouvé ;
//   - panne « ok »        : regardée, et elle ne monte pas ;
//   - gamme « sur »       : 4 passages au moins, aucune panne visée, rien trouvé : sur-maintenance possible ;
//   - gamme « ponctuel »  : moins de 4 passages, sans panne visée (chantier, réception…) : hors plan.
// Le préventif systématique (« changer telle pièce ») est montré à part : il ne dit rien des pannes.

import { db, reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { lireParcs, NON_CLASSE, machineAnalysable } from '../../lib/parcs.js'
import { familleDe } from '../../lib/types.js'
import { pannesDeLaMachine } from '../pannes/serveur.js'
import { evolution, pareto, fichesDesParcs, lireAnalyse } from './parcs.js'
import { interventionsDuParc, gammeDe, cleDe, classement, classeDe, texteSeul } from './equilibre.js'
import { redigerFiche, lireJson } from './correlation.js'
import { points } from './textes.js'

const PAR_LOT = 25 // RI envoyées à l'IA en une fois
const LECTURES_MAX = 120 // RI lues par clic (les plus récentes d'abord)
const SUR_MAINTENANCE = 4 // passages en 12 mois sans panne visée ni anomalie trouvée

const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
const plusFrequent = (valeurs) => [...valeurs.reduce((c, v) => c.set(v, (c.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
const MOTS_VIDES = new Set('controle controler verifier verification etat niveau machine general generale complet complete visuel visuelle nettoyage inspection preventif preventive mensuel mensuelle hebdomadaire annuel annuelle semestriel trimestriel defaut probleme panne'.split(' '))
const mots = (texte) => new Set(cleDe(texte).replace(/[^a-z ]+/g, ' ').split(' ').filter((m) => m.length > 3 && !MOTS_VIDES.has(m)).map((m) => m.replace(/(s|x)$/, '')))

const lectures = () => reglageJson('mn1_lectures', {}) || {}
const cibles = () => reglageJson('mn1_cibles', {}) || {}

async function contexte(parcId, machineId) {
  const p = await lireParcs()
  const parc = p?.parcs.find((x) => x.id === parcId && x.id !== NON_CLASSE)
  if (!parc) throw new ErreurHttp(404, 'Parc introuvable')
  const id = Number(machineId)
  const machine = db().prepare('SELECT id, repere, designation FROM machines WHERE id = ?').get(id)
  if (!machine) throw new ErreurHttp(404, 'Machine introuvable')
  return { p, parc, machine }
}

// Les pannes qui reviennent sur la machine (12 mois), comme dans le Pareto du parc.
function pannesDe(machine) {
  const depuis = ilYa(365)
  const avant = ilYa(730)
  return pannesDeLaMachine(machine.id).map((g) => {
    const recents = g.cas.filter((c) => c.date >= depuis)
    const precedent = g.cas.filter((c) => c.date >= avant && c.date < depuis).length
    const symptome = plusFrequent(g.cas.map((c) => c.symptome)).slice(0, 160)
    return { cle: cleDe(symptome).slice(0, 80), symptome, repere: machine.repere, designation: machine.designation, nombre: recents.length, precedent, evolution: evolution(recents.length, precedent), derniere: g.cas[0]?.date || '', cas: g.cas.map((c) => c.id) }
  }).filter((x) => x.nombre).sort((a, b) => b.nombre - a.nombre)
}

// Les préventifs de la machine, gamme par gamme (avec les interventions, pour les lire).
async function preventifsDe(parc, machine) {
  const { lignes, deNiveau1 } = await interventionsDuParc(parc)
  const c = classement()
  const lus = lectures()
  const gammes = new Map()
  for (const l of lignes) {
    if (l.machine_id !== machine.id || familleDe(l.type) !== 'Préventif') continue
    const gamme = gammeDe(l.description)
    const cle = cleDe(gamme)
    const g = gammes.get(cle) || { cle, gamme, classe: classeDe(c, cle), n1: 0, techniciens: 0, passages: 0, derniere: '', A: 0, B: 0, C: 0, lus: 0, interventions: [] }
    g.passages++
    if (deNiveau1(l)) g.n1++
    else g.techniciens++
    if (l.date > g.derniere) g.derniere = l.date
    const r = lus[l.id]
    if (r) { g[r]++; g.lus++ }
    g.interventions.push(l)
    gammes.set(cle, g)
  }
  return [...gammes.values()].sort((a, b) => b.passages - a.passages)
}

export async function demonstrateur(parcId, machineId) {
  const { p, parc, machine } = await contexte(parcId, machineId)
  const pannes = pannesDe(machine)
  const gammes = await preventifsDe(parc, machine)
  // Les fiches de niveau 1 de la machine, et les pannes qu'elles visent (analyse de corrélation du parc).
  const fiches = (fichesDesParcs(p).parParc.get(parc.id) || []).filter((f) => [f.machine_id, f.machine_prod].some((x) => x && (x === machine.id || machineAnalysable(p, x) === machine.id)))
  const analyse = lireAnalyse(parc.id)
  const parCode = new Map(pareto(parc).filter((x) => x.machine === machine.id).map((x) => [x.code, cleDe(x.symptome).slice(0, 80)]))
  const fichesDeLaPanne = new Map()
  for (const x of analyse?.pareto || []) {
    const cle = parCode.get(x.code)
    if (cle) fichesDeLaPanne.set(cle, x.fiches || [])
  }
  // Le rattachement gamme → pannes : celui de l'IA s'il existe, sinon les mots communs.
  const parIa = cibles()[machine.id]
  // Les mots du nom de la machine (« convoyeur ») ne rattachent rien : toutes ses gammes et pannes les portent.
  const motsMachine = mots(`${machine.repere} ${machine.designation}`)
  const sansMachine = (s) => new Set([...s].filter((w) => !motsMachine.has(w)))
  const motsPanne = new Map(pannes.map((x) => [x.cle, sansMachine(mots(x.symptome))]))
  for (const g of gammes) {
    if (g.classe === 'systematique') { g.cibles = []; continue }
    if (parIa?.gammes?.[g.cle]) { g.cibles = parIa.gammes[g.cle].filter((k) => motsPanne.has(k)); g.par = 'ia'; continue }
    const m = sansMachine(mots(g.gamme))
    g.cibles = pannes.filter((x) => [...motsPanne.get(x.cle)].some((w) => m.has(w))).map((x) => x.cle)
    g.par = 'mots'
  }
  const detection = (g) => (g.lus ? (g.B + g.C) / g.lus : null)
  for (const g of gammes) {
    const d = detection(g)
    g.detection = d
    if (g.classe === 'systematique') { g.diagnostic = 'systematique'; g.raison = 'Renouvellement à date fixe : ne regarde pas l’état, hors analyse.'; continue }
    if (!g.cibles.length && g.passages >= SUR_MAINTENANCE && !d) {
      g.diagnostic = 'sur'
      g.raison = `${g.passages} passages en 12 mois, aucune panne de la machine visée${g.lus ? `, rien trouvé sur ${g.lus} RI lues` : ''} : à espacer ?`
    } else if (!g.cibles.length && !d) {
      g.diagnostic = 'ponctuel'
      g.raison = `${g.passages} passage${g.passages > 1 ? 's' : ''} en 12 mois, sans panne visée : intervention ponctuelle plutôt que plan.`
    } else {
      g.diagnostic = 'ok'
      g.raison = g.cibles.length ? `Regarde ${g.cibles.length} panne${g.cibles.length > 1 ? 's' : ''} de la machine.` : `Trouve des anomalies (${Math.round(d * 100)} % des passages lus).`
    }
  }
  const fichesParId = new Map(fiches.map((f) => [f.id, f]))
  const nomFiche = (f) => [f.etiquette, f.zone].filter(Boolean).join(' · ') || points(f.action)[0]?.titre || `Fiche ${f.id}`
  const resultatPannes = pannes.map((x) => {
    const gs = gammes.filter((g) => g.cibles.includes(x.cle))
    const fs = (fichesDeLaPanne.get(x.cle) || []).map((id) => fichesParId.get(id)).filter(Boolean)
    const lus = gs.reduce((s, g) => s + g.lus, 0)
    const trouve = gs.reduce((s, g) => s + g.B + g.C, 0)
    let diagnostic, raison
    if (!gs.length && !fs.length) { diagnostic = 'sans'; raison = 'Aucun préventif ne regarde cette panne.' }
    else if (x.evolution === 'monte' || (x.evolution === 'nouvelle' && x.nombre >= 3)) { diagnostic = 'mauvais'; raison = `La panne ${x.evolution === 'monte' ? 'monte' : 'apparaît'} malgré le préventif qui la regarde : le point contrôlé ne la voit pas venir.` }
    else if (lus >= 3 && !trouve && x.nombre >= 3) { diagnostic = 'mauvais'; raison = `Les ${lus} passages lus n’ont rien trouvé, et la panne revient ${x.nombre} fois : le point contrôlé ne la voit pas venir.` }
    else { diagnostic = 'ok'; raison = x.evolution === 'baisse' ? 'Regardée, et elle baisse.' : 'Regardée, et elle ne monte pas.' }
    return { cle: x.cle, symptome: x.symptome, nombre: x.nombre, precedent: x.precedent, evolution: x.evolution, derniere: x.derniere, gammes: gs.map((g) => g.cle), fiches: fs.map((f) => ({ id: f.id, nom: nomFiche(f), frequence: f.frequence })), diagnostic, raison }
  })
  // Je décide : une décision par panne mal couverte, et par gamme qui tourne à vide.
  const decisions = [
    ...resultatPannes.filter((x) => x.diagnostic !== 'ok').map((x) => ({ type: x.diagnostic === 'sans' ? 'manque' : 'revoir', panne: x.cle })),
    ...gammes.filter((g) => g.diagnostic === 'sur').map((g) => ({ type: 'espacer', gamme: g.cle })),
  ]
  const aLire = gammes.filter((g) => g.classe !== 'systematique').reduce((s, g) => s + g.passages - g.lus, 0)
  return {
    parc: { id: parc.id, nom: parc.nom },
    machine,
    pannes: resultatPannes,
    preventifs: gammes.map(({ interventions, ...g }) => g),
    fiches: fiches.map((f) => ({ id: f.id, nom: nomFiche(f), frequence: f.frequence })),
    decisions,
    lecture: { aLire, rattachement: parIa ? { date: parIa.date } : null, analyseParc: analyse ? analyse.date : null },
    iaInstallee: iaInstallee(),
  }
}

// ---------------------------------------------------------------- l'analyse lourde, par l'IA

const CONSIGNES_CIBLES = `Tu es un expert en maintenance industrielle. On te donne les pannes qui reviennent sur une machine (codes P…) et les gammes de maintenance préventive faites sur cette machine (codes G…).
Pour chaque gamme, dis quelles pannes elle permet de voir venir ou d'éviter : même organe ou même mode de défaillance. Sois strict : un lien concret seulement. Une gamme peut ne viser aucune panne.
Réponds seulement avec un objet JSON, sans texte autour : {"G1":["P2"],"G2":[]}`

const CONSIGNES_LECTURE = `Tu lis des rapports d'intervention de maintenance préventive (codes R…). Chacun mélange souvent le mode opératoire de la gamme et l'observation du technicien : ne regarde que ce qui a été constaté.
Classe chaque rapport :
- "A" : rien trouvé (RAS, conforme, bon état, OK, rien à signaler, ou aucune observation) ;
- "B" : une anomalie trouvée et corrigée sur place (resserré, réglé, nettoyé une fuite, pièce changée parce qu'usée) ;
- "C" : une anomalie trouvée et laissée (à prévoir, demande d'intervention, DI, pièce à commander, à surveiller).
Réponds seulement avec un objet JSON, sans texte autour : {"R1":"A","R2":"C"}`

const enCours = new Set()

// Rattache les gammes aux pannes, puis lit les RI préventives pas encore lues (les plus récentes d'abord).
export async function lireMachine(parcId, machineId) {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  const { parc, machine } = await contexte(parcId, machineId)
  if (enCours.has(machine.id)) throw new ErreurHttp(409, 'Lecture déjà en cours pour cette machine.')
  enCours.add(machine.id)
  try {
    const pannes = pannesDe(machine).slice(0, 15)
    const gammes = (await preventifsDe(parc, machine)).filter((g) => g.classe !== 'systematique')
    let rattachement = null
    if (pannes.length && gammes.length) {
      const liste = gammes.slice(0, 40)
      const texte = await discuter([{ role: 'system', content: CONSIGNES_CIBLES }, { role: 'user', content: `Machine : ${machine.repere} ${machine.designation}\n\nPANNES :\n${pannes.map((x, i) => `P${i + 1} · ${x.symptome} (${x.nombre} cas)`).join('\n')}\n\nGAMMES :\n${liste.map((g, i) => `G${i + 1} · ${g.gamme}`).join('\n')}` }], { temperature: 0.1, maxMots: 800 })
      const lu = lireJson(texte)
      if (lu) rattachement = Object.fromEntries(liste.map((g, i) => [g.cle, (Array.isArray(lu[`G${i + 1}`]) ? lu[`G${i + 1}`] : []).map((c) => pannes[Number(String(c).replace(/\D/g, '')) - 1]?.cle).filter(Boolean)]))
    }
    const deja = lectures()
    const aLire = gammes.flatMap((g) => g.interventions.map((l) => ({ ...l, gamme: g.gamme }))).filter((l) => !deja[l.id]).sort((a, b) => b.date.localeCompare(a.date)).slice(0, LECTURES_MAX)
    const nouvelles = {}
    for (let i = 0; i < aLire.length; i += PAR_LOT) {
      const lot = aLire.slice(i, i + PAR_LOT)
      const texte = await discuter([{ role: 'system', content: CONSIGNES_LECTURE }, { role: 'user', content: lot.map((l, j) => `R${j + 1} · ${texteSeul(l.description).slice(0, 400)}`).join('\n') }], { temperature: 0.1, maxMots: 600 })
      const lu = lireJson(texte)
      if (!lu) continue // lot illisible : relu au prochain clic
      lot.forEach((l, j) => { if (['A', 'B', 'C'].includes(lu[`R${j + 1}`])) nouvelles[l.id] = lu[`R${j + 1}`] })
    }
    exigerEcriture({ pourTous: true }) // comme l'analyse de corrélation : possible en consultation
    modifierReglage('mn1_lectures', { ...lectures(), ...nouvelles })
    if (rattachement) modifierReglage('mn1_cibles', { ...cibles(), [machine.id]: { date: new Date().toISOString(), gammes: rattachement } })
    noterModification()
    return { lues: Object.keys(nouvelles).length, restantes: aLire.length - Object.keys(nouvelles).length, rattachement: Boolean(rattachement) }
  } finally {
    enCours.delete(machine.id)
  }
}

// ---------------------------------------------------------------- je décide : fiche N1 ou point N2

const CONSIGNES_N2 = `Tu rédiges un point de maintenance préventive de niveau 2 (fait par un technicien de maintenance, avec outillage ou démontage léger), à reporter dans la GMAO. Il doit permettre de voir venir la panne décrite.
Réponds seulement avec un objet JSON, sans texte autour :
{"quoi":"le contrôle ou la mesure, concret, avec la valeur ou l'état attendu","ou":"organe ou sous-ensemble","frequence":"Mensuelle | Trimestrielle | Semestrielle | Annuelle","metier":"Mécanique | Électrique | Pneumatique | Hydraulique | Automatisme","pourquoi":"la panne visée et ce que le contrôle voit venir, une phrase"}`

async function panneDe(parcId, machineId, cle) {
  const { parc, machine } = await contexte(parcId, machineId)
  const panne = pannesDe(machine).find((x) => x.cle === cle)
  if (!panne) throw new ErreurHttp(404, 'Panne introuvable sur cette machine')
  return { parc, machine, panne }
}

export async function proposerFicheMachine(parcId, machineId, cle) {
  const { panne } = await panneDe(parcId, machineId, cle)
  return redigerFiche(panne)
}

// gamme : la gamme qui regarde déjà la panne sans la voir venir (à revoir), facultative.
export async function proposerN2(parcId, machineId, cle, gamme = '') {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  const { machine, panne } = await panneDe(parcId, machineId, cle)
  const rapports = db().prepare(`SELECT date, description FROM interventions WHERE id IN (${panne.cas.slice(0, 8).join(',') || 'NULL'}) ORDER BY date DESC`).all()
  const texte = await discuter([{ role: 'system', content: CONSIGNES_N2 }, { role: 'user', content: `Machine : ${machine.repere} ${machine.designation}\nPanne : ${panne.symptome} (${panne.nombre} cas en 12 mois)${gamme ? `\nGamme actuelle qui ne la voit pas venir : ${gamme}` : ''}\nRapports :\n${rapports.map((r) => `- ${r.date} : ${texteSeul(r.description).slice(0, 300)}`).join('\n')}` }], { temperature: 0.3, maxMots: 400 })
  const lu = lireJson(texte)
  if (!lu?.quoi) throw new ErreurHttp(502, 'Réponse de l’IA illisible : réessayez.')
  const champ = (k, n = 300) => String(lu[k] || '').slice(0, n)
  return { quoi: champ('quoi'), ou: champ('ou', 120), frequence: champ('frequence', 40), metier: champ('metier', 40), pourquoi: champ('pourquoi'), machine: machine.repere, panne: panne.symptome }
}
