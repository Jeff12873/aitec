// La maintenance de niveau 1 : les fiches gardées (par ligne, ETH et machine, à imprimer en A5) et le tableau de
// bord des demandes d'intervention de niveau 1.

import { h, vider, ic, dateFr, nombreFr, essayer, confirmer, fenetre, notifier, tableau } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier } from '/socle/etat.js'
import { barres, barresHorizontales, COULEURS } from '/socle/graphiques.js'
import { menuDeroulant } from '../../interface/menu-deroulant.js'
import { LOGO_MN1, FREQUENCES, carteFiche, carteCharge, definirParametres, lireParametres } from '../../interface/fiches-mn1.js'
import { animer } from '../tableau-de-bord/vue.js'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const filtres = { texte: '', frequence: '' }
let lignesDemandes = ''

export default {
  chemin: 'mn1',
  titre: 'Maintenance de niveau 1',
  icone: 'coche',
  menu: true,
  aide: 'tableau-de-bord',

  async afficher(zone, { id }) {
    const onglet = id === 'demandes' ? 'demandes' : 'fiches'
    definirParametres(await api('/api/mn1/parametres').catch(() => null))
    const contenu = h('div')
    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('img', { class: 'logo-page-mn1', src: LOGO_MN1, alt: '' }),
        h('div', { style: { flex: 1 } }, h('h1', {}, 'Maintenance de niveau 1'), h('p', { class: 'sous-titre' }, 'Les gestes simples que les opérateurs font pour éviter les pannes, et les demandes d’intervention de niveau 1')),
        peutModifier() ? h('button', { class: 'discret icone-seule', title: 'Paramètres : fiches tirées par semaine, fiches par fréquence', onclick: reglerParametres }, ic('reglages', 18)) : null),
      h('div', { class: 'segments', style: { marginBottom: '18px' } },
        h('button', { class: onglet === 'fiches' ? 'choisi' : '', onclick: () => (location.hash = '#/mn1') }, ic('document', 16), 'Fiches'),
        h('button', { class: onglet === 'demandes' ? 'choisi' : '', onclick: () => (location.hash = '#/mn1/demandes') }, ic('graphique', 16), 'Demandes de niveau 1')),
      contenu,
    )
    if (onglet === 'demandes') await afficherDemandes(contenu)
    else await afficherFiches(contenu)
  },
}

// ---------------------------------------------------------------- fiches

async function afficherFiches(zone) {
  const fiches = await api('/api/mn1/fiches')
  if (!fiches.length) {
    return vider(zone, h('div', { class: 'carte vide' }, h('img', { src: LOGO_MN1, alt: '', style: { width: '56px', opacity: 0.8 } }),
      h('p', {}, 'Pas encore de fiche. Elles se gardent depuis la fiche d’analyse d’une machine : Tableau de bord › « Machines les plus en panne », puis « Analyser » et « Garder dans les fiches MN1 ».')))
  }
  const recherche = h('input', { type: 'search', placeholder: 'Filtrer : geste, machine, ETH…', value: filtres.texte })
  const liste = h('div')
  const pastilles = (cle, valeurs) => h('div', { class: 'pastilles-filtre' },
    ['', ...valeurs].map((v) => h('button', { class: `pastille-ligne${filtres[cle] === v ? ' choisie' : ''}`, onclick: () => { filtres[cle] = v; dessiner() } }, v || 'Toutes')))
  const zoneFiltres = h('div', { class: 'filtres-mn1' })

  function dessiner() {
    vider(zoneFiltres, recherche, pastilles('frequence', FREQUENCES.filter((f) => fiches.some((x) => x.frequence === f))))
    const mots = filtres.texte.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const visibles = fiches.filter((f) => (!filtres.frequence || f.frequence === filtres.frequence)
      && mots.every((m) => [f.action, f.evite, f.repere, f.designation, f.eth, f.ligne].join(' ').toLowerCase().includes(m)))
    // Ligne › ETH › machine
    const groupes = new Map()
    for (const f of visibles) {
      const cle = [f.ligne || 'Sans ligne', f.eth || ''].join(' › ').replace(/ › $/, '')
      ;(groupes.get(cle) || groupes.set(cle, []).get(cle)).push(f)
    }
    vider(liste, visibles.length ? [...groupes].map(([titre, groupe]) => h('section', { class: 'groupe-fiches-mn1' },
      h('h2', {}, titre, h('span', { class: 'discret' }, ` · ${groupe.length} fiche${groupe.length > 1 ? 's' : ''}`)),
      h('div', { class: 'fiches-mn1' }, groupe.map((f) => carteFiche(f, { enPlus: actionsFiche(f) }))))) : h('p', { class: 'discret' }, 'Aucune fiche ne correspond aux filtres.'))
  }
  recherche.addEventListener('input', () => { filtres.texte = recherche.value; dessiner() })
  vider(zone, carteCharge(fiches), zoneFiltres, liste)
  dessiner()
}

