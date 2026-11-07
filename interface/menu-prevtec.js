// Le menu de PREVTEC, la réévaluation du plan de maintenance : une porte d'AITEC (app.json « portes »), sur le même
// code et les mêmes données. K.NOVA l'ouvre sur /prevtec/ ; ses appels « /api/… » vont aux routes d'AITEC.
// Un seul écran au menu, le parcours du plan de maintenance (parc → Pareto → machine → décisions → fiches), et
// l'administration ; l'analyse d'une machine et les pannes connues s'ouvrent depuis le parcours.

import { selecteurParc, rafraichirParcs } from './parcs.js'
import mn1 from '../blocs/mn1/vue.js'
import administration from '../blocs/administration/vue.js'
import analyse from '../blocs/analyse/vue.js'
import pannes from '../blocs/pannes/vue.js'
import aide from '../blocs/aide/vue.js'

const plan = { ...mn1, titre: 'Plan de maintenance', icone: 'usine' }
export const blocs = [plan, administration, analyse, pannes, aide]
export { plan as accueil }

export function apresAffichage(zone, bloc) {
  if (!bloc.parcs) return
  // Sous le bandeau ; sans bandeau (page d'un parc), juste sous le fil des étapes, qui reste tout en haut.
  const entete = zone.querySelector('.bandeau-mn1, .entete-page') || zone.querySelector('.fil-etapes')
  const choix = document.createElement('div')
  choix.className = 'zone-parcs'
  choix.append(selecteurParc())
  if (entete) entete.after(choix)
  else zone.prepend(choix)
}

export const auDemarrage = () => rafraichirParcs()
export const styles = 'interface/app.css'
