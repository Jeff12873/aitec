// Lecture, par l'IA, des images contenues dans les documents (photos, captures d'écran, schémas).
//
// Les fiches de maintenance sont souvent faites de photos légendées : sans cette étape, l'IA ne verrait
// que les légendes. La lecture prend de quelques secondes à une minute par image : elle tourne en
// arrière-plan, document après document, sur le poste de l'administrateur.
//
// Un document en attente a l'état « images ». Si la lecture est interrompue (fin du mode administrateur),
// elle reprend au début de ce document la fois suivante.

import { db } from '../../serveur/socle/base.js'
import { etatPartage, noterModification } from '../../serveur/socle/partage.js'
import { iaInstallee, lireImage } from '../../serveur/socle/ia.js'
import { journal } from '../../serveur/socle/installation.js'
import { ajouterPassages } from '../recherche/passages.js'
import { imagesDuDocument } from './extraction.js'

export const CONSIGNE_IMAGE = `Cette image vient d'un document de maintenance industrielle (photo, capture d'écran, schéma ou page scannée).
1. Décris en une ou deux phrases ce qu'elle montre : type de vue, matériel ou organe, ce qu'on y règle ou vérifie, défaut visible éventuel.
2. Recopie fidèlement tout le texte lisible : références, valeurs, unités, libellés d'écran ou de boutons ; un tableau ligne par ligne, colonnes séparées par « | ».
Réponds exactement sous la forme :
Description : …
Texte : … (ou « aucun »)`

const DEBUT_PASSAGE = '[Image ' // les passages issus d'une image commencent ainsi

let enCours = false

export function relancerLecteurImages() {
  if (!enCours) setTimeout(lireLesImages, 1000)
}

async function lireLesImages() {
  if (enCours) return
  enCours = true
  try {
    while (etatPartage().admin && iaInstallee()) {
      const d = db().prepare("SELECT id, nom, contenu, machine_id FROM documents WHERE etat = 'images' ORDER BY id LIMIT 1").get()
      if (!d) break
      await lireLesImagesDe(d)
    }
  } catch (erreur) {
    journal(`Lecture des images interrompue : ${erreur.message}`)
  } finally {
    enCours = false
  }
}

async function lireLesImagesDe(d) {
  const images = imagesDuDocument(d.nom, Buffer.from(d.contenu))
  // Reprise : on efface ce qui avait été lu lors d'un essai précédent.
  db().prepare("DELETE FROM passages WHERE source = 'document' AND source_id = ? AND texte LIKE ?").run(d.id, DEBUT_PASSAGE + '%')

  let lues = 0
  for (const [i, image] of images.entries()) {
    if (!etatPartage().admin) return // le mode administrateur a été quitté : on reprendra plus tard
    db().prepare('UPDATE documents SET message = ? WHERE id = ?').run(`Lecture des images : ${i + 1} sur ${images.length}`, d.id)
    const type = { png: 'image/png', gif: 'image/gif', bmp: 'image/bmp' }[image.nom.split('.').pop().toLowerCase()] || 'image/jpeg'
    try {
      const texte = (await lireImage(image.octets, CONSIGNE_IMAGE, type)).trim()
      if (texte.length > 15) {
        ajouterPassages('document', d.id, d.machine_id, [{ page: null, texte: `${DEBUT_PASSAGE}${i + 1} du document]\n${texte}` }])
        lues++
      }
    } catch (erreur) {
      journal(`Image ${i + 1} de « ${d.nom} » illisible : ${erreur.message}`)
    }
    noterModification()
  }
  db().prepare("UPDATE documents SET etat = 'lu', message = ? WHERE id = ?").run(`${lues} image${lues > 1 ? 's' : ''} lue${lues > 1 ? 's' : ''} par l’IA`, d.id)
  noterModification()
}

export function etatLectureImages() {
  try {
    return { restants: db().prepare("SELECT count(*) AS n FROM documents WHERE etat = 'images'").get().n, enCours }
  } catch {
    return { restants: 0, enCours }
  }
}
