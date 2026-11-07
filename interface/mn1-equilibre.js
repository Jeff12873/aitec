// Le nuage correctif × préventif d'un parc (fiche MN1, à côté du Pareto) : un point par équipement, ses correctifs
// en abscisse et son préventif d'observation en ordonnée, sur 12 mois.
//   rouge  : beaucoup de pannes, peu de préventif (sous-entretien) ;
//   orange : beaucoup de préventif, peu de pannes (sur-entretien possible) ;
//   vert   : équilibré.
// Bascule Niveau 1 / Techniciens / Tout. Le préventif systématique (changer une pièce à date fixe) est écarté :
// l'IA classe chaque gamme, l'administrateur corrige (blocs/mn1/equilibre.js).

import { h, vider, ic, essayer } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { modeAdmin } from '/socle/etat.js'

const SVG = 'http://www.w3.org/2000/svg'
const s = (balise, attributs = {}, texte) => {
  const e = document.createElementNS(SVG, balise)
  for (const [k, v] of Object.entries(attributs)) e.setAttribute(k, v)
  if (texte !== undefined) e.textContent = texte
  return e
}

const ECART = 2 // même règle que le serveur (equilibre.js, zone)
const MODES = [['tout', 'Tout', 'Le préventif de niveau 1 et celui des techniciens'], ['n1', 'Niveau 1', 'Les RI de niveau 1 (conducteurs, fiches MN1)'], ['techniciens', 'Techniciens', 'Le préventif des techniciens, hors niveau 1']]
const preventifsDe = (e, mode) => (mode === 'n1' ? e.n1 : mode === 'techniciens' ? e.techniciens : e.n1 + e.techniciens)

function zone({ correctifs, preventifs }, totaux, nombre) {
  if (!correctifs && !preventifs) return null
  const partC = totaux.correctifs ? correctifs / totaux.correctifs : 0
  const partP = totaux.preventifs ? preventifs / totaux.preventifs : 0
  const moyenne = 1 / Math.max(1, nombre)
  if (correctifs >= 2 && partC >= moyenne && partC >= ECART * partP) return 'rouge'
  if (preventifs >= 2 && partP >= moyenne && partP >= ECART * partC) return 'orange'
  return 'vert'
}

