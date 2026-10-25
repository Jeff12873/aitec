// Le tableau de bord : chiffres clés, graphiques et remarques de l'IA.
// Il ne compte que les machines des arborescences choisies dans Administration (production et maintenance,
// par exemple), ou des lignes sélectionnées en haut de l'écran. Sans arborescence : toute la base.

import { db, reglage, modifierReglage, noterModification } from '../../lib/base.js'
import { etatPartage, exigerEcriture } from 'ktec/partage.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { lireArborescencesTableau } from '../../lib/arborescence.js'

// Le périmètre : { ids } (null = toute la base) et ce qu'il faut pour le choisir à l'écran.
const TOUT = { ids: null }

// Les consignes de « Ce que l'IA remarque » : modifiables par un administrateur (le rouage de l'encart),
// gardées dans le fichier de connaissances ; vides = celles d'origine.
const CONSIGNES_REMARQUES = `Tu es l'assistant d'un responsable de maintenance. À partir des données JSON fournies, écris 3 à 5 constats utiles, en français, sous forme de liste à puces courtes (une phrase chacune, avec les chiffres et les repères de machines).
Mets en avant ce qui demande une action : machines dont les pannes augmentent, pannes qui se répètent, machines sans documentation, déséquilibre préventif/correctif. N'invente rien qui ne soit pas dans les données. Si les données sont presque vides, dis simplement ce qu'il faudrait importer.`
const consignesRemarques = () => reglage('consignes_remarques', '') || CONSIGNES_REMARQUES
async function perimetre(lignesVoulues = []) {
  const a = await lireArborescencesTableau().catch(() => null)
  if (!a) return { ...TOUT, lignes: [], arbres: [], choisies: [], selection: [] }
  const selection = lignesVoulues.filter((id) => a.lignes.some((l) => l.id === id))
  const retenues = selection.length ? a.lignes.filter((l) => selection.includes(l.id)) : a.lignes
  return {
    ids: [...new Set(retenues.flatMap((l) => l.machines))].map(Number).filter(Number.isInteger),
    lignes: a.lignes.map((l) => ({ id: l.id, code: l.code, libelle: l.libelle, arbre: l.arbre, machines: l.machines.length })),
    arbres: a.arbres,
    choisies: a.choisies,
    selection,
  }
}
// « m.id IN (…) » : les ids sont des entiers lus dans la base, écrits tels quels dans la requête.
const dans = (p, colonne) => (p.ids ? `${colonne} IN (${p.ids.join(',') || 'NULL'})` : '1')
const lignesDemandees = (texte) => String(texte || '').split(',').map((x) => x.trim()).filter(Boolean)

export function routes(r) {
  r.get('/api/tableau-de-bord', async (ctx) => {
    const p = await perimetre(lignesDemandees(ctx.query.lignes))
    const cle = p.selection.join(',')
    return {
      atelier: reglage('nom_atelier', ''),
      perimetre: { lignes: p.lignes, arbres: p.arbres, choisies: p.choisies, selection: p.selection, machines: p.ids?.length ?? null },
      tuiles: tuiles(p),
      parMois: interventionsParMois(p),
      parType: db()
        .prepare(`SELECT type, count(*) AS nombre FROM interventions WHERE date >= date('now', '-12 months') AND ${dans(p, 'machine_id')} GROUP BY type ORDER BY nombre DESC`)
        .all(),
      machinesEnPanne: machinesLesPlusEnPanne(p, 6),
      dernieresInterventions: dernieresInterventions(p),
      remarques: remarquesEnMemoire.version === etatPartage().version && remarquesEnMemoire.cle === cle ? remarquesEnMemoire : null,
    }
  })

  // Les dernières interventions d'un type (clic sur une part de l'anneau des types) : ?lignes=…&type=…
  r.get('/api/tableau-de-bord/interventions', async (ctx) => dernieresInterventions(await perimetre(lignesDemandees(ctx.query.lignes)), ctx.query.type || ''))

  r.get('/api/tableau-de-bord/consignes', () => ({ texte: consignesRemarques(), origine: CONSIGNES_REMARQUES, modifiees: Boolean(reglage('consignes_remarques', '')) }))

  // { texte } ; un texte vide ou identique à l'original revient aux consignes d'origine.
  r.post('/api/tableau-de-bord/consignes', async (ctx) => {
    exigerEcriture()
    const { texte = '' } = await ctx.json()
    const propre = String(texte).trim()
    modifierReglage('consignes_remarques', propre === CONSIGNES_REMARQUES ? '' : propre)
    noterModification()
    remarquesEnMemoire = { version: -1 } // les remarques déjà écrites suivaient les anciennes consignes
    return { texte: consignesRemarques() }
  })

  r.get('/api/tableau-de-bord/arborescences', async () => {
    const a = await lireArborescencesTableau().catch(() => null)
    return a ? { arbres: a.arbres, choisies: a.choisies } : null
  })

  // Les arborescences comptées par le tableau de bord (administrateur) : { arbres: ['…', '…'] }
  r.post('/api/tableau-de-bord/arborescences', async (ctx) => {
    exigerEcriture()
    const { arbres = [] } = await ctx.json()
    modifierReglage('arborescences_tableau', JSON.stringify((Array.isArray(arbres) ? arbres : []).map(String)))
    noterModification()
    return { arbres }
  })

  // « Ce que l'IA remarque » : l'IA lit les chiffres et écrit quelques constats.
  // Rien n'est enregistré dans le fichier : chaque poste garde ses remarques en mémoire.
  r.post('/api/tableau-de-bord/remarques', async (ctx) => {
    if (!iaInstallee()) return { texte: "L'IA n'est pas installée sur ce poste.", date: new Date().toISOString() }
    const { lignes = [] } = await ctx.json().catch(() => ({}))
    const p = await perimetre(Array.isArray(lignes) ? lignes.map(String) : [])
    const donnees = {
      perimetre: p.selection.length ? p.lignes.filter((l) => p.selection.includes(l.id)).map((l) => l.libelle) : p.choisies.length ? p.choisies : 'toute la base',
      chiffres: tuiles(p),
      interventionsParMois: interventionsParMois(p),
      machinesLesPlusEnPanne12Mois: machinesLesPlusEnPanne(p, 10),
      machinesEnHausse: machinesEnHausse(p),
      machinesSansDocument: db().prepare(`SELECT repere, designation FROM machines WHERE ${dans(p, 'id')} AND id NOT IN (SELECT machine_id FROM documents WHERE machine_id IS NOT NULL) LIMIT 20`).all(),
    }
    const texte = await discuter(
      [
        { role: 'system', content: consignesRemarques() },
        { role: 'user', content: JSON.stringify(donnees) },
      ],
      { temperature: 0.2, maxMots: 600 },
    )
    remarquesEnMemoire = { texte, date: new Date().toISOString(), version: etatPartage().version, cle: p.selection.join(',') }
    return remarquesEnMemoire
  })
}

