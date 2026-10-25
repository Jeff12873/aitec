// La fiche d'analyse d'une machine (ouverte depuis « Machines les plus en panne » du tableau de bord) :
// ses chiffres sur 12 mois, ses pannes connues, ses intervenants, ses dernières interventions, et un résumé
// de l'IA avec quelques conseils. Les consignes de ce résumé sont modifiables (le rouage de l'encart).

import { db, reglage, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { etatPartage, exigerEcriture } from 'ktec/partage.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { sansBalises } from '../recherche/passages.js'
import { pannesDeLaMachine } from '../pannes/serveur.js'
import { lireArborescencesTableau, lireArborescence } from '../../lib/arborescence.js'

// La place de la machine dans l'arborescence : sa ligne (1er niveau) et son ETH (2e niveau, sous la ligne).
async function placeDe(machineId) {
  for (const lire of [lireArborescencesTableau, lireArborescence]) {
    const a = await lire().catch(() => null)
    for (const ligne of a?.lignes || []) {
      if (!ligne.machines.includes(machineId)) continue
      const eth = ligne.enfants.find((e) => e.machines.includes(machineId))
      return { ligne: ligne.libelle, eth: eth?.libelle || '' }
    }
  }
  return null
}

const CONSIGNES = `Tu es un technicien méthodes en maintenance industrielle. Tu reçois en JSON les données d'UNE machine : chiffres sur 12 mois (dont la fréquence des pannes), interventions par mois, pannes connues (symptôme, causes, remèdes, nombre de cas, fréquence déjà calculée) ou, à défaut, pannes répétées (rapports semblables regroupés, avec les actions notées et la fréquence), dernières interventions.
Écris en français, phrases courtes, sans introduction :
**En bref** : 2 phrases sur l'état de la machine (fréquence des pannes, tendance des derniers mois, part du préventif).
**Pannes qui reviennent** : 2 à 4 puces. Chacune : le symptôme, le nombre de cas, sa fréquence recopiée telle quelle du champ « frequence » (par exemple « environ toutes les 3 semaines »), et la cause la plus fréquente.
**Conseils** : 3 à 5 puces concrètes, chacune appuyée sur une donnée : préventif à ajouter ou renforcer, pièce à garder en stock, modification ou amélioration, formation des techniciens de maintenance, contrôle à faire.
**Maintenance de niveau 1** : elle est faite par les opérateurs de production (conducteurs). Cherche, pour les pannes qui reviennent, les gestes simples qu'ils pourraient faire pour les éviter (sans démontage ni habilitation particulière : nettoyage, contrôle visuel, graissage, appoint, resserrage, réglage simple, signalement d'une anomalie) ; c'est souvent possible. Propose 1 à 3 gestes, les plus utiles. Une ligne par geste, qui commence exactement par « [MN1 Production] » ; puis trois parties séparées par « | » : le geste | sa fréquence préconisée, calendaire, un seul mot parmi hebdomadaire, mensuelle, trimestrielle, semestrielle, annuelle (quotidienne seulement si rien de moins fréquent ne suffit) | la panne qu'il évite. Exemple : [MN1 Production] Nettoyer la goulotte de sortie | hebdomadaire | surcharge du convoyeur
Un geste qui demande un technicien de maintenance n'est pas du niveau 1 : mets-le dans les Conseils.
Formation des opérateurs (conducteurs) : si les données montrent qu'ils doivent apprendre ou revoir quelque chose, écris-le sur une seule ligne qui commence exactement par « [MN1 Formation] », et pas dans les Conseils. Sinon, n'écris pas cette ligne.
Aucun geste de niveau 1 possible et pas de formation des opérateurs : n'écris pas cette partie.
N'invente rien qui ne soit pas dans les données. Si les données sont trop maigres, dis-le en une phrase.`
const consignes = () => reglage('consignes_analyse_machine', '') || CONSIGNES

// « environ toutes les 3 semaines » : l'intervalle moyen entre deux cas, en jours, semaines ou mois.
// Calculé ici plutôt que par l'IA, qui se trompe volontiers sur les dates.
function enClair(jours) {
  if (!Number.isFinite(jours) || jours <= 0) return ''
  if (jours < 1.5) return 'environ tous les jours'
  if (jours < 13) return `environ tous les ${Math.round(jours)} jours`
  if (jours < 60) return `environ toutes les ${Math.round(jours / 7)} semaines`
  if (jours < 300) return `environ tous les ${Math.round(jours / 30.4)} mois`
  return 'environ une fois par an ou moins'
}
const joursEntre = (a, b) => (new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86_400_000

// La fréquence d'une panne d'après les dates de ses cas : le rythme des 12 derniers mois s'il y a au moins
// 2 cas (c'est lui qui compte pour agir), sinon l'écart moyen sur tout l'historique.
function frequenceDe(dates, depuis) {
  const triees = [...dates].filter(Boolean).sort()
  const recents = triees.filter((d) => d >= depuis).length
  if (recents >= 2) return `${enClair(365 / recents)} (${recents} cas ces 12 derniers mois)`
  const ecart = triees.length > 1 ? joursEntre(triees[0], triees.at(-1)) / (triees.length - 1) : null
  const historique = ecart ? `${enClair(ecart)} sur l'historique` : 'cas isolé'
  return `${historique}, ${recents ? '1 cas' : 'aucun cas'} ces 12 derniers mois`
}

// Les résumés déjà écrits, par machine, tant que le fichier de connaissances n'a pas changé.
const resumes = new Map()

function lireMachine(id) {
  const m = db().prepare('SELECT * FROM machines WHERE id = ?').get(id)
  if (!m) throw new ErreurHttp(404, 'Machine introuvable')
  return m
}

function donnees(id) {
  const machine = lireMachine(id)
  const compter = (sql, ...valeurs) => db().prepare(sql).get(id, ...valeurs)?.n || 0
  const chiffres = {
    pannes12Mois: compter("SELECT count(*) AS n FROM interventions WHERE machine_id = ? AND type = 'Correctif' AND date >= date('now', '-12 months')"),
    pannes3Mois: compter("SELECT count(*) AS n FROM interventions WHERE machine_id = ? AND type = 'Correctif' AND date >= date('now', '-3 months')"),
    preventifs12Mois: compter("SELECT count(*) AS n FROM interventions WHERE machine_id = ? AND type = 'Préventif' AND date >= date('now', '-12 months')"),
    interventions12Mois: compter("SELECT count(*) AS n FROM interventions WHERE machine_id = ? AND date >= date('now', '-12 months')"),
    heures12Mois: Math.round(db().prepare("SELECT coalesce(sum(duree_h), 0) AS n FROM interventions WHERE machine_id = ? AND date >= date('now', '-12 months')").get(id).n * 10) / 10,
    interventionsTotal: compter('SELECT count(*) AS n FROM interventions WHERE machine_id = ?'),
    derniere: db().prepare('SELECT max(date) AS d FROM interventions WHERE machine_id = ?').get(id).d,
  }
  chiffres.frequencePannes = chiffres.pannes12Mois ? `${enClair(365 / chiffres.pannes12Mois)} (${chiffres.pannes12Mois} pannes en 12 mois)` : 'aucune panne en 12 mois'
  const lignes = db()
    .prepare(`SELECT substr(date, 1, 7) AS mois, sum(type = 'Correctif') AS correctif, sum(type = 'Préventif') AS preventif, sum(type NOT IN ('Correctif', 'Préventif')) AS autre
              FROM interventions WHERE machine_id = ? AND date >= date('now', 'start of month', '-11 months') GROUP BY mois`)
    .all(id)
  const parMois = []
  const aujourdhui = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - i, 1)
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const l = lignes.find((x) => x.mois === cle)
    parMois.push({ mois: cle, correctif: l?.correctif || 0, preventif: l?.preventif || 0, autre: l?.autre || 0 })
  }
  // La fréquence de chaque panne connue : l'écart moyen entre deux cas, et les cas des 12 derniers mois.
  const ilYa12Mois = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const dateDe = db().prepare('SELECT date FROM interventions WHERE id = ?')
  const pannes = db().prepare('SELECT id, symptome, causes, nombre, premiere, derniere, exemples FROM pannes WHERE machine_id = ? ORDER BY nombre DESC').all(id).map((p) => {
    const frequence = frequenceDe(JSON.parse(p.exemples || '[]').map((i) => dateDe.get(i)?.date), ilYa12Mois)
    return { id: p.id, symptome: p.symptome, causes: JSON.parse(p.causes || '[]'), nombre: p.nombre, premiere: p.premiere, derniere: p.derniere, frequence }
  })
  // Sans pannes connues (ligne pas encore analysée) : les rapports semblables regroupés à la volée, avec leur
  // fréquence, pour que l'IA ait quand même des pannes qui reviennent.
  const plusFrequent = (valeurs) => [...valeurs.reduce((c, v) => c.set(v, (c.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  const repetees = pannes.length ? [] : pannesDeLaMachine(id).map((g) => {
    const dates = g.cas.map((c) => c.date).filter(Boolean).sort()
    return {
      symptome: plusFrequent(g.cas.map((c) => c.symptome)),
      nombre: g.cas.length,
      premiere: dates[0],
      derniere: dates.at(-1),
      frequence: frequenceDe(dates, ilYa12Mois),
      actions: [...new Set(g.cas.map((c) => c.action.slice(0, 140)))].slice(0, 4),
    }
  })
  // Les intervenants des 12 derniers mois (« NOM, PRÉNOM » ; plusieurs personnes sur une même intervention comptent chacune).
  const compte = new Map()
  for (const { intervenant } of db().prepare("SELECT intervenant FROM interventions WHERE machine_id = ? AND date >= date('now', '-12 months')").all(id)) {
    const parties = String(intervenant || '').split(/\s*,\s*/).filter(Boolean)
    const personnes = parties.length >= 4 && parties.length % 2 === 0 ? parties.reduce((acc, p, i) => (i % 2 ? acc : [...acc, `${p}, ${parties[i + 1]}`]), []) : [String(intervenant || '').trim()].filter(Boolean)
    for (const p of personnes) compte.set(p, (compte.get(p) || 0) + 1)
  }
  const intervenants = [...compte].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([nom, nombre]) => ({ nom, nombre }))
  const dernieres = db()
    .prepare('SELECT id, date, numero, type, description, intervenant FROM interventions WHERE machine_id = ? ORDER BY date DESC, id DESC LIMIT 12')
    .all(id)
    .map((i) => ({ ...i, description: sansBalises(i.description).replace(/\s+/g, ' ').slice(0, 300) }))
  return { machine, chiffres, parMois, pannes, repetees, intervenants, dernieres }
}

export function routes(r) {
  r.get('/api/analyse/consignes', () => ({ texte: consignes(), origine: CONSIGNES }))

  // { texte } ; vide ou identique à l'original : les consignes d'origine.
  r.post('/api/analyse/consignes', async (ctx) => {
    exigerEcriture()
    const { texte = '' } = await ctx.json()
    const propre = String(texte).trim()
    modifierReglage('consignes_analyse_machine', propre === CONSIGNES ? '' : propre)
    noterModification()
    resumes.clear()
    return { texte: consignes() }
  })

  r.get('/api/analyse/:id', async (ctx) => {
    const d = donnees(Number(ctx.params.id))
    const resume = resumes.get(d.machine.id)
    const fichesMN1 = db().prepare('SELECT id, action FROM fiches_mn1 WHERE machine_id = ?').all(d.machine.id)
    return { ...d, place: await placeDe(d.machine.id), fichesMN1, resume: resume?.version === etatPartage().version ? resume : null }
  })

  // Le résumé de l'IA : en bref, pannes qui reviennent, conseils.
  r.post('/api/analyse/:id/resume', async (ctx) => {
    const d = donnees(Number(ctx.params.id))
    if (!iaInstallee()) return { texte: "L'IA n'est pas installée sur ce poste.", date: new Date().toISOString() }
    const pourIA = {
      machine: { repere: d.machine.repere, designation: d.machine.designation, marque: d.machine.marque, modele: d.machine.modele, etat: d.machine.etat },
      chiffres: d.chiffres,
      interventionsParMois: d.parMois,
      pannesConnues: d.pannes.slice(0, 8).map((p) => ({ symptome: p.symptome, cas: p.nombre, frequence: p.frequence, premiere: p.premiere, derniere: p.derniere, causes: p.causes })),
      pannesRepetees: d.repetees.slice(0, 8).map((p) => ({ symptome: p.symptome, cas: p.nombre, frequence: p.frequence, premiere: p.premiere, derniere: p.derniere, actionsNotees: p.actions })),
      dernieresInterventions: d.dernieres.map((i) => ({ date: i.date, type: i.type, description: i.description.slice(0, 200) })),
    }
    const texte = await discuter([{ role: 'system', content: consignes() }, { role: 'user', content: JSON.stringify(pourIA) }], { temperature: 0.2, maxMots: 700 })
    const resume = { texte, date: new Date().toISOString(), version: etatPartage().version }
    resumes.set(d.machine.id, resume)
    return resume
  })
}
