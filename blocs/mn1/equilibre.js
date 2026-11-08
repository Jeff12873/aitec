// L'équilibre correctif × préventif d'un parc, équipement par équipement (le nuage de la fiche MN1 du parc) :
// pour chaque machine de maintenance, ses correctifs et ses préventifs des 12 derniers mois.
//   - rouge  : beaucoup de pannes et peu de préventif (sous-entretien) ;
//   - orange : beaucoup de préventif et peu de pannes (sur-entretien possible) ;
//   - vert   : équilibré.
// On compare des parts : la part des correctifs du parc que porte l'équipement, et sa part du préventif (la couleur
// est calculée par l'écran, interface/mn1-equilibre.js, selon la bascule niveau 1 / techniciens / tout).
//
// Seul le préventif d'observation compte (contrôles, inspections, surveillance de l'état) : un préventif
// systématique (« changer telle pièce ») renouvelle sans regarder et ne dit rien des pannes. Chaque gamme (le titre
// de l'intervention, avant « - ») est classée une fois par l'IA, observation ou systématique ; l'administrateur
// corrige. Le classement est gardé dans le fichier (réglage « mn1_gammes »). Sans classement : une première idée
// d'après les mots du titre (échange, remplacement…).
//
// Seul le préventif à code (visites.js) compte : le niveau 1 est celui dont le code le dit, le reste celui des
// techniciens.

