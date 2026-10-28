// Les FI de maintenance de niveau 1 dans la GMAO : une FI porte une fiche ; chaque parc a un maximum de charge
// par ETH (fiches par semaine, pondérées par la périodicité : une FI mensuelle compte pour 7 / 30,4 par semaine).
//
// AITEC lit les FI réelles de la GMAO à chaque ouverture de la maintenance de niveau 1 (pas les fiches affichées) :
// celles dont le numéro suit le modèle du parc (ex. « FI-MN1-{parc}-{eth}-{nnn} »), même créées à la main.
// Il écrit dans une seule transaction, simulée d'abord : création d'une FI, remplacement de la fiche d'une FI
// (modifiée sur place : son historique reste), suspension (ACTIF à 0), réactivation. Jamais de renumérotation.
//
// Le SQL est celui du site (fichier de connaissances, réglage « mn1_gmao ») ; AITEC n'en connaît que les colonnes
// et les paramètres nommés :
//   lecture       → colonnes numero, actif, periot, val_periot, equipement (+ titre, date_deb) ; paramètre :motif
//   création      → voir gmao.js ; modification (remplacement, réactivation) et suspension : mêmes paramètres.

import { db, noterModification, transaction } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import * as mysql from 'ktec/mysql.js'
import { lireParcs } from '../../lib/parcs.js'
import { reglagesDuParc, description, remplir, valeursSql, instructions } from './gmao.js'

// ---------------------------------------------------------------- lecture des FI de la GMAO

let lecture = { date: null, erreur: null, fi: [], promesse: null }

// Le modèle de numéro en motif LIKE (« FI-MN1-% ») et en expression (pour reconnaître parc, ETH et rang).
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function motifs(modele, valeurs = {}) {
  const champs = []
  let regex = ''
  let like = ''
  for (const morceau of String(modele || '').split(/(\{\w+\})/)) {
    const cle = morceau.match(/^\{(\w+)\}$/)?.[1]
    if (!cle) { regex += echapper(morceau); like += morceau.replace(/[%_\\]/g, (c) => `\\${c}`); continue }
    if (cle in valeurs) { regex += echapper(String(valeurs[cle])); like += String(valeurs[cle]).replace(/[%_\\]/g, (c) => `\\${c}`); continue }
    champs.push(cle)
    regex += /^n+$/.test(cle) ? '(\\d+)' : '(.+?)'
    like += '%'
  }
  return { like: like.replace(/%+/g, '%'), regex: new RegExp(`^${regex}$`, 'i'), champs }
}

// Lit les FI de niveau 1 de la GMAO (gardées 2 minutes ; force : relues tout de suite, avant une écriture).
export function lireFiGmao({ force = false } = {}) {
  if (!force && lecture.promesse && Date.now() - (lecture.date || 0) < 120_000) return lecture.promesse
  lecture.promesse = (async () => {
    const p = await lireParcs()
    const parcs = (p?.parcs || []).filter((x) => !x.nonClasse)
    const sql = reglagesDuParc('').sqlLecture
    if (!sql) throw new ErreurHttp(409, 'La requête de lecture des FI n’est pas réglée (Maintenance de niveau 1 › réglages de la GMAO).')
    if (!mysql.etatConnexion().ouverte) throw new ErreurHttp(401, 'Connexion à la GMAO indisponible : lecture des FI impossible.')
    const vus = new Map()
    for (const like of new Set(parcs.map((x) => motifs(reglagesDuParc(x.id).numero, { parc: x.nom }).like))) {
      const r = await mysql.executerRequete(sql.replace(/--[^\n]*/g, '').replace(/:motif\b/g, `'${like.replace(/'/g, "''")}'`), 20_000)
      const i = (nom) => r.colonnes.findIndex((c) => c.nom.toLowerCase() === nom)
      const col = Object.fromEntries(['numero', 'actif', 'periot', 'val_periot', 'equipement', 'titre', 'date_deb'].map((n) => [n, i(n)]))
      if (col.numero < 0 || col.actif < 0 || col.periot < 0 || col.val_periot < 0) throw new ErreurHttp(400, 'Requête de lecture des FI : il faut au moins les colonnes numero, actif, periot et val_periot.')
      const v = (l, n) => (col[n] < 0 ? '' : l[col[n]])
      for (const l of r.lignes) {
        const numero = String(v(l, 'numero') || '').trim()
        if (!numero || vus.has(numero)) continue
        vus.set(numero, { numero, actif: Number(v(l, 'actif')) === 1, periot: String(v(l, 'periot') ?? ''), valPeriot: Number(v(l, 'val_periot')) || 0, equipement: String(v(l, 'equipement') ?? ''), titre: String(v(l, 'titre') || ''), dateDeb: String(v(l, 'date_deb') || '') })
      }
    }
    lecture = { ...lecture, date: Date.now(), erreur: null, fi: [...vus.values()] }
    return lecture.fi
  })()
  lecture.promesse.catch((e) => { lecture = { ...lecture, erreur: e.message, promesse: null } })
  return lecture.promesse
}
export const etatLecture = () => ({ date: lecture.date ? new Date(lecture.date).toISOString() : null, erreur: lecture.erreur })

