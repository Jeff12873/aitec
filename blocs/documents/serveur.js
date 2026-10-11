// Les documents : dépôt, lecture du texte, consultation, rattachement à une machine.

import crypto from 'node:crypto'
import { db } from '../../serveur/socle/base.js'
import { noterModification, etatPartage } from '../../serveur/socle/partage.js'
import { ErreurHttp, envoyerOctets } from '../../serveur/socle/http.js'
import { lireImage, discuter } from '../../serveur/socle/ia.js'
import { journal } from '../../serveur/socle/installation.js'
import { extraireTexte } from './extraction.js'
import { ajouterPassages, remplacerPassages, supprimerPassages, changerMachineDesPassages } from '../recherche/passages.js'

const TAILLE_MAX = 900 * 1024 * 1024 // limite d'un champ SQLite (1 Go), avec une marge

const CONSIGNE_IMAGE = `Transcris fidèlement tout le texte lisible de cette image (page de documentation technique, plaque signalétique, étiquette, schéma…).
Garde les références, valeurs, unités et tableaux (une ligne par ligne de tableau, colonnes séparées par « | »).
S'il n'y a presque pas de texte, décris en une ou deux phrases ce que montre l'image (machine, pièce, défaut visible).
Réponds uniquement par la transcription, sans commentaire.`

export function routes(r) {
  r.get('/api/documents', (ctx) => {
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
        `SELECT d.id, d.nom, d.type, d.taille, d.machine_id, d.etat, d.message, d.pages, d.ajoute_le, d.ajoute_par,
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
    const octets = await ctx.octets()
    if (!octets.length) throw new ErreurHttp(400, 'Fichier vide')
    if (octets.length > TAILLE_MAX) throw new ErreurHttp(413, `${nom} est trop gros (900 Mo au plus).`)

    const empreinte = crypto.createHash('sha256').update(octets).digest('hex')
    const doublon = db().prepare('SELECT id, nom FROM documents WHERE empreinte = ?').get(empreinte)
    if (doublon && !ctx.query.forcer) throw new ErreurHttp(409, `Ce fichier est déjà dans la base (« ${doublon.nom} »).`)

    const { lastInsertRowid } = db()
      .prepare('INSERT INTO documents (nom, type, taille, contenu, empreinte, machine_id, etat, ajoute_le, ajoute_par) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nom, ctx.req.headers['content-type'] || '', octets.length, octets, empreinte, machineId, 'a-lire', new Date().toISOString(), etatPartage().admin?.nom || '')
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
    const { nom, machine_id } = await ctx.json()
    const machineId = Number(machine_id) || null
    db().prepare('UPDATE documents SET nom = coalesce(?, nom), machine_id = ? WHERE id = ?').run(nom || null, machineId, ctx.params.id)
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
    const lecture = lireSurLeServeur(d.id, d.nom, Buffer.from(d.contenu), d.machine_id)
    noterModification()
    return { id: d.id, lecture }
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

  // … ou l'image d'une page sans texte (scan, photo), que l'IA lit.
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
    const etat = erreur ? 'erreur' : 'lu'
    const message = erreur || (nombre ? '' : 'Aucun texte trouvé dans ce document.')
    db().prepare('UPDATE documents SET etat = ?, message = ?, pages = ? WHERE id = ?').run(etat, message, pages || null, id)
    noterModification()
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
  return 'serveur'
}
