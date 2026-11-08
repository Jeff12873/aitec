// Le circuit de la maintenance de niveau 1 : les indicateurs du bandeau (et le Hall of fame), les pastilles FI / RI
// des demandes, l'onglet FI N1 (FI issues de DI, arborescences manquantes) et l'onglet RI N1.

import { h, vider, ic, dateFr, nombreFr, tableau, notifier, fenetre } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { avecParc, parcChoisi, nomParcChoisi } from './parcs.js'
import { peutModifier } from '/socle/etat.js'
import { LOGO_MN1 } from './fiches-mn1.js'

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
// zone : les indicateurs, dans le bandeau ; zoneHof : l'encart du Hall of fame, sous le choix de la zone.
export async function indicateursBandeau(zone, zoneHof = null) {
  const i = await api(avecParc('/api/mn1/indicateurs')).catch(() => null)
  if (!i?.reglee) {
    if (zoneHof) vider(zoneHof)
    return vider(zone)
  }
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
  const hof = hallOfFame(i, parcChoisi() ? nomParcChoisi() : 'Usine complète', merci)
  if (zoneHof) vider(zoneHof, hof)
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
    zoneHof ? null : hof)
}

// Le Hall of fame du mois : les deux premiers demandeurs (DI) et exécutants (RI), et la portée dans le titre.
function hallOfFame(i, portee, merci = null) {
  if (!i.podium.length && !i.podiumRi?.length) return null
  const [annee, mois] = i.mois.split('-')
  const nomMois = new Date(Number(annee), Number(mois) - 1, 1).toLocaleDateString('fr-FR', { month: 'long' })
  return h('div', { class: 'hall-of-fame' },
    // Le logo du niveau 1 : le Hall of fame compte les demandes et exécutions de niveau 1.
    h('div', { class: 'titre-hof' }, h('img', { class: 'logo-hof', src: LOGO_MN1, alt: 'Niveau 1', title: 'Maintenance de niveau 1' }), h('span', { class: 'etincelle-hof' }, ic('etincelle', 22)), h('span', { class: 'texte-hof' }, 'Contributeurs du mois'), h('span', { class: 'portee-hof' }, `${portee} · ${nomMois}`)),
    h('div', { class: 'podiums' },
      podium(i.podium, 'DI', 'Demandes'),
      podium(i.podiumRi || [], 'RI', 'Exécutions')),
    merci)
}

// PREVTEC, « Ma ligne » : le Hall of fame de cette ligne seule (une ligne discrète s'il n'y a encore personne).
export function hallOfFameLigne(parc) {
  const zone = h('div', { class: 'zone-hof-ligne' })
  api(`/api/mn1/indicateurs?parc=${encodeURIComponent(parc.id)}`).then((i) => {
    if (!i?.reglee) return vider(zone)
    const seul = (c, quoi) => c ? h('div', { class: 'alerte-mn1' }, ic('personne', 15), `Les ${quoi} reposent sur une seule personne : ${c.nom} en a fait ${Math.round(c.part * 100)} % (${c.total} ${quoi} sur 8 semaines).`) : null
    vider(zone, hallOfFame(i, parc.nom) || h('p', { class: 'discret hof-vide' }, ic('etincelle', 14), `Pas encore de demande ni d’exécution ce mois-ci sur ${parc.nom}.`), seul(i.concentration, 'DI'), seul(i.concentrationRi, 'RI'))
  }).catch(() => vider(zone))
  return zone
}