// Le poids d'une FI en fiches par semaine (null : unité de périodicité inconnue).
export function parSemaine(periot, valPeriot, reglages) {
  const jours = Number(reglages.unites?.[String(periot)]?.jours)
  if (!jours || !valPeriot) return null
  return 7 / (jours * valPeriot)
}

// La périodicité GMAO d'une fréquence de fiche : [periot, val_periot].
export const periodicite = (frequence, reglages) => reglages.frequences?.[frequence] || null

// ---------------------------------------------------------------- charge d'un parc

// Les équipements de production d'un parc, à plat : [{ noeud, code, designation, eth, ethLibelle, machine }].
export async function equipementsDuParc(parcId) {
  const p = await lireParcs()
  const parc = p?.parcs.find((x) => x.id === parcId)
  if (!parc) return { parc: null, equipements: [], liens: {} }
  const equipements = parc.production.flatMap((racine) => p.detail(racine)).map((n) => ({ ...n, ethCode: n.eth || n.code }))
  const libelles = new Map(equipements.filter((n) => n.niveau === 2).map((n) => [n.code, n.designation ? `${n.code} — ${n.designation}` : n.code]))
  return { parc, equipements: equipements.map((n) => ({ ...n, ethLibelle: libelles.get(n.ethCode) || n.ethCode })), liens: p.liens }
}

const sansPrefixe = (code) => String(code || '').replace(/^[A-Z]{1,3}_/i, '')

// La charge d'un parc, par ETH : les FI actives (et suspendues) de la GMAO qui suivent son modèle de numéro.
// { reglages, eths: [{ eth, libelle, max, charge, taux, fi: [{ numero, actif, poids, fiche, equipement }] }], horsEth: [] }
export async function chargeDuParc(parcId, { force = false } = {}) {
  const r = reglagesDuParc(parcId)
  const { parc, equipements } = await equipementsDuParc(parcId)
  if (!parc) throw new ErreurHttp(404, 'Parc introuvable')
  const tout = await lireFiGmao({ force })
  const { regex, champs } = motifs(r.numero, { parc: parc.nom })
  const parNoeud = new Map(equipements.map((n) => [n.noeud, n]))
  const fiches = new Map(db().prepare("SELECT id, etiquette, zone, machine_nom, action, frequence, fi_gmao FROM fiches_mn1 WHERE fi_gmao <> '' AND archivee = 0").all().map((f) => [f.fi_gmao, f]))
  const eths = new Map(equipements.filter((n) => n.niveau === 2).map((n) => [n.code, { eth: n.code, libelle: n.ethLibelle, max: r.parSemaine, fi: [] }]))
  const horsEth = []
  for (const fi of tout) {
    const m = fi.numero.match(regex)
    if (!m) continue
    const rang = Number(m[champs.findIndex((c) => /^n+$/.test(c)) + 1]) || null
    const equipement = parNoeud.get(fi.equipement)
    const ligne = { ...fi, rang, poids: parSemaine(fi.periot, fi.valPeriot, r), fiche: fiches.get(fi.numero) || null, equipement: equipement ? { noeud: equipement.noeud, code: equipement.code, designation: equipement.designation } : null }
    const eth = equipement?.ethCode
    if (eth && eths.has(eth)) eths.get(eth).fi.push(ligne)
    else horsEth.push(ligne)
  }
  for (const e of eths.values()) {
    e.fi.sort((a, b) => (a.rang ?? 1e9) - (b.rang ?? 1e9) || a.numero.localeCompare(b.numero))
    e.charge = Math.round(e.fi.filter((x) => x.actif).reduce((s, x) => s + (x.poids || 0), 0) * 100) / 100
    e.taux = e.max ? e.charge / e.max : 0
    e.inconnues = e.fi.filter((x) => x.actif && x.poids === null).length
  }
  return { reglages: r, parc: { id: parc.id, nom: parc.nom }, eths: [...eths.values()], horsEth }
}

