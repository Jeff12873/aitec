// Le circuit de la maintenance de niveau 1, lu en direct dans la GMAO (requêtes du site « FI N1 » et « RI N1 »,
// réglées avec celle des demandes dans Données de la GMAO) :
//   - DI → FI → RI : le conducteur fait la DI, l'appui technique en fait une FI (qui doit porter l'arborescence de
//     production ET celle de maintenance), l'agent de maintenance la clôt par une RI ;
//   - FI focus → RI : les FI issues des vignettes, exécutées par les conducteurs, sans DI.
// Le calendrier de chaque parc (régime des équipes par semaine, semaines exclues) pèse sur tous les indicateurs.

import { ErreurHttp } from 'ktec/http.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { requetes } from '../import-gmao/synchronisation.js'
import { dateIso } from './demandes.js'

// ---------------------------------------------------------------- les requêtes du site

const caches = {}
// Une requête du site (fiN1, riN1) → lignes { colonne: valeur }, gardées une minute ; null si elle n'est pas réglée.
async function lire(cle, colonnes) {
  const sql = requetes()[cle]
  if (!sql) return null
  if (!etatConnexion().ouverte) throw new ErreurHttp(401, 'Connexion à la GMAO indisponible (réglée par l’administrateur).')
  const c = caches[cle]
  if (c && c.sql === sql && Date.now() - c.quand < 60_000) return c.lignes
  const r = await executerRequete(sql.replace(/--[^\n]*/g, ''), 200_000)
  const i = Object.fromEntries(colonnes.map((n) => [n, r.colonnes.findIndex((x) => x.nom.toLowerCase() === n)]))
  const lignes = r.lignes.map((l) => Object.fromEntries(colonnes.map((n) => [n, i[n] < 0 ? '' : l[i[n]] ?? ''])))
  caches[cle] = { sql, quand: Date.now(), lignes }
  return lignes
}

// Les FI de niveau 1, une par numéro (et par occurrence : les lignes archivées d'une FI périodique sont gardées),
// avec leurs équipements. → [{ numero, titre, date, echeance, actif, di, equipements: [noeud], ri, dateRi }]
export async function lireFiN1() {
  const lignes = await lire('fiN1', ['numero', 'titre', 'date', 'echeance', 'actif', 'di', 'equipement', 'ri', 'date_ri'])
  if (!lignes) return null
  const parCle = new Map()
  for (const l of lignes) {
    const numero = String(l.numero).trim()
    if (!numero) continue
    const fi = { numero, titre: String(l.titre).trim(), date: dateIso(l.date), echeance: dateIso(l.echeance), actif: Number(l.actif), di: String(l.di).trim(), ri: String(l.ri).trim(), dateRi: dateIso(l.date_ri) }
    // Une occurrence = un numéro, un état, une échéance, une RI.
    const cle = [numero, fi.actif, fi.echeance, fi.ri].join('|')
    const existante = parCle.get(cle) || { ...fi, equipements: [] }
    const eq = String(l.equipement).trim()
    if (eq && !existante.equipements.includes(eq)) existante.equipements.push(eq)
    parCle.set(cle, existante)
  }
  return [...parCle.values()]
}

// Les RI de niveau 1. → [{ numero, date, fi, di, dateDi, machine, intervenant, observation }]
export async function lireRiN1() {
  const lignes = await lire('riN1', ['numero', 'date', 'fi', 'di', 'date_di', 'machine', 'intervenant', 'observation'])
  if (!lignes) return null
  return lignes.map((l) => ({ numero: String(l.numero).trim(), date: dateIso(l.date), fi: String(l.fi).trim(), di: String(l.di).trim(), dateDi: dateIso(l.date_di), machine: String(l.machine).trim(), intervenant: String(l.intervenant).trim(), observation: texteSeul(l.observation).slice(0, 500) })).filter((r) => r.numero)
}

// ---------------------------------------------------------------- activités des conducteurs

