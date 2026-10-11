// Lecture du texte des documents déposés.
//
// Trois cas, selon le type de fichier :
//   - lu ici, par le serveur : Word, Excel, LibreOffice, PowerPoint, CSV, texte, HTML… ;
//   - lu par le navigateur   : PDF et images. Le navigateur sait afficher une page de PDF en image,
//                              ce qui permet de faire lire les pages scannées par l'IA (voir vue.js) ;
//   - pas lu                 : plans, vidéos, archives… Le fichier est seulement rangé (pièce jointe).

import { lireZip, lireTexteDansZip } from '../../serveur/socle/zip.js'
import { lireTableur, decoderTexte, decoderEntites } from '../../serveur/socle/tableurs.js'

const LUS_PAR_LE_NAVIGATEUR = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']
const TEXTES = ['txt', 'md', 'log', 'json', 'xml', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'nc', 'gcode', 'tap', 'sql', 'eml']

export function extension(nom) {
  return nom.toLowerCase().includes('.') ? nom.toLowerCase().split('.').pop() : ''
}

// Renvoie { lecture: 'serveur', pages: [{ page, texte }] } | { lecture: 'navigateur' } | { lecture: 'aucune' }
export function extraireTexte(nom, octets) {
  const ext = extension(nom)
  if (LUS_PAR_LE_NAVIGATEUR.includes(ext)) return { lecture: 'navigateur' }

  if (ext === 'docx' || ext === 'docm') return serveur(lireWord(octets))
  if (ext === 'odt') return serveur(lireOdt(octets))
  if (ext === 'pptx') return { lecture: 'serveur', pages: lirePowerPoint(octets) }
  if (['xlsx', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext)) return { lecture: 'serveur', pages: lireTableaux(nom, octets) }
  if (ext === 'html' || ext === 'htm') return serveur(texteDuHtml(decoderTexte(octets)))
  if (ext === 'rtf') return serveur(texteDuRtf(decoderTexte(octets)))
  if (TEXTES.includes(ext)) return serveur(decoderTexte(octets))
  return { lecture: 'aucune' }
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