let remarquesEnMemoire = { version: -1 }

function tuiles(p = TOUT) {
  const compter = (sql) => db().prepare(sql).get().n
  const machine = dans(p, 'machine_id')
  // Documents : ceux des machines comptées, et ceux qui ne sont rattachés à aucune machine.
  const document = p.ids ? `(machine_id IS NULL OR ${machine})` : '1'
  return {
    machines: compter(`SELECT count(*) AS n FROM machines WHERE ${dans(p, 'id')}`),
    machinesHorsService: compter(`SELECT count(*) AS n FROM machines WHERE ${dans(p, 'id')} AND etat <> '' AND etat NOT LIKE 'En service%'`),
    interventions30j: compter(`SELECT count(*) AS n FROM interventions WHERE ${machine} AND date >= date('now', '-30 days')`),
    interventions30jAvant: compter(`SELECT count(*) AS n FROM interventions WHERE ${machine} AND date >= date('now', '-60 days') AND date < date('now', '-30 days')`),
    interventions: compter(`SELECT count(*) AS n FROM interventions WHERE ${machine}`),
    documents: compter(`SELECT count(*) AS n FROM documents WHERE ${document}`),
    documentsLus: compter(`SELECT count(*) AS n FROM documents WHERE ${document} AND etat = 'lu'`),
  }
}

function dernieresInterventions(p, type = '') {
  return db()
    .prepare(`SELECT i.id, i.date, i.type, i.description, i.intervenant, m.repere FROM interventions i LEFT JOIN machines m ON m.id = i.machine_id
              WHERE ${dans(p, 'i.machine_id')} ${type ? 'AND i.type = ?' : ''} ORDER BY i.date DESC, i.id DESC LIMIT 8`)
    .all(...(type ? [type] : []))
}

// Les 12 derniers mois, même ceux sans intervention.
function interventionsParMois(p = TOUT) {
  const lignes = db()
    .prepare(
      `SELECT substr(date, 1, 7) AS mois,
              sum(type = 'Correctif') AS correctif, sum(type = 'Préventif') AS preventif,
              sum(type NOT IN ('Correctif', 'Préventif')) AS autre
       FROM interventions WHERE ${dans(p, 'machine_id')} AND date >= date('now', 'start of month', '-11 months') GROUP BY mois`,
    )
    .all()
  const mois = []
  const aujourdhui = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - i, 1)
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const ligne = lignes.find((l) => l.mois === cle)
    mois.push({ mois: cle, correctif: ligne?.correctif || 0, preventif: ligne?.preventif || 0, autre: ligne?.autre || 0 })
  }
  return mois
}

function machinesLesPlusEnPanne(p, nombre) {
  return db()
    .prepare(
      `SELECT m.id, m.repere, m.designation, count(*) AS pannes
       FROM interventions i JOIN machines m ON m.id = i.machine_id
       WHERE ${dans(p, 'm.id')} AND i.type = 'Correctif' AND i.date >= date('now', '-12 months')
       GROUP BY m.id ORDER BY pannes DESC LIMIT ?`,
    )
    .all(nombre)
}

// Machines dont les pannes des 3 derniers mois dépassent leur moyenne des 9 mois d'avant.
function machinesEnHausse(p) {
  return db()
    .prepare(
      `SELECT m.repere, m.designation,
              sum(i.date >= date('now', '-3 months')) AS pannes_3_derniers_mois,
              round(sum(i.date < date('now', '-3 months')) / 3.0, 1) AS moyenne_par_trimestre_avant
       FROM interventions i JOIN machines m ON m.id = i.machine_id
       WHERE ${dans(p, 'm.id')} AND i.type = 'Correctif' AND i.date >= date('now', '-12 months')
       GROUP BY m.id HAVING pannes_3_derniers_mois > moyenne_par_trimestre_avant AND pannes_3_derniers_mois >= 2
       ORDER BY pannes_3_derniers_mois DESC LIMIT 10`,
    )
    .all()
}

// Résumé en une phrase, donné à l'assistant pour qu'il réponde aux questions de chiffres simples.
export function resumeChiffres() {
  const t = tuiles()
  const nom = reglage('nom_atelier', 'Atelier')
  return `Atelier « ${nom} » : ${t.machines} machines (${t.machinesHorsService} hors service), ${t.interventions} interventions enregistrées dont ${t.interventions30j} ces 30 derniers jours, ${t.documents} documents.`
}
