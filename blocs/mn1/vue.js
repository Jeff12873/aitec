// La maintenance de niveau 1 : un bandeau (pourquoi, chiffres du site, une idée qui tourne), les vignettes des
// parcs (charge des opérateurs, pertinence des fiches, tendance des pannes, alertes), la fiche MN1 de chaque parc,
// et le tableau de bord des demandes d'intervention de niveau 1.

import { h, vider, ic, dateFr, nombreFr, essayer, fenetre, notifier, tableau } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier } from '/socle/etat.js'
import { barres, barresHorizontales, COULEURS } from '/socle/graphiques.js'
import { menuDeroulant } from '../../interface/menu-deroulant.js'
import { LOGO_MN1, definirParametres } from '../../interface/fiches-mn1.js'
import { afficherParc } from '../../interface/mn1-parc.js'
import { afficherFiches, boutonImport, reglerParametres, reglerCreationGmao } from '../../interface/mn1-ancien.js'
import { reglerGmao, reglerEntete } from '../../interface/mn1-reglages.js'
import { jauge, courbe, ecartTendance } from '../../interface/mn1-graphiques.js'
import { avecParc, parcChoisi } from '../../interface/parcs.js'
import { animer } from '../tableau-de-bord/vue.js'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
let tri = 'nom'
let derniereLecture = 0 // les FI de la GMAO sont relues à chaque ouverture de l'écran (pas à chaque rafraîchissement)

// Ce qu'on sait de la maintenance autonome (TPM), sans chiffre inventé : des repères et des exemples.
const IDEES = [
  ['La maintenance autonome est le premier pilier de la TPM, formalisée au Japon par Seiichi Nakajima (JIPM) dans les années 1970.', 'Repère'],
  ['« Nettoyer, c’est inspecter » : en nettoyant sa machine, l’opérateur voit la fuite, le jeu, la fissure avant la panne.', 'Principe TPM'],
  ['La TPM vise les six grandes pertes : pannes, changements et réglages, micro-arrêts, ralentissements, défauts qualité, pertes au démarrage.', 'Repère'],
  ['Le niveau 1 de maintenance (FD X 60-000) : des actions simples, sur des éléments accessibles en toute sécurité, faites par l’exploitant.', 'Norme'],
  ['Une anomalie relevée tôt (vis desserrée, courroie qui siffle, niveau bas) se répare en minutes ; la même, laissée filer, devient un arrêt.', 'Exemple'],
  ['L’opérateur est le premier capteur de sa machine : il entend le bruit qui change et sent la vibration nouvelle.', 'Principe'],
  ['Le TRS (disponibilité × performance × qualité) est l’indicateur que la maintenance autonome fait monter, en réduisant arrêts et micro-arrêts.', 'Repère'],
  ['Les étapes de la maintenance autonome commencent par le nettoyage initial et la chasse aux sources de salissure, avant les standards d’inspection.', 'Méthode JIPM'],
  ['Une fiche utile vise une panne qui revient : le Pareto des pannes dit par où commencer.', 'Méthode'],
  ['Exemple : un serrage de bride contrôlé chaque mois évite la fuite hydraulique qui arrêtait la ligne plusieurs fois par trimestre.', 'Exemple'],
]

