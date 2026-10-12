// Fabrique la version hors ligne d'IASSITEC : un dossier qui contient tout (programme, Node, llama.cpp,
// modèles d'IA), à copier sur une clé USB ou un partage pour installer des postes sans Internet.
// La version en ligne (IASSITEC.zip sur GitHub, qui télécharge au moment de la préparation) ne change pas.
//
// À lancer sur un PC connecté à Internet, depuis le dossier d'IASSITEC :
//     node outils/fabriquer-kit-hors-ligne.js
//
// Options :
//   --modeles petit,moyen      modèles à inclure (petit, moyen par défaut ; ajouter « grand » pour le lourd, +23,5 Go)
//   --systeme windows|linux    système des postes à installer (windows par défaut)
//   --dossier <dossier>        où créer le kit (par défaut : IASSITEC-hors-ligne-<système>, à côté d'IASSITEC)
//
// Les fichiers déjà téléchargés sur ce PC (modèles de la préparation) sont repris, sans nouveau téléchargement.
// Sur le poste : copier le dossier, puis lancer « Preparer IASSITEC.bat » (ou preparer-iassitec.sh).

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { RACINE, installation, dossierModelesParDefaut, version } from '../serveur/socle/installation.js'
import { telecharger, tailleLisible } from '../serveur/socle/telechargement.js'
import { telechargerDepuisHuggingFace, lireCatalogue } from '../serveur/socle/modeles.js'
import { decompresser } from '../serveur/socle/zip.js'

const options = lireOptions(process.argv.slice(2))
const catalogue = lireCatalogue()
const nodeVersion = fs.readFileSync(path.join(RACINE, 'Preparer IASSITEC.bat'), 'utf8').match(/NODE_VERSION=(v[\d.]+)/)[1]
const sortie = path.resolve(options.dossier || path.join(RACINE, '..', `IASSITEC-hors-ligne-${options.systeme}`))
const kit = path.join(sortie, 'hors-ligne')
const temporaire = path.join(sortie, 'temporaire') // dans le kit : même disque, pour pouvoir déplacer les fichiers

main().catch((erreur) => {
  console.error('\n✗ ' + erreur.message)
  console.error('Le kit n’est pas terminé. Relancez la commande : les fichiers déjà prêts ne sont pas refaits.')
  process.exitCode = 1
})

async function main() {
  const modeles = options.modeles.map((code) => catalogue.modeles.find((m) => m.code === code) || erreur(`Modèle inconnu : ${code}`))
  const total = modeles.reduce((s, m) => s + m.taille_go, 0) + 0.7
  console.log(`\nKit hors ligne d'IASSITEC pour ${options.systeme}`)
  console.log(`  Dossier : ${sortie}`)
  console.log(`  Modèles : ${modeles.map((m) => m.nom).join(', ')} (environ ${total.toFixed(1).replace('.', ',')} Go en tout)\n`)
  fs.mkdirSync(kit, { recursive: true })
  fs.mkdirSync(temporaire, { recursive: true })

  // 1. Le programme ---------------------------------------------------------------
  console.log('[1/4] Programme')
  for (const nom of ['serveur', 'blocs', 'interface', 'outils', 'docs', 'VERSION', 'package.json', 'README.md', 'Lancer IASSITEC.bat', 'Preparer IASSITEC.bat', 'lancer-iassitec.sh', 'preparer-iassitec.sh']) {
    fs.rmSync(path.join(sortie, nom), { recursive: true, force: true })
    fs.cpSync(path.join(RACINE, nom), path.join(sortie, nom), { recursive: true })
  }
  if (options.systeme === 'linux') for (const sh of ['lancer-iassitec.sh', 'preparer-iassitec.sh']) fs.chmodSync(path.join(sortie, sh), 0o755)

  // 2. Node -----------------------------------------------------------------------
  console.log(`[2/4] Node ${nodeVersion}`)
  if (!fs.existsSync(path.join(kit, 'node'))) {
    const nom = options.systeme === 'windows' ? `node-${nodeVersion}-win-x64` : `node-${nodeVersion}-linux-x64`
    const archive = path.join(temporaire, options.systeme === 'windows' ? `${nom}.zip` : `${nom}.tar.xz`)
    await telecharger(`https://nodejs.org/dist/${nodeVersion}/${path.basename(archive)}`, archive, { surProgression: progression(path.basename(archive)) })
    finProgression()
    if (options.systeme === 'windows') decompresser(fs.readFileSync(archive), temporaire)
    else execFileSync('tar', ['-xJf', archive, '-C', temporaire])
    fs.renameSync(path.join(temporaire, nom), path.join(kit, 'node'))
  }

  // 3. llama.cpp, versions carte graphique (Vulkan) et processeur --------------------------
  console.log(`[3/4] Moteur d'IA llama.cpp ${catalogue.llama}`)
  for (const variante of ['vulkan', 'cpu']) {
    const cible = path.join(kit, `llama-${variante}`)
    if (fs.existsSync(path.join(cible, catalogue.llama))) continue
    const nomArchive =
      options.systeme === 'windows'
        ? `llama-${catalogue.llama}-bin-win-${variante}-x64.zip`
        : `llama-${catalogue.llama}-bin-ubuntu-${variante === 'cpu' ? '' : variante + '-'}x64.tar.gz`
    const archive = path.join(temporaire, nomArchive)
    await telecharger(`https://github.com/ggml-org/llama.cpp/releases/download/${catalogue.llama}/${nomArchive}`, archive, { surProgression: progression(nomArchive) })
    finProgression()
    fs.rmSync(cible, { recursive: true, force: true })
    fs.mkdirSync(cible, { recursive: true })
    if (options.systeme === 'windows') decompresser(fs.readFileSync(archive), cible)
    else execFileSync('tar', ['-xzf', archive, '-C', cible])
    fs.writeFileSync(path.join(cible, catalogue.llama), '')
  }

  // 4. Modèles d'IA ---------------------------------------------------------------
  console.log('[4/4] Modèles d’IA')
  const dossierModeles = path.join(kit, 'modeles')
  fs.mkdirSync(dossierModeles, { recursive: true })
  const fichiers = [
    ...modeles.flatMap((m) => [
      { depot: m.depot, fichier: m.fichier, local: m.local },
      { depot: m.depot, fichier: m.vision, local: m.vision_local },
    ]),
    { depot: catalogue.recherche.depot, fichier: catalogue.recherche.fichier, local: catalogue.recherche.local },
  ]
  const dejaSurCePC = installation()?.dossierModeles || dossierModelesParDefaut()
  for (const f of fichiers) {
    const destination = path.join(dossierModeles, f.local)
    const existant = path.join(dejaSurCePC, f.local)
    if (!fs.existsSync(destination) && fs.existsSync(existant)) {
      console.log(`  ${f.local} : copié depuis ce PC`)
      fs.copyFileSync(existant, destination)
    }
    // Vérifie (taille et empreinte) le fichier copié, ou le télécharge.
    await telechargerDepuisHuggingFace(f.depot, f.fichier, destination, progression(f.local))
    finProgression()
    console.log(`  ${f.local} : prêt (${tailleLisible(fs.statSync(destination).size)})`)
  }

  fs.writeFileSync(
    path.join(kit, 'kit.json'),
    JSON.stringify({ systeme: options.systeme, version: version(), llama: catalogue.llama, node: nodeVersion, modeles: modeles.map((m) => m.code), creeLe: new Date().toISOString() }, null, 2) + '\n',
  )
  fs.writeFileSync(path.join(sortie, 'LISEZ-MOI (hors ligne).txt'), lisezMoi(modeles), options.systeme === 'windows' ? { encoding: 'utf8' } : undefined)
  fs.rmSync(temporaire, { recursive: true, force: true })
  console.log(`\nKit prêt : ${sortie}\nCopiez ce dossier entier (clé USB, partage) puis, sur le poste, lancez ${options.systeme === 'windows' ? '« Preparer IASSITEC.bat »' : 'preparer-iassitec.sh'}.\n`)
}

