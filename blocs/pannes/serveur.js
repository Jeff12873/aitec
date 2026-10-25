// Les pannes connues : pour une ligne de l'arborescence, AITEC regroupe les rapports d'intervention semblables,
// machine par machine (même symptôme, au moins 3 fois), puis l'IA en tire « symptôme → causes → remèdes ».
// Le nombre de cas, les dates et les intervenants sont comptés dans la base, pas par l'IA.
// Les fiches sont rangées dans le fichier de connaissances (table « pannes ») et indexées pour la recherche :
// l'assistant s'en sert dans ses réponses.
//
// Un rapport s'écrit en général « symptôme — constat et action » : le symptôme est ce qui précède le premier
// « — » (à défaut, la première phrase).

import { db, transaction, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { exigerEcriture } from 'ktec/partage.js'
import { journal } from 'ktec/installation.js'
import { lireArborescence } from '../../lib/arborescence.js'
import { remplacerPassages, supprimerPassages, sansBalises } from '../recherche/passages.js'

const CAS_MIN = 3 // une panne « connue » : au moins 3 rapports semblables
const PAR_MACHINE = 8 // au plus 8 pannes par machine, les plus fréquentes
const RESSEMBLANCE = 0.5 // part de mots en commun pour que deux symptômes soient « les mêmes »
const EXEMPLES_IA = 14 // rapports donnés à l'IA pour une panne

let analyse = { enCours: false, ligne: '', fait: 0, total: 0, fiches: 0, erreur: '', fin: null }
let arret = false

const CONSIGNES = `Tu analyses des rapports d'intervention de maintenance sur une même machine, qui décrivent le même symptôme.
Réponds uniquement en JSON, sans texte autour, sous cette forme :
{"symptome": "le symptôme en quelques mots", "causes": [{"cause": "l'organe en défaut et sa panne", "remede": "ce qui a été fait et a réglé le problème", "cas": 3}]}
Règles :
- 1 à 3 causes, de la plus fréquente à la moins fréquente ; « cas » = nombre de rapports qui la décrivent.
- Phrases courtes (12 mots au plus), mots du métier, orthographe corrigée.
- Seulement ce qui est écrit dans les rapports. Un rapport qui ne dit pas la cause ne compte pour aucune ; n'invente rien.
- Garde les repères tels qu'écrits (T114, E5.1, Q4, EV3).
- Cause inconnue dans tous les rapports : une seule entrée, cause « non trouvée », remède = ce qui a été fait le plus souvent.`

// ---------------------------------------------------------------- regroupement

const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Les types d'intervention qui ne sont pas des pannes (mots cherchés dans le type, accents ignorés).
const PAS_DES_PANNES = ['preventif', 'formation', 'administratif', 'amelioration', 'projet']
const MOTS_VIDES = new Set('les des une aux est sont pas plus par pour sur sous avec sans dans ete etait suite fait faire bon tres trop mal apres avant lors cote'.split(' '))

// Les mots qui comptent d'un symptôme (sans accents, sans pluriel, sans petits mots).
function mots(texte) {
  return new Set(sansAccents(texte).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((m) => m.length > 2 && !MOTS_VIDES.has(m)).map((m) => m.replace(/(s|x)$/, '')))
}
function ressemblance(a, b) {
  let communs = 0
  for (const m of a) if (b.has(m)) communs++
  return communs / (a.size + b.size - communs || 1)
}

// « 741.1 - Tapis décentré — Repris centrage » → { symptome: 'Tapis décentré', action: 'Repris centrage' }
function decouperRapport(description) {
  const texte = sansBalises(description).replace(/\s*\n\s*/g, ' ').replace(/^\s*[\d.]+\s*-\s*/, '').trim()
  let [symptome, ...reste] = texte.split(' — ')
  if (!reste.length) {
    const fin = texte.search(/[.;:](\s|$)/)
    if (fin < 0 || fin > 120) return null
    symptome = texte.slice(0, fin)
    reste = [texte.slice(fin + 1)]
  }
  const action = reste.join(' — ').trim()
  return action && symptome.trim() ? { symptome: symptome.trim(), action } : null
}

// Les pannes répétées d'une machine : les rapports (hors préventif, formation…) groupés par symptôme semblable.
function pannesDeLaMachine(machineId) {
  const rapports = db()
    .prepare('SELECT id, date, numero, type, description, intervenant FROM interventions WHERE machine_id = ? ORDER BY date DESC')
    .all(machineId)
    .filter((r) => !PAS_DES_PANNES.some((mot) => sansAccents(r.type).includes(mot)))
  const groupes = []
  for (const r of rapports) {
    const morceaux = decouperRapport(r.description)
    if (!morceaux) continue
    const m = mots(morceaux.symptome)
    if (!m.size) continue
    const cas = { ...r, ...morceaux, mots: m }
    const groupe = groupes.find((g) => ressemblance(g.mots, m) >= RESSEMBLANCE)
    if (groupe) groupe.cas.push(cas)
    else groupes.push({ mots: m, cas: [cas] })
  }
  return groupes.filter((g) => g.cas.length >= CAS_MIN).sort((a, b) => b.cas.length - a.cas.length).slice(0, PAR_MACHINE)
}

// ---------------------------------------------------------------- résumé d'une panne

const dateFr = (d) => (d ? d.split('-').reverse().join('/') : '?')

async function resumer(machine, groupe) {
  const plusFrequent = (valeurs) => [...valeurs.reduce((c, v) => c.set(v, (c.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  // Sans IA (ou si sa réponse est illisible) : le symptôme le plus écrit et l'action la plus fréquente.
  const deSecours = () => ({
    symptome: plusFrequent(groupe.cas.map((c) => c.symptome)),
    causes: [{ cause: 'non trouvée (résumé automatique)', remede: plusFrequent(groupe.cas.map((c) => c.action)).slice(0, 160), cas: groupe.cas.length }],
  })
  if (!iaInstallee()) return deSecours()
  const rapports = groupe.cas.slice(0, EXEMPLES_IA).map((c) => `- ${dateFr(c.date)} · ${c.symptome} · ${c.action.slice(0, 300)}`).join('\n')
  try {
    const texte = await discuter(
      [
        { role: 'system', content: CONSIGNES },
        { role: 'user', content: `Machine : ${machine.repere}${machine.designation ? ` (${machine.designation})` : ''}\n${groupe.cas.length} rapports, dont :\n${rapports}` },
      ],
      { temperature: 0.1, maxMots: 400 },
    )
    const json = JSON.parse(texte.slice(texte.indexOf('{'), texte.lastIndexOf('}') + 1))
    const causes = (Array.isArray(json.causes) ? json.causes : [])
      .map((c) => ({ cause: String(c.cause || '').trim(), remede: String(c.remede || '').trim(), cas: Math.max(1, Number(c.cas) || 1) }))
      .filter((c) => c.cause || c.remede)
      .slice(0, 3)
    if (!String(json.symptome || '').trim() || !causes.length) return deSecours()
    return { symptome: String(json.symptome).trim(), causes }
  } catch {
    return deSecours()
  }
}

// ---------------------------------------------------------------- fiches

// « DUPONT, JEAN, MARTIN, PAUL » : deux personnes écrites « NOM, PRÉNOM » à la suite.
function personnes(texte) {
  const morceaux = String(texte || '').split(/\s*[;/]\s*/).filter(Boolean)
  return morceaux.flatMap((m) => {
    const parties = m.split(/\s*,\s*/).filter(Boolean)
    if (parties.length < 4 || parties.length % 2) return [m.trim()]
    const paires = []
    for (let i = 0; i < parties.length; i += 2) paires.push(`${parties[i]}, ${parties[i + 1]}`)
    return paires
  })
}

function intervenantsDe(cas) {
  const compte = new Map()
  for (const c of cas) for (const nom of personnes(c.intervenant)) compte.set(nom, (compte.get(nom) || 0) + 1)
  return [...compte].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([nom, n]) => `${nom} (${n})`).join(', ')
}

function lireFiche(id) {
  const f = db().prepare('SELECT p.*, m.repere, m.designation FROM pannes p LEFT JOIN machines m ON m.id = p.machine_id WHERE p.id = ?').get(id)
  return f ? { ...f, causes: JSON.parse(f.causes || '[]'), exemples: JSON.parse(f.exemples || '[]') } : null
}

// Le passage de recherche d'une fiche : ce que l'assistant lit quand la panne ressemble à la question.
function indexerFiche(id) {
  const f = lireFiche(id)
  if (!f) return supprimerPassages('panne', id)
  const texte = [
    `Panne connue sur ${f.repere}${f.designation ? ` (${f.designation})` : ''}${f.ligne ? ` — ${[f.ligne, f.ensemble].filter(Boolean).join(' › ')}` : ''}.`,
    `${f.nombre} cas, du ${dateFr(f.premiere)} au ${dateFr(f.derniere)}${f.intervenants ? `. Intervenants : ${f.intervenants}` : ''}.`,
    `Symptôme : ${f.symptome}`,
    ...f.causes.map((c) => `Cause : ${c.cause} → Remède : ${c.remede} (${c.cas} cas)`),
  ].join('\n')
  remplacerPassages('panne', id, f.machine_id, [{ page: null, texte }])
}

function supprimerFiche(id) {
  db().prepare('DELETE FROM pannes WHERE id = ?').run(id)
  supprimerPassages('panne', id)
}

// Les fiches des machines visées qui ressemblent à la question (3 au plus), comme passages de recherche :
// l'assistant les met en tête de ses sources. Les mots sont comparés sur leurs 5 premières lettres
// (« aspire » retrouve « aspiration »).
export function pannesProches(question, machineIds, limite = 3) {
  const ids = (machineIds || []).map(Number).filter(Boolean)
  if (!ids.length) return []
  const racines = (texte) => new Set([...mots(texte)].map((m) => m.slice(0, 5)))
  const voulues = racines(question)
  if (!voulues.size) return []
  const fiches = db().prepare(`SELECT id, symptome, causes, nombre FROM pannes WHERE machine_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
  const passage = db().prepare("SELECT id FROM passages WHERE source = 'panne' AND source_id = ? LIMIT 1")
  return fiches
    .map((f) => {
      const symptome = racines(f.symptome)
      const causes = racines(JSON.parse(f.causes || '[]').map((c) => `${c.cause} ${c.remede}`).join(' '))
      let score = 0
      for (const m of voulues) score += symptome.has(m) ? 2 : causes.has(m) ? 1 : 0
      return { f, score }
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.f.nombre - a.f.nombre)
    .slice(0, limite)
    .map((x) => passage.get(x.f.id)?.id)
    .filter(Boolean)
}

// ---------------------------------------------------------------- analyse d'une ligne

async function analyserLigne(ligne) {
  arret = false
  analyse = { enCours: true, ligne: ligne.libelle, fait: 0, total: 0, fiches: 0, erreur: '', fin: null }
  try {
    // Chaque machine avec son sous-ensemble (celles rangées directement sous la ligne : sans sous-ensemble).
    const ensembleDe = new Map()
    for (const e of ligne.enfants) for (const id of e.machines) if (!ensembleDe.has(id)) ensembleDe.set(id, e.libelle)
    const lireMachine = db().prepare('SELECT id, repere, designation FROM machines WHERE id = ?')
    const taches = []
    for (const id of ligne.machines) {
      const machine = lireMachine.get(id)
      if (!machine) continue
      // Les fiches relues par un administrateur restent ; on ne refait pas une panne qu'elles couvrent déjà.
      const relues = db().prepare('SELECT symptome FROM pannes WHERE machine_id = ? AND validee = 1').all(id).map((f) => mots(f.symptome))
      for (const groupe of pannesDeLaMachine(id)) {
        if (relues.some((m) => ressemblance(m, groupe.mots) >= RESSEMBLANCE)) continue
        taches.push({ machine, ensemble: ensembleDe.get(id) || '', groupe })
      }
    }
    for (const f of db().prepare(`SELECT id FROM pannes WHERE validee = 0 AND machine_id IN (${ligne.machines.map(() => '?').join(',') || 'NULL'})`).all(...ligne.machines)) supprimerFiche(f.id)
    analyse.total = taches.length

    for (const { machine, ensemble, groupe } of taches) {
      if (arret) break
      const resume = await resumer(machine, groupe)
      const dates = groupe.cas.map((c) => c.date).filter(Boolean).sort()
      const id = transaction(() => Number(db()
        .prepare('INSERT INTO pannes (ligne, ensemble, machine_id, symptome, causes, nombre, premiere, derniere, intervenants, exemples, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ligne.libelle, ensemble, machine.id, resume.symptome, JSON.stringify(resume.causes), groupe.cas.length, dates[0] || null, dates.at(-1) || null, intervenantsDe(groupe.cas), JSON.stringify(groupe.cas.map((c) => c.id)), new Date().toISOString())
        .lastInsertRowid))
      indexerFiche(id)
      analyse.fait++
      analyse.fiches++
      if (analyse.fait % 10 === 0) noterModification()
    }
    noterModification()
    journal(`AITEC : pannes connues de ${ligne.libelle} : ${analyse.fiches} fiches${arret ? ' (analyse arrêtée)' : ''}`)
  } catch (erreur) {
    analyse.erreur = erreur.message
    journal(`AITEC : analyse des pannes de ${ligne.libelle} impossible : ${erreur.message}`)
  } finally {
    analyse.enCours = false
    analyse.fin = new Date().toISOString()
  }
}

// ---------------------------------------------------------------- routes

export function routes(r) {
  // Les lignes qui ont des fiches, avec leur nombre.
  r.get('/api/pannes/lignes', () => db().prepare("SELECT ligne, count(*) AS nombre FROM pannes GROUP BY ligne ORDER BY ligne").all())

  // Les fiches d'une ligne (ou celle demandée par ?id=, avec toute sa ligne).
  r.get('/api/pannes', (ctx) => {
    let ligne = ctx.query.ligne || ''
    if (ctx.query.id) ligne = db().prepare('SELECT ligne FROM pannes WHERE id = ?').get(ctx.query.id)?.ligne ?? ligne
    const ids = db().prepare('SELECT p.id FROM pannes p LEFT JOIN machines m ON m.id = p.machine_id WHERE p.ligne = ? ORDER BY p.ensemble, m.repere, p.nombre DESC').all(ligne)
    return { ligne, fiches: ids.map((f) => lireFiche(f.id)) }
  })

  // Les rapports regroupés dans une fiche.
  r.get('/api/pannes/:id/rapports', (ctx) => {
    const f = lireFiche(ctx.params.id)
    if (!f) throw new ErreurHttp(404, 'Fiche introuvable')
    const lire = db().prepare('SELECT id, date, numero, description, intervenant FROM interventions WHERE id = ?')
    return f.exemples.map((id) => lire.get(id)).filter(Boolean).map((i) => ({ ...i, description: sansBalises(i.description).replace(/\s+/g, ' ').slice(0, 240) }))
  })

  r.get('/api/pannes/analyse', () => analyse)

  // Lance l'analyse d'une ligne de l'arborescence (en tâche de fond : suivre avec GET /api/pannes/analyse).
  r.post('/api/pannes/analyse', async (ctx) => {
    exigerEcriture()
    if (analyse.enCours) throw new ErreurHttp(409, `Analyse déjà en cours (${analyse.ligne}).`)
    const { ligne: id } = await ctx.json()
    const arbre = await lireArborescence()
    if (!arbre) throw new ErreurHttp(409, 'Pas d’arborescence : réglez sa requête dans PDRTec › Paramètres et connectez-vous à la base de la GMAO.')
    const ligne = arbre.lignes.find((l) => l.id === String(id))
    if (!ligne) throw new ErreurHttp(404, 'Ligne introuvable dans l’arborescence')
    analyserLigne(ligne)
    return analyse
  })

  r.post('/api/pannes/analyse/arreter', () => {
    arret = true
    return analyse
  })

  // Corriger une fiche (et la marquer relue) : { symptome, causes: [{ cause, remede, cas }], validee }
  r.post('/api/pannes/:id', async (ctx) => {
    exigerEcriture()
    const f = lireFiche(ctx.params.id)
    if (!f) throw new ErreurHttp(404, 'Fiche introuvable')
    const { symptome = f.symptome, causes = f.causes, validee = f.validee } = await ctx.json()
    if (!String(symptome).trim()) throw new ErreurHttp(400, 'Le symptôme est obligatoire.')
    const propres = (Array.isArray(causes) ? causes : []).map((c) => ({ cause: String(c.cause || '').trim(), remede: String(c.remede || '').trim(), cas: Math.max(1, Number(c.cas) || 1) })).filter((c) => c.cause || c.remede)
    db().prepare('UPDATE pannes SET symptome = ?, causes = ?, validee = ?, modifie_le = ? WHERE id = ?').run(String(symptome).trim(), JSON.stringify(propres), validee ? 1 : 0, new Date().toISOString(), f.id)
    indexerFiche(f.id)
    noterModification()
    return lireFiche(f.id)
  })

  r.delete('/api/pannes/:id', (ctx) => {
    exigerEcriture()
    supprimerFiche(ctx.params.id)
    noterModification()
    return { supprimee: true }
  })
}
