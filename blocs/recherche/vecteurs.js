// Les vecteurs de la recherche par le sens, compressés pour alléger le fichier de connaissances.
//
//   ancien format : un nombre float32 par dimension (4 octets chacun) ;
//   compressé     : un octet par dimension, plus un octet d'échelle à la fin.
//
// Les deux coexistent tant que le fichier n'a pas été compacté. Les dimensions étant un multiple de 4 (512),
// seule la longueur d'un ancien vecteur est multiple de 4 : c'est ce qui les distingue.

const estCompresse = (blob) => blob.byteLength % 4 !== 0

// Échelle propre à chaque vecteur : son plus grand nombre occupe toute la plage d'un octet.
export function compresser(vecteur) {
  let plusGrand = 0
  for (const v of vecteur) if (Math.abs(v) > plusGrand) plusGrand = Math.abs(v)
  const echelle = Math.min(255, Math.max(1, Math.ceil(plusGrand * 255)))
  const sortie = new Uint8Array(vecteur.length + 1)
  const nombres = new Int8Array(sortie.buffer, 0, vecteur.length)
  const facteur = (127 * 255) / echelle
  for (let i = 0; i < vecteur.length; i++) nombres[i] = Math.round(vecteur[i] * facteur)
  sortie[vecteur.length] = echelle
  return sortie
}

export const ancienVecteur = (blob) => new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)

// Les vecteurs d'une liste de lignes { id, vecteur }, en mémoire sous forme compacte.
export function rangerEnMemoire(lignes) {
  const premier = lignes[0]?.vecteur
  const dimensions = !premier ? 0 : estCompresse(premier) ? premier.byteLength - 1 : premier.byteLength / 4
  const ids = new Int32Array(lignes.length)
  const nombres = new Int8Array(lignes.length * dimensions)
  const facteurs = new Float32Array(lignes.length)
  lignes.forEach((ligne, i) => {
    const blob = estCompresse(ligne.vecteur) ? ligne.vecteur : compresser(ancienVecteur(ligne.vecteur))
    ids[i] = ligne.id
    nombres.set(new Int8Array(blob.buffer, blob.byteOffset, dimensions), i * dimensions)
    facteurs[i] = blob[dimensions] / (127 * 255)
  })
  return { ids, nombres, facteurs, dimensions }
}