// Un podium du Hall of fame : les deux premiers, et ce qu'ils ont fait.
function podium(liste, unite, titre) {
  if (!liste.length) return null
  return h('div', { class: 'podium-titre' }, h('span', { class: 'discret' }, titre),
    h('div', { class: 'podium' }, liste.map((p, k) => h('div', { class: `marche marche-${k + 1}` }, h('span', { class: 'rang' }, k ? '2' : '1'), h('b', {}, p.nom), h('span', { class: 'discret' }, `${p.nombre} ${unite}`)))))
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
  // Refermé au départ : l'en-tête dit combien sont à reprendre, un clic l'ouvre.
  let ouvert = false
  const contenu = h('div', { hidden: true },
    h('div', { class: 'actions', style: { marginBottom: '8px' } },
      h('label', { class: 'discret', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('input', { type: 'checkbox', checked: true, style: { width: 'auto' }, onchange: (e) => { seulementAReprendre = e.target.checked; dessiner() } }),
        `seulement celles à reprendre (${aReprendre})`)),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Une FI faite d’une demande doit porter l’équipement de l’arborescence de production et celui de l’arborescence de maintenance. Celles à qui il en manque un sont en tête : à compléter dans la GMAO.'),
    corps)
  const fleche = h('span', { class: 'fleche-repli' }, '▸')
  const basculer = () => {
    ouvert = !ouvert
    contenu.hidden = !ouvert
    fleche.textContent = ouvert ? '▾' : '▸'
  }
  vider(zone, h('div', { class: 'carte', style: { marginBottom: '16px' } },
    h('button', { class: 'entete-repli', 'aria-expanded': 'false', onclick: (e) => { basculer(); e.currentTarget.setAttribute('aria-expanded', String(ouvert)) } },
      fleche, ic('document', 18), h('span', { class: 'titre-repli' }, 'FI issues de DI'),
      h('span', { class: `etiquette ${aReprendre ? 'orange' : ''}` }, aReprendre ? `${aReprendre} à reprendre` : 'rien à reprendre'),
      h('span', { class: 'discret' }, `${r.fi.length} FI`)),
    contenu))
  dessiner()
}

// ---------------------------------------------------------------- onglet RI N1

export async function afficherRi(zone) {
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture des RI dans la base de la GMAO'))
  const activites = h('div')
  encartActivites(activites)
  const r = await api(avecParc('/api/mn1/circuit/ri')).catch((e) => ({ erreur: e.message }))
  if (r.erreur) return vider(zone, activites, h('div', { class: 'carte vide' }, ic('alerte', 28), h('p', {}, r.erreur)))
  if (!r.reglee) return vider(zone, activites, h('div', { class: 'carte vide' }, ic('base', 28), h('p', {}, 'Pas encore de requête « RI de niveau 1 » : réglez-la dans Administration › Données de la GMAO › « Les requêtes ».')))
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
  vider(zone, activites,
    h('div', { class: 'carte', style: { marginBottom: '16px' } },
      h('div', { class: 'carte-entete' }, h('h2', {}, ic('coche', 18), 'RI des demandes (avec ou sans FI)'), h('span', { class: 'discret' }, `${nombreFr(r.issuesDeDi.length)} · 12 mois`)),
      tableau({ lignes: r.issuesDeDi, vide: 'Aucune RI de demande de niveau 1 sur 12 mois.', colonnes: colonnes(true) })),
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' }, h('h2', {}, ic('usine', 18), 'RI des FI focus'), h('span', { class: 'discret' }, `${nombreFr(r.focus.length)} · 12 mois`)),
      tableau({ lignes: r.focus, vide: 'Aucune RI de FI focus sur 12 mois.', colonnes: colonnes(false) })))
}

// ---------------------------------------------------------------- activités des conducteurs