// ---------------------------------------------------------------- numéro de la prochaine FI

// Le premier numéro jamais utilisé pour cet ETH (on ne renumérote jamais).
function prochainNumero(r, parc, eth, toutes, valeurs) {
  const base = { ...valeurs, parc: parc.nom, eth: sansPrefixe(eth) }
  const { regex, champs } = motifs(r.numero, Object.fromEntries(Object.entries(base).filter(([k]) => r.numero.includes(`{${k}}`) && !/^n+$/.test(k))))
  const iRang = champs.findIndex((c) => /^n+$/.test(c))
  const pris = toutes.map((fi) => fi.numero.match(regex)).filter(Boolean).map((m) => Number(m[iRang + 1]) || 0)
  const suivant = (pris.length ? Math.max(...pris) : 0) + 1
  return remplir(r.numero, { ...base, nn: String(suivant).padStart(2, '0'), nnn: String(suivant).padStart(3, '0'), n: String(suivant) })
}

// ---------------------------------------------------------------- plan : créer, remplacer, réactiver, suspendre

const aujourdhui = () => new Date().toISOString().slice(0, 10)

function lireFiche(id) {
  const f = db().prepare('SELECT f.*, m.repere FROM fiches_mn1 f LEFT JOIN machines m ON m.id = f.machine_id WHERE f.id = ?').get(id)
  if (!f) throw new ErreurHttp(404, 'Fiche introuvable')
  return f
}

// Ce que ferait l'enregistrement d'une fiche dans une FI :
//   { fiche, noeud, dateDeb, cible: 'nouvelle' | 'reactiver' | 'remplacer', numero (réactiver), remplacer: [numéros] }
// remplacer : la 1re FI cochée reçoit la fiche (cible « remplacer »), les autres sont suspendues.
// Renvoie le plan, la charge avant et après, et si le maximum est respecté.
export async function planifier({ parc: parcId, fiche: ficheId, noeud, dateDeb, cible = 'nouvelle', numero = '', remplacer = [] }, { force = false } = {}) {
  const f = lireFiche(ficheId)
  const c = await chargeDuParc(parcId, { force })
  const r = c.reglages
  const { equipements } = await equipementsDuParc(parcId)
  const equipement = equipements.find((n) => n.noeud === String(noeud || f.noeud || ''))
  if (!equipement) throw new ErreurHttp(400, 'Choisissez l’équipement de production de la FI.')
  const eth = c.eths.find((e) => e.eth === equipement.ethCode)
  if (!eth) throw new ErreurHttp(400, 'Cet équipement n’est sous aucun ETH du parc.')
  const per = periodicite(f.frequence, r)
  if (!per) throw new ErreurHttp(400, f.frequence === 'Quotidienne' ? 'Fréquence quotidienne : trop fréquent pour une fiche de niveau 1.' : 'La fréquence de la fiche n’a pas de périodicité GMAO : réglez-la (réglages de la GMAO) ou précisez la fréquence de la fiche.')
  const poids = parSemaine(per[0], per[1], r)
  const actives = eth.fi.filter((x) => x.actif)
  const choisies = [...new Set(remplacer.map(String))].map((n) => actives.find((x) => x.numero === n)).filter(Boolean)
  if (cible === 'remplacer' && !choisies.length) throw new ErreurHttp(400, 'Cochez la FI qui reçoit la fiche.')
  const suspendues = eth.fi.filter((x) => !x.actif)
  let numeroCible
  if (cible === 'remplacer') numeroCible = choisies[0].numero
  else if (cible === 'reactiver') {
    if (!suspendues.some((x) => x.numero === numero)) throw new ErreurHttp(400, 'Cette FI n’est pas suspendue dans cet ETH.')
    numeroCible = numero
  } else numeroCible = prochainNumero(r, c.parc, eth.eth, eth.fi.concat(c.horsEth), { ligne: f.ligne, eth_fiche: f.eth, machine: f.machine_nom || f.repere || '', zone: f.zone, etiquette: f.etiquette })
  const aSuspendre = cible === 'remplacer' ? choisies.slice(1) : choisies
  const liberee = (cible === 'remplacer' ? choisies : aSuspendre).reduce((s, x) => s + (x.poids || 0), 0)
  const apres = Math.round((eth.charge - liberee + poids) * 100) / 100
  return {
    fiche: f, parcNom: c.parc.nom, eth: { eth: eth.eth, libelle: eth.libelle, max: eth.max, charge: eth.charge }, equipement, periodicite: per, poids: Math.round(poids * 100) / 100,
    cible, numero: numeroCible, remplacee: cible === 'remplacer' ? choisies[0] : null, suspensions: aSuspendre, apres, respecte: apres <= eth.max + 1e-9,
    actives: actives.map((x) => ({ numero: x.numero, poids: x.poids, fiche: x.fiche ? { id: x.fiche.id, etiquette: x.fiche.etiquette, zone: x.fiche.zone, machine: x.fiche.machine_nom } : null })),
    suspendues: suspendues.map((x) => ({ numero: x.numero, poids: x.poids })),
    reglages: r,
  }
}