export default {
  chemin: 'mn1',
  titre: 'Maintenance de niveau 1',
  icone: 'coche',
  menu: true,
  aide: 'maintenance-niveau-1',

  async afficher(zone, { id }) {
    const [onglet, parc] = String(id || '').split('/')
    if (onglet === 'parc' && parc) return afficherParc(zone, decodeURIComponent(parc))
    definirParametres(await api('/api/mn1/parametres').catch(() => null))
    const contenu = h('div')
    const admin = peutModifier()
    const bandeau = h('div', { class: 'bandeau-mn1' })
    vider(
      zone,
      bandeau,
      h('div', { class: 'barre-onglets-mn1' },
        h('div', { class: 'segments' },
          h('button', { class: !['demandes', 'ancien'].includes(onglet) ? 'choisi' : '', onclick: () => (location.hash = '#/mn1') }, ic('usine', 16), 'Parcs'),
          h('button', { class: onglet === 'demandes' ? 'choisi' : '', onclick: () => (location.hash = '#/mn1/demandes') }, ic('graphique', 16), 'Demandes de niveau 1')),
        h('div', { class: 'espace' }),
        admin ? h('button', { class: 'discret petit', title: 'L’ancien écran (fiches par ligne, une FI par machine), le temps que le nouveau fasse ses preuves', onclick: () => (location.hash = '#/mn1/ancien') }, ic('historique', 14), 'Ancien mode') : null,
        admin ? h('button', { class: 'discret icone-seule', title: 'Réglages de la GMAO : paramètres des FI, périodicités, SQL du site', onclick: reglerGmao }, ic('base', 18)) : null),
      contenu,
    )
    if (onglet === 'demandes') {
      dessinerBandeau(bandeau, null)
      return afficherDemandes(contenu)
    }
    if (onglet === 'ancien') {
      dessinerBandeau(bandeau, null)
      return afficherAncien(contenu)
    }
    await afficherVignettes(contenu, bandeau)
  },
}

// ---------------------------------------------------------------- bandeau

let minuterieIdees = null
async function dessinerBandeau(bandeau, v) {
  const e = await api('/api/mn1/entete').catch(() => null)
  const idee = h('div', { class: 'idee-mn1' })
  let n = Math.floor(Math.random() * IDEES.length)
  const montrerIdee = () => {
    const [texte, source] = IDEES[n % IDEES.length]
    idee.classList.remove('visible')
    setTimeout(() => {
      vider(idee, h('span', { class: 'source-idee' }, source), h('span', {}, texte))
      idee.classList.add('visible')
    }, 250)
    n++
  }
  clearInterval(minuterieIdees)
  minuterieIdees = setInterval(() => (bandeau.isConnected ? montrerIdee() : clearInterval(minuterieIdees)), 9000)
  montrerIdee()
  const chiffre = (valeur, libelle, titre = '') => h('div', { class: 'chiffre-mn1', title: titre }, h('b', {}, valeur), h('span', {}, libelle))
  const parcs = v?.parcs || []
  const analyses = parcs.filter((p) => p.pertinence?.taux !== null && p.pertinence?.taux !== undefined)
  const fiches = parcs.reduce((s, p) => s + p.fiches, 0)
  vider(bandeau,
    h('img', { class: 'logo-page-mn1', src: LOGO_MN1, alt: '' }),
    h('div', { class: 'texte-bandeau-mn1' },
      h('div', { class: 'titre-bandeau-mn1' }, h('h1', {}, 'Maintenance de niveau 1'),
        peutModifier() ? h('button', { class: 'discret icone-seule petit', title: 'Modifier ce texte et le seuil d’alerte', onclick: reglerEntete }, ic('crayon', 15)) : null),
      h('p', { class: 'description-mn1' }, e?.description || ''),
      v ? h('div', { class: 'chiffres-mn1' },
        chiffre(nombreFr(parcs.length), parcs.length > 1 ? 'parcs' : 'parc'),
        chiffre(nombreFr(fiches), fiches > 1 ? 'fiches' : 'fiche'),
        chiffre(nombreFr(parcs.reduce((s, p) => s + (p.charge?.actives || 0), 0)), 'FI actives', 'FI de niveau 1 actives dans la GMAO'),
        chiffre(analyses.length ? `${Math.round((analyses.reduce((s, p) => s + p.pertinence.taux, 0) / analyses.length) * 100)} %` : '—', 'pertinence moyenne', 'Part du Pareto des pannes couverte par les fiches, en moyenne sur les parcs analysés'),
        chiffre(nombreFr(parcs.reduce((s, p) => s + p.pareto.cas, 0)), 'pannes qui reviennent', 'Cas des 12 derniers mois dans les Pareto des parcs'),
        chiffre(nombreFr(parcs.filter((p) => p.alertes.length).length), 'parcs en alerte')) : null,
      idee))
}