// Les RI exécutées par les conducteurs, par personne (barres empilées par catégorie, la plus active en haut) et par
// catégorie, sur 1, 3 ou 12 mois. Le parc d'une personne se reconnaît à son profil de la GMAO (réglé par parc).
const TEINTES = ['#2dd4bf', '#0d9488', '#a3e635', '#65a30d', '#f59e0b', '#8b5cf6', '#3b82f6', '#f05252']
let moisActivites = 3
async function encartActivites(zone) {
  const a = await api(avecParc(`/api/mn1/activites?mois=${moisActivites}`)).catch((e) => ({ erreur: e.message }))
  if (a.erreur) return vider(zone, h('div', { class: 'carte', style: { marginBottom: '16px' } }, h('div', { class: 'bandeau' }, ic('alerte'), `Activités des conducteurs : ${a.erreur}`)))
  if (!a.reglee) return vider(zone, h('div', { class: 'carte discret', style: { marginBottom: '16px' } }, ic('personne', 18), ' Activités des conducteurs : réglez la requête « RI des conducteurs » dans Administration › Données de la GMAO.'))
  const couleur = new Map(a.categories.map((c, k) => [c.cle, TEINTES[k % TEINTES.length]]))
  const max = Math.max(1, ...a.personnes.map((p) => p.total))
  const periode = h('div', { class: 'choix-periode' }, [[1, 'Mois en cours'], [3, '3 mois'], [12, '12 mois']].map(([m, texte]) =>
    h('button', { class: `petit${m === moisActivites ? ' choisi' : ' discret'}`, onclick: () => { moisActivites = m; encartActivites(zone) } }, texte)))
  const parc = parcChoisi()
  const reglageProfil = parc && peutModifier()
    ? h('label', { class: 'profil-parc discret', title: 'Le texte contenu dans le profil de la GMAO des conducteurs de cette ligne' }, 'Profil des conducteurs de cette ligne',
      h('input', { type: 'text', value: a.profil, placeholder: 'ex. LIGNE 2', onchange: async (e) => {
        try {
          await api(`/api/mn1/profils/${encodeURIComponent(parc)}`, { methode: 'POST', corps: { profil: e.target.value } })
          encartActivites(zone)
        } catch (erreur) { notifier(erreur.message, 'erreur') }
      } }))
    : null
  const avertissement = parc && !a.profil
    ? h('p', { class: 'discret', style: { margin: '0 0 8px' } }, `Aucun profil réglé pour ${nomParcChoisi()} : toutes les personnes de la requête sont comptées.`)
    : !parc && !a.profilsRegles ? h('p', { class: 'discret', style: { margin: '0 0 8px' } }, 'Aucun profil réglé sur les lignes : toutes les personnes de la requête sont comptées. Choisissez une ligne pour régler le sien.') : null
  vider(zone, h('div', { class: 'carte activites-conducteurs', style: { marginBottom: '16px' } },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('personne', 18), 'Activités des conducteurs'),
      h('span', { class: 'discret' }, `${nombreFr(a.total)} exécutions · ${nombreFr(a.ri)} RI · depuis le ${dateFr(a.depuis)}`), periode),
    reglageProfil, avertissement,
    a.personnes.length ? [
      h('div', { class: 'legende-activites' }, a.categories.map((c) => h('span', {}, h('i', { style: { background: couleur.get(c.cle) } }), `${c.nom} `, h('b', {}, nombreFr(c.total))))),
      h('div', { class: 'barres-activites' }, a.personnes.map((p) => h('div', { class: 'ligne-activite' },
        h('span', { class: 'nom-activite', title: p.nom }, p.nom),
        h('div', { class: 'piste-activite' }, h('div', { class: 'barre-activite', style: { width: `${(p.total / max) * 100}%` } },
          a.categories.filter((c) => p.parCategorie[c.cle]).map((c) => h('span', { style: { flex: String(p.parCategorie[c.cle]), background: couleur.get(c.cle) }, title: `${c.nom} : ${p.parCategorie[c.cle]}` })))),
        h('b', { class: 'total-activite' }, nombreFr(p.total))))),
    ] : h('p', { class: 'discret' }, 'Aucune RI exécutée par les conducteurs sur la période.')))
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
// La couleur d'une semaine : A (matin) bleu, B (après-midi) vert, C (nuit) violet ; plusieurs équipes : le dégradé
// de leurs couleurs (AB du bleu au vert). Semaine exclue : rayée, sans couleur.
const COULEURS_EQUIPES = { A: '#6fa3c7', B: '#73b08a', C: '#9c8fc4' }
const fondRegime = (r) => {
  if (!r || r === 'X') return ''
  const couleurs = [...r].map((l) => `color-mix(in srgb, ${COULEURS_EQUIPES[l] || '#2dd4bf'} 42%, transparent)`)
  return couleurs.length === 1 ? `linear-gradient(${couleurs[0]}, ${couleurs[0]})` : `linear-gradient(135deg, ${couleurs.map((c, i) => `${c} ${Math.round((i * 100) / (couleurs.length - 1))}%`).join(', ')})`
}
// Le liseré d'une semaine : les couleurs franches de ses équipes.
const LISERES = { A: '#3ea6ff', B: '#2fd67e', C: '#b48cff' }
const liseretRegime = (r) => {
  if (!r || r === 'X') return ''
  const c = [...r].map((l) => LISERES[l] || '#2dd4bf')
  return c.length === 1 ? `linear-gradient(${c[0]}, ${c[0]})` : `linear-gradient(135deg, ${c.join(', ')})`
}
const lettreColoree = (l, texte) => h('span', { class: 'lettre-equipe', style: { color: COULEURS_EQUIPES[l] } }, texte)

