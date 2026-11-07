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
