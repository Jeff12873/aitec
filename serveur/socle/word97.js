// Lecture du texte des anciens fichiers Word (.doc, Word 97 à 2003), sans bibliothèque.
//
// Un .doc est un « fichier composé » (format CFB, comme un petit disque avec des fichiers dedans).
// Le texte est dans le flux « WordDocument », découpé en morceaux (« pièces ») dont la liste
// est rangée dans le flux « 0Table » ou « 1Table ». Références : documentation Microsoft [MS-CFB] et [MS-DOC].
//
// Seul le texte est lu (pas les images ni la mise en forme). Les fichiers protégés par mot de passe sont refusés.

const FIN_DE_CHAINE = 0xfffffffe

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

// ---------------------------------------------------------------- fichier composé (CFB)

// Renvoie une Map nom → contenu de chaque flux.
export function lireFichierCompose(octets) {
  if (octets.readUInt32LE(0) !== 0xe011cfd0 || octets.readUInt32LE(4) !== 0xe11ab1a1) throw new Error('ce n’est pas un ancien fichier Office')
  const tailleSecteur = 1 << octets.readUInt16LE(0x1e)
  const tailleMiniSecteur = 1 << octets.readUInt16LE(0x20)
  const limiteMini = octets.readUInt32LE(0x38)
  const secteur = (numero) => octets.subarray((numero + 1) * tailleSecteur, (numero + 2) * tailleSecteur)

  // Table d'allocation (FAT) : ses secteurs sont listés dans l'en-tête, puis dans des secteurs « DIFAT ».
  const secteursFat = []
  for (let i = 0; i < 109; i++) {
    const numero = octets.readUInt32LE(0x4c + i * 4)
    if (numero < FIN_DE_CHAINE - 2) secteursFat.push(numero)
  }
  let difat = octets.readUInt32LE(0x44)
  for (let n = octets.readUInt32LE(0x48); n > 0 && difat < FIN_DE_CHAINE - 2; n--) {
    const s = secteur(difat)
    for (let i = 0; i < tailleSecteur / 4 - 1; i++) {
      const numero = s.readUInt32LE(i * 4)
      if (numero < FIN_DE_CHAINE - 2) secteursFat.push(numero)
    }
    difat = s.readUInt32LE(tailleSecteur - 4)
  }
  const fat = Buffer.concat(secteursFat.map(secteur))
  const suivant = (numero) => fat.readUInt32LE(numero * 4)

  const lireChaine = (depart, taille) => {
    const morceaux = []
    for (let n = depart, garde = 0; n < FIN_DE_CHAINE - 2 && garde < 1e6; n = suivant(n), garde++) morceaux.push(secteur(n))
    const tout = Buffer.concat(morceaux)
    return taille === undefined ? tout : tout.subarray(0, taille)
  }

  // Répertoire : 128 octets par entrée
  const repertoire = lireChaine(octets.readUInt32LE(0x30))
  const entrees = []
  for (let i = 0; i + 128 <= repertoire.length; i += 128) {
    const longueurNom = repertoire.readUInt16LE(i + 0x40)
    entrees.push({
      nom: repertoire.toString('utf16le', i, i + Math.max(0, longueurNom - 2)),
      type: repertoire[i + 0x42],
      depart: repertoire.readUInt32LE(i + 0x74),
      taille: repertoire.readUInt32LE(i + 0x78),
      gauche: repertoire.readUInt32LE(i + 0x44),
      droite: repertoire.readUInt32LE(i + 0x48),
      enfant: repertoire.readUInt32LE(i + 0x4c),
    })
  }

  // Les petits flux sont rangés dans le « mini-flux », découpé en mini-secteurs de 64 octets.
  const racine = entrees.find((e) => e.type === 5)
  const miniFlux = racine ? lireChaine(racine.depart, racine.taille) : Buffer.alloc(0)
  const miniFat = octets.readUInt32LE(0x40) ? lireChaine(octets.readUInt32LE(0x3c)) : Buffer.alloc(0)
  const lireMiniChaine = (depart, taille) => {
    const morceaux = []
    for (let n = depart, garde = 0; n < FIN_DE_CHAINE - 2 && garde < 1e6; n = miniFat.readUInt32LE(n * 4), garde++) {
      morceaux.push(miniFlux.subarray(n * tailleMiniSecteur, (n + 1) * tailleMiniSecteur))
    }
    return Buffer.concat(morceaux).subarray(0, taille)
  }

  // On ne garde que les flux posés directement à la racine : un objet incorporé (autre document Word,
  // image…) a ses propres flux « WordDocument » ou « 1Table », qu'il ne faut pas confondre avec ceux du document.
  // Les enfants d'un dossier forment un arbre : on le parcourt par ses branches gauche et droite.
  const flux = new Map()
  const parcourir = (numero, garde = 0) => {
    if (numero >= entrees.length || garde > entrees.length) return
    const entree = entrees[numero]
    parcourir(entree.gauche, garde + 1)
    parcourir(entree.droite, garde + 1)
    if (entree.type === 2) flux.set(entree.nom, entree.taille < limiteMini ? lireMiniChaine(entree.depart, entree.taille) : lireChaine(entree.depart, entree.taille))
  }
  if (racine) parcourir(racine.enfant)
  return flux
}
