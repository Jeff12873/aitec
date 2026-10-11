// Lecture des anciennes présentations PowerPoint (.ppt, PowerPoint 97 à 2003), sans bibliothèque.
//
// La présentation est le flux « PowerPoint Document » d'un fichier composé (voir fichier-compose.js).
// C'est un arbre d'« enregistrements » : [version + instance sur 2 octets][type sur 2 octets][longueur sur 4 octets].
// Une version 0xF signale un conteneur, qui contient d'autres enregistrements. Référence : [MS-PPT].
//
// Le texte est dans les enregistrements TextCharsAtom (UTF-16) et TextBytesAtom (1 octet par caractère).
// On le range par diapositive : chaque conteneur « Slide » est une diapositive ; les textes des titres et
// zones de plan sont aussi dans « SlideListWithText », où chaque diapositive commence par un SlidePersistAtom.
//
// lirePpt(octets) → [{ page: numéro de diapositive, texte }]

import { lireFichierCompose } from './fichier-compose.js'

const DIAPOSITIVE = 0x03ee // Slide
const MASQUE = 0x03f8 // MainMaster : textes modèles (« Cliquez pour modifier… »), ignorés
const LISTE_DIAPOSITIVES = 0x0ff0 // SlideListWithText
const DEBUT_DIAPOSITIVE = 0x03f3 // SlidePersistAtom
const TEXTE_UNICODE = 0x0fa0 // TextCharsAtom
const TEXTE_OCTETS = 0x0fa8 // TextBytesAtom

export function lirePpt(octets) {
  const flux = lireFichierCompose(octets).get('PowerPoint Document')
  if (!flux) throw new Error('présentation PowerPoint non reconnue')

  const pages = new Map() // numéro de diapositive → textes
  const ajouter = (page, texte) => {
    texte = texte.replace(/[\r\x0b]/g, '\n').trim()
    if (!texte || !page) return
    if (!pages.has(page)) pages.set(page, [])
    if (!pages.get(page).includes(texte)) pages.get(page).push(texte)
  }

  let diapositives = 0 // conteneurs « Slide » rencontrés
  let dansListe = 0 // numéro courant dans SlideListWithText

  const parcourir = (debut, fin, contexte) => {
    for (let position = debut; position + 8 <= fin; ) {
      const version = flux.readUInt16LE(position) & 0x0f
      const type = flux.readUInt16LE(position + 2)
      const longueur = flux.readUInt32LE(position + 4)
      const contenu = position + 8
      const suivant = Math.min(fin, contenu + longueur)

      if (version === 0x0f) {
        if (type === MASQUE) {
          // on saute les masques
        } else if (type === DIAPOSITIVE) {
          diapositives++
          parcourir(contenu, suivant, { page: diapositives })
        } else if (type === LISTE_DIAPOSITIVES) {
          dansListe = 0
          parcourir(contenu, suivant, { liste: true })
        } else {
          parcourir(contenu, suivant, contexte)
        }
      } else if (type === DEBUT_DIAPOSITIVE && contexte.liste) {
        dansListe++
      } else if (type === TEXTE_UNICODE || type === TEXTE_OCTETS) {
        const texte = type === TEXTE_UNICODE ? flux.toString('utf16le', contenu, suivant) : new TextDecoder('windows-1252').decode(flux.subarray(contenu, suivant))
        ajouter(contexte.liste ? dansListe : contexte.page, texte)
      }
      position = suivant
    }
  }
  parcourir(0, flux.length, {})

  return [...pages.entries()].sort((a, b) => a[0] - b[0]).map(([page, textes]) => ({ page, texte: textes.join('\n') }))
}
