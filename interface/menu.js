// Le menu d'AITEC, chargé par la coquille commune de KTEC (page /aitec/).
// Seuls l'assistant, la maintenance de niveau 1 (sans PREVTEC) et l'administration sont au menu (menu: true) ; les autres écrans
// (dont les pannes connues) s'ouvrent depuis les sources citées par l'IA ou depuis l'administration.

import { h, ic } from '/socle/ui.js'
import { estConcombre, concombreMasque } from './concombre.js'
import { selecteurParc, rafraichirParcs } from './parcs.js'
import assistant from '../blocs/assistant/vue.js'
import interventions from '../blocs/interventions/vue.js'
import documents from '../blocs/documents/vue.js'
import importGmao from '../blocs/import-gmao/vue.js'
import administration from '../blocs/administration/vue.js'
import aide from '../blocs/aide/vue.js'
import recherche from '../blocs/recherche/vue.js'
import pannes from '../blocs/pannes/vue.js'
import analyse from '../blocs/analyse/vue.js'
import mn1 from '../blocs/mn1/vue.js'

import { api, appli } from '/socle/api.js'

// La maintenance de niveau 1 et le plan de maintenance ont leur porte, PREVTEC (app.json « portes ») : AITEC ne garde
// que le dépannage. Avec un K.NOVA trop ancien pour les portes, l'écran reste ici.
const avecPrevtec = appli === 'aitec' && (await api('/api/ktec/applis').catch(() => [])).some((a) => a.id === 'prevtec')
window.aitecAvecPrevtec = avecPrevtec
export const blocs = [assistant, pannes, ...(avecPrevtec ? [] : [mn1]), administration, interventions, documents, importGmao, aide, recherche, analyse]
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
export const barre = () => [h('div', { class: 'recherche' }, ic('loupe', 17), champRecherche)]

// Le choix du parc : centré, en grand, sous le titre des écrans qui en tiennent compte (parcs: true).
export function apresAffichage(zone, bloc) {
  if (!bloc.parcs) return
  const entete = zone.querySelector('.entete-page, .bandeau-mn1')
  const choix = h('div', { class: 'zone-parcs' }, selecteurParc())
  if (entete) entete.after(choix)
  else zone.prepend(choix)
}

// Les parcs du sélecteur : lus à l'ouverture (et après leur réglage dans Administration).
export const auDemarrage = () => rafraichirParcs()
export const styles = 'interface/app.css'
