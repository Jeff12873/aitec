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
import { boutonImport } from '../../interface/mn1-import.js'
import { reglerGmao, reglerEntete } from '../../interface/mn1-reglages.js'
import { jauge, courbe, ecartTendance } from '../../interface/mn1-graphiques.js'
import { avecParc, parcChoisi, choisirParc } from '../../interface/parcs.js'
import { animer } from '../../interface/animer.js'
import { indicateursBandeau, pastillesSuivi, afficherFiIssues, afficherRi } from '../../interface/mn1-circuit.js'
import { estPrevtec, filEtapes, pastilleVerdict } from '../../interface/prevtec.js'
import { afficherDecider } from '../../interface/prevtec-decider.js'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
let tri = 'nom'
let triChoisi = false // PREVTEC trie par verdict tant qu'on n'a pas choisi
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
  parcs: true, // le choix du parc sous le titre
  titre: 'Maintenance de niveau 1',
  icone: 'coche',
  menu: true,
  aide: 'maintenance-niveau-1',

  async afficher(zone, { id, query }) {
    const [onglet, parc, machine, equipement] = String(id || '').split('/')
    if (onglet === 'decider' && parc && machine) return afficherDecider(zone, decodeURIComponent(parc), machine, { equipement, pose: query?.pose, titre: query?.titre })
    // Anciennes adresses : le niveau 1 a son menu dans PREVTEC.
    if (estPrevtec && onglet === 'n1') return location.replace(`#/niveau1/${parc || ''}`)
    if (estPrevtec && ['circuit', 'demandes', 'ri'].includes(onglet)) return location.replace('#/niveau1')
    if (onglet === 'parc' && parc) return afficherParc(zone, decodeURIComponent(parc), { machine: query?.machine })
    if (onglet === 'machine' && parc && machine) return location.replace(`#/mn1/parc/${parc}?machine=${machine}`) // ancienne adresse
    // PREVTEC, étape 1 : seulement le fil des étapes et les vignettes des lignes.
    if (estPrevtec && !onglet) {
      const vignettes = h('div')
      vider(zone, filEtapes(1), vignettes)
      return afficherVignettes(vignettes, null)
    }
    return afficherCircuit(zone, onglet)
  },
}

