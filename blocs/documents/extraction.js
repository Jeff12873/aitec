// Lecture du texte des documents déposés.
//
// Trois cas, selon le type de fichier :
//   - lu ici, par le serveur : Word, Excel et PowerPoint (récents et anciens formats), LibreOffice, CSV, texte, HTML… ;
//                              les images contenues dans ces documents sont lues ensuite par l'IA (lecteur-images.js) ;
//   - lu par le navigateur   : PDF et images. Le navigateur sait afficher une page de PDF en image,
//                              ce qui permet de faire lire les pages scannées par l'IA (voir vue.js) ;
//   - pas lu                 : plans, vidéos, archives… Le fichier est seulement rangé (pièce jointe).

import { lireZip, lireTexteDansZip } from 'ktec/zip.js'
import { lireTableur, decoderTexte, decoderEntites } from '../../lib/tableurs.js'
import { lireWord97 } from '../../lib/word97.js'
import { lirePpt } from '../../lib/powerpoint97.js'
import { lireFichierCompose } from '../../lib/fichier-compose.js'

const LUS_PAR_LE_NAVIGATEUR = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']
const TEXTES = ['txt', 'md', 'log', 'json', 'xml', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'nc', 'gcode', 'tap', 'sql', 'eml']

export function extension(nom) {
  return nom.toLowerCase().includes('.') ? nom.toLowerCase().split('.').pop() : ''
}

// Renvoie { lecture: 'serveur', pages: [{ page, texte }] } | { lecture: 'navigateur' } | { lecture: 'aucune' }
export function extraireTexte(nom, octets) {
  const ext = formatReel(nom, octets)
  if (LUS_PAR_LE_NAVIGATEUR.includes(ext)) return { lecture: 'navigateur' }

  if (ext === 'docx' || ext === 'docm') return serveur(lireWord(octets))
  if (ext === 'doc') return serveur(lireWord97(octets))
  if (ext === 'odt') return serveur(lireOdt(octets))
  if (ext === 'pptx') return { lecture: 'serveur', pages: lirePowerPoint(octets) }
  if (ext === 'ppt' || ext === 'pps') return { lecture: 'serveur', pages: lirePpt(octets) }
  if (['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext)) return { lecture: 'serveur', pages: lireTableaux(nom, octets) }
  if (ext === 'html' || ext === 'htm') return serveur(texteDuHtml(decoderTexte(octets)))
  if (ext === 'rtf') return serveur(texteDuRtf(decoderTexte(octets)))
  if (TEXTES.includes(ext)) return serveur(decoderTexte(octets))
  return { lecture: 'aucune' }
}

// Certains fichiers ont une extension trompeuse (un .docx renommé en .doc, par exemple) :
// on regarde d'abord les premiers octets du fichier.
function formatReel(nom, octets) {
  const ext = extension(nom)
  const debut = octets.subarray(0, 8)
  const estZip = debut[0] === 0x50 && debut[1] === 0x4b
  const estCompose = debut.readUInt32LE?.(0) === 0xe011cfd0
  if (['doc', 'docx', 'dot', 'dotx'].includes(ext)) {
    if (estZip) return 'docx'
    if (estCompose) return 'doc'
    if (octets.subarray(0, 5).toString() === '{\\rtf') return 'rtf'
  }
  if (['ppt', 'pps', 'pptx'].includes(ext)) return estZip ? 'pptx' : estCompose ? 'ppt' : ext
  if (['xls', 'xlsx'].includes(ext)) return estZip ? 'xlsx' : estCompose ? 'xls' : ext
  return ext
}

function serveur(texte) {
  return { lecture: 'serveur', pages: [{ page: null, texte }] }
}

// ---------------------------------------------------------------- Word (.docx)

function lireWord(octets) {
  const xml = lireTexteDansZip(lireZip(octets), 'word/document.xml') || ''
  return xml
    .split(/<\/w:p>/)
    .map((paragraphe) =>
      decoderEntites(
        paragraphe
          .replace(/<w:tab\/>/g, '\t')
          .replace(/<w:br\/>/g, '\n')
          .replace(/<\/w:tc>/g, ' | ') // cellules de tableau
          .replace(/<(?!\/?w:t[ >])[^>]+>/g, '')
          .replace(/<\/?w:t[^>]*>/g, ''),
      ),
    )
    .join('\n')
}

// ---------------------------------------------------------------- LibreOffice (.odt)

function lireOdt(octets) {
  const xml = lireTexteDansZip(lireZip(octets), 'content.xml') || ''
  return decoderEntites(
    xml
      .replace(/<text:s[^>]*\/>/g, ' ')
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<\/text:(p|h)>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

// ---------------------------------------------------------------- PowerPoint (.pptx) : une « page » par diapositive

function lirePowerPoint(octets) {
  const fichiers = lireZip(octets)
  return fichiers
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.nom))
    .map((f) => ({ page: Number(f.nom.match(/(\d+)\.xml$/)[1]), xml: f.lire().toString('utf8') }))
    .sort((a, b) => a.page - b.page)
    .map(({ page, xml }) => ({
      page,
      texte: decoderEntites(xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('')).join('\n')),
    }))
}

// ---------------------------------------------------------------- tableaux : une ligne = « en-tête : valeur » pour que l'IA comprenne

function lireTableaux(nom, octets) {
  return lireTableur(nom, octets).map(({ feuille, lignes }) => {
    const [entete = [], ...donnees] = lignes
    const texte = donnees
      .map((ligne) => ligne.map((valeur, i) => (valeur ? `${entete[i] || 'colonne ' + (i + 1)} : ${valeur}` : '')).filter(Boolean).join(' ; '))
      .join('\n')
    return { page: null, texte: `Tableau « ${feuille} »\n${texte}` }
  })
}

// ---------------------------------------------------------------- HTML et RTF

function texteDuHtml(html) {
  return decoderEntites(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

function texteDuRtf(rtf) {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (_, code) => new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(code, 16)])))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
}

