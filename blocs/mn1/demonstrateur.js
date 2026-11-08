// Le Démonstrateur d'une machine (PREVTEC, étapes 3 et 4), fidèle au classeur de son auteur : en colonnes les
// équipements de la machine (sous-ensembles, organes), le plus en panne à gauche ; en lignes les visites du plan ;
// à la croisée, l'endroit où chaque visite est posée (arborescence) ; sous chaque colonne, l'un des 4 diagnostics.
// Le taux t = A / (A + B + C) du classeur d'origine demande le résultat des inspections, que la GMAO n'a pas :
// la colonne t reste vide tant qu'il n'y en a pas.
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
import { pannesDeLaMachine, decouperRapport } from '../pannes/serveur.js'
import { evolution } from './parcs.js'
import { familleDe } from '../../lib/types.js'
import { visitesDuParc, regarde, texteSeul } from './visites.js'
import { redigerFiche, lireJson } from './correlation.js'

const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
const plusFrequent = (valeurs) => [...valeurs.reduce((c, v) => c.set(v, (c.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
const titreDe = (x) => x.code?.titre || texteSeul(x.description).split(' - ')[0].slice(0, 100)
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
      pannes.push({ cle: `${e}:${cleDe(symptome)}`, equipement: e, surQuoi: repere.get(e) || '', symptome, repere: machine.repere, designation: machine.designation, nombre: recents.length, precedent, evolution: evolution(recents.length, precedent), derniere: g.cas[0].date, derniereAction: g.cas[0].action, cas: g.cas.map((c) => c.id) })
    }
  }
  pannes.sort((a, b) => b.nombre - a.nombre)
  // Toutes les pannes de chaque équipement (le Démonstrateur compte tout, pas seulement ce qui revient).
  const parEquipement = new Map()
  for (const l of v.lignes) {
    if (!equipements.has(l.machine_id) || familleDe(l.type) !== 'Correctif') continue
    const c = parEquipement.get(l.machine_id) || { pannes: 0, precedent: 0, cas: [] }
    if (l.date >= depuis) { c.pannes++; c.cas.push(l.id) } else c.precedent++
    parEquipement.set(l.machine_id, c)
  }
  const globales = [...parEquipement].filter(([, c]) => c.pannes).map(([e, c]) => ({ cle: `${e}:*`, equipement: e, surQuoi: repere.get(e) || '', symptome: `pannes diverses de ${repere.get(e) || 'cet équipement'}`, repere: machine.repere, designation: machine.designation, nombre: c.pannes, precedent: c.precedent, evolution: evolution(c.pannes, c.precedent), cas: c.cas }))
  return { v, machine, equipements, repere, pannes, parEquipement, globales }
}

// Les 4 diagnostics du Démonstrateur (libellés de son auteur), par équipement de la machine :
//   « pas »      pas de préventif : des pannes, aucune visite sur l'équipement ni sur la machine ;
//   « mauvais »  mauvais point contrôlé ou énoncé trop vague : la panne monte malgré une visite sur l'équipement,
//                ou la seule visite est posée sur la machine entière (pas sur l'organe) ;
//   « ok »       préventif ok : des visites sur l'équipement, et ses pannes ne montent pas ;
//   « sur »      sur maintenance : 4 passages au moins sur un équipement presque sans panne.
const DIAGNOSTICS = {
  pas: 'pas de préventif',
  mauvais: 'mauvais point contrôlé ou énoncé trop vague',
  ok: 'préventif ok',
  sur: 'sur maintenance',
  rien: '',
}
const PANNES_MIN = 2
const SUR_MAINTENANCE = 4

export async function demonstrateur(parcId, machineId) {
  const { v, machine, equipements, repere, pannes, parEquipement: comptes, globales } = await machineEtPannes(parcId, machineId)
  const visites = v.observation.filter((x) => x.recente && equipements.has(x.machine_id)) // ni systématique, ni ponctuel
  const designation = new Map(db().prepare(`SELECT id, designation FROM machines WHERE id IN (${[...equipements].join(',')})`).all().map((m) => [m.id, m.designation]))
  // Les lignes : les visites du plan, regroupées par code, titre et équipement où elles sont posées.
  const groupes = new Map()
  for (const x of visites) {
    const cle = `${x.code?.code || ''}|${titreDe(x)}|${x.machine_id}`
    const g = groupes.get(cle) || { code: x.code ? { code: x.code.code, niveau: x.code.niveau, type: x.code.nomType } : null, titre: titreDe(x), equipement: x.machine_id, machineEntiere: x.machine_id === machine.id, passages: 0, derniere: '', t: null }
    g.passages++
    if (x.date > g.derniere) g.derniere = x.date
    groupes.set(cle, g)
  }
  const lignes = [...groupes.values()]
  const surMachine = lignes.filter((g) => g.machineEntiere)
  // Les colonnes : les équipements qui ont des pannes ou des visites, le plus en panne à gauche ; la machine entière
  // (visites posées sur elle) en dernier.
  const parEquipement = new Map([...comptes].filter(([, c]) => c.pannes || c.precedent).map(([id, c]) => [id, { pannes: c.pannes, precedent: c.precedent, liste: [] }]))
  for (const p of pannes) parEquipement.get(p.equipement)?.liste.push(p)
  for (const g of lignes) if (!g.machineEntiere && !parEquipement.has(g.equipement)) parEquipement.set(g.equipement, { pannes: 0, precedent: 0, liste: [] })
  // La panne à traiter : celle qui revient le plus, sinon l'ensemble des pannes de l'équipement.
  const principale = (id, c) => {
    const p = [...c.liste].sort((a, b) => b.nombre - a.nombre)[0] || globales.find((g) => g.equipement === id)
    return p ? { cle: p.cle, symptome: p.symptome, nombre: p.nombre } : null
  }
  const colonnes = [...parEquipement].filter(([id]) => id !== machine.id || parEquipement.get(id).pannes).map(([id, c]) => {
    const dessus = lignes.filter((g) => g.equipement === id && !g.machineEntiere)
    const passages = dessus.reduce((s, g) => s + g.passages, 0)
    const ev = evolution(c.pannes, c.precedent)
    const monte = ev === 'monte' || (ev === 'nouvelle' && c.pannes >= 3)
    let diagnostic = 'rien'
    let raison = ''
    if (c.pannes >= PANNES_MIN) {
      if (!dessus.length && !surMachine.length) { diagnostic = 'pas'; raison = 'Des pannes, et aucune visite sur cet équipement ni sur la machine.' }
      else if (!dessus.length) { diagnostic = 'mauvais'; raison = 'Seule une visite sur la machine entière le regarde : énoncé trop vague, le point n’est pas sur l’organe.' }
      else if (monte) { diagnostic = 'mauvais'; raison = 'Ses pannes montent malgré les visites posées sur lui : le point contrôlé ne les voit pas venir.' }
      else { diagnostic = 'ok'; raison = 'Des visites posées sur lui, et ses pannes ne montent pas.' }
    } else if (passages >= SUR_MAINTENANCE) { diagnostic = 'sur'; raison = `${passages} passages en 12 mois, pour ${c.pannes ? 'une seule panne' : 'aucune panne'}.` }
    else if (dessus.length) { diagnostic = 'ok'; raison = 'Peu de pannes, peu de visites.' }
    return { id, repere: repere.get(id) || '', designation: designation.get(id) || '', pannes: c.pannes, precedent: c.precedent, evolution: ev, diagnostic, libelle: DIAGNOSTICS[diagnostic], raison, panne: principale(id, c), pannesListe: c.liste.slice(0, 3).map((p) => ({ symptome: p.symptome, nombre: p.nombre })) }
  }).sort((a, b) => b.pannes - a.pannes || a.repere.localeCompare(b.repere))
  const ordreLignes = (g) => (g.machineEntiere ? colonnes.length : Math.max(0, colonnes.findIndex((c) => c.id === g.equipement)))
  return {
    parc: { id: v.parc.id, nom: v.parc.nom },
    machine,
    colonnes,
    lignes: lignes.sort((a, b) => ordreLignes(a) - ordreLignes(b) || b.passages - a.passages),
    conventionReglee: v.reglee,
    iaInstallee: iaInstallee(),
  }
}

// ---------------------------------------------------------------- la fiche de visite

const NB_POINTS = 8
const NB_DERNIERES = 12
const NB_REMARQUES = 6
const extrait = (t, n) => {
  const x = String(t || '').replace(/^[\s\-–—]+/, '')
  return x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x
}

// L'équipement et tout ce qui est rangé dessous dans l'arborescence.
function sousEquipements(v, repere, id) {
  const codes = new Set()
  const ramasser = (n) => { codes.add(n.code); n.enfants.forEach(ramasser) }
  const chercher = (n) => (n.code === repere.get(id) ? ramasser(n) : n.enfants.forEach(chercher))
  v.p.racines.filter((r) => v.parc.maintenance.includes(r.id)).forEach((r) => chercher(r.noeud))
  return new Set([id, ...[...repere].filter(([, code]) => codes.has(code)).map(([e]) => e)])
}

// Ce sur quoi le mainteneur s'appuie pour une visite trop générale : les pannes de ce qu'elle couvre (l'équipement où
// elle est posée et ce qu'il porte), sans IA. Rien que des faits de la GMAO, sans le nom des dépanneurs.
export async function ficheDeVisite(parcId, machineId, { equipement, titre }) {
  const { v, machine, repere, pannes } = await machineEtPannes(parcId, machineId)
  const id = Number(equipement)
  if (!repere.has(id)) throw new ErreurHttp(404, 'Équipement introuvable sur cette machine')
  const passages = v.visites.filter((x) => x.recente && x.machine_id === id && titreDe(x) === titre)
  if (!passages.length) throw new ErreurHttp(404, 'Visite introuvable sur cette machine')
  const couvert = sousEquipements(v, repere, id)
  const noms = new Map(db().prepare(`SELECT id, designation FROM machines WHERE id IN (${[...couvert].join(',')})`).all().map((m) => [m.id, m.designation]))
  const organe = (e) => ({ repere: repere.get(e) || '', designation: noms.get(e) || '' })
  const depuis = ilYa(365)
  const derniere = passages.reduce((d, x) => (x.date > d ? x.date : d), '')
  const correctifs = v.lignes.filter((l) => couvert.has(l.machine_id) && familleDe(l.type) === 'Correctif').sort((a, b) => b.date.localeCompare(a.date))
  const recents = correctifs.filter((l) => l.date >= depuis)
  const precedent = correctifs.length - recents.length
  const avecDuree = recents.filter((l) => Number(l.duree_h) > 0)
  const parOrgane = new Map()
  for (const l of recents) parOrgane.set(l.machine_id, (parOrgane.get(l.machine_id) || 0) + 1)
  const remontees = new Set(v.remontees)
  return {
    parc: v.parc.nom,
    machine: { repere: machine.repere, designation: machine.designation },
    visite: { code: passages[0].code?.code || '', titre, ...organe(id), machineEntiere: id === machine.id, passages: passages.length, derniere },
    bilan: {
      pannes: recents.length, precedent, evolution: evolution(recents.length, precedent),
      heures: avecDuree.length ? Math.round(avecDuree.reduce((s, l) => s + Number(l.duree_h), 0)) : null,
      depuisVisite: correctifs.filter((l) => l.date > derniere).length,
    },
    ou: [...parOrgane].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => ({ ...organe(e), pannes: n })),
    points: pannes.filter((p) => couvert.has(p.equipement)).slice(0, NB_POINTS).map((p) => ({ ...organe(p.equipement), symptome: p.symptome, nombre: p.nombre, precedent: p.precedent, evolution: p.evolution, derniere: p.derniere, reparation: extrait(p.derniereAction, 160) })),
    dernieres: recents.slice(0, NB_DERNIERES).map((l) => {
      const d = decouperRapport(l.description)
      return { date: l.date, repere: repere.get(l.machine_id) || '', symptome: extrait(d?.symptome || texteSeul(l.description), 110), reparation: extrait(d?.action, 130), duree: Number(l.duree_h) > 0 ? Number(l.duree_h) : null, apresVisite: l.date > derniere }
    }),
    remarques: [...v.remontees, ...v.ponctuels].filter((l) => l.date >= depuis && couvert.has(l.machine_id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, NB_REMARQUES)
      .map((l) => ({ date: l.date, repere: repere.get(l.machine_id) || '', texte: extrait(texteSeul(l.description), 160), origine: remontees.has(l) ? 'Conducteur' : 'Entretien' })),
  }
}

// ---------------------------------------------------------------- je décide : fiche N1 ou point N2

const CONSIGNES_N2 = `Tu rédiges un point de maintenance préventive de niveau 2 (fait par un technicien de maintenance, avec outillage ou démontage léger), à reporter dans la GMAO. Il doit permettre de voir venir la panne décrite.
Réponds seulement avec un objet JSON, sans texte autour :
{"quoi":"le contrôle ou la mesure, concret, avec la valeur ou l'état attendu","ou":"organe ou sous-ensemble","frequence":"Mensuelle | Trimestrielle | Semestrielle | Annuelle","metier":"Mécanique | Électrique | Pneumatique | Hydraulique | Automatisme","pourquoi":"la panne visée et ce que le contrôle voit venir, une phrase"}`

// La panne, avec les choses vues à refaire sur son équipement ou sa machine (préventif sans fréquence, 12 mois) :
// hors du plan, elles nourrissent les conseils de préventif.
async function panneDe(parcId, machineId, cle) {
  const { v, machine, pannes, globales } = await machineEtPannes(parcId, machineId)
  const panne = [...pannes, ...globales].find((x) => x.cle === cle)
  if (!panne) throw new ErreurHttp(404, 'Panne introuvable sur cette machine')
  const depuis = ilYa(365)
  const notes = [...v.remontees, ...v.ponctuels].filter((l) => l.date >= depuis && (l.machine_id === panne.equipement || l.machine_id === machine.id)).slice(0, 8).map((l) => `${l.date} : ${texteSeul(l.description).slice(0, 200)}`)
  return { machine, panne: { ...panne, notes } }
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
  const texte = await discuter([{ role: 'system', content: CONSIGNES_N2 }, { role: 'user', content: `Machine : ${machine.repere} ${machine.designation}\nPanne : ${panne.symptome}${panne.surQuoi ? ` (sur ${panne.surQuoi})` : ''}, ${panne.nombre} cas en 12 mois${visites ? `\nVisite actuelle qui ne la voit pas venir : ${visites}` : ''}\nRapports :\n${rapports.map((r) => `- ${r.date} : ${texteSeul(r.description).slice(0, 300)}`).join('\n')}${panne.notes.length ? `\nChoses vues à refaire sur cet équipement (notées pendant des pannes, sans fréquence) :\n${panne.notes.map((n) => `- ${n}`).join('\n')}` : ''}` }], { temperature: 0.3, maxMots: 400 })
  const lu = lireJson(texte)
  if (!lu?.quoi) throw new ErreurHttp(502, 'Réponse de l’IA illisible : réessayez.')
  const champ = (k, n = 300) => String(lu[k] || '').slice(0, n)
  return { quoi: champ('quoi'), ou: champ('ou', 120), frequence: champ('frequence', 40), metier: champ('metier', 40), pourquoi: champ('pourquoi'), machine: machine.repere, panne: panne.symptome }
}