function lisezMoi(modeles) {
  const texte = `IASSITEC — version hors ligne (${options.systeme === 'windows' ? 'Windows' : 'Linux'})
=================================================

Ce dossier contient tout ce qu'il faut pour installer IASSITEC sur un poste SANS connexion à Internet :
le programme, Node, le moteur d'IA llama.cpp et les modèles suivants :
${modeles.map((m) => `  - ${m.nom}`).join('\n')}

Installation sur un poste :
  1. Copier ce dossier entier sur le poste (ou le laisser sur la clé USB / le partage).
  2. ${options.systeme === 'windows' ? 'Double-cliquer sur « Preparer IASSITEC.bat ».' : 'Lancer : sh preparer-iassitec.sh'}
     IASSITEC est installé dans le profil de l'utilisateur, les modèles copiés, puis l'IA est essayée.
  3. Lancer IASSITEC avec le raccourci créé sur le Bureau.

Ensuite, le poste n'a plus besoin de ce dossier.

Mises à jour : la version hors ligne ne se met pas à jour toute seule. Fabriquer un nouveau kit
(node outils/fabriquer-kit-hors-ligne.js sur un PC connecté) et relancer la préparation sur le poste :
le fichier de l'atelier et les réglages sont gardés.

Version d'IASSITEC : ${version()} — fabriqué le ${new Date().toLocaleDateString('fr-FR')}
`
  return options.systeme === 'windows' ? texte.replace(/\n/g, '\r\n') : texte
}

function lireOptions(args) {
  const options = { modeles: ['petit', 'moyen'], systeme: 'windows', dossier: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--modeles') options.modeles = args[++i].split(',').map((c) => c.trim()).filter(Boolean)
    else if (args[i] === '--systeme') options.systeme = args[++i]
    else if (args[i] === '--dossier') options.dossier = args[++i]
  }
  if (!['windows', 'linux'].includes(options.systeme)) erreur('--systeme : windows ou linux')
  return options
}

function erreur(message) {
  throw new Error(message)
}

let derniere = 0
function progression(nom) {
  return (recu, total) => {
    if (Date.now() - derniere < 500 && recu < total) return
    derniere = Date.now()
    process.stdout.write(`\r  ${nom} : ${tailleLisible(recu)} / ${tailleLisible(total)} (${total ? Math.floor((recu / total) * 100) : 0} %)      `)
  }
}

function finProgression() {
  process.stdout.write('\r' + ' '.repeat(90) + '\r')
}