// Le menu « Maintenance de niveau 1 » de PREVTEC : le choix de la ligne, puis son niveau 1 (fiches, demandes, FI, RI).
export const niveau1 = {
  chemin: 'niveau1',
  titre: 'Maintenance de niveau 1',
  icone: 'coche',
  menu: true,
  aide: 'maintenance-niveau-1',

  async afficher(zone, { id }) {
    const [parc, onglet = ''] = String(id || '').split('/')
    definirParametres(await api('/api/mn1/parametres').catch(() => null))
    if (!parc || ['circuit', 'demandes', 'ri'].includes(parc)) { // (anciennes adresses : le circuit de l'usine)
      choisirParc('')
      const vignettes = h('div')
      vider(zone, h('div', { class: 'tete-niveau1' }, h('img', { class: 'logo-page-mn1', src: LOGO_MN1, alt: '' }), h('h1', {}, 'Maintenance de niveau 1')), vignettes)
      return afficherVignettes(vignettes, null, { n1: true })
    }
    choisirParc(decodeURIComponent(parc))
    return afficherParc(zone, decodeURIComponent(parc), { vue: 'n1', onglet, circuit: circuitDeLaLigne })
  },
}
// Hors du niveau 1 d'une ligne, plus de ligne choisie.
if (estPrevtec) window.addEventListener('hashchange', () => { if (!/^#\/niveau1\/[^/]/.test(location.hash)) choisirParc('') })

// Un onglet du circuit de niveau 1 d'une ligne : ses indicateurs, puis ses demandes, ses FI ou ses RI.
async function circuitDeLaLigne(zone, onglet) {
  const indicateurs = h('div', { class: 'zone-indicateurs-mn1' })
  const contenu = h('div')
  vider(zone, indicateurs, contenu)
  indicateursBandeau(indicateurs, h('div')) // les contributeurs sont déjà dans « Ma ligne »
  if (onglet === 'demandes') return afficherDemandes(contenu)
  if (onglet === 'ri') return afficherRi(contenu)
  return afficherFiIssues(contenu)
}

// Le circuit de niveau 1 : DI → FI → RI, ses indicateurs et le bandeau.
async function afficherCircuit(zone, onglet) {
    definirParametres(await api('/api/mn1/parametres').catch(() => null))
    const contenu = h('div')
    const admin = peutModifier()
    const bandeau = h('div', { class: 'bandeau-mn1' })
    // Sous le bandeau : le choix de la zone (posé par le menu), le Hall of fame dans son encart, puis les onglets centrés.
    const zoneHof = h('div', { class: 'zone-hof-mn1' })
    bandeau.zoneHof = zoneHof
    vider(
      zone,
      bandeau,
      zoneHof,
      h('div', { class: 'barre-onglets-mn1' },
        h('div'),
        h('div', { class: 'segments' },
          // Le circuit, dans l'ordre : la demande, la fiche d'intervention, le rapport d'intervention.
          h('button', { class: onglet === 'demandes' ? 'choisi' : '', onclick: () => (location.hash = '#/mn1/demandes') }, ic('graphique', 16), 'Demandes d’intervention N1'),
          h('button', { class: !['demandes', 'ri'].includes(onglet) ? 'choisi' : '', onclick: () => (location.hash = '#/mn1') }, ic('usine', 16), 'Fiches d’intervention N1'),
          h('button', { class: onglet === 'ri' ? 'choisi' : '', onclick: () => (location.hash = '#/mn1/ri') }, ic('coche', 16), 'Rapports d’intervention N1')),
        h('div', { class: 'actions-onglets-mn1' },
          admin ? h('button', { class: 'discret icone-seule', title: 'Réglages de la GMAO : paramètres des FI, périodicités, SQL du site', onclick: reglerGmao }, ic('base', 18)) : null)),
      contenu,
    )
    if (onglet === 'demandes') {
      dessinerBandeau(bandeau, null)
      return afficherDemandes(contenu)
    }
    if (onglet === 'ri') {
      dessinerBandeau(bandeau, null)
      return afficherRi(contenu)
    }
    // Fiches d'intervention N1 : d'abord les FI issues de DI (arborescences à compléter), puis les fiches focus.
    const zoneFi = h('div')
    const zoneFocus = h('div')
    vider(contenu, zoneFi, zoneFocus)
    afficherFiIssues(zoneFi)
    await afficherVignettes(zoneFocus, bandeau)
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
  // Les indicateurs du circuit DI → FI → RI et le Hall of fame, lus à part (ils n'attendent pas le reste).
  const zoneIndicateurs = h('div', { class: 'zone-indicateurs-mn1' })
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
        chiffre(analyses.length ? `${Math.round((analyses.reduce((s, p) => s + p.pertinence.taux, 0) / analyses.length) * 100)} %` : '—', 'pertinence moyenne', 'Part du Pareto des pannes couverte par les fiches, en moyenne sur les lignes analysées'),
        chiffre(nombreFr(parcs.reduce((s, p) => s + p.pareto.cas, 0)), 'pannes qui reviennent', 'Cas des 12 derniers mois dans les Pareto des lignes'),
        chiffre(nombreFr(parcs.filter((p) => p.alertes.length).length), 'lignes en alerte')) : null,
      idee),
    zoneIndicateurs)
  indicateursBandeau(zoneIndicateurs, bandeau.zoneHof)
}

// ---------------------------------------------------------------- vignettes

