// Le menu d'AITEC, chargé par la coquille commune de KTEC (page /aitec/).
// Seuls le tableau de bord, l'assistant, les pannes connues, la maintenance de niveau 1 et l'administration sont au menu (menu: true) ; les autres écrans
// s'ouvrent depuis les sources citées par l'IA ou depuis l'administration.

import { h, ic } from '/socle/ui.js'
import { estConcombre, concombreMasque } from './concombre.js'
import { selecteurParc, rafraichirParcs } from './parcs.js'
import tableauDeBord from '../blocs/tableau-de-bord/vue.js'
import assistant from '../blocs/assistant/vue.js'
import parc from '../blocs/parc/vue.js'
import interventions from '../blocs/interventions/vue.js'
import documents from '../blocs/documents/vue.js'
import importGmao from '../blocs/import-gmao/vue.js'
import administration from '../blocs/administration/vue.js'
import aide from '../blocs/aide/vue.js'
import recherche from '../blocs/recherche/vue.js'
import pannes from '../blocs/pannes/vue.js'
import analyse from '../blocs/analyse/vue.js'
import mn1 from '../blocs/mn1/vue.js'

export const blocs = [tableauDeBord, assistant, pannes, mn1, administration, parc, interventions, documents, importGmao, aide, recherche, analyse]
export { assistant as accueil }

// Le champ de recherche est créé une seule fois : redessiner la barre ne doit pas effacer ce qu'on tape.
const champRecherche = h('input', {
  type: 'search',
  placeholder: 'Rechercher dans toute la base…',
  onkeydown: (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return
    if (estConcombre(e.target.value)) {
      e.target.value = ''
      return concombreMasque()
    }
    location.hash = `#/recherche?q=${encodeURIComponent(e.target.value.trim())}`
  },
})
export const barre = () => [selecteurParc(), h('div', { class: 'recherche' }, ic('loupe', 17), champRecherche)]

// Les parcs du sélecteur : lus à l'ouverture (et après leur réglage dans Administration).
export const auDemarrage = () => rafraichirParcs()
export const styles = 'interface/app.css'
