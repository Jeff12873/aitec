// Le concombre masqué (une surprise partagée avec PDRTec et BiRTEC) : taper « concombre » dans la recherche
// fait pleuvoir des concombres sur la page, et le héros passe saluer en bas de l'écran.

const IMAGE = new URL('concombre-masque.webp', import.meta.url).href
const PETIT = new URL('concombre-petit.webp', import.meta.url).href
let enCours = false

export const estConcombre = (texte) => /^\s*(le\s+)?concombres?(\s+masqu[ée])?\s*$/i.test(texte)

export function concombreMasque() {
  if (enCours) return
  enCours = true
  const ciel = document.createElement('div')
  ciel.className = 'pluie-concombres'
  ciel.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 45; i++) {
    const c = document.createElement('img')
    c.src = PETIT
    c.alt = ''
    c.style.left = `${Math.random() * 100}vw`
    c.style.animationDelay = `${Math.random() * 2.5}s`
    c.style.animationDuration = `${2.6 + Math.random() * 2.6}s`
    c.style.setProperty('--tour', `${Math.round(Math.random() * 720 - 360)}deg`)
    c.style.setProperty('--taille', `${0.7 + Math.random() * 0.9}`)
    ciel.append(c)
  }
  const heros = document.createElement('img')
  heros.className = 'heros-concombre'
  heros.src = IMAGE
  heros.alt = 'Le concombre masqué'
  ciel.append(heros)
  document.body.append(ciel)
  setTimeout(() => { ciel.remove(); enCours = false }, 7800)
}