// ---------------------------------------------------------------- vignettes

async function afficherVignettes(zone, bandeau) {
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture des FI dans la GMAO'))
  const relire = Date.now() - derniereLecture > 60_000
  const v = await api(`/api/mn1/vignettes${relire ? '?relire=1' : ''}`)
  if (relire) derniereLecture = Date.now()
  dessinerBandeau(bandeau, v)
  const admin = peutModifier()
  if (v.sansArborescence) return vider(zone, h('div', { class: 'carte vide' }, ic('reseau', 28), h('p', {}, 'L’arborescence de la GMAO est illisible : il faut la connexion à la GMAO et la requête d’arborescence (réglée dans PDRTEC).')))
  if (!v.parcs.length) {
    return vider(zone, h('div', { class: 'carte vide' }, ic('usine', 28),
      h('p', {}, 'Pas encore de parc : rangez les racines de l’arborescence en parcs dans Administration › Parcs machines.'),
      admin ? h('a', { class: 'bouton principal', href: '#/administration/parcs' }, 'Ranger les parcs') : null))
  }
  const choisi = parcChoisi()
  let parcs = choisi ? v.parcs.filter((p) => p.id === choisi) : v.parcs
  const alertes = (p) => p.alertes.reduce((s, a) => s + ({ rouge: 3, orange: 2, gris: 1 }[a.niveau] || 0), 0)
  const ordres = {
    nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'),
    charge: (a, b) => (b.charge?.taux ?? -1) - (a.charge?.taux ?? -1),
    pertinence: (a, b) => (a.pertinence?.taux ?? 2) - (b.pertinence?.taux ?? 2),
    alertes: (a, b) => alertes(b) - alertes(a) || a.nom.localeCompare(b.nom, 'fr'),
    // Les parcs dont les correctifs montent le plus d'abord, ceux qui baissent le plus à la fin.
    tendance: (a, b) => ecartTendance(b.tendance.map((x) => x.n)) - ecartTendance(a.tendance.map((x) => x.n)),
  }
  parcs = [...parcs].sort(ordres[tri])
  const grille = h('div', { class: 'vignettes-mn1' }, parcs.map((p, i) => vignette(p, i, v.seuil)))
  vider(zone,
    h('div', { class: 'barre-vignettes' },
      h('span', { class: 'discret' }, 'Trier par'),
      h('div', { class: 'segments petits' }, [['nom', 'Nom'], ['charge', 'Charge'], ['pertinence', 'Pertinence'], ['alertes', 'Alertes'], ['tendance', 'Tendance']].map(([cle, texte]) =>
        h('button', { class: tri === cle ? 'choisi' : '', title: cle === 'tendance' ? 'Les correctifs qui montent le plus d’abord (3 derniers mois par rapport à la moyenne des 12)' : '', onclick: () => { tri = cle; afficherVignettes(zone, bandeau) } }, texte))),
      h('div', { class: 'espace' }),
      v.lecture?.erreur ? h('span', { class: 'etiquette orange', title: v.lecture.erreur }, ic('alerte', 13), 'FI de la GMAO non lues') : v.lecture?.date ? h('span', { class: 'discret petit-texte' }, `FI lues dans la GMAO à ${new Date(v.lecture.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`) : null,
      admin && v.sansParc ? h('button', { class: 'petit', onclick: rangerSansParc }, ic('alerte', 14), `${v.sansParc} fiche${v.sansParc > 1 ? 's' : ''} sans parc`) : null,
      admin ? boutonImport() : null),
    grille)
  animer(zone)
}

