// Calcul des vecteurs (recherche par le sens), en arrière-plan.
//
// Les passages sans vecteur sont traités par lots de 16. Ne tourne qu'en mode administrateur,
// puisque c'est une écriture dans le fichier partagé. S'il est interrompu, il reprend
// au prochain passage en mode administrateur. Sans vecteur, un passage reste trouvable par ses mots.

import { db } from '../../lib/base.js'
import { etatPartage, noterModification } from 'ktec/partage.js'
import { iaInstallee, vecteurs } from 'ktec/ia.js'
import { journal } from 'ktec/installation.js'

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
      lot.forEach((passage, i) => ecrire.run(new Uint8Array(resultats[i].buffer), passage.id))
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
