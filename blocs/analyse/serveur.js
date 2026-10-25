// La fiche d'analyse d'une machine (ouverte depuis « Machines les plus en panne » du tableau de bord) :
// ses chiffres sur 12 mois, ses pannes connues, ses intervenants, ses dernières interventions, et un résumé
// de l'IA avec quelques conseils. Les consignes de ce résumé sont modifiables (le rouage de l'encart).

import { db, reglage, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { etatPartage, exigerEcriture } from 'ktec/partage.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { sansBalises } from '../recherche/passages.js'

const CONSIGNES = `Tu es un technicien méthodes en maintenance industrielle. Tu reçois en JSON les données d'UNE machine : chiffres sur 12 mois, interventions par mois, pannes connues (symptôme, causes, remèdes, nombre de cas), dernières interventions.
Écris en français, phrases courtes, sans introduction :
**En bref** : 2 phrases sur l'état de la machine (fréquence des pannes, tendance des derniers mois, part du préventif).
**Pannes qui reviennent** : 2 à 4 puces, chacune avec le symptôme, le nombre de cas et la cause la plus fréquente.
**Conseils** : 3 à 5 puces concrètes, chacune appuyée sur une donnée : préventif à ajouter ou renforcer, pièce à garder en stock, modification ou amélioration, point de formation, contrôle à faire.
N'invente rien qui ne soit pas dans les données. Si les données sont trop maigres, dis-le en une phrase.`
const consignes = () => reglage('consignes_analyse_machine', '') || CONSIGNES

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
  const pannes = db().prepare('SELECT id, symptome, causes, nombre, derniere FROM pannes WHERE machine_id = ? ORDER BY nombre DESC').all(id).map((p) => ({ ...p, causes: JSON.parse(p.causes || '[]') }))
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
  return { machine, chiffres, parMois, pannes, intervenants, dernieres }
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

  r.get('/api/analyse/:id', (ctx) => {
    const d = donnees(Number(ctx.params.id))
    const resume = resumes.get(d.machine.id)
    return { ...d, resume: resume?.version === etatPartage().version ? resume : null }
  })

  // Le résumé de l'IA : en bref, pannes qui reviennent, conseils.
  r.post('/api/analyse/:id/resume', async (ctx) => {
    const d = donnees(Number(ctx.params.id))
    if (!iaInstallee()) return { texte: "L'IA n'est pas installée sur ce poste.", date: new Date().toISOString() }
    const pourIA = {
      machine: { repere: d.machine.repere, designation: d.machine.designation, marque: d.machine.marque, modele: d.machine.modele, etat: d.machine.etat },
      chiffres: d.chiffres,
      interventionsParMois: d.parMois,
      pannesConnues: d.pannes.slice(0, 8).map((p) => ({ symptome: p.symptome, cas: p.nombre, derniere: p.derniere, causes: p.causes })),
      dernieresInterventions: d.dernieres.map((i) => ({ date: i.date, type: i.type, description: i.description.slice(0, 200) })),
    }
    const texte = await discuter([{ role: 'system', content: consignes() }, { role: 'user', content: JSON.stringify(pourIA) }], { temperature: 0.2, maxMots: 700 })
    const resume = { texte, date: new Date().toISOString(), version: etatPartage().version }
    resumes.set(d.machine.id, resume)
    return resume
  })
}