// Exécute le plan dans la GMAO (simulation, ou validation) et, une fois validé, note tout dans le fichier.
export async function executer(demande, { valider = false } = {}) {
  if (typeof mysql.ecrireDansLaBase !== 'function') throw new ErreurHttp(409, 'Mettez KTEC à jour : cette version ne sait pas écrire dans la GMAO.')
  // Avant d'écrire pour de bon : les FI sont relues dans la GMAO (un autre poste a pu en créer).
  const plan = await planifier(demande, { force: valider })
  if (!plan.respecte) throw new ErreurHttp(409, `Charge maximale dépassée pour ${plan.eth.libelle} : ${plan.apres} fiche(s) par semaine pour ${plan.eth.max} au plus. Choisissez des FI à remplacer.`)
  const r = plan.reglages
  const manque = [plan.cible === 'nouvelle' ? 'sql' : 'sqlModification', ...(plan.suspensions.length ? ['sqlSuspension'] : []), 'modele', 'intervenant', 'emetteur', 'type', 'utilisateur'].filter((cle) => !r[cle])
  if (manque.length) throw new ErreurHttp(409, `Réglages de la GMAO incomplets (${manque.join(', ')}).`)
  const f = plan.fiche
  const debut = /^\d{4}-\d{2}-\d{2}$/.test(demande.dateDeb || '') ? demande.dateDeb : aujourdhui()
  const valeurs = valeursSql(r, {
    numero: plan.numero,
    titre: remplir(r.titre, { parc: plan.parcNom, machine: f.machine_nom || f.repere || plan.equipement.designation || plan.equipement.code, repere: plan.equipement.code, zone: f.zone, etiquette: f.etiquette, eth: sansPrefixe(plan.eth.eth), eth_fiche: f.eth, ligne: f.ligne }),
    obser: description([f]),
    parc: plan.equipement.noeud,
    dateDeb: debut,
    periot: plan.periodicite[0],
    valPeriot: plan.periodicite[1],
  })
  const lot = [
    ...instructions(plan.cible === 'nouvelle' ? r.sql : r.sqlModification, valeurs).map((i) => ({ ...i, role: 'cible' })),
    ...plan.suspensions.flatMap((s) => instructions(r.sqlSuspension, { ...valeurs, numero: s.numero }).map((i) => ({ ...i, role: 'suspension' }))),
  ]
  const reponse = await mysql.ecrireDansLaBase(lot.map(({ sql, valeurs: v }) => ({ sql, valeurs: v })), { valider })
  // Écrites : le nombre de lignes de chaque INSERT ou UPDATE, dans l'ordre.
  const ecritures = []
  reponse.resultats.forEach((x, i) => { if ('modifiees' in x && /^\s*(insert|update)/i.test(lot[i]?.sql || '')) ecritures.push({ role: lot[i].role, lignes: x.modifiees }) })
  const ok = (ecritures.find((e) => e.role === 'cible')?.lignes || 0) > 0
  const selects = reponse.resultats.map((x, i) => ({ ...x, role: lot[i]?.role })).filter((x) => x.colonnes && x.role === 'cible')
  const tableau = (x) => (x ? x.lignes.map((l) => Object.fromEntries(x.colonnes.map((c, i) => [c, l[i]]))) : [])
  if (valider && ok) noterDansLeFichier(plan, demande.parc, debut)
  return {
    valide: reponse.valide, ok, plan: resumePlan(plan), ecritures,
    controles: tableau(selects[0])[0] || null,
    recapitulatif: selects.length > 1 ? tableau(selects.at(-1)) : [],
    valeurs: { numero: valeurs.numero, titre: valeurs.titre, parc: valeurs.parc, date_deb: valeurs.date_deb, periot: valeurs.periot, val_periot: valeurs.val_periot },
  }
}