async function afficherVignettes(zone, bandeau, { n1 = false } = {}) {
  const ligneSeule = estPrevtec && !n1 // l'étape 1 du parcours : rien du niveau 1
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture des FI dans la GMAO'))
  const relire = Date.now() - derniereLecture > 60_000
  const v = await api(`/api/mn1/vignettes${relire ? '?relire=1' : ''}`)
  if (relire) derniereLecture = Date.now()
  if (bandeau) dessinerBandeau(bandeau, v)
  const admin = peutModifier()
  if (v.sansArborescence) return vider(zone, h('div', { class: 'carte vide' }, ic('reseau', 28), h('p', {}, 'L’arborescence de la GMAO est illisible : il faut la connexion à la GMAO et la requête d’arborescence (réglée dans PDRTEC).')))
  if (!v.parcs.length) {
    return vider(zone, h('div', { class: 'carte vide' }, ic('usine', 28),
      h('p', {}, 'Pas encore de ligne : rangez les racines de l’arborescence en lignes dans Administration › Lignes.'),
      admin ? h('a', { class: 'bouton principal', href: '#/administration/parcs' }, 'Ranger les lignes') : null))
  }
  // Un parc choisi en haut d'AITEC : sa page directement, avec le bandeau de synthèse (plus de vignette seule).
  const choisi = parcChoisi()
  if (choisi && v.parcs.some((p) => p.id === choisi)) return afficherParc(zone, choisi, { integre: true })
  let parcs = v.parcs
  const alertes = (p) => p.alertes.reduce((s, a) => s + ({ rouge: 3, orange: 2, gris: 1 }[a.niveau] || 0), 0)
  const ordres = {
    nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'),
    charge: (a, b) => (b.charge?.taux ?? -1) - (a.charge?.taux ?? -1),
    pertinence: (a, b) => (a.pertinence?.taux ?? 2) - (b.pertinence?.taux ?? 2),
    alertes: (a, b) => alertes(b) - alertes(a) || a.nom.localeCompare(b.nom, 'fr'),
    // Les parcs dont les correctifs montent le plus d'abord, ceux qui baissent le plus à la fin.
    tendance: (a, b) => ecartTendance(b.tendance.map((x) => x.n)) - ecartTendance(a.tendance.map((x) => x.n)),
    // Les plans à réévaluer d'abord.
    verdict: (a, b) => ({ reevaluer: 0, surveiller: 1, bon: 2 }[a.plan?.verdict] ?? 3) - ({ reevaluer: 0, surveiller: 1, bon: 2 }[b.plan?.verdict] ?? 3) || a.nom.localeCompare(b.nom, 'fr'),
  }
  if (ligneSeule && !triChoisi) tri = 'verdict'
  if (n1 && tri === 'verdict') tri = 'nom'
  parcs = [...parcs].sort(ordres[tri])
  const grille = h('div', { class: 'vignettes-mn1' }, parcs.map((p, i) => vignette(p, i, v.seuil, n1)))
  vider(zone,
    h('div', { class: 'barre-vignettes' },
      h('span', { class: 'discret' }, 'Trier par'),
      h('div', { class: 'segments petits' }, (ligneSeule ? [['verdict', 'Verdict'], ['nom', 'Nom'], ['tendance', 'Tendance']] : [['nom', 'Nom'], ['charge', 'Charge'], ['pertinence', 'Pertinence'], ['alertes', 'Alertes'], ['tendance', 'Tendance']]).map(([cle, texte]) =>
        h('button', { class: tri === cle ? 'choisi' : '', title: cle === 'tendance' ? 'Les correctifs qui montent le plus d’abord (3 derniers mois par rapport à la moyenne des 12)' : cle === 'verdict' ? 'Les plans à réévaluer d’abord' : '', onclick: () => { tri = cle; triChoisi = true; afficherVignettes(zone, bandeau, { n1 }) } }, texte))),
      h('div', { class: 'espace' }),
      // Le niveau 1 (lecture des FI, fiches sans ligne, import) : pas à l'étape 1 de PREVTEC.
      ligneSeule ? null : v.lecture?.erreur ? h('span', { class: 'etiquette orange', title: v.lecture.erreur }, ic('alerte', 13), 'FI de la GMAO non lues') : v.lecture?.date ? h('span', { class: 'discret petit-texte' }, `FI lues dans la GMAO à ${new Date(v.lecture.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`) : null,
      admin && !ligneSeule && v.sansParc ? h('button', { class: 'petit', onclick: rangerSansParc }, ic('alerte', 14), `${v.sansParc} fiche${v.sansParc > 1 ? 's' : ''} sans ligne`) : null,
      admin && !ligneSeule ? boutonImport() : null),
    grille)
  animer(zone)
}

