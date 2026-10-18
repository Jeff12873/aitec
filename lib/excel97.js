// Lecture des anciens classeurs Excel (.xls, Excel 97 à 2003), sans bibliothèque.
//
// Le classeur est le flux « Workbook » d'un fichier composé (voir fichier-compose.js). C'est une suite
// d'« enregistrements » : [type sur 2 octets][longueur sur 2 octets][contenu]. Référence : [MS-XLS].
// On lit le nom des feuilles, les textes partagés (table « SST ») et la valeur de chaque cellule.
//
// lireXls(octets) → [{ feuille: 'Feuil1', lignes: [['A1', 'B1'], …] }], comme lireTableur (tableurs.js).

import { lireFichierCompose } from './fichier-compose.js'

const BOF = 0x0809
const FEUILLE = 0x0085 // BOUNDSHEET : nom et position d'une feuille
const SST = 0x00fc // textes partagés
const CONTINUE = 0x003c
const TEXTE_PARTAGE = 0x00fd // LABELSST
const TEXTE = 0x0204 // LABEL
const NOMBRE = 0x0203
const RK = 0x027e
const MULRK = 0x00bd
const FORMULE = 0x0006
const RESULTAT_TEXTE = 0x0207 // STRING : résultat texte de la formule qui précède
const BOOLEEN = 0x0205

export function lireXls(octets) {
  const flux = lireFichierCompose(octets)
  const classeur = flux.get('Workbook') || flux.get('Book')
  if (!classeur) throw new Error('classeur Excel non reconnu')
  if (flux.has('EncryptionInfo')) throw new Error('classeur protégé par un mot de passe')

  const enregistrements = lireEnregistrements(classeur)
  const feuilles = new Map() // position de la feuille dans le flux → { feuille, lignes }
  let textes = []
  let feuille = null
  let formuleEnAttente = null

  enregistrements.forEach((e, i) => {
    const c = e.contenu
    if (e.type === FEUILLE && c[5] === 0) {
      feuilles.set(c.readUInt32LE(0), { feuille: lireTexteCourt(c, 6), lignes: [] })
    } else if (e.type === SST) {
      const suite = [c]
      for (let j = i + 1; enregistrements[j]?.type === CONTINUE; j++) suite.push(enregistrements[j].contenu)
      textes = lireTextesPartages(suite)
    } else if (e.type === BOF) {
      feuille = feuilles.get(e.position) || null // null : feuille de graphique ou partie globale
    } else if (feuille) {
      const placer = (ligne, colonne, valeur) => {
        const lignes = feuille.lignes
        while (lignes.length <= ligne) lignes.push([])
        while (lignes[ligne].length < colonne) lignes[ligne].push('')
        lignes[ligne][colonne] = String(valeur).trim()
      }
      if (e.type === TEXTE_PARTAGE) placer(c.readUInt16LE(0), c.readUInt16LE(2), textes[c.readUInt32LE(6)] ?? '')
      else if (e.type === TEXTE) placer(c.readUInt16LE(0), c.readUInt16LE(2), lireTexteLong(c, 6))
      else if (e.type === NOMBRE) placer(c.readUInt16LE(0), c.readUInt16LE(2), nombre(c.readDoubleLE(6)))
      else if (e.type === RK) placer(c.readUInt16LE(0), c.readUInt16LE(2), nombre(lireRk(c.readUInt32LE(6))))
      else if (e.type === MULRK) {
        const ligne = c.readUInt16LE(0)
        const premiere = c.readUInt16LE(2)
        for (let k = 0; 4 + k * 6 + 6 <= c.length - 2; k++) placer(ligne, premiere + k, nombre(lireRk(c.readUInt32LE(4 + k * 6 + 2))))
      } else if (e.type === BOOLEEN) {
        if (c[7] === 0) placer(c.readUInt16LE(0), c.readUInt16LE(2), c[6] ? 'VRAI' : 'FAUX')
      } else if (e.type === FORMULE) {
        // Résultat déjà calculé par Excel : un nombre, ou (si les 2 derniers octets valent FFFF) autre chose.
        if (c.readUInt16LE(12) !== 0xffff) placer(c.readUInt16LE(0), c.readUInt16LE(2), nombre(c.readDoubleLE(6)))
        else if (c[6] === 0) formuleEnAttente = { ligne: c.readUInt16LE(0), colonne: c.readUInt16LE(2) }
        else if (c[6] === 1) placer(c.readUInt16LE(0), c.readUInt16LE(2), c[8] ? 'VRAI' : 'FAUX')
      } else if (e.type === RESULTAT_TEXTE && formuleEnAttente) {
        placer(formuleEnAttente.ligne, formuleEnAttente.colonne, lireTexteLong(c, 0))
        formuleEnAttente = null
      }
    }
  })

  return [...feuilles.values()].map(({ feuille, lignes }) => ({ feuille, lignes: lignes.filter((l) => l.some((v) => v !== '')) }))
}

