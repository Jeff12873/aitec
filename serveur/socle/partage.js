// Le fichier .datassitec partagé, ouvert par plusieurs postes à la fois.
//
// Principe (détails dans docs/FICHIER-PARTAGE.md) :
//
//   lecteur réseau                       ce poste
//   atelier.datassitec  ── copie ──►  cache/base.datassitec  ◄── IASSITEC lit ici
//          ▲                                    │
//          └──────── publication ───────────────┘   (seulement en mode administrateur)
//
// - En consultation, on lit la copie locale et on la remplace dès que le fichier partagé change.
// - Pour modifier, il faut le verrou : un petit fichier « atelier.datassitec.verrou » posé à côté,
//   qui dit qui modifie et depuis quand. Un seul administrateur à la fois.
// - Chaque modification est publiée quelques secondes plus tard : la copie locale est envoyée
//   sous un nom temporaire puis renommée d'un coup, pour qu'aucun poste ne lise un fichier à moitié écrit.
// - Une sauvegarde du fichier est faite à chaque prise du verrou (5 gardées, dans IASSITEC-sauvegardes).

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { ouvrirBase, fermerBase, reglage, modifierReglage, baseOuverte } from './base.js'
import { RACINE, chemins, reglagesPoste, modifierReglagesPoste, journal } from './installation.js'
import { hacherMotDePasse, nouveauJeton } from './securite.js'

const DELAI_PUBLICATION = 3_000          // on regroupe les modifications rapprochées
const VERROU_ABANDONNE = 10 * 60_000     // verrou non rafraîchi depuis 10 min = poste planté
const ADMIN_INACTIF = 30 * 60_000        // on rend le verrou après 30 min sans modification
const SAUVEGARDES_GARDEES = 5

const etat = {
  fichier: null,         // chemin du .datassitec partagé
  signature: null,       // taille et date du fichier partagé lors de la dernière copie
  copieDu: null,         // date de cette copie
  version: 0,            // augmente quand le contenu change : l'interface se recharge
  admin: null,           // { nom, jeton, depuis, derniereAction } quand CE poste a le verrou
  aPublier: false,
  publication: { derniere: null, erreur: null },
  avertissement: null,
}

// Identifie cette installation (poste + dossier) : sur un même poste, chaque agent a la sienne.
const IDENTIFIANT_INSTALLATION = crypto.createHash('sha256').update(os.hostname() + RACINE).digest('hex').slice(0, 16)

const copieLocale = () => path.join(chemins.cache, 'base.datassitec')
const cheminVerrou = () => etat.fichier + '.verrou'

// ---------------------------------------------------------------- ouverture

export function ouvrirFichier(fichier) {
  fichier = path.resolve(fichier)
  if (!fs.existsSync(fichier)) throw Object.assign(new Error(`Fichier introuvable : ${fichier}`), { statut: 404 })
  if (etat.admin) quitterAdmin()

  etat.fichier = fichier
  etat.signature = null
  copierDepuisLePartage()
  if (!reglage('format')) {
    fermerBase()
    etat.fichier = null
    throw Object.assign(new Error("Ce fichier n'est pas un fichier IASSITEC."), { statut: 400 })
  }
  modifierReglagesPoste({ fichier })
  journal(`Fichier ouvert : ${fichier}`)
}

// Au démarrage : on rouvre le dernier fichier. S'il est inaccessible (réseau coupé),
// on travaille sur la dernière copie locale, en consultation seulement.
export function ouvrirDernierFichier() {
  const { fichier } = reglagesPoste()
  if (!fichier) return
  try {
    ouvrirFichier(fichier)
  } catch (erreur) {
    journal(`Impossible d'ouvrir ${fichier} : ${erreur.message}`)
    if (fs.existsSync(copieLocale())) {
      etat.fichier = fichier
      ouvrirBase(copieLocale(), { lectureSeule: true })
      etat.copieDu = fs.statSync(copieLocale()).mtime.toISOString()
      etat.avertissement = 'Le fichier partagé est inaccessible : vous consultez la dernière copie enregistrée sur ce poste.'
    }
  }
}

