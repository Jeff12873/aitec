// Le Démonstrateur d'une machine (PREVTEC, étapes 3 et 4), fidèle au classeur de son auteur : en colonnes les
// équipements de la machine (sous-ensembles, organes), le plus en panne à gauche ; en lignes les visites du plan ;
// à la croisée, l'endroit où chaque visite est posée (arborescence) ; sous chaque colonne, l'un des 4 diagnostics.
// Le taux t du classeur d'origine, la part des passages sans rien trouver, se lit dans l'observation écrite sur le
// rapport (visites.js) ; les passages sans observation n'en disent rien et ne comptent pas.
//
// La machine : le nœud de niveau 3 de l'arborescence (un clic sur un sous-ensemble remonte à sa machine), avec tous
// ses sous-ensembles. Ses 5 premières pannes (12 mois), chacune avec une pastille, sans IA :
//   - « aucune »   : aucune visite sur son équipement ni sur la machine ;
//   - « revoir »   : une visite la regarde, et pourtant elle monte (ou apparaît, 3 cas au moins) ;
//   - « regardee » : une visite la regarde, et elle ne monte pas.
// Les visites : celles du plan (code reconnu, visites.js), regroupées par titre. Je décide : pour le rouge et
// l'orange, une fiche N1 ou une FI revue, proposées par l'IA.

