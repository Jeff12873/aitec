// Calcul des vecteurs (recherche par le sens), en arrière-plan.
//
// Les passages sans vecteur sont traités par lots de 16. Ne tourne qu'en mode administrateur,
// puisque c'est une écriture dans le fichier partagé. S'il est interrompu, il reprend
// au prochain passage en mode administrateur. Sans vecteur, un passage reste trouvable par ses mots.

import { db, transaction } from '../../lib/base.js'
import { etatPartage, noterModification } from 'ktec/partage.js'
import { iaInstallee, vecteurs } from 'ktec/ia.js'
import { journal } from 'ktec/installation.js'
import { compresser, ancienVecteur } from './vecteurs.js'

let enCours = false

export function relancerIndexeur() {
  if (!enCours) setTimeout(indexer, 1000)
}

async function indexer() {
  if (enCours) return
  enCours = true
  try {
    while (etatPartage().admin && iaInstallee()) {
      const lot = db().prepare('SELECT id, texte FROM passages WHERE vecteur IS NULL LIMIT 16').all()
      if (!lot.length) break
      const resultats = await vecteurs(lot.map((p) => p.texte))
      if (!etatPartage().admin) break // le mode administrateur a été quitté pendant le calcul
      const ecrire = db().prepare('UPDATE passages SET vecteur = ? WHERE id = ?')
      lot.forEach((passage, i) => ecrire.run(compresser(resultats[i]), passage.id))
      noterModification()
    }
  } catch (erreur) {
    journal(`Indexation interrompue : ${erreur.message}`)
  } finally {
    enCours = false
  }
}

export function etatIndexation() {
  try {
    const { restants } = db().prepare('SELECT count(*) AS restants FROM passages WHERE vecteur IS NULL').get()
    return { restants, enCours }
  } catch {
    return { restants: 0, enCours }
  }
}

// ---------------------------------------------------------------- compactage (une seule fois par fichier)

const ANCIENS = 'length(vecteur) % 4 = 0'
const tailleBase = () => db().prepare('PRAGMA page_count').get().page_count * db().prepare('PRAGMA page_size').get().page_size

export const resteACompacter = () => Boolean(db().prepare(`SELECT 1 FROM passages WHERE ${ANCIENS} LIMIT 1`).get())

// Compresse les anciens vecteurs, sans l'IA, puis rend au fichier la place libérée.
export function compacterVecteurs() {
  const avant = tailleBase()
  transaction(() => {
    const lire = db().prepare(`SELECT id, vecteur FROM passages WHERE id > ? AND ${ANCIENS} ORDER BY id LIMIT 5000`)
    const ecrire = db().prepare('UPDATE passages SET vecteur = ? WHERE id = ?')
    for (let lot = lire.all(0); lot.length; lot = lire.all(lot.at(-1).id)) {
      for (const { id, vecteur } of lot) ecrire.run(compresser(ancienVecteur(vecteur)), id)
    }
  })
  db().exec('VACUUM')
  return { avant, apres: tailleBase() }
}