function vignette(p, rang, seuil) {
  const ouvrir = () => (location.hash = `#/mn1/parc/${encodeURIComponent(p.id)}`)
  const pire = p.alertes.find((a) => a.niveau === 'rouge') ? 'rouge' : p.alertes.find((a) => a.niveau === 'orange') ? 'orange' : ''
  return h('div', { class: `vignette-mn1 ${pire}`, role: 'button', tabindex: '0', style: { '--i': rang }, title: `Ouvrir la fiche MN1 du parc ${p.nom}`, onclick: ouvrir, onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), ouvrir()) },
    h('div', { class: 'tete-vignette' }, h('h2', {}, p.nom), h('span', { class: 'discret' }, `${nombreFr(p.fiches)} fiche${p.fiches > 1 ? 's' : ''} · ${nombreFr(p.charge?.actives ?? 0)} FI`)),
    h('div', { class: 'jauges-vignette' },
      h('div', { class: 'jauge-vignette', title: p.erreurCharge || (p.charge ? `Charge la plus haute d’un ETH : ${Math.round(p.charge.taux * 100)} % du maximum (${p.charge.max} fiches par semaine et par ETH)` : '') }, jauge(p.charge ? p.charge.taux : null, { inverse: true, libelle: 'charge' })),
      h('div', { class: 'jauge-vignette', title: p.pertinence ? `Part du Pareto des pannes visée par les fiches (analyse du ${dateFr(p.pertinence.date)})` : 'Pas encore d’analyse de corrélation' }, jauge(p.pertinence ? p.pertinence.taux : null, { seuil, libelle: p.pertinence ? 'pertinence' : 'non analysé' }))),
    h('div', { class: 'tendance-vignette', title: `Correctifs du parc, mois par mois : ${p.tendance.map((x) => x.n).join(', ')}` }, courbe(p.tendance.map((x) => x.n)), h('small', { class: 'discret' }, 'correctifs, 12 derniers mois')),
    h('div', { class: 'alertes-vignette' },
      p.alertes.map((a) => h('span', { class: `etiquette ${a.niveau === 'rouge' ? 'rouge' : a.niveau === 'orange' ? 'orange' : ''}` }, a.texte)),
      p.aAnalyser ? h('span', { class: 'etiquette' }, `${p.aAnalyser} à analyser`) : null,
      !p.alertes.length && !p.aAnalyser ? h('span', { class: 'discret petit-texte' }, p.pareto.nombre ? `${p.pareto.nombre} pannes au Pareto` : 'pas de panne qui revient') : null))
}

// Les fiches importées qu'AITEC n'a rangées dans aucun parc (administrateur).
async function rangerSansParc() {
  const [fiches, parcs] = await Promise.all([api('/api/mn1/fiches'), api('/api/parcs')])
  const v = await api('/api/mn1/vignettes')
  const dansUnParc = new Set()
  for (const p of v.parcs) dansUnParc.add(p.id)
  const choix = new Map()
  const sans = fiches.filter((f) => !f.archivee && (!f.parc || !dansUnParc.has(f.parc)))
  const lignes = sans.map((f) => {
    const select = h('select', { class: 'fin' }, h('option', { value: '' }, '— parc —'), parcs.filter((p) => !p.nonClasse).map((p) => h('option', { value: p.id }, p.nom)))
    choix.set(f.id, select)
    return h('tr', {}, h('td', {}, f.ligne || ''), h('td', {}, f.eth || ''), h('td', {}, [f.machine_nom || f.repere, f.etiquette, f.zone].filter(Boolean).join(' · ')), h('td', {}, select))
  })
  const ok = await fenetre({
    titre: 'Fiches sans parc',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'AITEC range les fiches d’après leur ligne ou leur machine ; celles-ci ne correspondent à aucun parc. Choisissez le leur.'),
      h('div', { class: 'tableau-conteneur', style: { maxHeight: '55vh' } }, h('table', { class: 'tableau' }, h('thead', {}, h('tr', {}, h('th', {}, 'Ligne'), h('th', {}, 'ETH'), h('th', {}, 'Fiche'), h('th', {}, 'Parc'))), h('tbody', {}, lignes)))),
    boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Ranger', classe: 'principal', valeur: true }],
  })
  if (!ok) return
  let n = 0
  for (const [id, select] of choix) {
    if (!select.value) continue
    if (await essayer(() => api(`/api/mn1/fiches/${id}/ranger`, { methode: 'POST', corps: { parc: select.value } }))) n++
  }
  notifier(`${n} fiche${n > 1 ? 's' : ''} rangée${n > 1 ? 's' : ''}`)
  window.ktec.recharger()
}

