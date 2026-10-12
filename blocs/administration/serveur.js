// Administration : icône, mot de passe, nom de l'atelier, index de recherche, sauvegardes,
// réglages du poste et mises à jour d'IASSITEC.

import fs from 'node:fs'
import path from 'node:path'
import { db, reglage, modifierReglage } from '../../serveur/socle/base.js'
import { ErreurHttp, envoyerOctets } from '../../serveur/socle/http.js'
import { arreterIA } from '../../serveur/socle/ia.js'
import { mettreAJourIconeLocale } from '../../serveur/socle/icone.js'
import { RACINE, chemins, installation, version, modifierReglagesPoste, journal } from '../../serveur/socle/installation.js'
import { hacherMotDePasse, verifierMotDePasse } from '../../serveur/socle/securite.js'
import { etatPartage, noterModification, listerSauvegardes, quitterAdmin } from '../../serveur/socle/partage.js'
import { telecharger } from '../../serveur/socle/telechargement.js'
import { decompresser } from '../../serveur/socle/zip.js'
import { relancerIndexeur } from '../recherche/indexeur.js'
import { etatModeles, utiliserModele } from '../../serveur/socle/modeles.js'
import { glossaire, GLOSSAIRE_PAR_DEFAUT } from '../../serveur/socle/glossaire.js'

const DEPOT_GITHUB = 'Jeff12873/iassitec'
const TYPES_ICONE = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']

export function routes(r) {
  // ---- icône (visible par tous)

  r.get('/api/icone', (ctx) => {
    const type = etatPartage().ouvert ? reglage('icone_type') : null
    if (type) return envoyerOctets(ctx.res, Buffer.from(reglage('icone')), { type })
    envoyerOctets(ctx.res, fs.readFileSync(path.join(chemins.interface, 'icone.svg')), { type: 'image/svg+xml' })
  })

  r.post('/api/admin/icone', async (ctx) => {
    ctx.exigerAdmin()
    const type = ctx.req.headers['content-type']
    if (!TYPES_ICONE.includes(type)) throw new ErreurHttp(400, 'Format accepté : PNG (conseillé, 512 × 512 px), SVG, JPEG ou WebP.')
    const octets = await ctx.octets()
    if (octets.length > 2 * 1024 * 1024) throw new ErreurHttp(413, 'Icône trop lourde (2 Mo au plus).')
    modifierReglage('icone', octets)
    modifierReglage('icone_type', type)
    noterModification()
    mettreAJourIconeLocale(octets, type)
  })

  r.delete('/api/admin/icone', (ctx) => {
    ctx.exigerAdmin()
    db().prepare("DELETE FROM reglages WHERE cle IN ('icone', 'icone_type')").run()
    noterModification()
    mettreAJourIconeLocale(null)
  })

  // ---- réglages communs (enregistrés dans le fichier)

  r.post('/api/admin/atelier', async (ctx) => {
    ctx.exigerAdmin()
    const { nom } = await ctx.json()
    if (!nom?.trim()) throw new ErreurHttp(400, "Donnez un nom à l'atelier.")
    modifierReglage('nom_atelier', nom.trim())
    noterModification()
  })

  r.post('/api/admin/mot-de-passe', async (ctx) => {
    ctx.exigerAdmin()
    const { actuel, nouveau } = await ctx.json()
    if (!verifierMotDePasse(actuel || '', reglage('mot_de_passe'))) throw new ErreurHttp(401, 'Mot de passe actuel incorrect.')
    if (!nouveau || nouveau.length < 4) throw new ErreurHttp(400, 'Nouveau mot de passe trop court (4 caractères au moins).')
    modifierReglage('mot_de_passe', hacherMotDePasse(nouveau))
    noterModification()
  })

  // Recalcule tous les vecteurs (après un changement de modèle de recherche, par exemple).
  r.post('/api/admin/reindexer', (ctx) => {
    ctx.exigerAdmin()
    db().exec('UPDATE passages SET vecteur = NULL')
    noterModification()
    relancerIndexeur()
  })

  r.get('/api/admin/infos', () => {
    const config = installation()
    const statistiques = etatPartage().ouvert
      ? db().prepare("SELECT (SELECT count(*) FROM passages) AS passages, (SELECT coalesce(sum(taille), 0) FROM documents) AS octetsDocuments").get()
      : null
    return {
      version: version(),
      dossierInstallation: RACINE,
      installation: config,
      fichier: etatPartage().fichier,
      tailleFichier: etatPartage().fichier && fs.existsSync(etatPartage().fichier) ? fs.statSync(etatPartage().fichier).size : null,
      statistiques,
      sauvegardes: listerSauvegardes().map(({ nom, date, taille }) => ({ nom, date, taille })),
    }
  })

  // ---- glossaire des repères (commun à tous les postes)

  r.get('/api/glossaire', () => ({ texte: glossaire(), parDefaut: GLOSSAIRE_PAR_DEFAUT }))

  r.post('/api/admin/glossaire', async (ctx) => {
    ctx.exigerAdmin()
    const { texte } = await ctx.json()
    modifierReglage('glossaire', String(texte || '').trim() || null)
    noterModification()
  })

  // ---- modèle d'IA de ce poste (moyen, lourd…)

  r.get('/api/modeles', () => etatModeles())

  r.post('/api/modeles/:code', (ctx) => utiliserModele(ctx.params.code, arreterIA))

  // ---- réglages de ce poste (pas besoin d'être administrateur : ils ne concernent que cet agent)

  r.post('/api/poste', async (ctx) => {
    const { arretIAMinutes, nomAgent } = await ctx.json()
    const changements = {}
    if (arretIAMinutes !== undefined) changements.arretIAMinutes = Math.max(1, Math.min(480, Number(arretIAMinutes) || 20))
    if (nomAgent !== undefined) changements.nomAgent = String(nomAgent).trim()
    return modifierReglagesPoste(changements)
  })

  r.post('/api/ia/arreter', () => {
    arreterIA()
  })

  r.post('/api/quitter', () => {
    journal('Arrêt demandé depuis l’interface')
    setTimeout(() => {
      quitterAdmin()
      arreterIA()
      process.exit(0)
    }, 300)
  })

  // ---- mises à jour (code seulement : le modèle, le fichier et les réglages ne sont pas touchés)

  r.get('/api/mise-a-jour', async () => {
    const actuelle = version()
    try {
      const reponse = await fetch(`https://api.github.com/repos/${DEPOT_GITHUB}/releases/latest`, { headers: { 'User-Agent': 'IASSITEC' }, signal: AbortSignal.timeout(8000) })
      if (!reponse.ok) return { actuelle, disponible: null, message: 'Impossible de consulter GitHub.' }
      const derniere = await reponse.json()
      const disponible = derniere.tag_name.replace(/^v/, '')
      return { actuelle, disponible, nouvelle: disponible !== actuelle, notes: derniere.body || '' }
    } catch {
      return { actuelle, disponible: null, message: 'Pas de connexion à Internet.' }
    }
  })

  r.post('/api/mise-a-jour', async () => {
    // Dans un dossier de développement (dépôt Git), la mise à jour écraserait le code en cours d'écriture.
    if (fs.existsSync(path.join(RACINE, '.git'))) throw new ErreurHttp(409, 'Dossier de développement (Git) : mettez à jour avec « git pull » plutôt qu’ici.')
    const zip = path.join(chemins.cache, 'IASSITEC.zip')
    await telecharger(`https://github.com/${DEPOT_GITHUB}/releases/latest/download/IASSITEC.zip`, zip)
    appliquerMiseAJour(fs.readFileSync(zip))
    fs.rmSync(zip, { force: true })
    journal('Mise à jour installée : redémarrage')
    // Le lanceur relance IASSITEC quand il reçoit le code 42.
    setTimeout(() => {
      quitterAdmin()
      arreterIA()
      process.exit(42)
    }, 500)
    return { ok: true }
  })
}

