// Le fichier .datassitec : état général, choix du fichier, création, mode administrateur.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { reglage } from '../../serveur/socle/base.js'
import { ErreurHttp } from '../../serveur/socle/http.js'
import { etatIA } from '../../serveur/socle/ia.js'
import { version, reglagesPoste, modifierReglagesPoste, WINDOWS } from '../../serveur/socle/installation.js'
import { verifierMotDePasse } from '../../serveur/socle/securite.js'
import { etatPartage, ouvrirFichier, creerFichier, entrerAdmin, quitterAdmin, cookieAdmin } from '../../serveur/socle/partage.js'
import { etatIndexation } from '../recherche/indexeur.js'

export function routes(r) {
  // Interrogé toutes les quelques secondes par l'interface.
  r.get('/api/etat', (ctx) => {
    const partage = etatPartage()
    return {
      version: version(),
      partage,
      admin: ctx.admin,
      atelier: partage.ouvert ? reglage('nom_atelier', 'Atelier') : null,
      iconePersonnalisee: partage.ouvert ? Boolean(reglage('icone_type')) : false,
      ia: etatIA(),
      indexation: partage.ouvert ? etatIndexation() : null,
      poste: reglagesPoste(),
    }
  })

  // ---- choix du fichier

  // Parcourir les dossiers du poste (le navigateur ne donne pas les chemins complets des fichiers).
  r.get('/api/explorer', (ctx) => {
    const dossier = ctx.query.dossier ? path.resolve(ctx.query.dossier) : null
    if (!dossier) return { dossier: null, parent: null, racines: racines(), dossiers: [], fichiers: [] }
    let entrees
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true })
    } catch {
      throw new ErreurHttp(404, `Dossier inaccessible : ${dossier}`)
    }
    const visibles = entrees.filter((e) => !e.name.startsWith('.') && !e.name.startsWith('$'))
    const parent = path.dirname(dossier)
    return {
      dossier,
      parent: parent !== dossier ? parent : null,
      racines: racines(),
      dossiers: visibles.filter((e) => estDossier(dossier, e)).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'fr')),
      fichiers: visibles.filter((e) => e.isFile() && e.name.endsWith('.datassitec')).map((e) => e.name).sort(),
    }
  })

  r.post('/api/fichier/ouvrir', async (ctx) => {
    const { chemin } = await ctx.json()
    ouvrirFichier(chemin)
    return etatPartage()
  })

  r.post('/api/fichier/creer', async (ctx) => {
    const { dossier, nomFichier, nomAtelier, motDePasse, nomAgent } = await ctx.json()
    if (!dossier || !nomFichier) throw new ErreurHttp(400, 'Choisissez un dossier et un nom de fichier.')
    const fichier = creerFichier(path.join(dossier, nomFichier), { nomAtelier, motDePasse, nom: nomAgent })
    if (nomAgent) modifierReglagesPoste({ nomAgent })
    // Celui qui crée le fichier entre directement en mode administrateur.
    entrerAdmin(nomAgent || os.userInfo().username)
    poserCookie(ctx.res, cookieAdmin())
    return { fichier }
  })

  // ---- mode administrateur

  r.post('/api/session', async (ctx) => {
    const { motDePasse, nom, forcer } = await ctx.json()
    if (!etatPartage().ouvert) throw new ErreurHttp(409, 'Aucun fichier ouvert.')
    if (!verifierMotDePasse(motDePasse || '', reglage('mot_de_passe'))) {
      await new Promise((ok) => setTimeout(ok, 800)) // ralentit les essais en série
      throw new ErreurHttp(401, 'Mot de passe incorrect.')
    }
    const nomAgent = (nom || '').trim() || os.userInfo().username
    modifierReglagesPoste({ nomAgent })
    const resultat = entrerAdmin(nomAgent, { forcer })
    if (resultat.occupe) return { occupe: resultat.occupe }
    poserCookie(ctx.res, cookieAdmin())
    return { ok: true }
  })

  r.delete('/api/session', (ctx) => {
    if (ctx.admin) quitterAdmin()
    ctx.res.setHeader('Set-Cookie', 'iassitec_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict')
    return { ok: true }
  })
}

function poserCookie(res, jeton) {
  res.setHeader('Set-Cookie', `iassitec_admin=${jeton}; Path=/; HttpOnly; SameSite=Strict`)
}

// Points de départ proposés dans l'explorateur.
function racines() {
  const liste = [{ nom: 'Dossier personnel', chemin: os.homedir() }]
  if (WINDOWS) {
    // Lecteurs C:, D:, … et lecteurs réseau (Z:…)
    for (const lettre of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const lecteur = `${lettre}:\\`
      if (fs.existsSync(lecteur)) liste.push({ nom: `Lecteur ${lettre}:`, chemin: lecteur })
    }
  } else {
    const uid = os.userInfo().uid
    for (const [nom, chemin] of [['Partages réseau (GNOME)', `/run/user/${uid}/gvfs`], ['Partages réseau (KDE)', `/run/user/${uid}/kio-fuse`], ['/mnt', '/mnt'], ['/media', '/media'], ['Racine /', '/']]) {
      if (fs.existsSync(chemin)) liste.push({ nom, chemin })
    }
  }
  const { fichier } = reglagesPoste()
  if (fichier) liste.unshift({ nom: 'Dossier du dernier fichier', chemin: path.dirname(fichier) })
  return liste
}

function estDossier(parent, entree) {
  if (entree.isDirectory()) return true
  if (!entree.isSymbolicLink()) return false
  try {
    return fs.statSync(path.join(parent, entree.name)).isDirectory()
  } catch {
    return false
  }
}
