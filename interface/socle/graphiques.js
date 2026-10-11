// Graphiques en SVG, sans bibliothèque : barres empilées, anneau, barres horizontales.
// Chaque fonction renvoie un élément <svg> prêt à insérer.

import { svg, h } from './ui.js'

export const COULEURS = { violet: '#8b5cf6', bleu: '#3b82f6', turquoise: '#2dd4bf', orange: '#f59e0b', gris: '#3a4654', rouge: '#f05252' }

const echapper = (texte) => String(texte).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Barres verticales, éventuellement empilées.
//   donnees : [{ etiquette: 'janv.', valeurs: { correctif: 3, preventif: 5 } }]
//   series  : [{ cle: 'correctif', nom: 'Correctif', couleur: '#8b5cf6' }]
export function barres(donnees, series, { hauteur = 240 } = {}) {
  const largeur = 640
  const marge = { haut: 12, droite: 8, bas: 28, gauche: 34 }
  const zoneL = largeur - marge.gauche - marge.droite
  const zoneH = hauteur - marge.haut - marge.bas
  const max = Math.max(1, ...donnees.map((d) => series.reduce((s, serie) => s + (d.valeurs[serie.cle] || 0), 0)))
  const pas = graduation(max)
  const haut = Math.ceil(max / pas) * pas
  const y = (v) => marge.haut + zoneH - (v / haut) * zoneH
  const colonne = zoneL / donnees.length
  const epaisseur = Math.min(26, colonne * 0.55)

  let contenu = ''
  for (let v = 0; v <= haut; v += pas) {
    contenu += `<line class="grille-ligne" x1="${marge.gauche}" x2="${largeur - marge.droite}" y1="${y(v)}" y2="${y(v)}"/>`
    contenu += `<text x="${marge.gauche - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`
  }
  donnees.forEach((d, i) => {
    const x = marge.gauche + colonne * i + (colonne - epaisseur) / 2
    let cumul = 0
    series.forEach((serie, s) => {
      const valeur = d.valeurs[serie.cle] || 0
      if (!valeur) return
      const debut = y(cumul)
      cumul += valeur
      const fin = y(cumul)
      const arrondi = s === series.length - 1 || series.slice(s + 1).every((autre) => !d.valeurs[autre.cle]) ? 4 : 0
      contenu += `<path d="${rectangleArrondiHaut(x, fin, epaisseur, debut - fin, arrondi)}" fill="${serie.couleur}"><title>${echapper(d.etiquette)} — ${echapper(serie.nom)} : ${valeur}</title></path>`
    })
    contenu += `<text x="${x + epaisseur / 2}" y="${hauteur - 8}" text-anchor="middle">${echapper(d.etiquette)}</text>`
  })
  return svg(`<svg class="graphique" viewBox="0 0 ${largeur} ${hauteur}" role="img">${contenu}</svg>`)
}

// Anneau : segments = [{ nom, valeur, couleur }]
export function anneau(segments, { epaisseur = 14 } = {}) {
  const total = segments.reduce((s, seg) => s + seg.valeur, 0)
  const rayon = 70
  const circonference = 2 * Math.PI * rayon
  let decalage = 0
  let contenu = `<circle cx="90" cy="90" r="${rayon}" fill="none" stroke="#1b232c" stroke-width="${epaisseur}"/>`
  if (total > 0) {
    for (const seg of segments) {
      const longueur = (seg.valeur / total) * circonference
      const espace = segments.length > 1 ? Math.min(4, longueur / 2) : 0
      contenu += `<circle cx="90" cy="90" r="${rayon}" fill="none" stroke="${seg.couleur}" stroke-width="${epaisseur}"
        stroke-dasharray="${Math.max(0, longueur - espace)} ${circonference}" stroke-dashoffset="${-decalage}"
        transform="rotate(-90 90 90)"><title>${echapper(seg.nom)} : ${seg.valeur}</title></circle>`
      decalage += longueur
    }
  }
  return svg(`<svg class="graphique" viewBox="0 0 180 180" role="img">${contenu}</svg>`)
}

// Barres horizontales : [{ etiquette, valeur, couleur? }]
// En HTML plutôt qu'en SVG : le texte reste lisible quelle que soit la largeur de la carte.
export function barresHorizontales(donnees, { couleur = COULEURS.violet } = {}) {
  const max = Math.max(1, ...donnees.map((d) => d.valeur))
  return h(
    'div',
    { class: 'barres-horizontales' },
    donnees.map((d) =>
      h(
        'div',
        { title: `${d.etiquette} : ${d.valeur}` },
        h('span', { class: 'etiquette-barre' }, d.etiquette),
        h('span', { class: 'piste' }, h('span', { style: { width: `${Math.max(4, (d.valeur / max) * 100)}%`, background: d.couleur || couleur } })),
        h('b', {}, d.valeur),
      ),
    ),
  )
}

// Pas de graduation lisible : 1, 2, 5, 10, 20, 50…
function graduation(max) {
  const brut = max / 4
  const puissance = 10 ** Math.floor(Math.log10(brut || 1))
  for (const facteur of [1, 2, 5, 10]) if (facteur * puissance >= brut) return Math.max(1, facteur * puissance)
  return puissance * 10
}

function rectangleArrondiHaut(x, y, l, h, r) {
  r = Math.min(r, h, l / 2)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + l - r} Q${x + l},${y} ${x + l},${y + r} V${y + h} Z`
}
