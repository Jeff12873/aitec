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
  let etat = 'sans-mesure'
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

// La courbe des 12 derniers mois, comme un moniteur cardiaque : juste le trait, une lueur le parcourt en boucle avec
// un point brillant en tête, et le dernier mois bat. Sa couleur dit la tendance : les 3 derniers mois par rapport à
// la moyenne des 12 (vert : en baisse, jaune : stable, rouge : en hausse).
export function courbe(valeurs, { largeur = 400, hauteur = 60 } = {}) {
  const svg = s('svg', { viewBox: `0 0 ${largeur} ${hauteur}`, class: 'courbe-mn1', preserveAspectRatio: 'xMidYMid meet' })
  if (!valeurs.length) return svg
  const max = Math.max(1, ...valeurs)
  const marge = 6
  const pas = valeurs.length > 1 ? (largeur - 2 * marge) / (valeurs.length - 1) : 0
  const points = valeurs.map((v, i) => [marge + i * pas, hauteur - marge - (v / max) * (hauteur - 2 * marge)])
  const trace = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const trait = s('path', { d: trace, class: 'trait-courbe' })
  const eclat = s('path', { d: trace, class: 'eclat-courbe' })
  const tete = s('circle', { r: 3.4, class: 'tete-courbe', cx: points[0][0], cy: points[0][1] })
  const [x, y] = points.at(-1)
  svg.append(trait, eclat, s('circle', { cx: x, cy: y, r: 3.2, class: 'battement-courbe' }), s('circle', { cx: x, cy: y, r: 3.2, class: 'point-courbe' }), tete)
  svg.classList.add(tendance(valeurs))
  balayer(svg, trait, eclat, tete, dureeBalayage(valeurs))
  return svg
}

// À 15 % près de la moyenne des 12 mois, la tendance est stable.
export function tendance(valeurs) {
  const moyenne = (liste) => liste.reduce((a, b) => a + b, 0) / (liste.length || 1)
  if (valeurs.length < 4) return 'stable'
  const recent = moyenne(valeurs.slice(-3))
  const annee = moyenne(valeurs)
  if (recent > annee * 1.15) return 'hausse'
  if (recent < annee * 0.85) return 'baisse'
  return 'stable'
}

// La vitesse du balayage suit la pente des 12 mois (droite des moindres carrés, rapportée à la moyenne) :
// une courbe presque plate défile lentement (4,2 s), une qui varie de 100 % ou plus sur l'année, vite (1,2 s).
export function dureeBalayage(valeurs) {
  const n = valeurs.length
  const moyenne = valeurs.reduce((a, b) => a + b, 0) / (n || 1)
  if (n < 2 || !moyenne) return 4200
  const xm = (n - 1) / 2
  let haut = 0
  let bas = 0
  valeurs.forEach((v, i) => {
    haut += (i - xm) * (v - moyenne)
    bas += (i - xm) ** 2
  })
  const delta = Math.abs((haut / bas) * (n - 1)) / moyenne
  return Math.round(4200 - 3000 * Math.min(1, delta))
}

// Le balayage : une lueur (un morceau du tracé) et le point de tête avancent ensemble, puis une courte pause.
function balayer(svg, trait, eclat, tete, DUREE = 2400) {
  const PAUSE = 700
  let longueur = 0
  let debut = null
  let vu = false
  const image = (t) => {
    if (!svg.isConnected) {
      if (vu || t - (debut ??= t) > 5000) return // l'écran a changé, ou la courbe n'a jamais été affichée
      return requestAnimationFrame(image)
    }
    if (!vu) {
      vu = true
      longueur = trait.getTotalLength()
      eclat.style.strokeDasharray = `${longueur * 0.22} ${longueur * 2}`
      debut = t
    }
    const p = ((t - debut) % (DUREE + PAUSE)) / DUREE
    if (p <= 1) {
      const position = longueur * p
      eclat.style.strokeDashoffset = String(longueur * 0.22 - position)
      const point = trait.getPointAtLength(position)
      tete.setAttribute('cx', point.x.toFixed(1))
      tete.setAttribute('cy', point.y.toFixed(1))
      tete.style.opacity = '1'
      eclat.style.opacity = '1'
    } else {
      tete.style.opacity = '0'
      eclat.style.opacity = '0'
    }
    requestAnimationFrame(image)
  }
  requestAnimationFrame(image)
}