// PREVTEC, « Ma ligne » : le calendrier des équipes en petit, la semaine en cours et les 5 suivantes ; un clic
// ouvre le calendrier complet (l'administrateur y change les semaines).
export function calendrierCompact(parc, admin) {
  const zone = h('button', { type: 'button', class: 'calendrier-compact', title: 'Ouvrir le calendrier des équipes de l’année' })
  const ouvrir = async () => {
    await fenetre({ titre: `Équipes — ${parc.nom}`, large: true, contenu: encartCalendrier(parc, admin), boutons: [{ texte: 'Fermer', classe: 'principal', valeur: true }] })
    charger()
  }
  zone.onclick = ouvrir
  const charger = () => api(`/api/mn1/calendrier/${encodeURIComponent(parc.id)}`).then((cal) => {
    const [a0, s0] = semaineCourante().split('-').map(Number)
    const semaines = []
    for (let k = 0, a = a0, s = s0; k < 6; k++) {
      const regime = cal.semaines[`${a}-${s}`] || cal.defaut
      semaines.push(h('span', { class: `semaine-compacte ${teinte(regime)}${k ? '' : ' courante'}`, style: { '--fond': fondRegime(regime), '--liseret': liseretRegime(regime) }, title: `S${s} ${a} : ${regime === 'X' ? 'exclue des indicateurs' : `${regime.length} équipe${regime.length > 1 ? 's' : ''} (${regime})`}` }, h('small', {}, `S${s}`), h('b', {}, regime === 'X' ? '✕' : regime)))
      if (++s > semainesDeLAnnee(a)) { s = 1; a++ }
    }
    vider(zone, h('span', { class: 'tete-compact' }, ic('calendrier', 14), 'Équipes', h('small', { class: 'discret' }, ' · cette semaine et les suivantes')), h('span', { class: 'semaines-compactes' }, semaines))
  }).catch(() => vider(zone))
  charger()
  return zone
}

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
  // Le geste en cours : la case de départ, sa valeur, et s'il a glissé (null hors geste). Les cases survolées
  // changent tout de suite ; on enregistre et on redessine quand le bouton est relâché.
  let geste = null
  const appliquer = (s, valeur) => {
    const cle = `${annee}-${s}`
    if (valeur) cal.semaines[cle] = valeur
    else delete cal.semaines[cle]
    const bouton = zone.querySelector(`.semaine-cal[data-s="${s}"]`)
    if (!bouton) return
    const regime = valeur || cal.defaut
    bouton.className = `semaine-cal ${teinte(regime)}${valeur ? '' : ' defaut'}${cle === semaineCourante() ? ' courante' : ''}`
    bouton.style.setProperty('--fond', fondRegime(regime))
    bouton.style.setProperty('--liseret', liseretRegime(regime))
    bouton.querySelector('b').textContent = regime === 'X' ? '✕' : regime
  }
  const relacher = () => {
    if (!geste) return
    const { depart, valeur, glisse } = geste
    geste = null
    // Sans glisser : un simple clic fait tourner la case de départ.
    if (!glisse) appliquer(depart, CYCLE[(CYCLE.indexOf(valeur) + 1) % CYCLE.length])
    enregistrer()
    dessiner()
  }
  document.addEventListener('pointerup', relacher)
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
        style: { '--fond': fondRegime(regime), '--liseret': liseretRegime(regime) },
        disabled: !admin,
        'data-s': String(s),
        title: `S${s} ${annee} : ${regime === 'X' ? 'exclue des indicateurs' : `${regime.length} équipe${regime.length > 1 ? 's' : ''} (${regime})`}${propre ? '' : ' — régime par défaut'}`,
        // Clic (au relâcher, sur la même case) : la valeur suivante. Bouton gardé enfoncé en glissant : la case de
        // départ ne change pas, les semaines survolées prennent sa valeur. Maj + clic : recopie jusqu'ici.
        onpointerdown: (e) => {
          if (e.button !== 0) return
          e.preventDefault()
          if (e.shiftKey && derniere && derniere.annee === annee) {
            const valeur = cal.semaines[`${annee}-${derniere.s}`] || ''
            for (let k = Math.min(derniere.s, s); k <= Math.max(derniere.s, s); k++) appliquer(k, valeur)
            enregistrer()
            return dessiner()
          }
          geste = { depart: s, valeur: propre, glisse: false }
          derniere = { annee, s }
        },
        onpointerenter: () => {
          if (!geste || s === geste.depart) return
          if (!geste.glisse) geste.glisse = true
          appliquer(s, geste.valeur)
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
      h('p', { class: 'legende-calendrier' }, lettreColoree('A', 'A matin'), ' · ', lettreColoree('B', 'B après-midi'), ' · ', lettreColoree('C', 'C nuit'), ' · ✕ exclue', admin ? h('br') : null, admin ? 'Clic : changer · clic gardé en glissant : la même valeur sur plusieurs semaines · Maj + clic : recopier jusqu’ici' : null))
  }
  api(`/api/mn1/calendrier/${encodeURIComponent(parc.id)}`).then((c) => { cal = c; dessiner() }).catch(() => vider(zone))
  return zone
}
