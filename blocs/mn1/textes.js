// Les points à vérifier d'une fiche (côté serveur ; même règle que l'écran, interface/fiches-mn1.js) :
// un par ligne ; « Porte : » est un intertitre ; les « ☐ » sont retirés.
export function points(texte) {
  return String(texte || '')
    .split('\n')
    .flatMap((ligne) => ligne.split(/☐/).map((x, i) => ({ x: x.trim(), coche: i > 0 || /^\s*☐/.test(ligne) })))
    .filter(({ x }) => x)
    .map(({ x, coche }) => (!coche && /:$/.test(x) ? { titre: x.replace(/\s*:$/, '') } : { point: x.replace(/^[-•]\s*/, '') }))
}
