// Création d'une FI dans la GMAO depuis les fiches de niveau 1 d'une machine (une FI regroupe toutes ses
// étiquettes). Le SQL est celui du site, rangé dans le fichier de connaissances (réglage « mn1_gmao ») : AITEC n'en
// connaît que les paramètres nommés, remplis à chaque création :
//   :numero :titre :obser :parc :date_deb :date_limite :date_jour :heure
//   :modele :intervenant :emetteur :type :tps_prevu :periot :val_periot :delai :utilisateur
// Toujours simulée d'abord (transaction annulée, récapitulatif) ; validée seulement à la demande.
// creerFi : l'ancien mode (une FI par machine, toutes ses étiquettes) ; le nouveau est dans fi.js.

import { db, reglageJson, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import * as mysql from 'ktec/mysql.js'
import { equipementsDeLaLigne } from '../../lib/arborescence.js'

const REGLAGES = {
  sql: '', // création d'une FI
  sqlLecture: '', // les FI de niveau 1 de la GMAO (paramètre :motif, un LIKE sur le numéro)
  sqlModification: '', // remplacement de la fiche d'une FI, ou réactivation (ACTIF à 1)
  sqlSuspension: '', // ACTIF à 0
  modele: '', // la FI dont la structure est copiée
  intervenant: '',
  emetteur: '',
  type: '',
  utilisateur: '',
  tpsPrevu: 1,
  periot: 3, // (ancien mode) unité de la périodicité dans la GMAO
  valPeriot: 4,
  delai: 7, // retard admissible, en jours
  numero: 'FI-MN1-{parc}-{eth}-{nnn}',
  titre: 'MN1-{machine} {etiquette}',
  parSemaine: 2, // maximum de fiches par semaine et par ETH (charge pondérée par la périodicité)
  // Les unités de périodicité de la GMAO (code → durée en jours), et la périodicité de chaque fréquence de fiche.
  unites: { 1: { nom: 'jour', jours: 1 }, 3: { nom: 'semaine', jours: 7 }, 4: { nom: 'mois', jours: 30.44 } },
  frequences: { Hebdomadaire: [3, 1], Mensuelle: [3, 4], Trimestrielle: [3, 13], Semestrielle: [3, 26], Annuelle: [3, 52] },
  // Les listes de choix lues dans la GMAO (une requête par paramètre : colonnes valeur et libelle).
  listes: { modele: '', intervenant: '', emetteur: '', type: '', utilisateur: '' },
}
// Ce qu'un parc peut régler pour lui seul (vide : les réglages généraux).
export const PROPRES_AU_PARC = ['modele', 'intervenant', 'emetteur', 'type', 'utilisateur', 'tpsPrevu', 'delai', 'numero', 'titre', 'parSemaine']
const TEXTES = ['sql', 'sqlLecture', 'sqlModification', 'sqlSuspension', 'modele', 'intervenant', 'emetteur', 'type', 'utilisateur', 'numero', 'titre']
const NOMBRES = ['tpsPrevu', 'periot', 'valPeriot', 'delai', 'parSemaine']

export const reglagesGmao = () => {
  const lus = reglageJson('mn1_gmao', {}) || {}
  return { ...REGLAGES, ...lus, unites: lus.unites || REGLAGES.unites, frequences: { ...REGLAGES.frequences, ...(lus.frequences || {}) }, listes: { ...REGLAGES.listes, ...(lus.listes || {}) }, parcs: lus.parcs || {} }
}

// Les réglages d'un parc : les généraux, et ce que le parc règle pour lui.
export function reglagesDuParc(parcId) {
  const r = reglagesGmao()
  const propres = Object.fromEntries(Object.entries(r.parcs?.[parcId] || {}).filter(([cle, v]) => PROPRES_AU_PARC.includes(cle) && v !== '' && v !== null && v !== undefined))
  return { ...r, ...propres, propres }
}

export function enregistrerReglagesGmao(entree) {
  const avant = reglagesGmao()
  const propres = { ...avant }
  for (const cle of TEXTES) if (cle in entree) propres[cle] = String(entree[cle] ?? '').trim()
  for (const cle of NOMBRES) if (cle in entree) propres[cle] = Number(entree[cle]) > 0 ? Number(entree[cle]) : REGLAGES[cle]
  if (entree.unites && typeof entree.unites === 'object') {
    propres.unites = Object.fromEntries(Object.entries(entree.unites).map(([code, u]) => [String(code).trim(), { nom: String(u?.nom || '').trim(), jours: Number(u?.jours) || 0 }]).filter(([code, u]) => code && u.jours > 0))
  }
  if (entree.frequences && typeof entree.frequences === 'object') {
    propres.frequences = Object.fromEntries(Object.entries(entree.frequences).filter(([, v]) => Array.isArray(v) && v[0] !== '' && Number(v[1]) > 0).map(([f, v]) => [f, [String(v[0]), Number(v[1])]]))
  }
  if (entree.listes && typeof entree.listes === 'object') propres.listes = Object.fromEntries(Object.keys(REGLAGES.listes).map((cle) => [cle, String(entree.listes[cle] ?? avant.listes[cle] ?? '').trim()]))
  delete propres.propres
  modifierReglage('mn1_gmao', propres)
  noterModification()
  return reglagesGmao()
}

// Les réglages propres à un parc (vide : on reprend le réglage général).
export function enregistrerReglagesDuParc(parcId, entree) {
  const r = reglagesGmao()
  const propres = {}
  for (const cle of PROPRES_AU_PARC) {
    const v = entree[cle]
    if (v === '' || v === null || v === undefined) continue
    propres[cle] = NOMBRES.includes(cle) ? Number(v) || undefined : String(v).trim()
  }
  const parcs = { ...(r.parcs || {}), [parcId]: Object.fromEntries(Object.entries(propres).filter(([, v]) => v !== undefined)) }
  const { propres: _, ...general } = r
  modifierReglage('mn1_gmao', { ...general, parcs })
  noterModification()
  return reglagesDuParc(parcId)
}

// ---------------------------------------------------------------- ce qui est écrit

const aaaammjj = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
const html = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

// La description (OBSER) : chaque étiquette en gras, puis ses points à vérifier, une ligne chacun.
export function description(fiches) {
  return fiches.map((f) => {
    const points = String(f.action || '').split('\n').flatMap((l) => l.split('☐')).map((x) => x.trim()).filter(Boolean)
    return [`<div><b>${html([f.etiquette, f.zone].filter(Boolean).join(' - ') || f.machine_nom || f.repere || '')}</b></div>`, ...points.map((p) => (/:$/.test(p) ? `<div><u>${html(p)}</u></div>` : `<div>- ${html(p)}</div>`))].join('')
  }).join('')
}

// « FI-MN1-{ligne}-{eth}-{nn} », « P{n}M-MN1-{machine} {repere} » : {n} = les chiffres de la ligne (« L2 » → 2).
export function remplir(modele, valeurs) {
  return String(modele || '').replace(/\{(\w+)\}/g, (_, cle) => (cle === 'n' ? String(valeurs.ligne || '').replace(/\D/g, '') : String(valeurs[cle] ?? ''))).replace(/\s+/g, ' ').trim()
}

// Toutes les valeurs que le SQL du site peut utiliser (paramètres nommés), pour une FI.
export function valeursSql(r, { numero, titre = '', obser = '', parc = '', dateDeb = null, periot = r.periot, valPeriot = r.valPeriot }) {
  const maintenant = new Date()
  const debut = dateDeb && /^\d{4}-\d{2}-\d{2}$/.test(dateDeb) ? new Date(`${dateDeb}T00:00:00`) : maintenant
  const limite = new Date(debut.getTime() + r.delai * 86_400_000)
  return {
    numero, titre, obser, parc: String(parc),
    date_deb: aaaammjj(debut), date_limite: aaaammjj(limite), date_jour: aaaammjj(maintenant), heure: `${String(maintenant.getHours()).padStart(2, '0')}${String(maintenant.getMinutes()).padStart(2, '0')}`,
    modele: r.modele, intervenant: r.intervenant, emetteur: r.emetteur, type: r.type, tps_prevu: r.tpsPrevu, periot, val_periot: valPeriot, delai: r.delai, utilisateur: r.utilisateur,
  }
}

// Le modèle SQL découpé en instructions (« ; » en fin de ligne), les « :nom » remplacés par des « ? ».
export function instructions(sql, valeurs) {
  const morceaux = String(sql).replace(/^\s*--[^\n]*$/gm, '').split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean)
  return morceaux.map((morceau) => {
    const liste = []
    const texte = morceau.replace(/(?<![:\w]):([a-z_]+)\b/g, (_, nom) => {
      if (!(nom in valeurs)) throw new ErreurHttp(400, `Paramètre inconnu dans le SQL de création : :${nom}`)
      liste.push(valeurs[nom] === null || valeurs[nom] === undefined ? null : String(valeurs[nom]))
      return '?'
    })
    return { sql: texte, valeurs: liste }
  })
}