// d : le détail du parc (pour son id). Renvoie l'élément ; les données se chargent à l'affichage.
export function nuageEquilibre(d) {
  const zoneNuage = h('div', { class: 'equilibre-mn1' }, h('p', { class: 'discret' }, 'Lecture des interventions…'))
  let donnees = null
  let mode = 'tout'

  const charger = async () => {
    donnees = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/equilibre`))
    if (donnees) dessiner()
    else vider(zoneNuage, h('p', { class: 'discret' }, 'Lecture impossible.'))
  }

  const dessiner = () => {
    const liste = donnees.equipements.map((e) => ({ ...e, preventifs: preventifsDe(e, mode) })).filter((e) => e.correctifs || e.preventifs)
    const totaux = { correctifs: liste.reduce((t, e) => t + e.correctifs, 0), preventifs: liste.reduce((t, e) => t + e.preventifs, 0) }
    for (const e of liste) e.zone = zone(e, totaux, liste.length)
    const compte = (z) => liste.filter((e) => e.zone === z).length
    const aRegarder = liste.filter((e) => e.zone === 'rouge').sort((a, b) => b.correctifs - a.correctifs)
    const surEntretien = liste.filter((e) => e.zone === 'orange').sort((a, b) => b.preventifs - a.preventifs)
    const g = donnees.gammes

    const boutonClasser = h('button', { class: 'petit', title: 'L’IA lit le titre de chaque gamme de préventif du parc : observation (contrôle, vérification) ou systématique (échange, remplacement). Gardé dans le fichier.' }, ic('etincelle', 13), g.aClasser ? `Classer ${g.aClasser} gamme${g.aClasser > 1 ? 's' : ''} par l’IA` : 'Gammes classées')
    boutonClasser.disabled = !g.aClasser || !donnees.iaInstallee
    boutonClasser.onclick = async () => {
      boutonClasser.disabled = true
      vider(boutonClasser, ic('etincelle', 13), 'L’IA classe les gammes…')
      const r = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/gammes`, { methode: 'POST' }))
      if (r) await charger()
      else { boutonClasser.disabled = false; vider(boutonClasser, ic('etincelle', 13), 'Réessayer le classement') }
    }

    vider(zoneNuage,
      h('div', { class: 'tete-equilibre' },
        h('div', { class: 'segments petits' }, MODES.map(([cle, texte, aide]) => h('button', { class: mode === cle ? 'choisi' : '', title: aide, onclick: () => { mode = cle; dessiner() } }, texte))),
        h('div', { class: 'legende-equilibre' },
          h('span', { class: 'pastille-zone rouge' }), `${compte('rouge')} sous-entretenu${compte('rouge') > 1 ? 's' : ''}`,
          h('span', { class: 'pastille-zone orange' }), `${compte('orange')} sur-entretenu${compte('orange') > 1 ? 's' : ''} ?`,
          h('span', { class: 'pastille-zone vert' }), `${compte('vert')} équilibré${compte('vert') > 1 ? 's' : ''}`)),
      liste.length
        ? graphique(liste, totaux)
        : h('p', { class: 'discret' }, 'Ni correctif ni préventif sur les machines de maintenance de ce parc ces 12 derniers mois.'),
      h('p', { class: 'discret petit-texte' }, `${liste.length} équipement${liste.length > 1 ? 's' : ''}, ${totaux.correctifs} correctifs et ${totaux.preventifs} préventifs d’observation sur 12 mois. Une couleur compare deux parts : celle des pannes du parc que porte l’équipement, et celle du préventif qu’il reçoit (le double de l’autre, au moins).`),
      aRegarder.length || surEntretien.length ? h('div', { class: 'a-regarder' },
        aRegarder.length ? h('div', {}, h('b', {}, 'À regarder d’abord'), aRegarder.slice(0, 8).map(puce)) : null,
        surEntretien.length ? h('div', {}, h('b', {}, 'Préventif à alléger ?'), surEntretien.slice(0, 8).map(puce)) : null) : null,
      h('div', { class: 'gammes-equilibre' },
        h('div', { class: 'ligne-gammes' },
          h('span', { class: 'texte-2' }, `${g.total} gamme${g.total > 1 ? 's' : ''} de préventif, dont ${g.systematiques} systématique${g.systematiques > 1 ? 's' : ''}, écartée${g.systematiques > 1 ? 's' : ''} du nuage.`,
            g.aClasser ? h('span', { class: 'etiquette orange', title: 'Classées d’après les mots du titre seulement (échange, remplacement…), en attendant l’IA' }, `${g.aClasser} à classer`) : null),
          donnees.iaInstallee ? boutonClasser : h('span', { class: 'discret petit-texte' }, 'IA non installée : classement d’après les mots du titre.')),
        listeGammes(g)))
  }

  // Les gammes, la plus fréquente d'abord : l'administrateur corrige le classement d'un clic.
  const listeGammes = (g) => {
    const corps = h('div', { class: 'liste-gammes' })
    const details = h('details', {}, h('summary', {}, 'Voir le classement des gammes'), corps)
    details.addEventListener('toggle', () => {
      if (!details.open || corps.childElementCount) return
      const PAR = { ia: 'IA', admin: 'administrateur', mots: 'mots du titre' }
      for (const x of g.liste) {
        const choix = h('select', { class: 'fin', disabled: !modeAdmin(), title: modeAdmin() ? '' : 'Seul l’administrateur corrige le classement' },
          h('option', { value: 'observation', selected: x.classe === 'observation' }, 'Observation'),
          h('option', { value: 'systematique', selected: x.classe === 'systematique' }, 'Systématique'))
        const origine = h('small', { class: 'discret' }, PAR[x.par] || '')
        choix.onchange = async () => {
          const r = await essayer(() => api('/api/mn1/gammes', { methode: 'POST', corps: { cle: x.cle, gamme: x.gamme, classe: choix.value } }), 'Classement corrigé')
          if (r) { x.classe = r.classe; x.par = r.par; origine.textContent = PAR[r.par]; charger() }
        }
        corps.append(h('div', { class: `gamme ${x.classe}` }, h('span', {}, x.gamme || '(sans titre)'), h('small', { class: 'discret' }, `×${x.nombre}`), origine, choix))
      }
      if (g.total > g.liste.length) corps.append(h('p', { class: 'discret petit-texte' }, `Les ${g.liste.length} plus fréquentes sur ${g.total}.`))
    })
    return details
  }

  charger()
  return zoneNuage
}

// Un équipement à regarder : son repère (lien vers son analyse, s'il en a une), ses correctifs / préventifs.
const lien = (e, contenu) => (e.analyse ? h('a', { href: `#/analyse/${e.analyse}` }, contenu) : contenu)
function puce(e) {
  return h('span', { class: `puce-equipement ${e.zone}`, title: `${e.designation || e.repere} : ${e.correctifs} correctif${e.correctifs > 1 ? 's' : ''}, ${e.preventifs} préventif${e.preventifs > 1 ? 's' : ''}` },
    lien(e, h('span', { class: 'mono' }, e.repere || '?')), h('small', {}, ` ${e.correctifs} / ${e.preventifs}`))
}