// Les RI exécutées par les conducteurs (requête du site « RI des conducteurs ») : une ligne par RI et par personne.
// → [{ numero, date, personne, profil, categorie }] ; la catégorie « 01.Libellé » garde son numéro pour le rang.
export async function lireActivites() {
  const lignes = await lire('riConducteurs', ['numero', 'date', 'personne', 'profil', 'categorie'])
  if (!lignes) return null
  return lignes.map((l) => ({ numero: String(l.numero).trim(), date: dateIso(l.date), personne: String(l.personne).trim(), profil: String(l.profil).trim(), categorie: String(l.categorie).trim() || 'Autre' }))
    .filter((x) => x.numero && x.personne && x.date)
}

// Le profil des conducteurs de chaque parc (un texte contenu dans le profil de la GMAO) : { parcId: 'texte' }.
export const profilsDesParcs = () => reglageJson('mn1_profils', {}) || {}
export function enregistrerProfil(parcId, texte) {
  const tout = profilsDesParcs()
  if (String(texte || '').trim()) tout[parcId] = String(texte).trim()
  else delete tout[parcId]
  modifierReglage('mn1_profils', JSON.stringify(tout))
  noterModification()
  return { profil: tout[parcId] || '' }
}
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Les lignes d'un parc (son profil), ou de tous les parcs réglés ; sans profil réglé, toutes les lignes.
export function activitesDuParc(lignes, parcId) {
  const profils = profilsDesParcs()
  const voulus = parcId ? [profils[parcId]].filter(Boolean) : Object.values(profils)
  if (!voulus.length) return lignes
  return lignes.filter((l) => voulus.some((p) => sansAccent(l.profil).includes(sansAccent(p))))
}
// Une RI par personne (deux conducteurs sur la même RI : une exécution chacun).
const uniques = (lignes) => [...new Map(lignes.map((l) => [`${l.numero}|${l.personne}`, l])).values()]
const debutDuMois = (decalage) => {
  const d = new Date()
  const m = new Date(d.getFullYear(), d.getMonth() - decalage, 1)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`
}
// Les exécutions des n derniers mois (le mois en cours compris) : par catégorie, et par personne (la plus active
// d'abord, les ex aequo par nom).
export function activites(lignes, mois) {
  const depuis = debutDuMois(mois - 1)
  const retenues = uniques(lignes.filter((l) => l.date >= depuis))
  const categories = [...new Set(retenues.map((l) => l.categorie))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
  const parPersonne = new Map()
  for (const l of retenues) {
    const p = parPersonne.get(l.personne) || { nom: l.personne, total: 0, parCategorie: {} }
    p.total++
    p.parCategorie[l.categorie] = (p.parCategorie[l.categorie] || 0) + 1
    parPersonne.set(l.personne, p)
  }
  return {
    depuis,
    total: retenues.length,
    ri: new Set(retenues.map((l) => l.numero)).size,
    categories: categories.map((cle) => ({ cle, nom: cle.replace(/^\d+\s*[.\-:]\s*/, ''), total: retenues.filter((l) => l.categorie === cle).length })),
    personnes: [...parPersonne.values()].sort((a, b) => b.total - a.total || a.nom.localeCompare(b.nom, 'fr')),
  }
}
// Les deux premiers exécutants du mois écoulé.
export function podiumExecutants(lignes) {
  const debut = debutDuMois(1), fin = debutDuMois(0)
  const compte = new Map()
  for (const l of uniques(lignes.filter((x) => x.date >= debut && x.date < fin))) compte.set(l.personne, (compte.get(l.personne) || 0) + 1)
  return [...compte].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 2).map(([nom, nombre]) => ({ nom, nombre }))
}

// L'observation d'une RI est écrite en HTML par la GMAO : le texte seul, sans le rappel « ------- FI : … ------- ».
function texteSeul(v) {
  return String(v ?? '')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/-{3,}\s*FI\s*:.*?-{3,}/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------- calendrier des parcs

// Le régime d'une semaine : quelles équipes ont tourné (A matin, B après-midi, C nuit) ; X : semaine exclue (travaux
// d'été…). Une case vide prend le régime par défaut du parc. Le week-end n'est pas travaillé : 5 jours par poste.
export const REGIMES = ['A', 'AB', 'B', 'BC', 'C', 'CA', 'ABC', 'X']
export const postesDe = (regime) => (regime === 'X' ? 0 : String(regime || '').length)

// { parcId: { defaut: 'AB', semaines: { '2026-28': 'X', … } } }
export const calendriers = () => reglageJson('mn1_calendrier', {}) || {}
export function calendrierDuParc(parcId) {
  const c = calendriers()[parcId] || {}
  return { defaut: REGIMES.includes(c.defaut) && c.defaut !== 'X' ? c.defaut : 'AB', semaines: c.semaines || {} }
}
export function enregistrerCalendrier(parcId, { defaut, semaines }) {
  const propres = Object.fromEntries(Object.entries(semaines || {}).filter(([cle, v]) => /^\d{4}-\d{1,2}$/.test(cle) && REGIMES.includes(v)))
  const tout = calendriers()
  tout[parcId] = { defaut: REGIMES.includes(defaut) && defaut !== 'X' ? defaut : 'AB', semaines: propres }
  modifierReglage('mn1_calendrier', JSON.stringify(tout))
  noterModification()
  return calendrierDuParc(parcId)
}
// Le régime d'un parc pour une semaine « AAAA-SS ».
export const regimeDe = (parcId, semaine) => {
  const c = calendrierDuParc(parcId)
  return c.semaines[semaine] || c.defaut
}

// ---------------------------------------------------------------- semaines ISO

const jourUtc = (iso) => new Date(`${iso}T00:00:00Z`)
// « AAAA-MM-JJ » → « AAAA-SS » (semaine ISO, lundi en premier).
export function semaineDe(iso) {
  if (!iso) return null
  const d = jourUtc(iso)
  const jeudi = new Date(d)
  jeudi.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))
  const annee = jeudi.getUTCFullYear()
  const premierJeudi = new Date(Date.UTC(annee, 0, 4))
  const numero = 1 + Math.round(((jeudi - premierJeudi) / 86_400_000 - 3 + ((premierJeudi.getUTCDay() + 6) % 7)) / 7)
  return `${annee}-${numero}`
}
// Les n dernières semaines terminées (la semaine en cours n'est jamais comptée), de la plus ancienne à la plus récente.
export function semainesTerminees(n, aujourdhui = new Date()) {
  const lundi = new Date(Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate()))
  lundi.setUTCDate(lundi.getUTCDate() - ((lundi.getUTCDay() + 6) % 7))
  const liste = []
  for (let k = n; k >= 1; k--) {
    const d = new Date(lundi)
    d.setUTCDate(lundi.getUTCDate() - 7 * k)
    liste.push(semaineDe(d.toISOString().slice(0, 10)))
  }
  return liste
}
export const nombreDeSemaines = (annee) => Number(semaineDe(`${annee}-12-28`).split('-')[1])

// ---------------------------------------------------------------- indicateurs

const mediane = (valeurs) => {
  if (!valeurs.length) return null
  const v = [...valeurs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const jours = (de, a) => Math.round((jourUtc(a) - jourUtc(de)) / 86_400_000)

// Les indicateurs du bandeau.
//   demandes : les DI de niveau 1 retenues (avec .parc) ; parcs : les id des parcs pris en compte ;
//   fi, ri : les FI et RI de niveau 1 (ou null) ; parcDuNoeud : nœud de l'arborescence → parc ;
//   classer(noeud) → 'production' | 'maintenance' | null.
// Hall of fame : les deux premiers demandeurs du mois écoulé.
export function podiumDemandeurs(di) {
  const m = new Date()
  const moisPasse = new Date(m.getFullYear(), m.getMonth() - 1, 1)
  const cleMois = `${moisPasse.getFullYear()}-${String(moisPasse.getMonth() + 1).padStart(2, '0')}`
  const duMois = di.filter((d) => d.date.startsWith(cleMois) && d.demandeur)
  return [...duMois.reduce((mm, d) => mm.set(d.demandeur, (mm.get(d.demandeur) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([nom, nombre]) => ({ nom, nombre }))
}

export function indicateurs({ demandes, parcs, fi, ri, parcDuNoeud, classer }) {
  const exclue = (parc, iso) => parc && regimeDe(parc, semaineDe(iso)) === 'X'
  const dans = (d) => !exclue(d.parc, d.date)
  const di = demandes.filter(dans)
  const aujourdhui = new Date().toISOString().slice(0, 10)

  // DI par semaine terminée, ramenées au poste travaillé (une semaine ABC = 3 postes × 5 jours).
  const semaines = semainesTerminees(8)
  const parSemaine = semaines.map((s) => {
    const actifs = parcs.filter((p) => regimeDe(p, s) !== 'X')
    const postes = actifs.reduce((t, p) => t + postesDe(regimeDe(p, s)) * 5, 0)
    const nombre = di.filter((d) => semaineDe(d.date) === s && (!parcs.length || actifs.includes(d.parc))).length
    return { semaine: s, nombre, postes, exclue: parcs.length > 0 && !actifs.length }
  })
  const comptees = parSemaine.filter((s) => !s.exclue)
  const taux = (liste) => {
    const postes = liste.reduce((t, s) => t + s.postes, 0)
    return postes ? liste.reduce((t, s) => t + s.nombre, 0) / postes : liste.length ? liste.reduce((t, s) => t + s.nombre, 0) / liste.length : null
  }
  const recentes = comptees.slice(-4)
  const avant = comptees.slice(-8, -4)
  const tauxRecent = taux(recentes)
  const tauxAvant = taux(avant)
  const tendance = tauxRecent !== null && tauxAvant ? (tauxRecent - tauxAvant) / tauxAvant : null

  // Concentration : une seule personne fait plus de la moitié des DI des 8 dernières semaines.
  const sur8 = di.filter((d) => semaines.includes(semaineDe(d.date)) && d.demandeur)
  const parDemandeur = [...sur8.reduce((m, d) => m.set(d.demandeur, (m.get(d.demandeur) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])
  const concentration = sur8.length >= 10 && parDemandeur[0] && parDemandeur[0][1] / sur8.length > 0.5 ? { nom: parDemandeur[0][0], part: parDemandeur[0][1] / sur8.length, total: sur8.length } : null

  const podium = podiumDemandeurs(di)

  // Le suivi de chaque DI (si la requête des demandes donne la FI et la RI).
  const suivi = demandes.some((d) => d.suivi)
  const ilYa = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
  const sur12 = di.filter((d) => d.date >= ilYa(365))
  const delais = sur12.filter((d) => d.ri && d.dateRi && d.dateRi >= d.date).map((d) => jours(d.date, d.dateRi))
  const enAttente = suivi ? di.filter((d) => !d.close && !d.fi && d.date <= ilYa(7)).length : null
  const supprimees = suivi ? sur12.filter((d) => d.fi && d.fiActif === 2 && !d.ri).length : null

  // Les FI issues de DI sans les deux arborescences, et le retard des FI focus (échéance → RI).
  let sansDoubleArbo = null
  let retardFocus = null
  let focusEnRetard = null
  if (fi) {
    const ouvertesOuRecentes = fi.filter((f) => f.di && (f.actif === 1 || f.date >= ilYa(365)) && !(f.actif === 2 && !f.ri))
    sansDoubleArbo = ouvertesOuRecentes.filter((f) => manqueArbo(f, classer)).length
    const focus = fi.filter((f) => !f.di && !exclue(parcDuNoeud(f.equipements[0]), f.echeance))
    const retards = focus.filter((f) => f.ri && f.dateRi && f.echeance && f.dateRi >= ilYa(365)).map((f) => jours(f.echeance, f.dateRi))
    retardFocus = mediane(retards)
    focusEnRetard = focus.filter((f) => f.actif === 1 && f.echeance && f.echeance < aujourdhui && !f.ri).length
  }
  return {
    parSemaine,
    diSemaine: recentes.length ? recentes.reduce((t, s) => t + s.nombre, 0) / recentes.length : null,
    tauxParPoste: tauxRecent,
    tendance,
    alerteBaisse: tendance !== null && tendance < -0.2,
    concentration,
    podium,
    mois: cleMois,
    delaiMedian: mediane(delais),
    enAttente,
    supprimees,
    sansDoubleArbo,
    retardFocus,
    focusEnRetard,
    suivi,
    fiReglee: fi !== null,
    semainesExclues: parSemaine.filter((s) => s.exclue).length,
  }
}

// Une FI issue d'une DI doit porter un équipement de production ET un de maintenance.
export function manqueArbo(f, classer) {
  const genres = new Set(f.equipements.map(classer).filter(Boolean))
  return !(genres.has('production') && genres.has('maintenance'))
}
