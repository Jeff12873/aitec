// Lecture des images par l'IA, en arrière-plan, sur le poste de l'administrateur.
//
// Deux sortes d'images :
//   1. les images de pages de PDF, dessinées par le navigateur (table images_pages) :
//      - folios de schémas et pages de plans : la page entière (vue d'ensemble) et ses deux moitiés agrandies
//        (pour lire les petits repères). L'IA en tire une fiche qui permettra de retrouver le folio ;
//      - pages de notices qui contiennent des photos : l'IA décrit les illustrations ;
//   2. les photos et captures d'écran contenues dans les documents Word, PowerPoint, LibreOffice.
//
// Comptez de quelques secondes à une minute par image. Un document en attente a l'état « images ».
// Si le mode administrateur est quitté, la lecture reprend là où elle en était au passage suivant.

import { db } from '../../serveur/socle/base.js'
import { etatPartage, noterModification } from '../../serveur/socle/partage.js'
import { iaInstallee, lireImage, surProcesseur } from '../../serveur/socle/ia.js'
import { journal } from '../../serveur/socle/installation.js'
import { glossaire } from '../../serveur/socle/glossaire.js'
import { ajouterPassages } from '../recherche/passages.js'
import { imagesDuDocument } from './extraction.js'

// ---------------------------------------------------------------- consignes données à l'IA (modifiables)

export const CONSIGNE_IMAGE = `Cette image vient d'un document de maintenance industrielle (photo, capture d'écran, schéma ou page scannée).
1. Décris en une ou deux phrases ce qu'elle montre : type de vue, matériel ou organe, ce qu'on y règle ou vérifie, défaut visible éventuel.
2. Recopie fidèlement tout le texte lisible : références, valeurs, unités, libellés d'écran ou de boutons ; un tableau ligne par ligne, colonnes séparées par « | ».
Réponds exactement sous la forme :
Description : …
Texte : … (ou « aucun »)`

const CONSIGNE_ILLUSTRATIONS = `Cette image est une page de documentation technique (notice, procédure). Son texte a déjà été lu ailleurs.
Décris seulement les photos, schémas et figures de la page, en quelques phrases : ce qu'ils montrent (organe, réglage, repères, flèches, valeurs indiquées sur la figure). Ignore les logos et le texte courant.
S'il n'y a aucune figure utile, réponds seulement « aucune ».`

const CONSIGNE_FOLIO = `Cette image est un folio de schéma (électrique, pneumatique ou hydraulique) d'une machine industrielle. La page peut être tournée de 90°.
Rédige une fiche concise qui permettra de retrouver ce folio et de dépanner :
Folio : numéro, titre et machine lus dans le cartouche.
Rôle : une ou deux phrases.
Composants : un par ligne, « repère — nature — rôle », avec bornes, couleurs de fils et adresses d'automate lisibles.
Liaisons : alimentations et potentiels, numéros de fils, renvois vers d'autres folios.
Utilise le glossaire des repères ci-dessous. N'invente rien : si un repère ou une liaison est illisible, écris « illisible ».

GLOSSAIRE DES REPÈRES :
{glossaire}`

const CONSIGNE_PLAN = `Cette image est un plan mécanique (dessin d'ensemble ou de définition) d'une machine industrielle. La page peut être tournée de 90°.
Rédige une fiche concise qui permettra de retrouver ce plan :
Plan : numéro, titre, ensemble ou pièce, indice, lus dans le cartouche.
Contenu : ce que représente le dessin, en une ou deux phrases.
Nomenclature : un repère par ligne, « repère — désignation — quantité — matière ou référence » si lisibles.
Cotes et notes : cotes fonctionnelles, tolérances, ajustements, couples de serrage, traitements et notes lisibles.
N'invente rien : si une valeur est illisible, écris « illisible ».`

const CONSIGNE_DETAIL = `Cette image est une moitié agrandie d'un {nature}. Recopie uniquement ce qui est lisible, sans phrases :
- tous les repères avec ce qui les accompagne (nature, bornes, numéros de fils, adresses d'automate, renvois de folios) ;
- pour un plan : les cotes, tolérances, repères de nomenclature et notes.
Un élément par ligne. N'invente rien.`

// ---------------------------------------------------------------- boucle de lecture

let enCours = false

export function relancerLecteurImages() {
  if (!enCours) setTimeout(lireLesImages, 1000)
}

