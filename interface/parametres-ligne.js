// Le menu de paramétrage de « Ma ligne » (administrateur, commun au site) : les indicateurs affichés, Pareto ou
// Démonstrateur, ce que disent les carrés des ETH, et les étiquettes du préventif avec les écrans où elles comptent.

import { h, vider, ic, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'

const INDICATEURS = [['pannes', 'Pannes'], ['heures', 'Temps passé à dépanner'], ['preventif', 'Part du préventif'], ['tmcd', 'Dépanneurs par panne (TMCD)'], ['concentration', 'Où sont les pannes']]
const VARIABLES = [['pannes', 'Pannes'], ['visites', 'Visites'], ['aRegarder', 'Machines à regarder'], ['evolution', 'Évolution des pannes'], ['heures', 'Heures de dépannage'], ['ratio', 'Visites par panne']]
const ECRANS = [['verdict', 'Verdict'], ['indicateurs', 'Indicateurs'], ['tableau', 'Tableau des ETH'], ['demonstrateur', 'Démonstrateur']]

const cases = (liste, choisies) => {
  const elements = liste.map(([cle, texte]) => [cle, h('input', { type: 'checkbox', checked: choisies.includes(cle) }), texte])
  return { element: h('div', { class: 'cases-parametres' }, elements.map(([, c, t]) => h('label', { class: 'case' }, c, ` ${t}`))), valeur: () => elements.filter(([, c]) => c.checked).map(([k]) => k) }
}
const radios = (nom, liste, valeur) => {
  const elements = liste.map(([cle, texte]) => [cle, h('input', { type: 'radio', name: nom, checked: valeur === cle }), texte])
  return { element: h('div', { class: 'cases-parametres' }, elements.map(([, c, t]) => h('label', { class: 'case' }, c, ` ${t}`))), valeur: () => elements.find(([, c]) => c.checked)?.[0] }
}

export async function reglerAffichage(parc, apres) {
  const [r, eq] = await Promise.all([essayer(() => api('/api/mn1/affichage')), api(`/api/mn1/parcs/${encodeURIComponent(parc.id)}/equilibre`).catch(() => null)])
  if (!r) return
  const a = r.affichage
  const indicateurs = cases(INDICATEURS, a.indicateurs)
  const panneau = radios('panneau', [['demonstrateur', 'Démonstrateur'], ['pareto', 'Pareto des pannes']], a.panneau)
  const carres = cases(VARIABLES, a.carres)
  const nomCarres = radios('nom-carres', [['repere', 'Le repère'], ['designation', 'Le nom de la machine ou de l’ETH']], a.nomCarres)
  const eths = [...new Map((eq?.equipements || []).filter((e) => e.eth).map((e) => [e.eth.id, e.eth])).values()]
  const nomsEth = new Map(eths.map((e) => [e.id, h('input', { type: 'text', value: a.nomsEth[e.id] || '', maxlength: 30, placeholder: e.code })]))

  const etiquettes = r.etiquettes.map((e) => ({ ...e, ecrans: { ...e.ecrans } }))
  const corps = h('tbody')
  const dessiner = () => vider(corps, etiquettes.map((e) => h('tr', {},
    h('td', {}, h('input', { type: 'text', value: e.nom, maxlength: 40, placeholder: 'Nom', oninput: (x) => (e.nom = x.target.value) })),
    h('td', {}, h('input', { type: 'text', value: e.interet, maxlength: 160, placeholder: 'À quoi elle sert', oninput: (x) => (e.interet = x.target.value) })),
    ECRANS.map(([cle]) => h('td', { class: 'centre' }, h('input', { type: 'checkbox', checked: Boolean(e.ecrans[cle]), disabled: e.role === 'panne', title: e.role === 'panne' ? 'Une panne compte partout' : '', onchange: (x) => (e.ecrans[cle] = x.target.checked) }))),
    h('td', {}, e.base ? null : h('button', { class: 'discret icone-seule petit', title: 'Retirer cette étiquette', onclick: () => { etiquettes.splice(etiquettes.indexOf(e), 1); dessiner() } }, ic('x', 13))))))
  dessiner()
  const symptomes = h('textarea', { rows: 12, spellcheck: false }, r.symptomes)
  const section = (titre, aide, ...contenu) => h('section', { class: 'section-parametres' }, h('h3', {}, titre), aide ? h('p', { class: 'discret petit-texte' }, aide) : null, ...contenu)
  const ok = await fenetre({
    titre: 'Paramètres de « Ma ligne »',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Communs à tout le site, pour toutes les lignes.'),
      section('Indicateurs affichés', '', indicateurs.element),
      section('Panneau du bas', '', panneau.element),
      section('Les carrés du tableau', 'Ce qui s’écrit dans les carrés des ETH (Hors ETH garde pannes et visites).', carres.element, h('p', { class: 'discret petit-texte' }, 'Nom affiché dans les carrés :'), nomCarres.element,
        eths.length ? h('details', {}, h('summary', {}, 'Renommer une ETH de cette ligne'), h('div', { class: 'noms-eth' }, eths.map((e) => h('label', { class: 'champ' }, h('span', {}, e.code), nomsEth.get(e.id))))) : null),
      section('Étiquettes du préventif', 'Dans quels écrans chacune compte. Une nouvelle étiquette s’attribue à la main, dans « Préventif & entretiens », sous le tableau.',
        h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau grille-etiquettes' }, h('thead', {}, h('tr', {}, h('th', {}, 'Étiquette'), h('th', {}, 'Intérêt'), ECRANS.map(([, t]) => h('th', { class: 'centre' }, t)), h('th'))), corps)),
        h('button', { class: 'petit discret', onclick: () => { etiquettes.push({ id: '', nom: '', interet: '', role: 'visite', base: false, ecrans: {} }); dessiner() } }, ic('plus', 13), 'Une étiquette')),
      section('Symptômes classiques par élément', 'L’IA les cite dans les points de contrôle. Une ligne par élément : « Élément / autre nom : symptôme ; symptôme ».', symptomes)),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => {
        await api('/api/mn1/affichage', { methode: 'POST', corps: { indicateurs: indicateurs.valeur(), panneau: panneau.valeur(), carres: carres.valeur(), nomCarres: nomCarres.valeur(), nomsEth: { ...a.nomsEth, ...Object.fromEntries([...nomsEth].map(([id, champ]) => [id, champ.value])) } } })
        await api('/api/mn1/etiquettes', { methode: 'POST', corps: { etiquettes } })
        await api('/api/mn1/symptomes', { methode: 'POST', corps: { texte: symptomes.value } })
        return true
      } },
    ],
  })
  if (ok) { notifier('Paramètres enregistrés'); apres() }
}