import { db, reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { lireParcs, NON_CLASSE, machineAnalysable } from '../../lib/parcs.js'
import { familleDe } from '../../lib/types.js'
import { convention, lireCode, estDuPlan, placesDuParc, visitesDuParc } from './visites.js'
import { etiquettes } from './affichage.js'

const JOURS = 365
const PAR_LOT = 40 // gammes envoyées à l'IA en une fois

const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
export const texteSeul = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

// La gamme d'une intervention : son titre, avant « - » (« Vérification du tunnel de rinçage - ras » → la 1re partie).
// Un code d'équipement en tête (« 741.1 - Contrôle visu. - RAS ») est sauté, comme pour les pannes.
export function gammeDe(description) {
  const t = texteSeul(description).replace(/^[\d.]+\s*-\s*/, '').replace(/^(.{3,}?)\.(\s+-\s)/, '$1$2')
  const i = t.indexOf(' - ')
  return (i > 0 ? t.slice(0, i) : t).slice(0, 120).trim()
}
export const cleDe = (gamme) => gamme.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// Première idée sans IA : les mots du renouvellement à date fixe.
const SYSTEMATIQUE = /\b(echange|echanger|remplac\w*|chang(?:er|ement)|vidange\w*|renouvel\w*|substitu\w*)\b/
const devinee = (cle) => (SYSTEMATIQUE.test(cle) ? 'systematique' : 'observation')

// { cle: { classe: 'observation' | 'systematique', par: 'ia' | 'admin', gamme } }
// (une étiquette retirée depuis : la gamme revient à sa première idée)
export const classement = () => {
  const connues = new Set(etiquettes().map((e) => e.id))
  return Object.fromEntries(Object.entries(reglageJson('mn1_gammes', {}) || {}).filter(([, x]) => connues.has(x.classe)))
}
export const classeDe = (c, cle) => c[cle]?.classe || devinee(cle)

// Les préventifs et correctifs des machines de maintenance d'un parc (12 mois).
export async function interventionsDuParc(parc) {
  const ids = new Set(parc.machinesMaintenance.size ? parc.machinesMaintenance : parc.machines)
  const lignes = db().prepare('SELECT id, date, machine_id, numero, type, description, duree_h FROM interventions WHERE date >= ?').all(ilYa(JOURS)).filter((l) => ids.has(l.machine_id))
  // Seules les visites à code comptent (le fréquentiel) ; le niveau vient du code (convention réglée).
  const c = convention()
  const deNiveau1 = (l) => lireCode(l.description, c)?.niveau === 1
  const duPlan = (l) => familleDe(l.type) !== 'Préventif' || estDuPlan(l.description, c)
  return { ids, lignes: lignes.filter(duPlan), deNiveau1 }
}

export async function equilibreDuParc(parcId) {
  const p = await lireParcs()
  const parc = p?.parcs.find((x) => x.id === parcId && x.id !== NON_CLASSE)
  if (!parc) throw new ErreurHttp(404, 'Ligne introuvable')
  const { lignes, deNiveau1 } = await interventionsDuParc(parc)
  const c = classement()
  const cochees = new Set(etiquettes().filter((e) => e.role === 'visite' && e.ecrans.tableau).map((e) => e.id))
  const parMachine = new Map()
  const gammes = new Map() // cle → { gamme, nombre, classe, par }
  const machineDe = (id) => {
    if (!parMachine.has(id)) parMachine.set(id, { correctifs: 0, heures: 0, n1: 0, techniciens: 0 })
    return parMachine.get(id)
  }
  for (const l of lignes) {
    const famille = familleDe(l.type)
    if (famille !== 'Correctif' && famille !== 'Préventif') continue
    const m = machineDe(l.machine_id)
    if (famille === 'Correctif') {
      m.correctifs++
      m.heures += Number(l.duree_h) > 0 ? Number(l.duree_h) : 0
    } else {
      const gamme = gammeDe(l.description)
      const cle = cleDe(gamme)
      const g = gammes.get(cle) || { cle, gamme, nombre: 0, classe: classeDe(c, cle), par: c[cle]?.par || 'mots' }
      g.nombre++
      gammes.set(cle, g)
    }
  }
  // Le préventif compté : celui des étiquettes cochées pour le tableau.
  for (const l of (await visitesDuParc(parcId)).pourEcran('tableau')) {
    if (!l.recente) continue
    const m = machineDe(l.machine_id)
    if (l.nature === 'remontee' || deNiveau1(l)) m.n1++
    else m.techniciens++
  }
  const reperes = db().prepare('SELECT id, repere, designation FROM machines').all()
  const machine = new Map(reperes.map((x) => [x.id, x]))
  // Les pannes des 12 mois d'avant, pour dire si le préventif porte ses fruits.
  const avant = new Map()
  for (const l of db().prepare('SELECT machine_id, type FROM interventions WHERE date >= ? AND date < ?').all(ilYa(2 * JOURS), ilYa(JOURS))) if (familleDe(l.type) === 'Correctif') avant.set(l.machine_id, (avant.get(l.machine_id) || 0) + 1)
  // Chaque équipement avec sa machine (niveau 3) et son ETH (niveau 2), pour le tableau à deux niveaux.
  const places = placesDuParc(p, parc)
  const equipements = [...parMachine].map(([id, m]) => {
    const pl = places.get(id)
    const porteuse = pl?.machine ?? id
    return { id, repere: machine.get(id)?.repere || '', designation: machine.get(id)?.designation || '', analyse: machineAnalysable(p, id) || null, machine: { id: porteuse, repere: machine.get(porteuse)?.repere || '', designation: machine.get(porteuse)?.designation || '' }, eth: pl?.eth || null, correctifsAvant: avant.get(id) || 0, ...m }
  })
  const listeGammes = [...gammes.values()].sort((a, b) => b.nombre - a.nombre)
  return {
    jours: JOURS,
    equipements,
    etiquettes: etiquettes().filter((e) => e.role === 'visite'),
    gammes: {
      total: listeGammes.length,
      aClasser: listeGammes.filter((g) => g.par === 'mots').length,
      ecartes: listeGammes.filter((g) => !cochees.has(g.classe)).length,
      liste: listeGammes.slice(0, 400),
    },
    iaInstallee: iaInstallee(),
  }
}

// ---------------------------------------------------------------- classement des gammes par l'IA

const CONSIGNES = `Tu es un expert en maintenance industrielle. On te donne des titres de gammes de maintenance préventive (codes G…).
Classe chaque gamme :
- "observation" : on regarde l'état pour détecter une dérive ou une panne qui vient (contrôle, vérification, inspection, mesure, relevé, surveillance, nettoyage avec contrôle, serrage contrôlé, essai) ;
- "systematique" : on renouvelle ou on remplace à date fixe sans regarder l'état (échange de pièce ou de filtre, remplacement, vidange, changement d'huile, étalonnage à date fixe, graissage systématique).
En cas de doute, "observation".
Réponds seulement avec un objet JSON, sans texte autour : {"G1":"observation","G2":"systematique"}`

let enCours = new Set()

// L'IA classe les gammes du parc qui ne le sont pas encore (classées par les mots seulement).
export async function classerGammes(parcId) {
  if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
  if (enCours.has(parcId)) throw new ErreurHttp(409, 'Classement déjà en cours pour cette ligne.')
  enCours.add(parcId)
  try {
    const { gammes } = await equilibreDuParc(parcId)
    const aClasser = gammes.liste.filter((g) => g.par === 'mots')
    const classees = {}
    for (let i = 0; i < aClasser.length; i += PAR_LOT) {
      const lot = aClasser.slice(i, i + PAR_LOT)
      const texte = await discuter([{ role: 'system', content: CONSIGNES }, { role: 'user', content: lot.map((g, j) => `G${j + 1} · ${g.gamme}`).join('\n') }], { temperature: 0.1, maxMots: 1200 })
      const debut = texte.indexOf('{')
      let lu = null
      try {
        lu = JSON.parse(texte.slice(debut, texte.lastIndexOf('}') + 1))
      } catch {}
      if (!lu) continue // lot illisible : il restera « à classer », un nouveau clic le reprend
      lot.forEach((g, j) => {
        const classe = lu[`G${j + 1}`]
        if (classe === 'observation' || classe === 'systematique') classees[g.cle] = { classe, par: 'ia', gamme: g.gamme }
      })
    }
    exigerEcriture({ pourTous: true }) // comme l'analyse de corrélation : possible en consultation
    // Relu juste avant d'écrire : une correction de l'administrateur faite pendant ce temps est gardée.
    const c = classement()
    for (const [cle, x] of Object.entries(classees)) if (c[cle]?.par !== 'admin') c[cle] = x
    modifierReglage('mn1_gammes', c)
    noterModification()
    return { classees: Object.keys(classees).length, restantes: aClasser.length - Object.keys(classees).length }
  } finally {
    enCours.delete(parcId)
  }
}

// L'administrateur corrige une gamme : { cle, classe } (classe vide : retour à la première idée).
export function corrigerGamme({ cle, gamme, classe }) {
  const c = classement()
  const k = String(cle || '')
  if (!k) throw new ErreurHttp(400, 'Gamme manquante.')
  if (!classe) delete c[k]
  else if (etiquettes().some((e) => e.id === classe && e.role === 'visite')) c[k] = { classe, par: 'admin', gamme: String(gamme || c[k]?.gamme || '').slice(0, 120) }
  else throw new ErreurHttp(400, 'Classe inconnue.')
  modifierReglage('mn1_gammes', c)
  noterModification()
  return { cle: k, classe: c[k]?.classe || devinee(k), par: c[k]?.par || 'mots' }
}