import { db, reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { exigerEcriture } from 'ktec/partage.js'
import * as mysql from 'ktec/mysql.js'
import { reglagesDuParc, valeursSql, instructions } from './gmao.js'
import { visitesLocales, visiteLocale } from './visites-locales.js'
import { FORMAT_POINT, symptomesPour } from './symptomes.js'
import { ErreurHttp } from 'ktec/http.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { pannesDeLaMachine, decouperRapport } from '../pannes/serveur.js'
import { evolution } from './parcs.js'
import { familleDe } from '../../lib/types.js'
import { visitesDuParc, regarde, texteSeul, resultatDuPassage, morceauxPassage, organeDuTitre } from './visites.js'
import { redigerFiche, lireJson } from './correlation.js'

const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
const plusFrequent = (valeurs) => [...valeurs.reduce((c, v) => c.set(v, (c.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
const titreDe = (x) => x.code?.titre || texteSeul(x.description).split(' - ')[0].slice(0, 100)
const cleDe = (texte) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)

const cleDeplacement = (machine, pose, titre) => `${machine}|${pose}|${titre}`

// La machine (niveau 3) et ses équipements, ses pannes des 12 derniers mois.
export async function machineEtPannes(parcId, machineId) {
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
      const symptome = plusFrequent(g.cas.map((c) => c.symptome))
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

// deja : la machine et ses pannes, si l'appelant les a lues.
export async function demonstrateur(parcId, machineId, deja = null) {
  const { v, machine, equipements, repere, pannes, parEquipement: comptes, globales } = deja || await machineEtPannes(parcId, machineId)
  const visites = v.pourEcran('demonstrateur').filter((x) => x.recente && equipements.has(x.machine_id)) // par défaut, l'observation seule
  const designation = new Map(db().prepare(`SELECT id, designation FROM machines WHERE id IN (${[...equipements].join(',')})`).all().map((m) => [m.id, m.designation]))
  const deplacements = reglageJson('prev_deplacements', {}) || {}
  const placements = reglageJson('prev_placements', {}) || {}
  // Une visite posée sur la machine entière dont le titre nomme un organe compte sur cet organe.
  const organes = [...equipements].filter((e) => e !== machine.id).map((e) => ({ id: e, repere: repere.get(e) || '', designation: designation.get(e) || '' }))
  // Les lignes : les visites du plan, regroupées par code, titre et équipement où elles sont posées.
  const groupes = new Map()
  for (const x of visites) {
    const cle = `${x.code?.code || ''}|${titreDe(x)}|${x.machine_id}`
    // Où la montrer : validée dans la GMAO (les rapports déjà faits restent à l'ancienne place), déplacée dans PREVTEC
    // en attendant d'être validée, ou rattachée d'après son titre.
    const cleVisite = cleDeplacement(machine.id, x.machine_id, titreDe(x))
    const deplacee = deplacements[cleVisite]
    const placee = placements[cleVisite]
    const dapresLeTitre = x.machine_id === machine.id && !deplacee && !placee ? organeDuTitre(titreDe(x), organes) : null
    const organe = deplacee ?? placee ?? dapresLeTitre
    const g = groupes.get(cle) || { code: x.code ? { code: x.code.code, niveau: x.code.niveau, type: x.code.nomType } : null, titre: titreDe(x), pose: x.machine_id, equipement: organe ?? x.machine_id, machineEntiere: x.machine_id === machine.id && !organe, dapresTitre: Boolean(dapresLeTitre), deplacee: Boolean(deplacee), placee: Boolean(placee) && !deplacee, passages: 0, derniere: '', ecrits: 0, rien: 0 }
    g.passages++
    const resultat = resultatDuPassage(x.description)
    if (resultat) g.ecrits++
    if (resultat === 'rien') g.rien++
    if (x.date > g.derniere) g.derniere = x.date
    groupes.set(cle, g)
  }
  const lignes = [...groupes.values()].map((g) => ({ ...g, t: g.ecrits ? g.rien / g.ecrits : null }))
  // Un déplacement encore provisoire n'est pas actif : il compte à sa place d'origine, tant qu'il n'est pas validé.
  const surMachine = lignes.filter((g) => g.machineEntiere || (g.placee && g.pose === machine.id))
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
    const dessus = lignes.filter((g) => (g.placee ? g.pose === id && g.pose !== machine.id : g.equipement === id && !g.machineEntiere))
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
    locales: visitesLocales(machine.id),
    conventionReglee: v.reglee,
    iaInstallee: iaInstallee(),
  }
}

// ---------------------------------------------------------------- la fiche de visite

const NB_POINTS = 8
const NB_DERNIERES = 12
const NB_REMARQUES = 6
// Le texte d'un rapport, jamais coupé : une fiche se lit en entier.
const propre = (t) => String(t || '').replace(/^[\s\-–—]+/, '')

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
export async function ficheDeVisite(parcId, machineId, { equipement, titre, organe, locale }) {
  const { v, machine, repere, pannes } = await machineEtPannes(parcId, machineId)
  const id = Number(equipement)
  if (!repere.has(id)) throw new ErreurHttp(404, 'Équipement introuvable sur cette machine')
  // Une visite préparée dans PREVTEC : pas encore de passage, ses points à contrôler en plus.
  const preparee = locale ? visiteLocale(String(locale)) : null
  const passages = preparee ? [] : v.toutes.filter((x) => x.recente && x.machine_id === id && titreDe(x) === titre)
  if (!passages.length && !preparee?.fiches[id]) throw new ErreurHttp(404, 'Visite introuvable sur cette machine')
  const cible = repere.has(Number(organe)) ? Number(organe) : id
  const couvert = sousEquipements(v, repere, cible)
  const noms = new Map(db().prepare(`SELECT id, designation FROM machines WHERE id IN (${[...couvert].join(',')})`).all().map((m) => [m.id, m.designation]))
  const nomOrgane = (e) => ({ repere: repere.get(e) || '', designation: noms.get(e) || '' })
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
    visite: { code: passages[0]?.code?.code || '', titre: preparee?.titre || titre, points: preparee?.fiches[id].points || null, frequence: preparee?.fiches[id].frequence || '', format: preparee?.fiches[id].format || 'html', ...nomOrgane(cible), machineEntiere: cible === machine.id, passages: passages.length, derniere },
    bilan: {
      pannes: recents.length, precedent, evolution: evolution(recents.length, precedent),
      heures: avecDuree.length ? Math.round(avecDuree.reduce((s, l) => s + Number(l.duree_h), 0)) : null,
      depuisVisite: derniere ? correctifs.filter((l) => l.date > derniere).length : null,
    },
    ou: [...parOrgane].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => ({ ...nomOrgane(e), pannes: n })),
    points: pannes.filter((p) => couvert.has(p.equipement)).slice(0, NB_POINTS).map((p) => ({ ...nomOrgane(p.equipement), symptome: p.symptome, nombre: p.nombre, precedent: p.precedent, evolution: p.evolution, derniere: p.derniere, reparation: propre(p.derniereAction) })),
    dernieres: recents.slice(0, NB_DERNIERES).map((l) => {
      const d = decouperRapport(l.description)
      return { date: l.date, repere: repere.get(l.machine_id) || '', symptome: propre(d?.symptome || texteSeul(l.description)), reparation: propre(d?.action), duree: Number(l.duree_h) > 0 ? Number(l.duree_h) : null, apresVisite: Boolean(derniere) && l.date > derniere }
    }),
    remarques: [...v.remontees, ...v.ponctuels].filter((l) => l.date >= depuis && couvert.has(l.machine_id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, NB_REMARQUES)
      .map((l) => ({ date: l.date, repere: repere.get(l.machine_id) || '', texte: propre(texteSeul(l.description)), origine: remontees.has(l) ? 'Conducteur' : 'Entretien' })),
  }
}

// ---------------------------------------------------------------- déplacer une visite dans la GMAO

// L'ID du nœud de l'arborescence qui porte ce repère, sous les racines de maintenance de la ligne.
export function noeudDe(v, repere) {
  let trouve = null
  const chercher = (n) => { if (n.code === repere) trouve = trouve ?? n.id; else n.enfants.forEach(chercher) }
  v.p.racines.filter((r) => v.parc.maintenance.includes(r.id)).forEach((r) => chercher(r.noeud))
  return trouve
}

// Une visite glissée sur un autre équipement : dans PREVTEC seulement, en attendant d'être validée. vers vide : annulé.
export async function placerVisite(parcId, machineId, { pose, titre, vers = null }) {
  const { machine, equipements } = await machineEtPannes(parcId, machineId)
  if (vers !== null && (!equipements.has(Number(vers)) || Number(vers) === Number(pose))) throw new ErreurHttp(400, 'Choisissez un autre équipement de cette machine.')
  exigerEcriture()
  const p = reglageJson('prev_placements', {}) || {}
  const cle = cleDeplacement(machine.id, Number(pose), titre)
  if (vers === null) delete p[cle]
  else p[cle] = Number(vers)
  modifierReglage('prev_placements', p)
  noterModification()
  return { ok: true }
}

// Valider le déplacement d'une visite dans la GMAO : { pose, titre, vers, valider }. Simulé d'abord (transaction
// annulée) ; une fois validé, retenu dans le fichier pour que le Démonstrateur la montre sur son nouvel équipement.
export async function deplacerVisite(parcId, machineId, { pose, titre, vers, valider = false }) {
  const { v, machine, equipements, repere } = await machineEtPannes(parcId, machineId)
  const cible = Number(vers)
  const origine = Number(pose)
  if (!equipements.has(origine) || !equipements.has(cible) || origine === cible) throw new ErreurHttp(400, 'Choisissez un autre équipement de cette machine.')
  const passages = v.toutes.filter((x) => x.machine_id === origine && titreDe(x) === titre).sort((a, b) => b.date.localeCompare(a.date))
  const fi = passages.map((x) => morceauxPassage(x.description).fi).find(Boolean)?.split(/\s/)[0]
  if (!fi) throw new ErreurHttp(404, 'Le numéro de FI de cette visite est introuvable dans ses rapports.')
  const r = reglagesDuParc(parcId)
  if (!r.sqlEquipement) throw new ErreurHttp(409, 'Le SQL de déplacement d’une FI n’est pas réglé (Maintenance de niveau 1 › Circuit › réglages de la GMAO › SQL du site).')
  const [ancienCode, nouveauCode] = [repere.get(origine), repere.get(cible)]
  const [ancien, nouveau] = [noeudDe(v, ancienCode), noeudDe(v, nouveauCode)]
  if (ancien === null || nouveau === null) throw new ErreurHttp(404, 'Cet équipement est introuvable dans l’arborescence de la GMAO.')
  const lot = instructions(r.sqlEquipement, { ...valeursSql(r, { numero: fi }), numero: fi, ancien, nouveau, ancien_code: ancienCode, nouveau_code: nouveauCode })
  const reponse = await mysql.ecrireDansLaBase(lot, { valider: Boolean(valider) })
  const modifiees = reponse.resultats.filter((x) => 'modifiees' in x).reduce((s, x) => s + x.modifiees, 0)
  if (valider && modifiees) {
    exigerEcriture()
    const d = reglageJson('prev_deplacements', {}) || {}
    d[cleDeplacement(machine.id, origine, titre)] = cible
    modifierReglage('prev_deplacements', d)
    const p = reglageJson('prev_placements', {}) || {}
    delete p[cleDeplacement(machine.id, origine, titre)]
    modifierReglage('prev_placements', p)
    noterModification()
  }
  return { valide: reponse.valide, modifiees, numero: fi, de: ancienCode, vers: nouveauCode }
}

// ---------------------------------------------------------------- je décide : une visite × un équipement

// La page « Je décide » d'une case du Démonstrateur : la visite telle qu'elle est écrite dans la GMAO (sa FI, ses
// observations), et de quoi la juger face aux pannes de cet équipement.
export async function decisionCroisee(parcId, machineId, { equipement, pose, titre }) {
  const base = await machineEtPannes(parcId, machineId)
  const { v, machine, pannes } = base
  const d = await demonstrateur(parcId, machineId, base)
  const id = Number(equipement)
  const g = d.lignes.find((x) => x.pose === Number(pose) && x.titre === titre)
  if (!g) throw new ErreurHttp(404, 'Visite introuvable sur cette machine')
  const entiere = id === machine.id && !d.colonnes.some((x) => x.id === id && x.pannes)
  const siennes = pannes.filter((p) => (entiere ? true : p.equipement === id)).slice(0, 6)
  const c = d.colonnes.find((x) => x.id === id) || { id, repere: machine.repere, designation: machine.designation, pannes: d.colonnes.reduce((s, x) => s + x.pannes, 0), precedent: 0, diagnostic: 'rien', libelle: '', raison: '', panne: null }
  if (!c.panne && siennes[0]) c.panne = { cle: siennes[0].cle, symptome: siennes[0].symptome, nombre: siennes[0].nombre }
  if (!base.repere.has(id)) throw new ErreurHttp(404, 'Équipement introuvable sur cette machine')
  const passages = v.toutes.filter((x) => x.machine_id === g.pose && titreDe(x) === g.titre).sort((a, b) => b.date.localeCompare(a.date))
  const morceaux = passages.map((x) => ({ date: x.date, ...morceauxPassage(x.description) }))
  const avecFi = morceaux.find((m) => m.contenu) || morceaux.find((m) => m.fi)
  const visite = { ...g, fi: avecFi?.fi || '', contenu: propre(avecFi?.contenu), observations: morceaux.filter((m) => m.observation).slice(0, 5).map((m) => ({ date: m.date, texte: propre(m.observation) })), jamaisEspacer: passages[0]?.code?.jamaisEspacer || false }
  const depuis = ilYa(365)
  const remarques = [...v.remontees, ...v.ponctuels].filter((l) => l.date >= depuis && (l.machine_id === id || l.machine_id === machine.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((l) => ({ date: l.date, texte: propre(texteSeul(l.description)) }))
  const posee = g.equipement === id || (g.machineEntiere && id === machine.id)
  const liste = siennes.map((p) => ({ symptome: p.symptome, nombre: p.nombre, precedent: p.precedent, evolution: p.evolution, derniere: p.derniere, reparation: propre(p.derniereAction) }))
  return { parc: d.parc, machine, equipement: c, visite, posee, pannes: liste, remarques, conseils: conseilsDe(c, [visite], liste, remarques), iaInstallee: d.iaInstallee }
}

const CONSIGNES_PRECONISATIONS = `Tu es un expert en maintenance industrielle. On te donne une visite préventive (sa FI, ses observations) et les pannes d'un équipement qu'elle regarde, ou pourrait regarder.
Donne 3 préconisations au plus : simples, concrètes, 20 mots au plus chacune, tirées seulement de ce qui t'est donné. Une préconisation par ligne, sans numéro ni tiret. Formule des propositions, pas des ordres. N'invente aucune valeur ni aucun repère.`

const resumeCroisee = (r) => `Machine : ${r.machine.repere} ${r.machine.designation}
Équipement : ${r.equipement.repere} ${r.equipement.designation}${r.posee ? '' : ' (la visite n\'est pas posée sur lui)'}
Visite : ${r.visite.titre}, ${r.visite.passages} passages en 12 mois
Contenu actuel de la FI : ${r.visite.contenu.slice(0, 1500) || 'inconnu'}
Observations écrites : ${r.visite.observations.map((o) => o.texte).join(' ; ') || 'aucune'}
Pannes qui reviennent sur l'équipement (12 mois) :
${r.pannes.map((p) => `- ${p.symptome} : ${p.nombre} cas, dernière réparation : ${p.reparation}`).join('\n') || '- aucune'}
Déjà remarqué sur place : ${r.remarques.map((x) => x.texte).join(' ; ') || 'rien'}
Symptômes classiques par élément :
${symptomesPour(`${r.equipement.designation} ${r.visite.contenu} ${r.pannes.map((p) => `${p.symptome} ${p.reparation}`).join(' ')}`) || '- aucun'}`

// Les préconisations de l'IA pour cette case ; sans IA, les conseils tirés des chiffres.
export async function preconisations(parcId, machineId, croisee) {
  const r = await decisionCroisee(parcId, machineId, croisee)
  if (!iaInstallee()) return { lignes: r.conseils, ia: false }
  const texte = await discuter([{ role: 'system', content: CONSIGNES_PRECONISATIONS }, { role: 'user', content: resumeCroisee(r) }], { temperature: 0.3, maxMots: 250 })
  const lignes = texte.split('\n').map((l) => l.replace(/^[\s\-•*\d.)]+/, '').trim()).filter(Boolean).slice(0, 3)
  return { lignes: lignes.length ? lignes : r.conseils, ia: Boolean(lignes.length) }
}

const CONSIGNES_FI = `Tu améliores le contenu d'une fiche d'intervention (FI) préventive de maintenance. Garde ce qui est utile, rends chaque point précis, et ajoute le contrôle qui verrait venir les pannes données. N'invente aucune valeur ni aucun repère. Réponds seulement avec le nouveau texte de la FI, un point par ligne.
${FORMAT_POINT}`

// Le contenu de la FI actuelle, et une proposition de l'IA à reporter dans la GMAO.
export async function proposerFi(parcId, machineId, croisee) {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  const r = await decisionCroisee(parcId, machineId, croisee)
  const texte = await discuter([{ role: 'system', content: CONSIGNES_FI }, { role: 'user', content: resumeCroisee(r) }], { temperature: 0.3, maxMots: 1500 })
  return { actuelle: r.visite.contenu, proposee: texte.trim() }
}

// Des conseils tirés des chiffres, sans IA : ce que disent le diagnostic, les passages et les observations.
function conseilsDe(c, visites, pannes, remarques) {
  const conseils = []
  const posees = visites.filter((g) => !g.machineEntiere)
  if (c.diagnostic === 'pas') conseils.push('Aucune visite ne regarde cet équipement. Si sa panne principale se voit venir (usure, jeu, fuite), ajoutez un point de contrôle ; sinon, le correctif peut rester le bon choix.')
  if (c.diagnostic === 'mauvais' && !posees.length) conseils.push('La visite reste générale : imprimez sa fiche de visite pour orienter le mainteneur, ou ajoutez un point précis sur cet organe.')
  if (c.diagnostic === 'mauvais' && posees.length) conseils.push('Ses pannes montent malgré la visite : revoyez ce qu’elle contrôle, en partant des pannes ci-contre.')
  for (const g of visites) {
    if (g.t !== null && g.ecrits >= 3 && g.t >= 0.8 && c.pannes >= 2) conseils.push(`« ${g.titre} » : ${Math.round(g.t * 100)} % des passages ne trouvent rien, alors que les pannes continuent. Le point contrôlé ne regarde sans doute pas ce qui casse.`)
    if (g.passages >= 2 && g.ecrits < g.passages / 2) conseils.push(`« ${g.titre} » : seuls ${g.ecrits} passages sur ${g.passages} ont une observation écrite. Sans elle, on ne sait pas ce qui a été vu.`)
  }
  if (c.diagnostic === 'sur' && !visites.some((g) => g.jamaisEspacer)) conseils.push('Beaucoup de passages pour presque aucune panne : les visites peuvent-elles être espacées ?')
  const monte = pannes.find((p) => p.evolution === 'monte')
  if (monte) conseils.push(`Commencez par « ${monte.symptome} » : ${monte.nombre} cas sur 12 mois contre ${monte.precedent} les 12 mois d’avant.`)
  if (remarques.length) conseils.push(`${remarques.length} chose${remarques.length > 1 ? 's' : ''} déjà remarquée${remarques.length > 1 ? 's' : ''} sur place : une bonne source pour un nouveau contrôle.`)
  return conseils
}

// ---------------------------------------------------------------- je décide : la fiche N1

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
