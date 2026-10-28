// Les petits graphiques de la maintenance de niveau 1 : la jauge en anneau (charge, pertinence), qui se remplit à
// l'affichage, et la courbe des correctifs sur 12 mois.

const SVG = 'http://www.w3.org/2000/svg'
const s = (balise, attributs = {}) => {
  const e = document.createElementNS(SVG, balise)
  for (const [k, v] of Object.entries(attributs)) e.setAttribute(k, v)
  return e
}

// valeur : 0 à 1 (ou plus : dépassement), null : pas encore de mesure.
// seuil : sous lui la jauge est orange (pertinence) ; inverse : au-dessus de 1 elle est rouge (charge).
export function jauge(valeur, { taille = 74, seuil = null, inverse = false, libelle = '' } = {}) {
  const r = 30
  const tour = 2 * Math.PI * r
  const svg = s('svg', { viewBox: '0 0 80 80', width: taille, height: taille, class: 'jauge-mn1' })
  svg.append(s('circle', { cx: 40, cy: 40, r, class: 'fond-jauge' }))
  let etat = 'vide'
  if (valeur !== null && valeur !== undefined) {
    etat = inverse ? (valeur > 1 + 1e-9 ? 'rouge' : valeur > 0.85 ? 'orange' : 'bon') : seuil !== null && valeur < seuil ? 'orange' : 'bon'
    const arc = s('circle', { cx: 40, cy: 40, r, class: `arc-jauge ${etat}`, 'stroke-dasharray': `${tour} ${tour}`, 'stroke-dashoffset': tour, transform: 'rotate(-90 40 40)' })
    arc.style.setProperty('--fin', String(tour * (1 - Math.min(1, valeur))))
    svg.append(arc)
  }
  const texte = s('text', { x: 40, y: libelle ? 41 : 45, 'text-anchor': 'middle', class: 'valeur-jauge' })
  texte.textContent = valeur === null || valeur === undefined ? '—' : `${Math.round(valeur * 100)}%`
  svg.append(texte)
  if (libelle) {
    const l = s('text', { x: 40, y: 54, 'text-anchor': 'middle', class: 'libelle-jauge' })
    l.textContent = libelle
    svg.append(l)
  }
  svg.classList.add(etat)
  return svg
}

// Une courbe sans axes (les 12 derniers mois), avec sa surface ; le dernier point est marqué.
export function courbe(valeurs, { largeur = 120, hauteur = 34 } = {}) {
  const svg = s('svg', { viewBox: `0 0 ${largeur} ${hauteur}`, width: largeur, height: hauteur, class: 'courbe-mn1' })
  if (!valeurs.length) return svg
  const max = Math.max(1, ...valeurs)
  const pas = valeurs.length > 1 ? (largeur - 6) / (valeurs.length - 1) : 0
  const points = valeurs.map((v, i) => [3 + i * pas, hauteur - 4 - (v / max) * (hauteur - 8)])
  const trace = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  svg.append(s('path', { d: `${trace} L${points.at(-1)[0].toFixed(1)},${hauteur} L${points[0][0].toFixed(1)},${hauteur} Z`, class: 'surface-courbe' }))
  svg.append(s('path', { d: trace, class: 'trait-courbe' }))
  const [x, y] = points.at(-1)
  svg.append(s('circle', { cx: x, cy: y, r: 2.6, class: 'point-courbe' }))
  // En hausse sur les 3 derniers mois par rapport aux 3 d'avant : la courbe le dit.
  const somme = (liste) => liste.reduce((a, b) => a + b, 0)
  if (valeurs.length >= 6 && somme(valeurs.slice(-3)) > somme(valeurs.slice(-6, -3)) * 1.2) svg.classList.add('hausse')
  return svg
}