export function creerFichier(fichier, { nomAtelier, motDePasse, nom }) {
  fichier = path.resolve(fichier.endsWith('.datassitec') ? fichier : fichier + '.datassitec')
  if (fs.existsSync(fichier)) throw Object.assign(new Error('Un fichier porte déjà ce nom.'), { statut: 409 })
  if (!motDePasse || motDePasse.length < 4) throw Object.assign(new Error('Mot de passe trop court (4 caractères au moins).'), { statut: 400 })

  // On prépare la base dans le cache, puis on l'envoie sur le partage.
  fs.mkdirSync(chemins.cache, { recursive: true })
  const nouveau = path.join(chemins.cache, 'nouveau.datassitec')
  fs.rmSync(nouveau, { force: true })
  ouvrirBase(nouveau, { lectureSeule: false })
  modifierReglage('nom_atelier', nomAtelier || 'Atelier')
  modifierReglage('mot_de_passe', hacherMotDePasse(motDePasse))
  modifierReglage('cree_le', new Date().toISOString())
  modifierReglage('cree_par', nom || '')
  fermerBase()

  fs.mkdirSync(path.dirname(fichier), { recursive: true })
  fs.copyFileSync(nouveau, fichier)
  fs.rmSync(nouveau, { force: true })
  ouvrirFichier(fichier)
  return fichier
}

// Copie le fichier partagé dans le cache si il a changé. Renvoie true s'il a été recopié.
function copierDepuisLePartage() {
  const infos = fs.statSync(etat.fichier)
  const signature = `${infos.size}-${infos.mtimeMs}`
  if (signature === etat.signature && baseOuverte()) return false

  fs.mkdirSync(chemins.cache, { recursive: true })
  const temporaire = copieLocale() + '.copie'
  fs.copyFileSync(etat.fichier, temporaire)
  fermerBase()
  fs.renameSync(temporaire, copieLocale())
  ouvrirBase(copieLocale(), { lectureSeule: !etat.admin })

  etat.signature = signature
  etat.copieDu = new Date().toISOString()
  etat.version++
  etat.avertissement = null
  return true
}

// Toutes les 10 secondes : en consultation, on suit les changements faits par l'administrateur.
setInterval(() => {
  if (!etat.fichier || etat.admin) return
  try {
    if (copierDepuisLePartage()) journal('Nouvelle version du fichier partagé chargée')
  } catch (erreur) {
    etat.avertissement = 'Le fichier partagé est inaccessible : vous consultez la dernière copie enregistrée sur ce poste.'
  }
}, 10_000).unref()

// ---------------------------------------------------------------- verrou administrateur

export function lireVerrou() {
  if (!etat.fichier) return null
  try {
    return JSON.parse(fs.readFileSync(cheminVerrou(), 'utf8'))
  } catch {
    return null
  }
}

function ecrireVerrou(verrou, { exclusif = false } = {}) {
  fs.writeFileSync(cheminVerrou(), JSON.stringify(verrou), { flag: exclusif ? 'wx' : 'w' })
}