function vignette(p, rang, seuil, n1 = false) {
  const ouvrir = () => (location.hash = n1 ? `#/niveau1/${encodeURIComponent(p.id)}` : `#/mn1/parc/${encodeURIComponent(p.id)}`)
  // PREVTEC : la vignette ne parle que de la ligne (verdict, pannes, visites, courbe), rien du niveau 1.
  if (estPrevtec && !n1) return vignetteLigne(p, rang, ouvrir)
  const pire = p.alertes.find((a) => a.niveau === 'rouge') ? 'rouge' : p.alertes.find((a) => a.niveau === 'orange') ? 'orange' : ''
  return h('div', { class: `vignette-mn1 ${pire}`, role: 'button', tabindex: '0', style: { '--i': rang }, title: `Ouvrir la fiche MN1 de la ligne ${p.nom}`, onclick: ouvrir, onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), ouvrir()) },
    h('div', { class: 'tete-vignette' }, h('h2', {}, p.nom), h('span', { class: 'discret' }, `${nombreFr(p.fiches)} fiche${p.fiches > 1 ? 's' : ''} · ${nombreFr(p.charge?.actives ?? 0)} FI`)),
    h('div', { class: 'jauges-vignette' },
      h('div', { class: 'jauge-vignette', title: p.erreurCharge || (p.charge ? `Charge la plus haute d’un ETH : ${Math.round(p.charge.taux * 100)} % du maximum (${p.charge.max} fiches par semaine et par ETH)` : '') }, jauge(p.charge ? p.charge.taux : null, { inverse: true, libelle: 'charge' })),
      h('div', { class: 'jauge-vignette', title: p.pertinence ? `Part du Pareto des pannes visée par les fiches (analyse du ${dateFr(p.pertinence.date)})` : 'Pas encore d’analyse de corrélation' }, jauge(p.pertinence ? p.pertinence.taux : null, { seuil, libelle: p.pertinence ? 'pertinence' : 'non analysé' }))),
    h('div', { class: 'tendance-vignette', title: `Correctifs de la ligne, mois par mois : ${p.tendance.map((x) => x.n).join(', ')}` }, courbe(p.tendance.map((x) => x.n)), h('small', { class: 'discret' }, 'correctifs, 12 derniers mois')),
    h('div', { class: 'alertes-vignette' },
      p.alertes.map((a) => h('span', { class: `etiquette ${a.niveau === 'rouge' ? 'rouge' : a.niveau === 'orange' ? 'orange' : ''}` }, a.texte)),
      p.aAnalyser ? h('span', { class: 'etiquette' }, `${p.aAnalyser} à analyser`) : null,
      !p.alertes.length && !p.aAnalyser ? h('span', { class: 'discret petit-texte' }, p.pareto.nombre ? `${p.pareto.nombre} pannes au Pareto` : 'pas de panne qui revient') : null))
}