// ---------------------------------------------------------------- images contenues dans un document

const DOSSIERS_IMAGES = /^(word|ppt|xl)\/media\/|^Pictures\//
const TAILLE_MIN_IMAGE = 15_000 // en dessous : logos, puces, icônes
const IMAGES_MAX = 40

// Les images (photos, captures d'écran, schémas) d'un document Word, PowerPoint, Excel ou LibreOffice.
// Renvoie [{ nom, octets }], sans les petites images ni les doublons (logo répété à chaque page…).
export function imagesDuDocument(nom, octets) {
  const ext = formatReel(nom, octets)
  let images = []
  try {
    if (['docx', 'docm', 'pptx', 'xlsx', 'xlsm', 'odt', 'ods', 'odp'].includes(ext)) {
      images = lireZip(octets)
        .filter((f) => DOSSIERS_IMAGES.test(f.nom) && /\.(png|jpe?g|gif|bmp)$/i.test(f.nom))
        .map((f) => ({ nom: f.nom.split('/').pop(), octets: f.lire() }))
    } else if (ext === 'doc' || ext === 'ppt') {
      // Ancien Word : images dans le flux « Data » ; ancien PowerPoint : dans le flux « Pictures ».
      const donnees = lireFichierCompose(octets).get(ext === 'doc' ? 'Data' : 'Pictures')
      if (donnees) images = chercherImages(donnees)
    }
  } catch {
    return []
  }
  const vues = new Set()
  return images
    .filter((image) => image.octets.length >= TAILLE_MIN_IMAGE)
    .filter((image) => {
      const cle = image.octets.length + ':' + image.octets.subarray(0, 64).toString('hex')
      if (vues.has(cle)) return false
      vues.add(cle)
      return true
    })
    .slice(0, IMAGES_MAX)
}

// Dans un ancien .doc ou .ppt, les images sont rangées les unes après les autres dans un flux :
// on repère les débuts et fins de fichiers PNG et JPEG.
function chercherImages(donnees) {
  const images = []
  let position = 0
  while (position < donnees.length) {
    const png = donnees.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), position)
    const jpeg = donnees.indexOf(Buffer.from([0xff, 0xd8, 0xff]), position)
    const debut = [png, jpeg].filter((p) => p >= 0).sort((a, b) => a - b)[0]
    if (debut === undefined) break
    const fin = debut === png ? finDuPng(donnees, debut) : finDuJpeg(donnees, debut)
    if (fin < 0) {
      position = debut + 3 // signature trouvée au hasard des octets : on continue après
      continue
    }
    images.push({ nom: `image${images.length + 1}.${debut === png ? 'png' : 'jpg'}`, octets: Buffer.from(donnees.subarray(debut, fin)) })
    position = fin
  }
  return images
}

function finDuPng(donnees, debut) {
  const iend = donnees.indexOf(Buffer.from('IEND'), debut)
  return iend < 0 ? -1 : iend + 8
}

// Un JPEG est une suite de segments (marqueur FF xx + longueur) jusqu'aux données de l'image (FF DA) ;
// dans ces données, FF D9 ne peut apparaître qu'à la fin.
function finDuJpeg(donnees, debut) {
  let position = debut + 2
  while (position + 4 <= donnees.length) {
    if (donnees[position] !== 0xff) return -1
    const marqueur = donnees[position + 1]
    if (marqueur === 0xff) {
      position++ // octet de remplissage
      continue
    }
    const longueur = donnees.readUInt16BE(position + 2)
    if (marqueur === 0xda) {
      const fin = donnees.indexOf(Buffer.from([0xff, 0xd9]), position + 2 + longueur)
      return fin < 0 ? -1 : fin + 2
    }
    position += 2 + longueur
  }
  return -1
}