// Prend le verrou. Renvoie { occupe: verrou } si quelqu'un d'autre modifie déjà.
export function entrerAdmin(nom, { forcer = false } = {}) {
  if (!etat.fichier) throw Object.assign(new Error('Aucun fichier ouvert'), { statut: 409 })
  if (etat.admin) return { ok: true }

  const existant = lireVerrou()
  const abandonne = existant && Date.now() - existant.vu > VERROU_ABANDONNE
  // Verrou laissé par cette même installation (IASSITEC fermé brutalement) : on le reprend.
  const leNotre = existant && existant.installation === IDENTIFIANT_INSTALLATION
  if (existant && !abandonne && !leNotre && !forcer) return { occupe: publicDuVerrou(existant) }

  const verrou = { nom, poste: os.hostname(), installation: IDENTIFIANT_INSTALLATION, jeton: nouveauJeton(), depuis: Date.now(), vu: Date.now() }
  try {
    // Création « exclusive » : si deux postes essaient au même instant, un seul réussit.
    ecrireVerrou(verrou, { exclusif: !existant })
  } catch (erreur) {
    if (erreur.code === 'EEXIST') return { occupe: publicDuVerrou(lireVerrou()) }
    throw erreur
  }

  // « jeton » identifie le verrou (il est lisible sur le partage) ; « cookie » ne quitte jamais ce poste.
  etat.admin = { nom, jeton: verrou.jeton, cookie: nouveauJeton(), depuis: verrou.depuis, derniereAction: Date.now() }
  try {
    etat.signature = null
    copierDepuisLePartage() // on repart de la toute dernière version, cette fois en écriture
    sauvegarder()
  } catch (erreur) {
    quitterAdmin()
    throw erreur
  }
  journal(`Mode administrateur : ${nom}`)
  return { ok: true }
}

export function quitterAdmin() {
  if (!etat.admin) return
  try {
    if (etat.aPublier) publier()
  } catch (erreur) {
    journal(`Publication impossible en quittant le mode administrateur : ${erreur.message}`)
  }
  const verrou = lireVerrou()
  if (verrou?.jeton === etat.admin.jeton) fs.rmSync(cheminVerrou(), { force: true })
  journal(`Fin du mode administrateur : ${etat.admin.nom}`)
  etat.admin = null
  // On rouvre la base en lecture seule.
  try {
    etat.signature = null
    copierDepuisLePartage()
  } catch {
    ouvrirBase(copieLocale(), { lectureSeule: true })
  }
}

export function estAdmin(cookie) {
  return Boolean(etat.admin && cookie && etat.admin.cookie === cookie)
}

export function cookieAdmin() {
  return etat.admin?.cookie
}

// Ce qu'on peut montrer d'un verrou à un autre poste.
function publicDuVerrou(verrou) {
  return verrou ? { nom: verrou.nom, poste: verrou.poste, depuis: verrou.depuis } : null
}

// Toutes les minutes : on signale qu'on est toujours là, on vérifie que personne n'a forcé
// le verrou, et on rend la main après une longue inactivité.
setInterval(() => {
  if (!etat.admin) return
  const verrou = lireVerrou()
  if (verrou?.jeton !== etat.admin.jeton) {
    journal('Verrou repris par un autre poste')
    avertirUnMoment(`${verrou?.nom || 'Un autre poste'} a repris la main : vous repassez en consultation.`)
    etat.admin = null
    etat.aPublier = false
    etat.signature = null
    try { copierDepuisLePartage() } catch { /* réseau coupé : on garde la copie */ }
    return
  }
  if (Date.now() - etat.admin.derniereAction > ADMIN_INACTIF) {
    quitterAdmin()
    avertirUnMoment('Mode administrateur fermé après 30 minutes sans modification.')
    return
  }
  ecrireVerrou({ ...verrou, vu: Date.now() })
}, 60_000).unref()

// ---------------------------------------------------------------- publication

let minuterie = null

// À appeler après chaque écriture dans la base.
let premiereModification = 0

export function noterModification() {
  if (!etat.admin) throw Object.assign(new Error('Modification refusée : passez en mode administrateur.'), { statut: 403 })
  etat.admin.derniereAction = Date.now()
  if (!etat.aPublier) premiereModification = Date.now()
  etat.aPublier = true
  clearTimeout(minuterie)
  // On attend que les modifications se calment, mais jamais plus de 30 secondes
  // (pendant un long calcul de l'index, par exemple).
  const attente = Date.now() - premiereModification > 30_000 ? 0 : DELAI_PUBLICATION
  minuterie = setTimeout(publierPlusTard, attente)
}

export function noterActiviteAdmin() {
  if (etat.admin) etat.admin.derniereAction = Date.now()
}

