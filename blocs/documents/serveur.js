// Les documents : dépôt, lecture du texte, consultation, rattachement à une machine.

import crypto from 'node:crypto'
import { db } from '../../serveur/socle/base.js'
import { noterModification, etatPartage } from '../../serveur/socle/partage.js'
import { ErreurHttp, envoyerOctets } from '../../serveur/socle/http.js'
import { lireImage, discuter, iaInstallee } from '../../serveur/socle/ia.js'
import { journal } from '../../serveur/socle/installation.js'
import { extraireTexte, imagesDuDocument } from './extraction.js'
import { CONSIGNE_IMAGE, relancerLecteurImages } from './lecteur-images.js'
import { ajouterPassages, remplacerPassages, supprimerPassages, changerMachineDesPassages } from '../recherche/passages.js'

const TAILLE_MAX = 900 * 1024 * 1024 // limite d'un champ SQLite (1 Go), avec une marge

export function routes(r) {
  r.get('/api/documents', (ctx) => {
    if (ctx.admin) relancerLecteurImages() // reprend une lecture d'images interrompue
    const conditions = []
    const valeurs = []
    if (ctx.query.machine) {
      conditions.push('d.machine_id = ?')
      valeurs.push(Number(ctx.query.machine))
    }
    if (ctx.query.q) {
      conditions.push('d.nom LIKE ?')
      valeurs.push(`%${ctx.query.q}%`)
    }
    return db()
      .prepare(
        `SELECT d.id, d.nom, d.type, d.taille, d.machine_id, d.etat, d.message, d.pages, d.ajoute_le, d.ajoute_par, d.genre,
                m.repere, (SELECT count(*) FROM passages p WHERE p.source = 'document' AND p.source_id = d.id) AS passages
         FROM documents d LEFT JOIN machines m ON m.id = d.machine_id
         ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
         ORDER BY d.ajoute_le DESC`,
      )
      .all(...valeurs)
  })

  // Dépôt d'un fichier. Le corps de la requête est le fichier lui-même ;
  // son nom et la machine arrivent dans les en-têtes (X-Nom, X-Machine).
  r.post('/api/documents', async (ctx) => {
    ctx.exigerAdmin()
    const nom = decodeURIComponent(ctx.req.headers['x-nom'] || 'document')
    const machineId = Number(ctx.req.headers['x-machine']) || null
    const genre = GENRES.includes(ctx.req.headers['x-genre']) ? ctx.req.headers['x-genre'] : 'document'
    const octets = await ctx.octets()
    if (!octets.length) throw new ErreurHttp(400, 'Fichier vide')
    if (octets.length > TAILLE_MAX) throw new ErreurHttp(413, `${nom} est trop gros (900 Mo au plus).`)

    const empreinte = crypto.createHash('sha256').update(octets).digest('hex')
    const doublon = db().prepare('SELECT id, nom FROM documents WHERE empreinte = ?').get(empreinte)
    if (doublon && !ctx.query.forcer) throw new ErreurHttp(409, `Ce fichier est déjà dans la base (« ${doublon.nom} »).`)

    const { lastInsertRowid } = db()
      .prepare('INSERT INTO documents (nom, type, taille, contenu, empreinte, machine_id, etat, ajoute_le, ajoute_par, genre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nom, ctx.req.headers['content-type'] || '', octets.length, octets, empreinte, machineId, 'a-lire', new Date().toISOString(), etatPartage().admin?.nom || '', genre)
    const id = Number(lastInsertRowid)
    const lecture = lireSurLeServeur(id, nom, octets, machineId)
    noterModification()
    return { id, lecture }
  })

  r.get('/api/documents/:id/fichier', (ctx) => {
    const d = db().prepare('SELECT nom, type, contenu FROM documents WHERE id = ?').get(ctx.params.id)
    if (!d) throw new ErreurHttp(404, 'Document introuvable')
    envoyerOctets(ctx.res, Buffer.from(d.contenu), { type: d.type || 'application/octet-stream', nom: d.nom, telecharger: Boolean(ctx.query.telecharger) })
  })

  // Le texte lu, page par page (pour « Voir le texte » et « Traduire »).
  r.get('/api/documents/:id/texte', (ctx) => {
    return db().prepare("SELECT page, texte FROM passages WHERE source = 'document' AND source_id = ? ORDER BY page, id").all(ctx.params.id)
  })

  r.put('/api/documents/:id', async (ctx) => {
    ctx.exigerAdmin()
    const { nom, machine_id, genre } = await ctx.json()
    const machineId = Number(machine_id) || null
    db().prepare('UPDATE documents SET nom = coalesce(?, nom), machine_id = ?, genre = coalesce(?, genre) WHERE id = ?').run(nom || null, machineId, GENRES.includes(genre) ? genre : null, ctx.params.id)
    changerMachineDesPassages('document', Number(ctx.params.id), machineId)
    noterModification()
  })

  r.delete('/api/documents/:id', (ctx) => {
    ctx.exigerAdmin()
    supprimerPassages('document', Number(ctx.params.id))
    db().prepare('DELETE FROM documents WHERE id = ?').run(ctx.params.id)
    noterModification()
  })

  // Relire un document (après une erreur, ou pour profiter d'un meilleur modèle).
  r.post('/api/documents/:id/relire', (ctx) => {
    ctx.exigerAdmin()
    const d = db().prepare('SELECT id, nom, contenu, machine_id FROM documents WHERE id = ?').get(ctx.params.id)
    if (!d) throw new ErreurHttp(404, 'Document introuvable')
    supprimerPassages('document', d.id)
    db().prepare('DELETE FROM images_pages WHERE document_id = ?').run(d.id) // le navigateur les refera
    const lecture = lireSurLeServeur(d.id, d.nom, Buffer.from(d.contenu), d.machine_id)
    noterModification()
    return { id: d.id, lecture }
  })

  // Relit tous les documents que le serveur sait lire (utile après une mise à jour d'IASSITEC
  // qui lit plus de formats, ou les images). Les PDF et photos, lus par le navigateur, ne sont pas touchés.
  r.post('/api/documents/relire-tout', (ctx) => {
    ctx.exigerAdmin()
    let relus = 0
    for (const { id } of db().prepare('SELECT id FROM documents').all()) {
      const d = db().prepare('SELECT id, nom, contenu, machine_id FROM documents WHERE id = ?').get(id)
      const octets = Buffer.from(d.contenu)
      if (extraireTexte(d.nom, octets).lecture === 'navigateur') {
        // PDF : on garde le texte, mais on refait analyser les images de pages (nouveau glossaire, nouveau modèle…).
        if (relireImagesDesPages(d.id)) relus++
        continue
      }
      supprimerPassages('document', d.id)
      lireSurLeServeur(d.id, d.nom, octets, d.machine_id)
      relus++
    }
    noterModification()
    return { relus }
  })

  // ---- lecture par le navigateur (PDF, images) : il envoie le texte de chaque page…
  r.post('/api/documents/:id/pages', async (ctx) => {
    ctx.exigerAdmin()
    const pages = await ctx.json()
    const d = db().prepare('SELECT machine_id FROM documents WHERE id = ?').get(ctx.params.id)
    if (!d) throw new ErreurHttp(404, 'Document introuvable')
    ajouterPassages('document', Number(ctx.params.id), d.machine_id, pages)
    noterModification()
  })

  // … et l'image des pages à analyser plus tard par l'IA : folios de schémas et de plans (page entière
  // et deux moitiés agrandies), pages de notices qui contiennent des photos.
  r.post('/api/documents/:id/rendu', async (ctx) => {
    ctx.exigerAdmin()
    const page = Number(ctx.query.page)
    const partie = ['page', 'gauche', 'droite'].includes(ctx.query.partie) ? ctx.query.partie : 'page'
    const image = await ctx.octets()
    db().prepare('INSERT OR REPLACE INTO images_pages (document_id, page, partie, image, lu) VALUES (?, ?, ?, ?, 0)').run(Number(ctx.params.id), page, partie, image)
    noterModification()
  })

  // Image d'une page (folio d'un schéma, page d'un plan), pour l'afficher.
  r.get('/api/documents/:id/page/:page', (ctx) => {
    const ligne = db().prepare("SELECT image FROM images_pages WHERE document_id = ? AND page = ? AND partie = 'page'").get(ctx.params.id, ctx.params.page)
    if (!ligne) throw new ErreurHttp(404, 'Image de page introuvable')
    envoyerOctets(ctx.res, Buffer.from(ligne.image), { type: 'image/jpeg' })
  })

  // … ou l'image d'une page sans texte (scan, photo), que l'IA lit tout de suite.
  r.post('/api/documents/:id/image', async (ctx) => {
    ctx.exigerAdmin()
    const image = await ctx.octets()
    const texte = await lireImage(image, CONSIGNE_IMAGE)
    return { texte }
  })

  r.post('/api/documents/:id/fin', async (ctx) => {
    ctx.exigerAdmin()
    const { pages, erreur } = await ctx.json()
    const id = Number(ctx.params.id)
    const { nombre } = db().prepare("SELECT count(*) AS nombre FROM passages WHERE source = 'document' AND source_id = ?").get(id)
    const { enAttente } = db().prepare('SELECT count(DISTINCT page) AS enAttente FROM images_pages WHERE document_id = ? AND lu = 0').get(id)
    let etat = erreur ? 'erreur' : 'lu'
    let message = erreur || (nombre ? '' : 'Aucun texte trouvé dans ce document.')
    if (!erreur && enAttente) {
      etat = 'images'
      message = `${enAttente} page${enAttente > 1 ? 's' : ''} en attente d’analyse par l’IA`
    }
    db().prepare('UPDATE documents SET etat = ?, message = ?, pages = ? WHERE id = ?').run(etat, message, pages || null, id)
    noterModification()
    if (etat === 'images') relancerLecteurImages()
  })

  // Traduction en français (n'importe quel agent : rien n'est enregistré).
  r.post('/api/traduire', async (ctx) => {
    const { texte } = await ctx.json()
    if (!texte?.trim()) return { texte: '' }
    const traduction = await discuter(
      [
        { role: 'system', content: 'Tu es traducteur technique. Traduis en français le texte donné, fidèlement, en gardant les références, valeurs et unités. Si le texte est déjà en français, recopie-le tel quel. Réponds uniquement par la traduction.' },
        { role: 'user', content: texte.slice(0, 12000) },
      ],
      { temperature: 0.1, maxMots: 4000 },
    )
    return { texte: traduction }
  })
}

export const GENRES = ['document', 'schema', 'plan']

// Remet les images de pages d'un PDF en attente d'analyse. Renvoie true s'il y en avait.
function relireImagesDesPages(id) {
  const { n } = db().prepare('SELECT count(*) AS n FROM images_pages WHERE document_id = ?').get(id)
  if (!n) return false
  db().prepare('UPDATE images_pages SET lu = 0 WHERE document_id = ?').run(id)
  db().prepare("DELETE FROM passages WHERE source = 'document' AND source_id = ? AND (texte LIKE '[Folio %' OR texte LIKE '[Plan %' OR texte LIKE '[Illustrations %')").run(id)
  db().prepare("UPDATE documents SET etat = 'images', message = 'Pages en attente d’analyse par l’IA' WHERE id = ?").run(id)
  relancerLecteurImages()
  return true
}

// Lit le document si c'est un format que le serveur sait lire, et met à jour son état.
// Renvoie 'navigateur' si c'est au navigateur de le lire (PDF, images).
function lireSurLeServeur(id, nom, octets, machineId) {
  let resultat
  try {
    resultat = extraireTexte(nom, octets)
  } catch (erreur) {
    journal(`Lecture impossible de ${nom} : ${erreur.message}`)
    db().prepare("UPDATE documents SET etat = 'erreur', message = ? WHERE id = ?").run(`Lecture impossible : ${erreur.message}`, id)
    return 'erreur'
  }

  if (resultat.lecture === 'navigateur') {
    db().prepare("UPDATE documents SET etat = 'a-lire', message = '' WHERE id = ?").run(id)
    return 'navigateur'
  }
  if (resultat.lecture === 'aucune') {
    db().prepare("UPDATE documents SET etat = 'piece-jointe', message = 'Format non lu par l’IA : fichier rangé comme pièce jointe.' WHERE id = ?").run(id)
    return 'aucune'
  }
  remplacerPassages('document', id, machineId, resultat.pages)
  const { nombre } = db().prepare("SELECT count(*) AS nombre FROM passages WHERE source = 'document' AND source_id = ?").get(id)
  db().prepare('UPDATE documents SET etat = ?, message = ?, pages = ? WHERE id = ?').run('lu', nombre ? '' : 'Aucun texte trouvé dans ce document.', resultat.pages.length, id)

  // Photos et captures d'écran du document : lues ensuite par l'IA, en arrière-plan.
  const images = iaInstallee() ? imagesDuDocument(nom, octets).length : 0
  if (images) {
    db().prepare("UPDATE documents SET etat = 'images', message = ? WHERE id = ?").run(`${images} image${images > 1 ? 's' : ''} en attente de lecture par l’IA`, id)
    relancerLecteurImages()
  }
  return 'serveur'
}