export const resumePlan = (plan) => ({
  cible: plan.cible, numero: plan.numero, eth: plan.eth, equipement: { noeud: plan.equipement.noeud, code: plan.equipement.code, designation: plan.equipement.designation },
  poids: plan.poids, apres: plan.apres, respecte: plan.respecte, remplacee: plan.remplacee?.numero || null, suspensions: plan.suspensions.map((s) => s.numero),
  actives: plan.actives, suspendues: plan.suspendues, periodicite: plan.periodicite,
})

// Le fichier de connaissances suit la GMAO : la fiche porte la FI ; la fiche remplacée et celles des FI suspendues
// sont archivées ; l'historique note les débuts et les fins.
function noterDansLeFichier(plan, parcId, debut) {
  const maintenant = new Date().toISOString()
  const jour = aujourdhui()
  const archiver = (numero, motif) => {
    for (const ancienne of db().prepare('SELECT id FROM fiches_mn1 WHERE fi_gmao = ? AND id <> ?').all(numero, plan.fiche.id)) {
      db().prepare("UPDATE fiches_mn1 SET fi_gmao = '', archivee = 1, archivee_le = ?, modifie_le = ? WHERE id = ?").run(maintenant, maintenant, ancienne.id)
      db().prepare('UPDATE fiches_mn1_fi SET fin = ?, motif = ? WHERE fiche_id = ? AND numero = ? AND fin IS NULL').run(jour, motif, ancienne.id, numero)
    }
  }
  transaction(() => {
    if (plan.cible !== 'nouvelle') archiver(plan.numero, 'remplacement')
    for (const s of plan.suspensions) archiver(s.numero, 'suspension')
    db().prepare('UPDATE fiches_mn1_fi SET fin = ? WHERE fiche_id = ? AND fin IS NULL').run(jour, plan.fiche.id)
    db().prepare('UPDATE fiches_mn1 SET fi_gmao = ?, parc = ?, noeud = ?, machine_prod = ?, archivee = 0, archivee_le = NULL, modifie_le = ? WHERE id = ?')
      .run(plan.numero, parcId, plan.equipement.noeud, plan.equipement.machine ?? null, maintenant, plan.fiche.id)
    db().prepare('INSERT INTO fiches_mn1_fi (fiche_id, numero, debut, motif) VALUES (?, ?, ?, ?)')
      .run(plan.fiche.id, plan.numero, plan.cible === 'nouvelle' ? debut : jour, { nouvelle: 'création', reactiver: 'réactivation', remplacer: 'remplacement' }[plan.cible])
  })
  noterModification()
  lecture = { ...lecture, promesse: null } // relire la GMAO au prochain affichage
}

// Suspendre des FI (maximum baissé) : { parc, numeros, valider }. Leurs fiches sont archivées.
export async function suspendre({ parc: parcId, numeros = [] }, { valider = false } = {}) {
  const c = await chargeDuParc(parcId, { force: valider })
  const r = c.reglages
  if (!r.sqlSuspension) throw new ErreurHttp(409, 'Le SQL de suspension n’est pas réglé.')
  const actives = c.eths.flatMap((e) => e.fi.filter((x) => x.actif))
  const choisies = [...new Set(numeros.map(String))].map((n) => actives.find((x) => x.numero === n)).filter(Boolean)
  if (!choisies.length) throw new ErreurHttp(400, 'Cochez les FI à suspendre.')
  const valeurs = valeursSql(r, { numero: choisies[0].numero })
  const lot = choisies.flatMap((s) => instructions(r.sqlSuspension, { ...valeurs, numero: s.numero }))
  const reponse = await mysql.ecrireDansLaBase(lot, { valider })
  const suspendues = reponse.resultats.filter((x) => 'modifiees' in x).reduce((s, x) => s + x.modifiees, 0)
  if (valider && suspendues) {
    const maintenant = new Date().toISOString()
    const jour = aujourdhui()
    transaction(() => {
      for (const s of choisies) {
        for (const f of db().prepare('SELECT id FROM fiches_mn1 WHERE fi_gmao = ?').all(s.numero)) {
          db().prepare("UPDATE fiches_mn1 SET fi_gmao = '', archivee = 1, archivee_le = ?, modifie_le = ? WHERE id = ?").run(maintenant, maintenant, f.id)
          db().prepare("UPDATE fiches_mn1_fi SET fin = ?, motif = 'suspension' WHERE fiche_id = ? AND numero = ? AND fin IS NULL").run(jour, f.id, s.numero)
        }
      }
    })
    noterModification()
    lecture = { ...lecture, promesse: null }
  }
  return { valide: reponse.valide, suspendues, numeros: choisies.map((x) => x.numero) }
}
