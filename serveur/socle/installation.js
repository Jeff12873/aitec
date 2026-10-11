// Où se trouvent les choses sur ce poste.
//
// IASSITEC tourne depuis le dossier où il est installé (le profil de l'utilisateur) :
//   installation.json    → écrit par la préparation : moteur d'IA, modèles, carte graphique
//   reglages-poste.json  → réglages de cet agent : fichier .datassitec ouvert, son nom…
//   cache/               → copie locale du fichier .datassitec
//   moteur/              → Node et llama.cpp

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const WINDOWS = process.platform === 'win32'

export const chemins = {
  installation: path.join(RACINE, 'installation.json'),
  reglagesPoste: path.join(RACINE, 'reglages-poste.json'),
  cache: path.join(RACINE, 'cache'),
  interface: path.join(RACINE, 'interface'),
  blocs: path.join(RACINE, 'blocs'),
  journal: path.join(RACINE, 'journal.txt'),
}

export function version() {
  try {
    return fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim()
  } catch {
    return 'développement'
  }
}

// Dossier d'installation par défaut, dans le profil de l'utilisateur
// (les programmes ne peuvent pas être lancés ailleurs sur les postes verrouillés).
export function dossierInstallationParDefaut() {
  if (WINDOWS) {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(local, 'IASSITEC')
  }
  const donnees = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(donnees, 'iassitec')
}

// Les modèles sont de simples fichiers de données : sous Windows, on les range dans
// un dossier commun du poste pour ne pas les télécharger une fois par agent.
export function dossierModelesParDefaut() {
  if (WINDOWS) {
    const public_ = process.env.PUBLIC || 'C:\\Users\\Public'
    return path.join(public_, 'IASSITEC', 'modeles')
  }
  return path.join(dossierInstallationParDefaut(), 'modeles')
}

export function lireJson(fichier, defaut) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'))
  } catch {
    return defaut
  }
}

export function ecrireJson(fichier, donnees) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true })
  fs.writeFileSync(fichier, JSON.stringify(donnees, null, 2) + '\n')
}

// installation.json : null si la préparation n'a pas encore été faite (l'IA est alors absente).
export function installation() {
  return lireJson(chemins.installation, null)
}

const REGLAGES_DEFAUT = {
  fichier: '',          // chemin du fichier .datassitec ouvert
  nomAgent: '',         // nom proposé pour le mode administrateur
  arretIAMinutes: 20,   // l'IA libère la mémoire après ce délai sans question
}

export function reglagesPoste() {
  return { ...REGLAGES_DEFAUT, ...lireJson(chemins.reglagesPoste, {}) }
}

export function modifierReglagesPoste(changements) {
  const reglages = { ...reglagesPoste(), ...changements }
  ecrireJson(chemins.reglagesPoste, reglages)
  return reglages
}

// Petit journal pour comprendre un problème après coup (journal.txt, 200 Ko au plus).
export function journal(...morceaux) {
  const ligne = `${new Date().toISOString()}  ${morceaux.join(' ')}\n`
  process.stdout.write(ligne)
  try {
    if (fs.existsSync(chemins.journal) && fs.statSync(chemins.journal).size > 200_000) {
      fs.renameSync(chemins.journal, chemins.journal + '.ancien')
    }
    fs.appendFileSync(chemins.journal, ligne)
  } catch {
    // le journal ne doit jamais empêcher l'application de fonctionner
  }
}