// ---------------------------------------------------------------- ancien mode

async function afficherAncien(zone) {
  const contenu = h('div')
  vider(zone,
    h('div', { class: 'bandeau', style: { marginBottom: '14px' } }, ic('historique'), h('span', { style: { flex: 1 } }, 'Ancien mode : fiches par ligne, une FI par machine, charge par secteur. Il sera retiré quand le mode par parcs aura fait ses preuves.'),
      peutModifier() ? h('button', { class: 'petit', onclick: reglerParametres }, ic('reglages', 14), 'Fiches par fréquence') : null,
      peutModifier() ? h('button', { class: 'petit', onclick: reglerCreationGmao }, ic('base', 14), 'Création (ancien)') : null),
    contenu)
  await afficherFiches(contenu)
}

// ---------------------------------------------------------------- demandes de niveau 1

async function afficherDemandes(zone) {
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture des demandes dans la base de la GMAO'))
  const d = await api(avecParc('/api/mn1/demandes')).catch((e) => ({ erreur: e.message }))
  if (d.erreur) return vider(zone, h('div', { class: 'carte vide' }, ic('alerte', 28), h('p', {}, d.erreur)))
  if (!d.reglee) {
    return vider(zone, h('div', { class: 'carte vide' }, ic('base', 28),
      h('p', {}, 'Pas encore de requête des demandes d’intervention : réglez-la dans Administration › Données de la GMAO › « Les requêtes » (colonnes numero, date, machine, type, description, demandeur, etat, arret).')))
  }
  const t = d.tuiles
  const ecart = t.mois - t.moisAvant
  vider(zone,
    h('div', { class: 'barre-demandes' },
      h('span', { class: 'discret' }, 'Type de demande'),
      menuDeroulant({ choix: d.types.map((x) => ({ valeur: x.nom, libelle: x.nom, nombre: x.nombre })), valeur: d.type, surChoix: async (type) => { if (await essayer(() => api('/api/mn1/type', { methode: 'POST', corps: { type } }))) window.ktec.recharger() } }),
      parcChoisi() ? h('span', { class: 'discret' }, 'parc choisi en haut d’AITEC') : null),
    h('div', { class: 'grille grille-4', style: { marginBottom: '16px' } },
      tuile('document', 'violet', `Demandes ${d.type} (12 mois)`, t.annee, null),
      tuile('horloge', '', 'Encore ouvertes', t.ouvertes, null),
      tuile('alerte', 'violet', 'Ouvertes, machine à l’arrêt', t.arret, null),
      tuile('graphique', 'bleu', 'Ces 30 jours', t.mois, ecart ? h('span', { class: `ecart ${ecart > 0 ? 'hausse' : 'baisse'}`, title: 'Par rapport aux 30 jours précédents' }, `${ecart > 0 ? '+' : ''}${ecart}`) : null)),
    h('div', { class: 'grille grille-3' },
      h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('graphique', 'Demandes par mois', '12 derniers mois'), graphiqueMois(d.parMois)),
      h('div', { class: 'carte' }, entete('personne', 'Demandeurs', '12 mois'), d.demandeurs.length ? barresHorizontales(d.demandeurs.map((x) => ({ etiquette: x.nom, valeur: x.nombre })), { couleur: COULEURS.bleu }) : h('div', { class: 'vide' }, 'Personne.')),
      h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('alerte', 'Machines les plus demandées', '12 mois · cliquer pour l’analyse'), machinesDemandees(d.machines)),
      h('div', { class: 'carte' }, entete('reseau', 'Par ETH', '12 mois'), d.eth.length ? barresHorizontales(d.eth.map((x) => ({ etiquette: x.nom, valeur: x.nombre })), { couleur: COULEURS.turquoise }) : h('div', { class: 'vide' }, 'ETH inconnus (arborescence).')),
      d.sansFiche.length ? h('div', { class: 'carte pleine sans-fiche-mn1' }, entete('coche', 'Sans fiche de niveau 1', 'machines souvent demandées'),
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Ces machines reviennent souvent dans les demandes de niveau 1 mais n’ont pas encore de fiche : leur analyse propose les gestes qui éviteraient ces demandes.'),
        h('div', { class: 'liste-sans-fiche' }, d.sansFiche.map((m) => h('a', { class: 'bouton', href: `#/analyse/${m.id}` }, h('b', { class: 'mono' }, m.repere), ` · ${m.nombre} demandes`)))) : null,
      h('div', { class: 'carte pleine' }, entete('historique', 'Dernières demandes'), listeDemandes(d.dernieres)),
    ))
  animer(zone)
}