// Le nuage : échelles en racine carrée (beaucoup d'équipements ont peu d'interventions, quelques-uns beaucoup) ; une
// droite passant par zéro le reste, si bien que les zones restent des secteurs nets autour de la diagonale.
function graphique(liste, totaux) {
  const L = 720
  const H = 380
  const m = { g: 48, d: 16, h: 14, b: 40 }
  const maxC = Math.max(1, ...liste.map((e) => e.correctifs))
  const maxP = Math.max(1, ...liste.map((e) => e.preventifs))
  const x = (v) => m.g + (Math.sqrt(v) / Math.sqrt(maxC)) * (L - m.g - m.d)
  const y = (v) => H - m.b - (Math.sqrt(v) / Math.sqrt(maxP)) * (H - m.h - m.b)
  const svg = s('svg', { viewBox: `0 0 ${L} ${H}`, class: 'nuage-mn1', role: 'img', 'aria-label': 'Nuage correctif × préventif par équipement' })

  // Les secteurs : préventif = pente × correctif (pente du parc), sous la moitié rouge, au-dessus du double orange.
  const pente = totaux.correctifs ? totaux.preventifs / totaux.correctifs : 1
  const bord = (k) => {
    // Le point où la droite P = k·C sort du cadre.
    const c = Math.min(maxC, maxP / k)
    return [x(c), y(k * c)]
  }
  const [x0, y0] = [x(0), y(0)]
  const [xr, yr] = bord(pente / ECART)
  const [xo, yo] = bord(pente * ECART)
  const [xd, yd] = bord(pente)
  const coins = { bd: [x(maxC), y0], hd: [x(maxC), y(maxP)], hg: [x0, y(maxP)] }
  const poly = (points, classe) => s('polygon', { points: points.map((p) => p.join(',')).join(' '), class: classe })
  svg.append(
    poly([[x0, y0], coins.bd, ...(yr > coins.hd[1] + 0.5 ? [[xr, yr]] : [coins.hd, [xr, yr]])], 'secteur rouge'),
    poly([[x0, y0], [xo, yo], ...(xo >= coins.hd[0] - 0.5 ? [coins.hd] : []), coins.hg], 'secteur orange'),
    s('line', { x1: x0, y1: y0, x2: xd, y2: yd, class: 'diagonale' }),
  )

  // Axes et graduations (valeurs rondes).
  const graduations = (max) => {
    const pas = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((p) => max / p <= 5) || 1000
    const v = [0]
    for (let t = pas; t <= max; t += pas) v.push(t)
    return v
  }
  for (const v of graduations(maxC)) svg.append(s('line', { x1: x(v), y1: y0, x2: x(v), y2: y0 + 4, class: 'axe' }), s('text', { x: x(v), y: y0 + 16, 'text-anchor': 'middle', class: 'graduation' }, String(v)))
  for (const v of graduations(maxP)) svg.append(s('line', { x1: x0 - 4, y1: y(v), x2: x0, y2: y(v), class: 'axe' }), s('text', { x: x0 - 7, y: y(v) + 4, 'text-anchor': 'end', class: 'graduation' }, String(v)))
  svg.append(
    s('line', { x1: x0, y1: y0, x2: x(maxC), y2: y0, class: 'axe' }),
    s('line', { x1: x0, y1: y0, x2: x0, y2: y(maxP), class: 'axe' }),
    s('text', { x: x(maxC), y: H - 6, 'text-anchor': 'end', class: 'titre-axe' }, 'correctifs (12 mois) →'),
    s('text', { x: 12, y: m.h + 4, transform: `rotate(-90 12 ${m.h + 4})`, 'text-anchor': 'end', class: 'titre-axe' }, '← préventif d’observation'),
  )

  // Les points : les équipements aux mêmes nombres (fréquent pour les petits) font une seule bulle, plus grosse,
  // qui les nomme tous. Les rouges en dernier (au-dessus).
  const bulles = new Map()
  for (const e of liste) {
    const cle = `${e.correctifs}|${e.preventifs}|${e.zone}`
    bulles.set(cle, [...(bulles.get(cle) || []), e])
  }
  const ordre = { vert: 0, orange: 1, rouge: 2 }
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`
  for (const groupe of [...bulles.values()].sort((a, b) => ordre[a[0].zone] - ordre[b[0].zone] || b.length - a.length)) {
    const e = groupe[0]
    const seul = groupe.length === 1
    const cible = groupe.find((x) => x.analyse)
    const point = s('circle', { cx: x(e.correctifs), cy: y(e.preventifs), r: 5 + 2.2 * Math.sqrt(groupe.length - 1), class: `point ${e.zone}${seul && e.analyse ? ' cliquable' : ''}` })
    const nommes = groupe.slice(0, 10).map((g) => `${g.repere}${g.designation ? ` · ${g.designation}` : ''}`).join('\n') + (groupe.length > 10 ? `\n… et ${groupe.length - 10} autres` : '')
    const detail = seul ? ` (niveau 1 : ${e.n1}, techniciens : ${e.techniciens})${e.systematiques ? `\n${pluriel(e.systematiques, 'systématique')} écarté${e.systematiques > 1 ? 's' : ''}` : ''}` : ''
    point.append(s('title', {}, `${seul ? '' : `${groupe.length} équipements\n`}${nommes}\n${pluriel(e.correctifs, 'correctif')}, ${pluriel(e.preventifs, 'préventif')} d’observation${detail}`))
    if (seul && cible) point.addEventListener('click', () => { location.hash = `#/analyse/${cible.analyse}` })
    svg.append(point)
    if (!seul) svg.append(s('text', { x: x(e.correctifs), y: y(e.preventifs) + 3.5, 'text-anchor': 'middle', class: 'nombre-bulle' }, String(groupe.length)))
  }
  return h('div', { class: 'cadre-nuage' }, svg)
}
