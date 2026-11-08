// Une surprise de PREVTEC : taper « concombre » sur un écran (hors d'un champ de saisie) fait pleuvoir des concombres,
// le plan de maintenance passe aux légumes, et tout revient au bout de 15 secondes.

import { concombreMasque } from './concombre.js'

const MOT = 'concombre'
const DUREE = 15_000
const LEGUMES = [['Démonstrateur', 'Concombrateur'], ['Contributeurs du mois', 'Concombres du mois'], ['Plan de maintenance', 'Plan de culture'], ['Je décide', 'Je récolte'], ['Pannes', 'Limaces']]
const QUOI = 'h1, h2, .texte-hof, .etape-fil span, .titre-tuile, .menu a span'

function auxLegumes() {
  const changes = []
  for (const e of document.querySelectorAll(QUOI)) {
    for (const n of e.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE) continue
      const texte = LEGUMES.reduce((t, [de, vers]) => t.replace(de, vers), n.textContent)
      if (texte !== n.textContent) { changes.push([n, n.textContent]); n.textContent = texte }
    }
  }
  document.body.classList.add('mode-concombre')
  setTimeout(() => {
    document.body.classList.remove('mode-concombre')
    for (const [n, texte] of changes) n.textContent = texte
  }, DUREE)
}

export function installerConcombre() {
  let tape = ''
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.target.closest?.('input, textarea, select, [contenteditable]')) return
    tape = (tape + e.key.toLowerCase()).slice(-MOT.length)
    if (tape !== MOT) return
    tape = ''
    concombreMasque()
    auxLegumes()
  })
}