// Simule (valider = false) ou crée la FI. Renvoie les contrôles, le nombre de lignes écrites par instruction,
// et le récapitulatif (le dernier SELECT du modèle).
export async function creerFi({ ids, numero, titre, parc, dateDeb, valider = false }) {
  if (typeof mysql.ecrireDansLaBase !== 'function') throw new ErreurHttp(409, 'Mettez KTEC à jour : cette version ne sait pas écrire dans la GMAO.')
  const r = reglagesGmao()
  const manque = ['sql', 'modele', 'intervenant', 'emetteur', 'type', 'utilisateur'].filter((cle) => !r[cle])
  if (manque.length) throw new ErreurHttp(409, `Réglages de création incomplets (${manque.join(', ')}) : bouton « Création dans la GMAO » du menu Maintenance de niveau 1.`)
  const fiches = (ids || []).map((id) => db().prepare('SELECT f.*, m.repere FROM fiches_mn1 f LEFT JOIN machines m ON m.id = f.machine_id WHERE f.id = ?').get(id)).filter(Boolean)
  if (!fiches.length) throw new ErreurHttp(400, 'Aucune fiche à créer.')
  if (!String(numero || '').trim() || !String(titre || '').trim() || !String(parc || '').trim()) throw new ErreurHttp(400, 'Le numéro, le titre et l’équipement sont obligatoires.')
  const debut = /^\d{4}-\d{2}-\d{2}$/.test(dateDeb || '') ? new Date(`${dateDeb}T00:00:00`) : null
  if (!debut) throw new ErreurHttp(400, 'Date de première échéance invalide.')
  const limite = new Date(debut.getTime() + r.delai * 86_400_000)
  const maintenant = new Date()
  const valeurs = {
    numero: numero.trim(), titre: titre.trim(), obser: description(fiches), parc: String(parc).trim(),
    date_deb: aaaammjj(debut), date_limite: aaaammjj(limite), date_jour: aaaammjj(maintenant), heure: `${String(maintenant.getHours()).padStart(2, '0')}${String(maintenant.getMinutes()).padStart(2, '0')}`,
    modele: r.modele, intervenant: r.intervenant, emetteur: r.emetteur, type: r.type, tps_prevu: r.tpsPrevu, periot: r.periot, val_periot: r.valPeriot, delai: r.delai, utilisateur: r.utilisateur,
  }
  const reponse = await mysql.ecrireDansLaBase(instructions(r.sql, valeurs), { valider })
  const selects = reponse.resultats.filter((x) => x.colonnes)
  // Les lignes écrites par chaque INSERT (les SET en comptent 0) ; créée si le premier INSERT, l'en-tête de la
  // FI, a écrit une ligne.
  const ecritures = reponse.resultats.filter((x) => 'modifiees' in x).map((x) => x.modifiees)
  const insertions = instructions(r.sql, valeurs).filter((i) => /^\s*insert/i.test(i.sql)).length
  const parInsertion = ecritures.slice(-insertions)
  const creee = insertions > 0 && parInsertion[0] > 0
  const tableau = (x) => (x ? x.lignes.map((l) => Object.fromEntries(x.colonnes.map((c, i) => [c, l[i]]))) : [])
  if (valider && creee) {
    db().prepare(`UPDATE fiches_mn1 SET fi_gmao = ?, modifie_le = ? WHERE id IN (${fiches.map(() => '?').join(',')})`).run(valeurs.numero, maintenant.toISOString(), ...fiches.map((f) => f.id))
    noterModification()
  }
  return {
    valide: reponse.valide,
    creee: Boolean(creee),
    controles: tableau(selects[0])[0] || null,
    recapitulatif: tableau(selects.at(-1)),
    ecritures: parInsertion,
    valeurs: { numero: valeurs.numero, titre: valeurs.titre, parc: valeurs.parc, date_deb: valeurs.date_deb, date_limite: valeurs.date_limite, obser: valeurs.obser },
  }
}

export { equipementsDeLaLigne }
