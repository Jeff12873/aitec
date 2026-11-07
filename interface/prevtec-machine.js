// PREVTEC, étapes 3 et 4 : le démonstrateur d'une machine (clic sur une machine du Pareto ou du nuage).
// En haut, ses pannes qui reviennent et le préventif qui les regarde ; puis TOUS ses préventifs, gamme par gamme
// (nature, niveau, passages, taux de détection lu par l'IA, pannes visées) ; en bas, « Je décide » : une décision
// par panne mal couverte ou par gamme qui tourne à vide, avec la fiche N1 ou le point N2 rédigés par l'IA.
// Le calcul est dans blocs/mn1/demonstrateur.js.

import { h, vider, ic, dateFr, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { filEtapes, evolutionPanne } from './prevtec.js'
import { relireFiche } from './mn1-parc.js'

const DIAGNOSTICS = {
  sans: ['rouge', 'Pas de préventif'],
  mauvais: ['orange', 'Mauvais point contrôlé'],
  ok: ['vert', 'Préventif OK'],
  sur: ['orange', 'Sur-maintenance ?'],
  systematique: ['', 'Systématique'],
  ponctuel: ['', 'Ponctuel'],
}
const pastille = (diagnostic, raison) => {
  const [classe, texte] = DIAGNOSTICS[diagnostic]
  return h('span', { class: `etiquette ${classe}`, title: raison }, texte)
}

export async function afficherMachine(zone, parcId, machineId) {
  vider(zone, filEtapes(3), h('p', { class: 'discret curseur' }, 'Lecture des pannes et des préventifs de la machine'))
  const base = `/api/mn1/parcs/${encodeURIComponent(parcId)}/machines/${machineId}`
  const d = await api(base)
  const m = d.machine
  const panneDe = new Map(d.pannes.map((p) => [p.cle, p]))
  const gammeDe = new Map(d.preventifs.map((g) => [g.cle, g]))
  const observation = d.preventifs.filter((g) => g.classe !== 'systematique')
  const passages = d.preventifs.reduce((s, g) => s + g.passages, 0)

  // ---- l'analyse lourde : l'IA rattache les gammes aux pannes et lit les RI préventives
  const lire = async (bouton) => {
    bouton.disabled = true
    notifier('L’IA lit les rapports préventifs de la machine : quelques minutes…')
    const r = await essayer(() => api(`${base}/lire`, { methode: 'POST' }))
    bouton.disabled = false
    if (!r) return
    notifier(`${r.lues} RI lues${r.restantes ? `, ${r.restantes} à relire (nouveau clic)` : ''}${r.rattachement ? ', gammes rattachées aux pannes' : ''}`)
    window.ktec.recharger()
  }
  const boutonLire = h('button', { class: 'principal', title: 'L’IA dit quelle gamme regarde quelle panne, et lit chaque RI préventive : A rien trouvé, B anomalie corrigée, C anomalie laissée', onclick: (e) => lire(e.currentTarget) }, ic('etincelle', 16), d.lecture.aLire ? `Lire ${d.lecture.aLire} RI par l’IA` : 'Relire par l’IA')
  if (!d.iaInstallee) boutonLire.disabled = true

  const etatLecture = h('div', { class: `bandeau${d.lecture.aLire ? '' : ' discret'}` }, ic(d.lecture.aLire ? 'alerte' : 'coche'),
    h('span', {}, [
      d.lecture.rattachement ? `Gammes rattachées aux pannes par l’IA le ${dateFr(d.lecture.rattachement.date.slice(0, 10))}.` : 'Gammes rattachées aux pannes par les mots communs seulement (première idée).',
      d.lecture.aLire ? ` ${d.lecture.aLire} RI préventives pas encore lues : sans elles, pas de taux de détection.` : ' Toutes les RI préventives sont lues.',
      d.lecture.analyseParc ? '' : ' Fiches de niveau 1 : lancez l’analyse de corrélation du parc pour savoir quelles pannes elles visent.',
    ].join('')))

  // ---- ses pannes
  const cartePannes = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('alerte', 18), 'Ses pannes qui reviennent'), h('span', { class: 'discret' }, '12 mois, face aux 12 d’avant')),
    d.pannes.length ? h('table', { class: 'table-demonstrateur' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Panne'), h('th', { class: 'nombre' }, 'Cas'), h('th', {}, 'Évolution'), h('th', {}, 'Préventif qui la regarde'), h('th', {}, 'Diagnostic'))),
      h('tbody', {}, d.pannes.map((p) => h('tr', { class: `diag-${p.diagnostic}` },
        h('td', {}, p.symptome),
        h('td', { class: 'nombre' }, String(p.nombre)),
        h('td', {}, evolutionPanne(p)),
        h('td', {}, [...p.gammes.map((k) => h('span', { class: 'etiquette', title: 'Gamme préventive' }, gammeDe.get(k)?.gamme || k)), ...p.fiches.map((f) => h('span', { class: 'etiquette vert', title: 'Fiche de niveau 1' }, `N1 · ${f.nom}`))].flatMap((x, i) => (i ? [' ', x] : [x])), !p.gammes.length && !p.fiches.length ? h('span', { class: 'discret' }, 'aucun') : null),
        h('td', {}, pastille(p.diagnostic, p.raison), h('div', { class: 'discret petit-texte' }, p.raison))))))
      : h('p', { class: 'discret' }, 'Pas de panne qui revient sur cette machine ces 12 mois.'))

  // ---- tous ses préventifs
  const detection = (g) => {
    if (g.classe === 'systematique') return h('span', { class: 'discret' }, '—')
    if (!g.lus) return h('span', { class: 'discret', title: 'RI pas encore lues par l’IA' }, 'à lire')
    const part = (n) => `${(n / g.lus) * 100}%`
    return h('div', { class: 'detection', title: `${g.lus} RI lues : ${g.A} rien trouvé (A), ${g.B} anomalie corrigée (B), ${g.C} anomalie laissée (C)` },
      h('div', { class: 'barre-abc' }, h('i', { class: 'a', style: { width: part(g.A) } }), h('i', { class: 'b', style: { width: part(g.B) } }), h('i', { class: 'c', style: { width: part(g.C) } })),
      h('small', {}, `${Math.round(g.detection * 100)} % détectent · ${g.lus}/${g.passages} lues`))
  }
  const cartePreventifs = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('rafraichir', 18), 'Tous ses préventifs'), h('span', { class: 'discret' }, `${d.preventifs.length} gamme${d.preventifs.length > 1 ? 's' : ''} · ${passages} passage${passages > 1 ? 's' : ''} en 12 mois · ${observation.length} d’observation`)),
    d.preventifs.length ? h('table', { class: 'table-demonstrateur' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Gamme'), h('th', {}, 'Nature'), h('th', {}, 'Qui'), h('th', { class: 'nombre' }, 'Passages'), h('th', {}, 'Dernier'), h('th', {}, 'Détection'), h('th', {}, 'Pannes visées'), h('th', {}, 'Diagnostic'))),
      h('tbody', {}, d.preventifs.map((g) => h('tr', { class: `diag-${g.diagnostic}` },
        h('td', {}, g.gamme),
        h('td', {}, g.classe === 'systematique' ? 'systématique' : 'observation'),
        h('td', { class: 'petit-texte' }, [g.n1 ? `N1 ${g.n1}` : '', g.techniciens ? `techniciens ${g.techniciens}` : ''].filter(Boolean).join(' · ')),
        h('td', { class: 'nombre' }, String(g.passages)),
        h('td', {}, dateFr(g.derniere)),
        h('td', {}, detection(g)),
        h('td', { class: 'petit-texte' }, g.cibles.length ? g.cibles.map((k) => panneDe.get(k)?.symptome || k).join(' ; ') : h('span', { class: 'discret' }, g.classe === 'systematique' ? '' : 'aucune'), g.par === 'mots' && g.cibles.length ? h('small', { class: 'discret', title: 'Rattachement par les mots communs : lancez la lecture par l’IA pour le confirmer' }, ' (mots)') : null),
        h('td', {}, pastille(g.diagnostic, g.raison))))))
      : h('p', { class: 'discret' }, 'Aucun préventif sur cette machine ces 12 mois.'))

  // ---- je décide
  const decision = (x) => {
    if (x.type === 'espacer') {
      const g = gammeDe.get(x.gamme)
      const texte = `${m.repere} — gamme « ${g.gamme} » : ${g.raison} Proposition : espacer la périodicité (par exemple la doubler) et surveiller les pannes de la machine.`
      return h('div', { class: 'decision orange' },
        h('div', { class: 'tete-decision' }, ic('horloge', 16), h('b', {}, `Espacer « ${g.gamme} »`)),
        h('p', {}, g.raison),
        h('div', { class: 'actions' }, h('button', { class: 'petit', onclick: () => navigator.clipboard.writeText(texte).then(() => notifier('Proposition copiée : à reporter dans la GMAO')) }, 'Copier la proposition')))
    }
    const p = panneDe.get(x.panne)
    const gamme = p.gammes.map((k) => gammeDe.get(k)?.gamme).filter(Boolean).join(' ; ')
    return h('div', { class: `decision ${x.type === 'manque' ? 'rouge' : 'orange'}` },
      h('div', { class: 'tete-decision' }, ic('alerte', 16), h('b', {}, p.symptome), h('span', { class: 'discret' }, `${p.nombre} cas en 12 mois`)),
      h('p', {}, x.type === 'manque' ? 'Aucun préventif ne la regarde. Un geste simple de l’opérateur peut-il la voir venir ? Sinon, un contrôle du technicien.' : `${p.raison}${gamme ? ` Gamme en place : ${gamme}.` : ''}`),
      h('div', { class: 'actions' },
        h('button', { class: 'petit', title: 'L’IA rédige une fiche de niveau 1 (contrôle simple de l’opérateur), que vous relisez', onclick: () => ficheN1(p) }, ic('etincelle', 13), x.type === 'manque' ? 'Fiche N1 (opérateur)' : 'Ajouter une fiche N1'),
        h('button', { class: 'petit', title: 'L’IA rédige un point de niveau 2 (technicien), à reporter dans la GMAO', onclick: () => pointN2(p, gamme) }, ic('etincelle', 13), x.type === 'manque' ? 'Point N2 (technicien)' : 'Revoir le point (N2)')))
  }
  const ficheN1 = async (p) => {
    notifier('L’IA rédige une fiche pour cette panne…')
    const b = await essayer(() => api(`${base}/fiche`, { methode: 'POST', corps: { panne: p.cle } }))
    if (b && (await relireFiche(d.parc.id, b, `Fiche N1 — ${m.repere} : ${p.symptome}`, `Rédigée par l’IA pour cette panne (${p.nombre} cas en 12 mois). Relisez et corrigez : rien n’est enregistré sans vous. Ensuite, étape 5 « Je fais » : la FI et l’impression, sur la page du parc.`))) window.ktec.recharger()
  }
  const pointN2 = async (p, gamme) => {
    notifier('L’IA rédige un point de niveau 2…')
    const n = await essayer(() => api(`${base}/n2`, { methode: 'POST', corps: { panne: p.cle, gamme } }))
    if (!n) return
    const texte = [`Machine : ${n.machine}`, `Organe : ${n.ou}`, `Contrôle : ${n.quoi}`, `Fréquence : ${n.frequence}`, `Métier : ${n.metier}`, `Panne visée : ${n.panne} — ${n.pourquoi}`].join('\n')
    const zoneTexte = h('textarea', { rows: 8 }, texte)
    await fenetre({
      titre: `Point N2 — ${m.repere} : ${p.symptome}`,
      large: true,
      contenu: h('div', {}, h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Rédigé par l’IA : corrigez-le si besoin, puis reportez-le dans la GMAO (PREVTEC ne gère pas les gammes de niveau 2).'), zoneTexte),
      boutons: [{ texte: 'Fermer', classe: 'discret', valeur: null }, { texte: 'Copier', classe: 'principal', action: async () => { await navigator.clipboard.writeText(zoneTexte.value); notifier('Point N2 copié'); return true } }],
    })
  }
  const carteDecisions = h('div', { class: 'carte carte-decisions' },
    h('div', { class: 'carte-entete' }, h('h2', {}, h('span', { class: 'numero-etape' }, '4'), 'Je décide'), h('span', { class: 'discret' }, `${d.decisions.length} décision${d.decisions.length > 1 ? 's' : ''} à prendre`)),
    d.decisions.length ? h('div', { class: 'decisions' }, d.decisions.map(decision))
      : h('p', { class: 'discret' }, 'Rien à décider : chaque panne est regardée par un préventif, et aucun préventif ne tourne à vide.'),
    h('div', { class: 'suite-etape' },
      h('a', { class: 'bouton', href: `#/mn1/parc/${encodeURIComponent(d.parc.id)}` }, h('span', { class: 'numero-etape' }, '5'), 'Je fais : les fiches du parc, leur FI, l’impression ›')))

  vider(zone,
    filEtapes(3, d.parc, m),
    h('div', { class: 'entete-page' },
      h('a', { class: 'bouton discret icone-seule', title: `Retour au Pareto du parc ${d.parc.nom}`, href: `#/mn1/parc/${encodeURIComponent(d.parc.id)}` }, ic('retour')),
      h('div', { style: { flex: 1 } }, h('h1', {}, h('span', { class: 'mono' }, m.repere), m.designation ? ` — ${m.designation}` : ''), h('p', { class: 'sous-titre' }, `${d.parc.nom} · ses pannes face à tous ses préventifs, sur 12 mois`)),
      h('div', { class: 'actions' },
        boutonLire,
        h('a', { class: 'bouton', href: `#/analyse/${m.id}` }, ic('graphique', 16), 'Analyse complète'))),
    etatLecture,
    h('div', { class: 'demonstrateur' }, cartePannes, cartePreventifs, carteDecisions))
}