function actionsFiche(f) {
  return h('div', { class: 'actions-fiche-mn1' },
    h('a', { href: `#/analyse/${f.machine_id}`, class: 'discret petit' }, ic('graphique', 13), 'Analyse'),
    peutModifier() ? h('button', { class: 'discret petit icone-seule', title: 'Corriger la fiche', onclick: () => corrigerFiche(f) }, ic('crayon', 14)) : null,
    peutModifier() ? h('button', { class: 'discret petit icone-seule', title: 'Supprimer la fiche', onclick: async () => {
      if (await confirmer('Supprimer cette fiche de niveau 1 ?', { danger: true, texte: 'Supprimer' }) && await essayer(() => api(`/api/mn1/fiches/${f.id}`, { methode: 'DELETE' }))) window.ktec.recharger()
    } }, ic('poubelle', 14)) : null)
}

async function corrigerFiche(f) {
  const action = h('textarea', { rows: 3 }, f.action)
  const frequence = h('select', {}, h('option', { value: '' }, 'À préciser'), FREQUENCES.map((x) => h('option', { value: x, selected: x === f.frequence }, x)))
  const evite = h('input', { type: 'text', value: f.evite })
  const ok = await fenetre({
    titre: `Fiche de niveau 1 — ${f.repere}`,
    contenu: h('div', { class: 'grille', style: { gap: '10px' } },
      h('label', { class: 'champ' }, h('span', {}, 'Geste à réaliser'), action),
      h('label', { class: 'champ' }, h('span', {}, 'Fréquence préconisée'), frequence),
      h('label', { class: 'champ' }, h('span', {}, 'Panne évitée'), evite)),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { await api(`/api/mn1/fiches/${f.id}`, { methode: 'POST', corps: { action: action.value, frequence: frequence.value, evite: evite.value } }); return true } },
    ],
  })
  if (ok) {
    notifier('Fiche enregistrée')
    window.ktec.recharger()
  }
}

// Le rouage : combien de fiches les opérateurs tirent par semaine, et combien de fiches imprimer par fréquence.
async function reglerParametres() {
  const p = await essayer(() => api('/api/mn1/parametres'))
  if (!p) return
  const nombre = (valeur) => h('input', { type: 'number', min: 1, max: 31, value: valeur, style: { width: '90px' } })
  const parSemaine = h('input', { type: 'number', min: 1, max: 50, value: p.parSemaine, style: { width: '90px' } })
  const champs = Object.fromEntries(Object.keys(p.fiches).map((f) => [f, nombre(p.fiches[f])]))
  const periode = { Hebdomadaire: 'par mois (une par semaine)', Mensuelle: 'par mois', Trimestrielle: 'par trimestre', Semestrielle: 'par semestre', Annuelle: 'par an' }
  const ok = await fenetre({
    titre: 'Paramètres de la maintenance de niveau 1',
    contenu: h('div', { class: 'parametres-mn1' },
      h('label', { class: 'ligne-parametre' }, h('span', {}, 'Fiches tirées par les opérateurs, par semaine'), parSemaine),
      h('h3', {}, 'Fiches à imprimer selon la fréquence préconisée'),
      Object.entries(champs).map(([f, champ]) => h('label', { class: 'ligne-parametre' }, h('span', {}, `${f} `, h('small', { class: 'discret' }, periode[f] || '')), champ)),
      h('p', { class: 'discret', style: { fontSize: '13px', marginBottom: 0 } }, 'Quotidienne : trop fréquent pour une fiche ; la fiche renvoie vers le responsable de production ou un focus maintenance.')),
    boutons: [
      { texte: 'Revenir aux valeurs d’origine', classe: 'discret', action: () => { parSemaine.value = p.origine.parSemaine; for (const [f, c] of Object.entries(champs)) c.value = p.origine.fiches[f]; return false } },
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { definirParametres(await api('/api/mn1/parametres', { methode: 'POST', corps: { parSemaine: parSemaine.value, fiches: Object.fromEntries(Object.entries(champs).map(([f, c]) => [f, c.value])) } })); return true } },
    ],
  })
  if (ok) {
    notifier('Paramètres enregistrés')
    window.ktec.recharger()
  }
}

// ---------------------------------------------------------------- demandes de niveau 1

async function afficherDemandes(zone) {
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture des demandes dans la base de la GMAO'))
  const d = await api(`/api/mn1/demandes${lignesDemandes ? `?lignes=${encodeURIComponent(lignesDemandes)}` : ''}`).catch((e) => ({ erreur: e.message }))
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
      d.lignes.length ? [h('span', { class: 'discret' }, 'Ligne'), menuDeroulant({ choix: [{ valeur: '', libelle: 'Toutes' }, ...d.lignes.map((l) => ({ valeur: l.id, libelle: l.libelle }))], valeur: lignesDemandes, surChoix: (v) => { lignesDemandes = v; window.ktec.recharger() } })] : null),
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