function lireEnregistrements(flux) {
  const liste = []
  for (let position = 0; position + 4 <= flux.length; ) {
    const type = flux.readUInt16LE(position)
    const longueur = flux.readUInt16LE(position + 2)
    liste.push({ type, position, contenu: flux.subarray(position + 4, position + 4 + longueur) })
    position += 4 + longueur
  }
  return liste
}

// 49.50000000001 → 49.5
function nombre(valeur) {
  return Number(valeur.toPrecision(12))
}

// Nombre « RK » : forme compacte d'Excel (entier sur 30 bits, ou début d'un nombre à virgule, éventuellement × 100).
function lireRk(rk) {
  let valeur
  if (rk & 0x02) valeur = rk >> 2
  else {
    const tampon = Buffer.alloc(8)
    tampon.writeUInt32LE(rk & 0xfffffffc, 4)
    valeur = tampon.readDoubleLE(0)
  }
  return rk & 0x01 ? valeur / 100 : valeur
}

// Nom de feuille : longueur sur 1 octet, puis un octet d'options (1 = caractères sur 2 octets).
function lireTexteCourt(c, position) {
  const longueur = c[position]
  return c[position + 1] & 1 ? c.toString('utf16le', position + 2, position + 2 + longueur * 2) : c.toString('latin1', position + 2, position + 2 + longueur)
}

// Texte de cellule : longueur sur 2 octets, puis un octet d'options.
function lireTexteLong(c, position) {
  const longueur = c.readUInt16LE(position)
  return c[position + 2] & 1 ? c.toString('utf16le', position + 3, position + 3 + longueur * 2) : c.toString('latin1', position + 3, position + 3 + longueur)
}

// Table des textes partagés. Elle peut déborder sur plusieurs enregistrements CONTINUE ;
// un texte coupé reprend dans l'enregistrement suivant avec un nouvel octet d'options.
function lireTextesPartages(morceaux) {
  let m = 0
  let position = 8 // on saute les deux compteurs du début
  const octet = () => {
    if (position >= morceaux[m].length) {
      m++
      position = 0
    }
    return morceaux[m][position++]
  }
  const entier16 = () => octet() | (octet() << 8)
  const entier32 = () => (entier16() | (entier16() << 16)) >>> 0
  const sauter = (n) => {
    for (let i = 0; i < n; i++) octet()
  }

  const nombreTextes = morceaux[0].readUInt32LE(4)
  const textes = []
  for (let t = 0; t < nombreTextes && m < morceaux.length; t++) {
    const longueur = entier16()
    const options = octet()
    const miseEnForme = options & 0x08 ? entier16() : 0
    const extension = options & 0x04 ? entier32() : 0
    let large = options & 0x01
    let texte = ''
    for (let i = 0; i < longueur; i++) {
      if (position >= morceaux[m].length) {
        // le texte continue dans l'enregistrement suivant, qui commence par son propre octet d'options
        m++
        position = 0
        large = morceaux[m][position++] & 0x01
      }
      texte += String.fromCharCode(large ? entier16() : octet())
    }
    sauter(miseEnForme * 4 + extension)
    textes.push(texte)
  }
  return textes
}
