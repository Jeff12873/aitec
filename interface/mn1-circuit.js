// Le circuit de la maintenance de niveau 1 : les indicateurs du bandeau (et le Hall of fame), les pastilles FI / RI
// des demandes, l'onglet FI N1 (FI issues de DI, arborescences manquantes) et l'onglet RI N1.

import { h, vider, ic, dateFr, nombreFr, tableau } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { avecParc } from './parcs.js'

const jours = (n) => (n === null || n === undefined ? '—' : `${Math.round(n)} j`)
const pourcent = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)} %`

// Dire aux gens quand ils font bien : rappels pour le manager, qui lit l'indicateur (ceux qui font les DI n'ont pas
// accès à l'outil). Ils tournent, comme les idées du bandeau.
const RECONNAISSANCE = [
  'Une DI bien faite, c’est une panne évitée : dites-le à ceux qui les font, ils le verront rarement ailleurs.',
  'Un merci précis vaut mieux qu’un bravo général : citez la machine, la date, ce que la demande a permis.',
  'Ce qu’on remarque se répète : relevez les bonnes demandes au point du matin.',
  'Le signalement d’une anomalie est un geste de maintenance : il mérite d’être reconnu comme tel.',
  'Montrer la suite donnée à une DI (la FI, la RI) encourage plus que n’importe quel chiffre.',
  'Une remarque positive en équipe compte plus qu’un classement affiché.',
]

// ---------------------------------------------------------------- bandeau

let minuterieMerci = null
export async function indicateursBandeau(zone) {
  const i = await api(avecParc('/api/mn1/indicateurs')).catch(() => null)
  if (!i?.reglee) return vider(zone)
  const tuile = (valeur, libelle, { titre = '', alerte = false } = {}) => h('div', { class: `indicateur-mn1${alerte ? ' alerte' : ''}`, title: titre }, h('b', {}, valeur), h('span', {}, libelle))
  const alertes = [
    i.alerteBaisse ? h('div', { class: 'alerte-mn1' }, ic('alerte', 15), `Les DI baissent : ${pourcent(i.tendance)} par poste sur les 4 dernières semaines terminées, par rapport aux 4 précédentes.`) : null,
    i.concentration ? h('div', { class: 'alerte-mn1' }, ic('personne', 15), `Les DI reposent sur une seule personne : ${i.concentration.nom} en a fait ${Math.round(i.concentration.part * 100)} % (${i.concentration.total} DI sur 8 semaines).`) : null,
  ].filter(Boolean)
  const merci = h('p', { class: 'merci-mn1' })
  let n = Math.floor(Math.random() * RECONNAISSANCE.length)
  const tourner = () => { merci.classList.remove('visible'); setTimeout(() => { merci.textContent = RECONNAISSANCE[n++ % RECONNAISSANCE.length]; merci.classList.add('visible') }, 250) }
  clearInterval(minuterieMerci)
  minuterieMerci = setInterval(() => (zone.isConnected ? tourner() : clearInterval(minuterieMerci)), 11000)
  tourner()
  const [annee, mois] = i.mois.split('-')
  const nomMois = new Date(Number(annee), Number(mois) - 1, 1).toLocaleDateString('fr-FR', { month: 'long' })
  vider(zone,
    h('div', { class: 'indicateurs-mn1' },
      tuile(i.diSemaine === null ? '—' : (Math.round(i.diSemaine * 10) / 10).toLocaleString('fr-FR'), 'DI par semaine', { titre: `Moyenne des 4 dernières semaines terminées (la semaine en cours n’est pas comptée).${i.tauxParPoste !== null ? ` Soit ${(Math.round(i.tauxParPoste * 100) / 100).toLocaleString('fr-FR')} DI par poste travaillé.` : ''}${i.semainesExclues ? ` ${i.semainesExclues} semaine(s) exclue(s) par le calendrier.` : ''}` }),
      tuile(i.tendance === null ? '—' : pourcent(i.tendance), 'tendance', { titre: 'DI par poste : 4 dernières semaines terminées contre les 4 précédentes', alerte: i.alerteBaisse }),
      tuile(jours(i.delaiMedian), 'DI → clôture RI', { titre: i.suivi ? 'Délai médian entre la création de la DI et la RI qui la clôt (12 mois)' : 'Ajoutez les colonnes fi, fi_actif, ri, date_ri à la requête des demandes' }),
      tuile(i.enAttente ?? '—', 'DI sans FI > 7 j', { titre: 'Demandes ouvertes depuis plus de 7 jours que l’appui technique n’a pas encore transformées en FI', alerte: i.enAttente > 0 }),
      tuile(i.supprimees ?? '—', 'FI supprimées', { titre: 'FI issues de DI archivées sans RI, sur 12 mois (doublon, erreur…) — règle à confirmer' }),
      tuile(i.sansDoubleArbo ?? '—', 'FI sans double arbo', { titre: i.fiReglee ? 'FI issues de DI qui n’ont pas à la fois un équipement de production et un de maintenance' : 'Réglez la requête « FI de niveau 1 »', alerte: i.sansDoubleArbo > 0 }),
      tuile(i.focusEnRetard ?? '—', 'FI focus en retard', { titre: `FI focus dont l’échéance est passée sans RI. Retard médian des FI focus faites : ${jours(i.retardFocus)}`, alerte: i.focusEnRetard > 0 })),
    alertes.length ? h('div', { class: 'alertes-mn1' }, alertes) : null,
    i.podium.length ? h('div', { class: 'hall-of-fame' },
      h('div', { class: 'titre-hof' }, ic('etincelle', 16), `Hall of fame · ${nomMois}`),
      h('div', { class: 'podium' }, i.podium.map((p, k) => h('div', { class: `marche marche-${k + 1}` }, h('span', { class: 'rang' }, k ? '2' : '1'), h('b', {}, p.nom), h('span', { class: 'discret' }, `${p.nombre} DI`)))),
      merci) : null)
}

// ---------------------------------------------------------------- pastilles FI / RI d'une demande

export function pastillesSuivi(d) {
  const fi = !d.fi
    ? h('span', { class: 'pastille-etat absente', title: 'Pas encore de FI : l’appui technique ne l’a pas transformée' }, 'FI —')
    : d.fiActif === 2 && !d.ri
      ? h('span', { class: 'pastille-etat supprimee', title: 'FI archivée sans RI : supprimée (doublon, erreur…)' }, d.fi)
      : h('span', { class: `pastille-etat ${d.ri ? 'faite' : 'en-cours'}`, title: d.ri ? 'FI faite' : 'FI programmée, pas encore de RI' }, d.fi)
  const ri = d.ri
    ? h('span', { class: 'pastille-etat close', title: `RI du ${dateFr(d.dateRi)}` }, d.ri)
    : h('span', { class: 'pastille-etat absente', title: 'Pas encore de RI' }, 'RI —')
  return h('span', { class: 'pastilles-suivi' }, fi, ri)
}

// ---------------------------------------------------------------- onglet FI N1 : FI issues de DI

export async function afficherFiIssues(zone) {
  const r = await api(avecParc('/api/mn1/circuit/fi')).catch((e) => ({ erreur: e.message }))
  if (r.erreur) return vider(zone, h('div', { class: 'carte' }, h('div', { class: 'bandeau' }, ic('alerte'), r.erreur)))
  if (!r.reglee) return vider(zone, h('div', { class: 'carte discret' }, ic('base', 18), ' FI issues de DI : réglez la requête « FI de niveau 1 » dans Administration › Données de la GMAO.'))
  let seulementAReprendre = true
  const corps = h('div')
  const coche = (oui, titre) => h('span', { title: titre, style: { color: oui ? 'var(--vert)' : 'var(--rouge)', fontWeight: 700 } }, oui ? '✓' : '✗')
  const dessiner = () => {
    const liste = seulementAReprendre ? r.fi.filter((f) => f.manque && !f.supprimee) : r.fi
    vider(corps, tableau({
      lignes: liste,
      vide: seulementAReprendre ? 'Toutes les FI issues de DI ont leurs deux arborescences.' : 'Aucune FI issue de DI.',
      colonnes: [
        { titre: 'FI', valeur: (f) => h('b', { class: 'mono' }, f.numero) },
        { titre: 'DI', valeur: (f) => h('span', { class: 'mono discret' }, f.di) },
        { titre: 'Créée', classe: 'col-date', valeur: (f) => h('span', { class: 'discret' }, dateFr(f.date)) },
        { titre: 'Titre', classe: 'col-description', valeur: (f) => h('span', { class: 'texte-2', title: f.titre }, f.titre) },
        { titre: 'Arbo production', valeur: (f) => coche(f.production, f.production ? 'Un équipement de l’arborescence de production' : 'Pas d’équipement de production') },
        { titre: 'Arbo maintenance', valeur: (f) => coche(f.maintenance, f.maintenance ? 'Un équipement de l’arborescence de maintenance' : 'Pas d’équipement de maintenance') },
        { titre: 'État', valeur: (f) => (f.supprimee ? h('span', { class: 'pastille-etat supprimee' }, 'supprimée') : f.ri ? h('span', { class: 'pastille-etat close', title: `RI du ${dateFr(f.dateRi)}` }, f.ri) : h('span', { class: 'pastille-etat en-cours' }, f.actif === 1 ? 'programmée' : 'archivée')) },
      ],
    }))
  }
  const aReprendre = r.fi.filter((f) => f.manque && !f.supprimee).length
  vider(zone, h('div', { class: 'carte', style: { marginBottom: '16px' } },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('document', 18), 'FI issues de DI'),
      h('label', { class: 'discret', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('input', { type: 'checkbox', checked: true, style: { width: 'auto' }, onchange: (e) => { seulementAReprendre = e.target.checked; dessiner() } }),
        `seulement celles à reprendre (${aReprendre})`)),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Une FI faite d’une demande doit porter l’équipement de l’arborescence de production et celui de l’arborescence de maintenance. Celles à qui il en manque un sont en tête : à compléter dans la GMAO.'),
    corps))
  dessiner()
}

// ---------------------------------------------------------------- onglet RI N1

export async function afficherRi(zone) {
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture des RI dans la base de la GMAO'))
  const r = await api(avecParc('/api/mn1/circuit/ri')).catch((e) => ({ erreur: e.message }))
  if (r.erreur) return vider(zone, h('div', { class: 'carte vide' }, ic('alerte', 28), h('p', {}, r.erreur)))
  if (!r.reglee) return vider(zone, h('div', { class: 'carte vide' }, ic('base', 28), h('p', {}, 'Pas encore de requête « RI de niveau 1 » : réglez-la dans Administration › Données de la GMAO › « Les requêtes ».')))
  const colonnes = (avecDi) => [
    { titre: 'Date', classe: 'col-date', valeur: (x) => h('span', { class: 'discret' }, dateFr(x.date)) },
    { titre: 'RI', valeur: (x) => h('b', { class: 'mono' }, x.numero) },
    avecDi ? { titre: 'DI', valeur: (x) => h('span', { class: 'mono discret' }, x.di) } : null,
    { titre: 'FI', valeur: (x) => h('span', { class: 'mono discret' }, x.fi || '—') },
    avecDi ? { titre: 'Délai', valeur: (x) => h('span', { title: 'De la création de la DI à la RI' }, jours(x.delai)) } : null,
    { titre: 'Machine', valeur: (x) => h('span', { class: 'mono' }, x.machine) },
    { titre: 'Intervenant', classe: 'col-intervenants', valeur: (x) => x.intervenant || '—' },
    { titre: 'Observation', classe: 'col-description', valeur: (x) => h('span', { class: 'texte-2', title: x.observation }, x.observation || '—') },
  ].filter(Boolean)
  vider(zone,
    h('div', { class: 'carte', style: { marginBottom: '16px' } },
      h('div', { class: 'carte-entete' }, h('h2', {}, ic('coche', 18), 'RI des demandes (avec ou sans FI)'), h('span', { class: 'discret' }, `${nombreFr(r.issuesDeDi.length)} · 12 mois`)),
      tableau({ lignes: r.issuesDeDi, vide: 'Aucune RI de demande de niveau 1 sur 12 mois.', colonnes: colonnes(true) })),
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' }, h('h2', {}, ic('usine', 18), 'RI des FI focus'), h('span', { class: 'discret' }, `${nombreFr(r.focus.length)} · 12 mois`)),
      tableau({ lignes: r.focus, vide: 'Aucune RI de FI focus sur 12 mois.', colonnes: colonnes(false) })))
}

// ---------------------------------------------------------------- calendrier d'un parc

// Le régime des équipes, semaine par semaine (A matin, B après-midi, C nuit ; X : semaine exclue des indicateurs,
// travaux d'été…). Une case vide prend le régime par défaut du parc. L'administrateur clique pour faire tourner la
// case ; Maj + clic recopie la valeur de la dernière case cliquée sur toutes les semaines entre les deux.
const CYCLE = ['', 'A', 'AB', 'B', 'BC', 'C', 'CA', 'ABC', 'X']
const semainesDeLAnnee = (annee) => {
  const d = new Date(Date.UTC(annee, 11, 28))
  const jeudi = new Date(d)
  jeudi.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))
  const premierJeudi = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((jeudi - premierJeudi) / 86_400_000 - 3 + ((premierJeudi.getUTCDay() + 6) % 7)) / 7)
}
const semaineCourante = () => {
  const d = new Date()
  const jeudi = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  jeudi.setUTCDate(jeudi.getUTCDate() + 3 - ((jeudi.getUTCDay() + 6) % 7))
  const premierJeudi = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 4))
  return `${jeudi.getUTCFullYear()}-${1 + Math.round(((jeudi - premierJeudi) / 86_400_000 - 3 + ((premierJeudi.getUTCDay() + 6) % 7)) / 7)}`
}
const teinte = (r) => (r === 'X' ? 'exclue' : `equipes-${r.length}`)

export function encartCalendrier(parc, admin) {
  const zone = h('div', { class: 'calendrier-parc' })
  let annee = new Date().getFullYear()
  let cal = null
  let derniere = null // la dernière case cliquée (pour Maj + clic)
  let minuterie = null
  const enregistrer = () => {
    clearTimeout(minuterie)
    minuterie = setTimeout(() => api(`/api/mn1/calendrier/${encodeURIComponent(parc.id)}`, { methode: 'POST', corps: { defaut: cal.defaut, semaines: cal.semaines } }).catch(() => {}), 500)
  }
  const dessiner = () => {
    const n = semainesDeLAnnee(annee)
    const courante = semaineCourante()
    const cases = []
    for (let s = 1; s <= n; s++) {
      const cle = `${annee}-${s}`
      const propre = cal.semaines[cle] || ''
      const regime = propre || cal.defaut
      cases.push(h('button', {
        type: 'button',
        class: `semaine-cal ${teinte(regime)}${propre ? '' : ' defaut'}${cle === courante ? ' courante' : ''}`,
        disabled: !admin,
        title: `S${s} ${annee} : ${regime === 'X' ? 'exclue des indicateurs' : `${regime.length} équipe${regime.length > 1 ? 's' : ''} (${regime})`}${propre ? '' : ' — régime par défaut'}`,
        onclick: (e) => {
          if (e.shiftKey && derniere && derniere.annee === annee) {
            const valeur = cal.semaines[`${annee}-${derniere.s}`] || ''
            for (let k = Math.min(derniere.s, s); k <= Math.max(derniere.s, s); k++) {
              if (valeur) cal.semaines[`${annee}-${k}`] = valeur
              else delete cal.semaines[`${annee}-${k}`]
            }
          } else {
            const suivant = CYCLE[(CYCLE.indexOf(propre) + 1) % CYCLE.length]
            if (suivant) cal.semaines[cle] = suivant
            else delete cal.semaines[cle]
            derniere = { annee, s }
          }
          enregistrer()
          dessiner()
        },
      }, h('small', {}, `S${s}`), h('b', {}, regime === 'X' ? '✕' : regime)))
    }
    const defaut = admin
      ? h('select', { class: 'petit', onchange: (e) => { cal.defaut = e.target.value; enregistrer(); dessiner() } }, ['A', 'AB', 'B', 'BC', 'C', 'CA', 'ABC'].map((r) => h('option', { value: r, selected: r === cal.defaut }, r)))
      : h('b', {}, cal.defaut)
    vider(zone,
      h('div', { class: 'tete-calendrier' },
        h('h3', {}, ic('calendrier', 16), 'Équipes'),
        h('div', { class: 'annee-calendrier' },
          h('button', { class: 'discret icone-seule petit', title: 'Année précédente', onclick: () => { annee--; dessiner() } }, '‹'),
          h('b', {}, String(annee)),
          h('button', { class: 'discret icone-seule petit', title: 'Année suivante', onclick: () => { annee++; dessiner() } }, '›'))),
      h('div', { class: 'defaut-calendrier' }, h('span', { class: 'discret' }, 'Par défaut'), defaut),
      h('div', { class: 'grille-calendrier' }, cases),
      h('p', { class: 'legende-calendrier' }, 'A matin · B après-midi · C nuit · ✕ exclue', admin ? h('br') : null, admin ? 'Clic : changer · Maj + clic : recopier jusqu’ici' : null))
  }
  api(`/api/mn1/calendrier/${encodeURIComponent(parc.id)}`).then((c) => { cal = c; dessiner() }).catch(() => vider(zone))
  return zone
}