function tuile(icone, couleur, libelle, valeur, detail) {
  return h('div', { class: 'tuile' },
    h('div', { class: 'libelle' }, h('span', { class: `pastille ${couleur}` }, ic(icone, 16)), libelle),
    h('div', { class: 'valeur' }, nombreFr(valeur), detail))
}

function entete(icone, titre, detail) {
  return h('div', { class: 'carte-entete' }, h('h2', {}, ic(icone, 18), titre), detail ? h('span', { class: 'discret' }, detail) : null)
}

function graphiqueMois(parMois) {
  const series = [
    { cle: 'closes', nom: 'Closes', couleur: COULEURS.bleu },
    { cle: 'ouvertes', nom: 'Encore ouvertes', couleur: COULEURS.orange },
  ]
  return h('div', {},
    barres(parMois.map((x) => ({ etiquette: MOIS[Number(x.mois.slice(5)) - 1], valeurs: x })), series),
    h('div', { class: 'legende ligne', style: { marginTop: '8px' } }, series.map((s) => h('div', {}, h('span', { class: 'point', style: { color: s.couleur } }), s.nom))))
}

function machinesDemandees(machines) {
  if (!machines.length) return h('div', { class: 'vide' }, 'Aucune demande sur 12 mois.')
  const b = barresHorizontales(machines.map((m) => ({ etiquette: `${m.repere}${m.designation ? ` · ${m.designation}` : ''}${m.fiche ? '' : ' — sans fiche'}`, valeur: m.nombre })), { couleur: COULEURS.orange })
  ;[...b.children].forEach((ligne, i) => {
    if (!machines[i].id) return
    ligne.classList.add('barre-cliquable')
    ligne.addEventListener('click', () => (location.hash = `#/analyse/${machines[i].id}`))
  })
  return b
}

function listeDemandes(liste) {
  return tableau({
    lignes: liste,
    vide: 'Aucune demande.',
    surClic: (d) => d.machineId && (location.hash = `#/analyse/${d.machineId}`),
    colonnes: [
      { titre: 'Date', classe: 'col-date', valeur: (d) => h('span', { class: 'discret' }, dateFr(d.date)) },
      { titre: 'N°', valeur: (d) => h('span', { class: 'mono discret' }, d.numero) },
      { titre: 'Machine', valeur: (d) => h('b', { class: 'mono' }, d.machine) },
      { titre: 'ETH', valeur: (d) => h('span', { class: 'texte-2' }, d.eth || '') },
      { titre: 'Description', classe: 'col-description', valeur: (d) => h('span', { class: 'texte-2', title: d.description }, d.description) },
      { titre: 'Demandeur', classe: 'col-intervenants', valeur: (d) => d.demandeur || '—' },
      { titre: 'État', valeur: (d) => h('span', { class: `etiquette ${d.close ? '' : 'violet'}` }, d.etat || (d.close ? 'Close' : 'Ouverte'), d.arret && !d.close ? ' · arrêt' : '') },
    ],
  })
}