function vignetteLigne(p, rang, ouvrir) {
  const verdict = p.plan?.verdict === 'reevaluer' ? 'rouge' : p.plan?.verdict === 'surveiller' ? 'orange' : ''
  const c = p.indicateurs?.concentration
  return h('div', { class: `vignette-mn1 ${verdict}`, role: 'button', tabindex: '0', style: { '--i': rang }, title: `Ouvrir la ligne ${p.nom}`, onclick: ouvrir, onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), ouvrir()) },
    h('div', { class: 'tete-vignette' }, h('h2', {}, p.nom)),
    p.plan ? h('div', { class: 'plan-vignette' }, pastilleVerdict(p.plan),
      h('small', { class: 'discret', title: 'Pannes et visites du plan des 12 derniers mois terminés (entre parenthèses : les 12 mois d’avant)' }, `${nombreFr(p.plan.correctifs.recent)} pannes (${nombreFr(p.plan.correctifs.precedent)}) · ${nombreFr(p.plan.preventifs.recent)} visites (${nombreFr(p.plan.preventifs.precedent)})`)) : null,
    h('div', { class: 'tendance-vignette', title: `Correctifs de la ligne, mois par mois : ${p.tendance.map((x) => x.n).join(', ')}` }, courbe(p.tendance.map((x) => x.n)), h('small', { class: 'discret' }, 'correctifs, 12 mois terminés')),
    c?.machines?.length ? h('small', { class: 'discret concentration-vignette' }, `${c.machines.length} machines font ${Math.round((c.part || 0) * 100)} % des pannes`) : null)
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
    const select = h('select', { class: 'fin' }, h('option', { value: '' }, '— ligne —'), parcs.filter((p) => !p.nonClasse).map((p) => h('option', { value: p.id }, p.nom)))
    choix.set(f.id, select)
    return h('tr', {}, h('td', {}, f.ligne || ''), h('td', {}, f.eth || ''), h('td', {}, [f.machine_nom || f.repere, f.etiquette, f.zone].filter(Boolean).join(' · ')), h('td', {}, select))
  })
  const ok = await fenetre({
    titre: 'Fiches sans ligne',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'AITEC range les fiches d’après leur ligne ou leur machine ; celles-ci ne correspondent à aucune ligne. Choisissez la leur.'),
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
      parcChoisi() ? h('span', { class: 'discret' }, 'ligne choisie sous le titre') : null),
    h('div', { class: 'grille grille-4', style: { marginBottom: '16px' } },
      tuile('document', 'violet', `Demandes ${d.type} (12 mois)`, t.annee, null),
      tuile('horloge', '', 'Encore ouvertes', t.ouvertes, null),
      tuile('alerte', 'violet', 'Ouvertes, machine à l’arrêt', t.arret, null),
      tuile('graphique', 'bleu', 'Ces 30 jours', t.mois, ecart ? h('span', { class: `ecart ${ecart > 0 ? 'hausse' : 'baisse'}`, title: 'Par rapport aux 30 jours précédents' }, `${ecart > 0 ? '+' : ''}${ecart}`) : null)),
    h('div', { class: 'grille grille-3' },
      h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('graphique', 'Demandes par mois', '12 derniers mois'), graphiqueMois(d.parMois)),
      h('div', { class: 'carte' }, entete('personne', 'Demandeurs', '12 mois'), d.demandeurs.length ? barresHorizontales(d.demandeurs.map((x) => ({ etiquette: x.nom, valeur: x.nombre })), { couleur: COULEURS.bleu }) : h('div', { class: 'vide' }, 'Personne.')),
      h('div', { class: 'carte', style: { gridColumn: 'span 2' } }, entete('alerte', 'Machines les plus demandées', '12 mois'), machinesDemandees(d.machines)),
      h('div', { class: 'carte' }, entete('reseau', 'Par ETH', '12 mois'), d.eth.length ? barresHorizontales(d.eth.map((x) => ({ etiquette: x.nom, valeur: x.nombre })), { couleur: COULEURS.turquoise }) : h('div', { class: 'vide' }, 'ETH inconnus (arborescence).')),
      d.sansFiche.length ? h('div', { class: 'carte pleine sans-fiche-mn1' }, entete('coche', 'Sans fiche de niveau 1', 'machines souvent demandées'),
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Ces machines reviennent souvent dans les demandes de niveau 1 mais n’ont pas encore de fiche : leur analyse propose les gestes qui éviteraient ces demandes.'),
        // Un clic ouvre l'analyse de la machine de maintenance (reliée, ou au même code sans préfixe) ; sans elle, la
        // machine reste une simple étiquette.
        h('div', { class: 'liste-sans-fiche' }, d.sansFiche.map((m) => m.analyse
          ? h('a', { class: 'bouton', href: `#/analyse/${m.analyse}`, title: 'Ouvrir la fiche de la machine de maintenance' }, h('b', { class: 'mono' }, m.repere), ` · ${m.nombre} demandes`)
          : h('span', { class: 'etiquette', title: 'Aucune machine de maintenance reliée : Administration › Lignes › production ↔ maintenance' }, h('b', { class: 'mono' }, m.repere), ` · ${m.nombre} demandes`)))) : null,
      h('div', { class: 'carte pleine' }, entete('historique', 'Demandes de niveau 1', d.liste ? 'ouvertes, et 12 derniers mois' : ''), listeDemandes(d.liste || d.dernieres, d.suivi)),
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

