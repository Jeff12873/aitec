// Le texte d'une fiche : brut, ou mis en forme (une liste numérotée, le début de chaque point en gras jusqu'à « : »).
// On écrit toujours un point par ligne ; la mise en forme se calcule, le texte reste échappé.

import { h, vider } from '/socle/ui.js'

export const echapper = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export const lignesDe = (texte) => String(texte).split('\n').map((x) => x.trim()).filter(Boolean)

export function pointEnHtml(ligne) {
  const m = /^(.{3,90}?) : (.+)$/.exec(ligne)
  return m ? `<b>${echapper(m[1])}</b> : ${echapper(m[2])}` : echapper(ligne)
}
export const pointsEnHtml = (lignes) => `<ol>${lignes.map((l) => `<li>${pointEnHtml(l)}</li>`).join('')}</ol>`

// Le choix du format et son aperçu, sous un champ de texte. Rend { element, format() }.
export function choixFormat(champ, format = 'html') {
  const boutons = h('div', { class: 'segments petits' })
  const apercu = h('div', { class: 'apercu-texte-fiche' })
  const dessiner = () => {
    vider(boutons, [['html', 'Mise en forme'], ['texte', 'Texte sans mise en forme']].map(([cle, texte]) => h('button', { type: 'button', class: format === cle ? 'choisi' : '', onclick: () => { format = cle; dessiner() } }, texte)))
    apercu.hidden = format !== 'html'
    apercu.innerHTML = format === 'html' ? pointsEnHtml(lignesDe(champ.value)) : ''
  }
  champ.addEventListener('input', dessiner)
  dessiner()
  return { boutons, apercu, format: () => format }
}

// La fiche à l'écran, selon son format.
export const pointsAffiches = (points, format) => (format === 'texte'
  ? h('div', { class: 'texte-brut-fiche' }, points.join('\n'))
  : h('div', { class: 'apercu-texte-fiche', html: pointsEnHtml(points) }))
