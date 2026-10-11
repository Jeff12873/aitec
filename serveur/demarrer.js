// Point de départ d'IASSITEC (lancé par « Lancer IASSITEC.bat » ou « lancer-iassitec.sh »).
//
// 1. si IASSITEC tourne déjà pour cet agent, on ouvre simplement le navigateur ;
// 2. sinon : on rouvre le dernier fichier .datassitec, on charge les blocs, on démarre le serveur web ;
// 3. on ouvre le navigateur sur http://127.0.0.1:<port>.
//
// Option : --sans-navigateur (pour les essais).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { creerRoutes, demarrerServeur } from './socle/http.js'
import { ouvrirDernierFichier, etatPartage, quitterAdmin } from './socle/partage.js'
import { reglage } from './socle/base.js'
import { arreterIA } from './socle/ia.js'
import { mettreAJourIconeLocale } from './socle/icone.js'
import { RACINE, WINDOWS, chemins, version, journal, lireJson, ecrireJson } from './socle/installation.js'

const PREMIER_PORT = 47800
const fichierServeur = path.join(chemins.cache, 'serveur.json')
// Identifie cette installation : sur un poste partagé, un autre agent peut avoir son propre IASSITEC.
const identifiant = crypto.createHash('sha256').update(RACINE).digest('hex').slice(0, 16)
const sansNavigateur = process.argv.includes('--sans-navigateur')

// ---- 1. déjà lancé ?
const precedent = lireJson(fichierServeur, null)
if (precedent && (await repond(precedent.port))) {
  console.log('IASSITEC est déjà lancé : ouverture du navigateur.')
  if (!sansNavigateur) ouvrirNavigateur(`http://127.0.0.1:${precedent.port}`)
  process.exit(0)
}

// ---- 2. démarrage
journal(`Démarrage d'IASSITEC ${version()} (${RACINE})`)
ouvrirDernierFichier()
if (etatPartage().ouvert) mettreAJourIconeLocale(reglage('icone'), reglage('icone_type'))

const routes = creerRoutes()
routes.get('/api/ping', () => ({ identifiant }))
for (const nom of fs.readdirSync(chemins.blocs).sort()) {
  const fichier = path.join(chemins.blocs, nom, 'serveur.js')
  if (!fs.existsSync(fichier)) continue
  const bloc = await import(pathToFileURL(fichier).href)
  bloc.routes(routes)
}

const port = await demarrerSurUnPortLibre()
ecrireJson(fichierServeur, { port, pid: process.pid })
const adresse = `http://127.0.0.1:${port}`
journal(`IASSITEC prêt : ${adresse}`)
console.log(`\n  IASSITEC est ouvert dans votre navigateur : ${adresse}\n  Fermer cette fenêtre arrête IASSITEC.\n`)
if (!sansNavigateur) ouvrirNavigateur(adresse)

// ---- arrêt propre : on rend le verrou administrateur et on arrête l'IA
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    quitterAdmin()
    arreterIA()
    process.exit(0)
  })
}

// ---------------------------------------------------------------- outils

async function demarrerSurUnPortLibre() {
  for (let p = PREMIER_PORT; p < PREMIER_PORT + 100; p++) {
    try {
      await demarrerServeur(routes, p)
      return p
    } catch (erreur) {
      if (erreur.code !== 'EADDRINUSE') throw erreur
    }
  }
  throw new Error('Aucun port libre entre 47800 et 47899')
}

async function repond(port) {
  try {
    const reponse = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) })
    return (await reponse.json()).identifiant === identifiant
  } catch {
    return false
  }
}

function ouvrirNavigateur(adresse) {
  const [commande, args] = WINDOWS ? ['cmd', ['/c', 'start', '', adresse]] : ['xdg-open', [adresse]]
  try {
    spawn(commande, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    console.log(`Ouvrez ce lien dans votre navigateur : ${adresse}`)
  }
}