// Les lignes ne mènent nulle part : la fiche de la machine (analyse) n'apporte rien depuis ce tableau de bord.
function machinesDemandees(machines) {
  if (!machines.length) return h('div', { class: 'vide' }, 'Aucune demande sur 12 mois.')
  return barresHorizontales(machines.map((m) => ({ etiquette: `${m.repere}${m.designation ? ` · ${m.designation}` : ''}${m.fiche ? '' : ' — sans fiche'}`, valeur: m.nombre })), { couleur: COULEURS.orange })
}

// La suite donnée à une demande : terminée (une RI), supprimée (FI archivée sans RI, ou DI close sans FI ni RI),
// prise en compte (une FI, pas encore de RI), non prise en compte (ouverte, sans FI).
const SUITES = [
  ['', 'Toutes', null],
  ['sans-fi', 'Non prises en compte', 'Créées, sans FI : l’appui technique ne les a pas encore transformées'],
  ['fi', 'Prises en compte', 'Une FI a été créée, pas encore de RI'],
  ['terminee', 'Terminées', 'FI et RI : la demande est traitée'],
  ['supprimee', 'Supprimées', 'FI archivée sans RI, ou demande close sans FI ni RI (doublon, erreur…)'],
]
function suiteDe(d) {
  if (d.ri) return 'terminee'
  if ((d.fi && d.fiActif === 2) || (d.close && !d.fi)) return 'supprimee'
  return d.fi ? 'fi' : 'sans-fi'
}

function listeDemandes(liste, suivi = false) {
  const table = (lignes) => tableau({
    lignes,
    vide: 'Aucune demande.',
    colonnes: [
      { titre: 'Date', classe: 'col-date', valeur: (d) => h('span', { class: 'discret' }, dateFr(d.date)) },
      { titre: 'N°', valeur: (d) => h('span', { class: 'mono discret' }, d.numero) },
      { titre: 'Machine', valeur: (d) => h('b', { class: 'mono' }, d.machine) },
      { titre: 'ETH', valeur: (d) => h('span', { class: 'texte-2' }, d.eth || '') },
      { titre: 'Description', classe: 'col-description', valeur: (d) => h('span', { class: 'texte-2', title: d.description }, d.description) },
      { titre: 'Demandeur', classe: 'col-intervenants', valeur: (d) => d.demandeur || '—' },
      { titre: 'État', valeur: (d) => h('span', { class: `etiquette ${d.close ? '' : 'violet'}` }, d.etat || (d.close ? 'Close' : 'Ouverte'), d.arret && !d.close ? ' · arrêt' : '') },
      // La suite donnée à la demande : sa FI et sa RI (requête des demandes, ou requêtes FI et RI de niveau 1).
      suivi ? { titre: 'FI · RI', valeur: (d) => pastillesSuivi(d) } : null,
    ].filter(Boolean),
  })
  if (!suivi) return table(liste)
  let choix = ''
  const boutons = h('div', { class: 'segments petits' })
  const zoneTable = h('div')
  const dessiner = () => {
    vider(boutons, SUITES.map(([cle, texte, aide]) => {
      const n = cle ? liste.filter((d) => suiteDe(d) === cle).length : liste.length
      return h('button', { class: choix === cle ? 'choisi' : '', title: aide || 'Toutes les demandes de la liste', onclick: () => { choix = cle; dessiner() } }, texte, h('span', { class: 'nombre-filtre' }, String(n)))
    }))
    vider(zoneTable, table(choix ? liste.filter((d) => suiteDe(d) === choix) : liste))
  }
  dessiner()
  return h('div', {}, h('div', { class: 'filtres-mn1' }, boutons), zoneTable)
}
