// L'entrée des écrans de chiffres : les chiffres défilent jusqu'à leur valeur, les barres montent.

import { nombreFr } from '/socle/ui.js'

// Les chiffres défilent jusqu'à leur valeur, les barres montent, l'anneau se dessine.
export function animer(zone) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  zone.classList.remove('tableau-anime')
  void zone.offsetWidth // relance les animations CSS
  zone.classList.add('tableau-anime')
  zone.querySelectorAll('svg.graphique path').forEach((p, i) => (p.style.animationDelay = `${(i % 12) * 35 + Math.floor(i / 12) * 60}ms`))
  zone.querySelectorAll('.barres-horizontales .piste > span').forEach((b, i) => (b.style.animationDelay = `${i * 70}ms`))
  zone.querySelectorAll('.tuile .valeur').forEach((v) => {
    const texte = v.firstChild
    if (texte?.nodeType !== Node.TEXT_NODE) return
    const fin = Number(texte.textContent.replace(/\D/g, ''))
    if (!fin) return
    const debut = performance.now()
    const pas = (instant) => {
      const t = Math.min(1, (instant - debut) / 900)
      texte.textContent = nombreFr(Math.round(fin * (1 - (1 - t) ** 3)))
      if (t < 1 && texte.isConnected) requestAnimationFrame(pas)
    }
    requestAnimationFrame(pas)
  })
}

// Le zoom d'un écran vers le niveau suivant, depuis l'élément cliqué : l'écran plonge dedans, le suivant en sort.
// changer : dessine le niveau suivant (peut être asynchrone) ; entrer faux : on remonte.
export async function inception(zone, element, changer, entrer = true) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !zone.animate) return changer()
  const z = zone.getBoundingClientRect()
  const r = element?.getBoundingClientRect()
  zone.style.transformOrigin = r ? `${r.left - z.left + r.width / 2}px ${r.top - z.top + r.height / 2}px` : '50% 30%'
  const cadre = zone.closest('.carte') || zone
  cadre.classList.add('en-inception')
  await zone.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${entrer ? 2.8 : 0.55})`, opacity: 0 }], { duration: 230, easing: 'cubic-bezier(.5,0,.8,.4)' }).finished
  zone.style.opacity = 0
  await changer()
  zone.style.opacity = ''
  await zone.animate([{ transform: `scale(${entrer ? 0.55 : 2.2})`, opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)' }).finished
  cadre.classList.remove('en-inception')
}
