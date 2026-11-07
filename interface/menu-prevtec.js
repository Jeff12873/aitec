// Le menu de PREVTEC, la réévaluation du plan de maintenance : une porte d'AITEC (app.json « portes »), sur le même
// code et les mêmes données. K.NOVA l'ouvre sur /prevtec/ ; ses appels « /api/… » vont aux routes d'AITEC.
// Un seul écran au menu, le parcours du plan de maintenance (parc → Pareto → machine → décisions → fiches), et
// l'administration ; l'analyse d'une machine et les pannes connues s'ouvrent depuis le parcours.

import { rafraichirParcs } from './parcs.js'
import mn1 from '../blocs/mn1/vue.js'
import administration from '../blocs/administration/vue.js'
import analyse from '../blocs/analyse/vue.js'
import pannes from '../blocs/pannes/vue.js'
import aide from '../blocs/aide/vue.js'

const plan = { ...mn1, titre: 'Plan de maintenance', icone: 'usine' }
export const blocs = [plan, administration, analyse, pannes, aide]
export { plan as accueil }

// Pas de pastilles des parcs dans PREVTEC : on choisit son parc en cliquant sa vignette (étape 1 du parcours).

export const auDemarrage = () => rafraichirParcs()
export const styles = 'interface/app.css'
