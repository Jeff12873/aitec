// Le menu d'AITEC, chargé par la coquille commune de KTEC (page /aitec/).
// Seuls l'assistant, le tableau de bord et l'administration sont au menu (menu: true) ; les autres écrans
// s'ouvrent depuis les sources citées par l'IA ou depuis l'administration.

import { h, ic } from '/socle/ui.js'
import tableauDeBord from '../blocs/tableau-de-bord/vue.js'
import assistant from '../blocs/assistant/vue.js'
import parc from '../blocs/parc/vue.js'
import interventions from '../blocs/interventions/vue.js'
import documents from '../blocs/documents/vue.js'
import importGmao from '../blocs/import-gmao/vue.js'
import administration from '../blocs/administration/vue.js'
import aide from '../blocs/aide/vue.js'
import recherche from '../blocs/recherche/vue.js'

export const blocs = [assistant, tableauDeBord, administration, parc, interventions, documents, importGmao, aide, recherche]
export { assistant as accueil }

// Le champ de recherche est créé une seule fois : redessiner la barre ne doit pas effacer ce qu'on tape.
const champRecherche = h('input', {
  type: 'search',
  placeholder: 'Rechercher dans toute la base…',
  onkeydown: (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) location.hash = `#/recherche?q=${encodeURIComponent(e.target.value.trim())}`
  },
})
export const barre = () => h('div', { class: 'recherche' }, ic('loupe', 17), champRecherche)
export const styles = 'interface/app.css'
