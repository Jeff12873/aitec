// Lecture du texte des anciens fichiers Word (.doc, Word 97 à 2003), sans bibliothèque.
//
// Un .doc est un « fichier composé » (voir fichier-compose.js).
// Le texte est dans le flux « WordDocument », découpé en morceaux (« pièces ») dont la liste
// est rangée dans le flux « 0Table » ou « 1Table ». Références : documentation Microsoft [MS-CFB] et [MS-DOC].
//
// Seul le texte est lu (pas les images ni la mise en forme). Les fichiers protégés par mot de passe sont refusés.

import { lireFichierCompose } from './fichier-compose.js'

export function lireWord97(octets) {
  const flux = lireFichierCompose(octets)
  const document = flux.get('WordDocument')
  if (!document) throw new Error('fichier Word 97 non reconnu')

  // FIB : l'en-tête du document Word
  const options = document.readUInt16LE(0x0a)
  if (options & 0x0100) throw new Error('document protégé par un mot de passe')
  const table = flux.get(options & 0x0200 ? '1Table' : '0Table')
  if (!table) throw new Error('table du document introuvable')

  // Position de la liste des pièces (fcClx / lcbClx), après les parties de longueur variable du FIB.
  const csw = document.readUInt16LE(32)
  const cslw = document.readUInt16LE(34 + csw * 2)
  const debutFcLcb = 34 + csw * 2 + 2 + cslw * 4 + 2
  const fcClx = document.readUInt32LE(debutFcLcb + 66 * 4)
  const lcbClx = document.readUInt32LE(debutFcLcb + 67 * 4)

  // Dans la liste, on saute les blocs de mise en forme (type 1) jusqu'à la table des pièces (type 2).
  let position = fcClx
  while (position < fcClx + lcbClx && table[position] === 0x01) position += 3 + table.readInt16LE(position + 1)
  if (table[position] !== 0x02) throw new Error('liste des morceaux de texte introuvable')
  const taille = table.readUInt32LE(position + 1)
  const debut = position + 5
  const nombre = (taille - 4) / 12

  let texte = ''
  for (let i = 0; i < nombre; i++) {
    const cpDebut = table.readUInt32LE(debut + i * 4)
    const cpFin = table.readUInt32LE(debut + (i + 1) * 4)
    const fc = table.readUInt32LE(debut + (nombre + 1) * 4 + i * 8 + 2)
    const longueur = cpFin - cpDebut
    if (fc & 0x40000000) {
      // Texte « compressé » : un octet par caractère, en Windows-1252
      const depart = (fc & ~0x40000000) / 2
      texte += new TextDecoder('windows-1252').decode(document.subarray(depart, depart + longueur))
    } else {
      texte += document.toString('utf16le', fc, fc + longueur * 2)
    }
  }
  return nettoyer(texte)
}

// Caractères spéciaux de Word : fins de cellule, champs (on garde le résultat, pas le code), images…
function nettoyer(texte) {
  return texte
    .replace(/\x13[^\x13\x14\x15]*\x14/g, '') // code d'un champ, jusqu'au séparateur
    .replace(/\x13[^\x13\x14\x15]*\x15/g, '') // champ sans résultat
    .replace(/[\x14\x15]/g, '')
    .replace(/\x07/g, ' | ') // fin de cellule de tableau
    .replace(/[\r\x0b\x0c]/g, '\n')
    .replace(/[\x00-\x08\x0e-\x1f]/g, '')
}
