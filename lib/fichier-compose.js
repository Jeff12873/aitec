// Lecture des « fichiers composés » (format CFB) : les anciens fichiers Office (.doc, .xls, .ppt).
//
// Un fichier composé est comme un petit disque : des « flux » (des fichiers) rangés dans des secteurs,
// avec une table d'allocation qui dit quel secteur suit quel autre. Référence : documentation Microsoft [MS-CFB].
// Lecteurs qui l'utilisent : word97.js, excel97.js, powerpoint97.js.

const FIN_DE_CHAINE = 0xfffffffe

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