// Le ZIP contient un dossier « IASSITEC/ ». On le décompresse à part, puis on remplace
// les dossiers de code d'un coup : en cas d'erreur, l'ancienne version reste en place.
const REMPLACES = ['serveur', 'blocs', 'interface', 'outils', 'docs']
const FICHIERS_REMPLACES = ['VERSION', 'README.md', 'package.json', 'LICENCE', 'Lancer IASSITEC.bat', 'Preparer IASSITEC.bat', 'Fabriquer kit hors ligne.bat', 'lancer-iassitec.sh', 'preparer-iassitec.sh', 'fabriquer-kit-hors-ligne.sh']

function appliquerMiseAJour(octets) {
  const nouveau = path.join(chemins.cache, 'mise-a-jour')
  const ancien = path.join(chemins.cache, 'version-precedente')
  fs.rmSync(nouveau, { recursive: true, force: true })
  decompresser(octets, nouveau)
  const source = fs.existsSync(path.join(nouveau, 'IASSITEC')) ? path.join(nouveau, 'IASSITEC') : nouveau
  if (!fs.existsSync(path.join(source, 'serveur', 'demarrer.js'))) throw new Error('Mise à jour incomplète : rien n’a été changé.')

  fs.rmSync(ancien, { recursive: true, force: true })
  fs.mkdirSync(ancien, { recursive: true })
  for (const nom of [...REMPLACES, ...FICHIERS_REMPLACES]) {
    if (!fs.existsSync(path.join(source, nom))) continue
    if (fs.existsSync(path.join(RACINE, nom))) fs.renameSync(path.join(RACINE, nom), path.join(ancien, nom))
    fs.renameSync(path.join(source, nom), path.join(RACINE, nom))
  }
  for (const lanceur of ['lancer-iassitec.sh', 'preparer-iassitec.sh', 'fabriquer-kit-hors-ligne.sh']) {
    if (fs.existsSync(path.join(RACINE, lanceur))) fs.chmodSync(path.join(RACINE, lanceur), 0o755)
  }
  fs.rmSync(nouveau, { recursive: true, force: true })
}