async function lireLesImages() {
  if (enCours) return
  enCours = true
  const echecs = new Set() // documents mis de côté jusqu'au prochain passage, après une erreur
  try {
    while (etatPartage().admin && iaInstallee()) {
      const enAttente = db().prepare("SELECT id FROM documents WHERE etat = 'images' ORDER BY id").all().map((l) => l.id)
      const id = enAttente.find((i) => !echecs.has(i))
      if (!id) break
      const d = db().prepare('SELECT id, nom, contenu, machine_id, genre FROM documents WHERE id = ?').get(id)
      const pages = db().prepare('SELECT DISTINCT page FROM images_pages WHERE document_id = ? AND lu = 0 ORDER BY page').all(d.id).map((l) => l.page)
      try {
        if (pages.length) await lireLesPages(d, pages)
        else await lireLesImagesDe(d)
      } catch (erreur) {
        echecs.add(d.id)
        journal(`Analyse de « ${d.nom} » interrompue : ${erreur.message}`)
        db().prepare('UPDATE documents SET message = ? WHERE id = ?').run(`Analyse interrompue (${erreur.message}) : nouvel essai au prochain passage en mode administrateur.`, d.id)
        noterModification()
      }
    }
  } catch (erreur) {
    journal(`Lecture des images interrompue : ${erreur.message}`)
  } finally {
    enCours = false
  }
}

// Images de pages de PDF (folios, plans, pages illustrées)
async function lireLesPages(d, pages) {
  for (const [i, page] of pages.entries()) {
    if (!etatPartage().admin) return
    db().prepare('UPDATE documents SET message = ? WHERE id = ?').run(`Analyse des pages par l’IA : ${i + 1} sur ${pages.length} restantes`, d.id)
    const parties = Object.fromEntries(
      db().prepare('SELECT partie, image FROM images_pages WHERE document_id = ? AND page = ?').all(d.id, page).map((l) => [l.partie, Buffer.from(l.image)]),
    )
    // En cas d'erreur (moteur arrêté…), l'exception remonte : la page reste à analyser.
    const texte = d.genre === 'document' ? await analyserIllustrations(parties.page) : await analyserFolio(d.genre, parties)
    if (texte) {
      const titre = d.genre === 'schema' ? `[Folio — page ${page} du schéma « ${d.nom} »]` : d.genre === 'plan' ? `[Plan — page ${page} de « ${d.nom} »]` : `[Illustrations — page ${page}]`
      ajouterPassages('document', d.id, d.machine_id, [{ page, texte }], { titre })
    }
    db().prepare('UPDATE images_pages SET lu = 1 WHERE document_id = ? AND page = ?').run(d.id, page)
    // Pages illustrées de notices : l'image n'est plus utile une fois décrite.
    if (d.genre === 'document') db().prepare('DELETE FROM images_pages WHERE document_id = ? AND page = ?').run(d.id, page)
    noterModification()
  }
  db().prepare("UPDATE documents SET etat = 'lu', message = ? WHERE id = ?").run(`${pages.length} page${pages.length > 1 ? 's' : ''} analysée${pages.length > 1 ? 's' : ''} par l’IA`, d.id)
  noterModification()
}

async function analyserIllustrations(image) {
  if (!image) return ''
  const texte = (await lireImage(image, CONSIGNE_ILLUSTRATIONS)).trim()
  return /^aucune\.?$/i.test(texte) ? '' : texte
}

async function analyserFolio(genre, parties) {
  const consigne = (genre === 'plan' ? CONSIGNE_PLAN : CONSIGNE_FOLIO).replace('{glossaire}', glossaire())
  const morceaux = []
  if (parties.page) morceaux.push((await lireImage(parties.page, consigne)).trim())
  // Sur le processeur, chaque image prend plusieurs minutes : on se contente de la vue d'ensemble.
  for (const moitie of surProcesseur() ? [] : ['gauche', 'droite']) {
    if (!parties[moitie]) continue
    const detail = (await lireImage(parties[moitie], CONSIGNE_DETAIL.replace('{nature}', genre === 'plan' ? 'plan mécanique' : 'folio de schéma'))).trim()
    morceaux.push(`Détail (moitié ${moitie}) :\n${detail}`)
  }
  return morceaux.filter(Boolean).join('\n\n')
}

// Photos contenues dans un document Word, PowerPoint ou LibreOffice
const DEBUT_PASSAGE = '[Image ' // les passages issus de ces images commencent ainsi

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
      if (/fetch failed|terminated|démarrer/i.test(erreur.message)) throw erreur // moteur arrêté : on réessaiera
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

