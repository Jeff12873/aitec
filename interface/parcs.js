// Le sélecteur de parc, en haut d'AITEC : « Tous » ou un parc (réglés dans Administration › Parcs machines).
// Un seul parc à la fois, valable pour tous les écrans ; remis à « Tous » à chaque ouverture d'AITEC.
// Les écrans ajoutent ?parc=… à leurs demandes avec avecParc(adresse).

import { h, vider } from '/socle/ui.js'
import { api } from '/socle/api.js'

let choisi = ''
let liste = []
const element = h('div', { class: 'selecteur-parc', role: 'tablist', 'aria-label': 'Parc machines' })

export const parcChoisi = () => choisi
export const nomParcChoisi = () => liste.find((p) => p.id === choisi)?.nom || ''
export const avecParc = (adresse) => (choisi ? `${adresse}${adresse.includes('?') ? '&' : '?'}parc=${encodeURIComponent(choisi)}` : adresse)

export async function rafraichirParcs() {
  try {
    liste = await api('/api/parcs')
  } catch {
    liste = []
  }
  if (!liste.some((p) => p.id === choisi)) choisi = ''
  dessiner()
}

function dessiner() {
  // Pas de parc réglé (ou seulement « Non classé ») : pas de sélecteur.
  if (!liste.some((p) => !p.nonClasse)) return vider(element)
  const pastille = (id, nom, titre, classe = '') => h('button', {
    class: `pastille-ligne${choisi === id ? ' choisie' : ''} ${classe}`,
    role: 'tab',
    'aria-selected': String(choisi === id),
    title: titre,
    onclick: () => {
      if (choisi === id) return
      choisi = id
      dessiner()
      window.ktec?.recharger()
    },
  }, nom)
  vider(element,
    pastille('', 'Tous', 'Tous les parcs (sauf les racines masquées)'),
    liste.map((p) => pastille(p.id, p.nom, `${p.nom} — ${p.machines.toLocaleString('fr-FR')} machines${p.nonClasse ? ' (racines à ranger dans Administration)' : ''}`, p.nonClasse ? 'non-classe' : '')))
}

export const selecteurParc = () => element