function publierPlusTard() {
  try {
    publier()
  } catch (erreur) {
    etat.publication.erreur = erreur.message
    journal(`Publication impossible : ${erreur.message} (nouvel essai dans 30 s)`)
    minuterie = setTimeout(publierPlusTard, 30_000)
  }
}

function publier() {
  if (!etat.admin || !etat.aPublier) return
  if (lireVerrou()?.jeton !== etat.admin.jeton) throw new Error('le verrou ne nous appartient plus')

  const envoi = `${etat.fichier}.envoi-${os.hostname()}`
  fs.copyFileSync(copieLocale(), envoi)
  remplacer(envoi, etat.fichier)

  const infos = fs.statSync(etat.fichier)
  etat.signature = `${infos.size}-${infos.mtimeMs}`
  etat.aPublier = false
  etat.publication = { derniere: new Date().toISOString(), erreur: null }
}

// Sous Windows, le renommage échoue si un autre poste est en train de copier le fichier :
// on réessaie quelques fois.
function remplacer(source, destination) {
  for (let essai = 1; ; essai++) {
    try {
      fs.renameSync(source, destination)
      return
    } catch (erreur) {
      if (essai >= 10) {
        fs.rmSync(source, { force: true })
        throw erreur
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300) // pause de 300 ms
    }
  }
}

// ---------------------------------------------------------------- sauvegardes

function sauvegarder() {
  const dossier = path.join(path.dirname(etat.fichier), 'IASSITEC-sauvegardes')
  const base = path.basename(etat.fichier, '.datassitec')
  fs.mkdirSync(dossier, { recursive: true })

  const existantes = listerSauvegardes()
  // Pas plus d'une sauvegarde par heure.
  if (existantes[0] && Date.now() - existantes[0].date < 3_600_000) return

  const horodatage = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
  fs.copyFileSync(etat.fichier, path.join(dossier, `${base}-${horodatage}.datassitec`))
  for (const ancienne of listerSauvegardes().slice(SAUVEGARDES_GARDEES)) fs.rmSync(ancienne.chemin, { force: true })
}

export function listerSauvegardes() {
  if (!etat.fichier) return []
  const dossier = path.join(path.dirname(etat.fichier), 'IASSITEC-sauvegardes')
  const base = path.basename(etat.fichier, '.datassitec')
  if (!fs.existsSync(dossier)) return []
  return fs
    .readdirSync(dossier)
    .filter((nom) => nom.startsWith(base + '-') && nom.endsWith('.datassitec'))
    .map((nom) => {
      const chemin = path.join(dossier, nom)
      return { nom, chemin, date: fs.statSync(chemin).mtimeMs, taille: fs.statSync(chemin).size }
    })
    .sort((a, b) => b.date - a.date)
}

// ---------------------------------------------------------------- état pour l'interface

export function etatPartage() {
  const verrou = lireVerrou()
  const autreAdmin = verrou && verrou.jeton !== etat.admin?.jeton && verrou.installation !== IDENTIFIANT_INSTALLATION && Date.now() - verrou.vu < VERROU_ABANDONNE ? { nom: verrou.nom, poste: verrou.poste, depuis: verrou.depuis } : null
  return {
    fichier: etat.fichier,
    nomFichier: etat.fichier ? path.basename(etat.fichier) : null,
    ouvert: baseOuverte(),
    version: etat.version,
    copieDu: etat.copieDu,
    admin: etat.admin ? { nom: etat.admin.nom, depuis: etat.admin.depuis } : null,
    autreAdmin,
    aPublier: etat.aPublier,
    publication: etat.publication,
    avertissement: etat.avertissement,
  }
}

// Avertissement affiché 2 minutes seulement (les problèmes de réseau, eux, restent affichés).
function avertirUnMoment(message) {
  etat.avertissement = message
  setTimeout(() => {
    if (etat.avertissement === message) etat.avertissement = null
  }, 120_000).unref()
}

// Pour signaler un changement fait sans passer par noterModification (ex. index de recherche).
export function changerVersion() {
  etat.version++
}
