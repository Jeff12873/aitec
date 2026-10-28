// La fiche MN1 d'un parc (clic sur sa vignette) : la charge des opérateurs par ETH (FI réelles de la GMAO), la
// corrélation entre le Pareto des pannes et les fiches (analyse de l'IA, datée), les fiches du parc avec leur FI,
// leur avant / après et leurs alertes, et les demandes de niveau 1 du parc.

import { h, vider, ic, dateFr, essayer, confirmer, fenetre, notifier, ilYa } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier, etat } from '/socle/etat.js'
import { texteIA } from '/socle/texte-ia.js'
import { LOGO_MN1, FREQUENCES, carteFiche, imprimerFiches, nomMachine } from './fiches-mn1.js'
import { dialogueFi, dialogueSuspension, utilites } from './mn1-fi.js'
import { reglerParc } from './mn1-reglages.js'
import { jauge, courbe } from './mn1-graphiques.js'

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)} %`)
const arrondi = (n) => (n === null || n === undefined ? '?' : (Math.round(n * 100) / 100).toLocaleString('fr-FR'))

export async function afficherParc(zone, id) {
  vider(zone, h('p', { class: 'discret curseur' }, 'Lecture du parc et des FI de la GMAO'))
  const d = await api(`/api/mn1/parcs/${encodeURIComponent(id)}`)
  const admin = peutModifier()
  const u = utilites(d)
  const parCode = new Map((d.analyse?.pareto || []).map((x) => [x.code, x]))
  const fichesParId = new Map(d.fiches.map((f) => [f.id, f]))
  const etiquetteFiche = (fid) => {
    const f = fichesParId.get(fid)
    return f ? (f.etiquette || f.zone || nomMachine(f) || `fiche ${f.id}`) : `fiche ${fid}`
  }

  // ---- en-tête
  const entete = h('div', { class: 'entete-parc' },
    h('a', { class: 'bouton petit discret', href: '#/mn1' }, ic('retour', 14), 'Tous les parcs'),
    h('div', { class: 'titre-parc' }, h('img', { src: LOGO_MN1, alt: '' }), h('div', {}, h('h1', {}, d.parc.nom), h('p', { class: 'sous-titre' }, `${d.fiches.length} fiche${d.fiches.length > 1 ? 's' : ''} · ${d.parc.production} machines de production · ${d.parc.maintenance} de maintenance`))),
    h('div', { class: 'espace' }),
    d.tendance?.length ? h('div', { class: 'tendance-parc', title: 'Correctifs du parc, 12 derniers mois' }, courbe(d.tendance.map((x) => x.n), { largeur: 160, hauteur: 40 }), h('small', { class: 'discret' }, 'correctifs, 12 mois')) : null,
    admin ? h('button', { class: 'discret icone-seule', title: 'Réglages du parc : maximum par ETH, paramètres de ses FI', onclick: () => reglerParc(d.parc) }, ic('reglages', 18)) : null)

  // ---- charge des opérateurs, par ETH
  const carteChargeParc = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('personne', 18), 'Charge des opérateurs'), h('span', { class: 'discret' }, `maximum ${arrondi(d.reglages.parSemaine)} fiche${d.reglages.parSemaine > 1 ? 's' : ''} par semaine et par ETH · FI lues dans la GMAO ${d.lecture.date ? ilYa(d.lecture.date) : ''}`)),
    d.erreurCharge ? h('div', { class: 'bandeau' }, ic('alerte'), d.erreurCharge)
      : !d.charge.eths.length ? h('p', { class: 'discret' }, 'Ce parc n’a pas encore de racine de production avec des ETH (Administration › Parcs machines).')
        : h('div', { class: 'eths-parc' }, d.charge.eths.map((e) => h('div', { class: `eth-parc${e.taux > 1 + 1e-9 ? ' depasse' : ''}` },
          h('div', { class: 'tete-eth' }, h('b', {}, e.libelle), h('span', { class: 'discret' }, `${arrondi(e.charge)} / ${arrondi(e.max)} par semaine`),
            e.taux > 1 + 1e-9 && admin ? h('button', { class: 'petit danger', onclick: () => dialogueSuspension(d, e) }, ic('stop', 13), 'Choisir les FI à suspendre') : null),
          h('div', { class: 'barre-eth' }, h('i', { style: { width: `${Math.min(100, e.taux * 100)}%` } })),
          e.fi.length ? h('div', { class: 'fi-eth' }, e.fi.map((x) => h('span', { class: `puce-fi${x.actif ? '' : ' suspendue'}`, title: `${x.numero}${x.actif ? '' : ' (suspendue)'} — ${x.fiche ? [x.fiche.etiquette, x.fiche.machine_nom, x.fiche.zone].filter(Boolean).join(' · ') : 'fiche inconnue (FI faite à la main)'} — ${arrondi(x.poids)} / semaine` }, x.numero.replace(/^.*?(\d+)$/, 'n° $1'), x.fiche?.etiquette ? h('small', {}, x.fiche.etiquette) : null))) : h('span', { class: 'discret' }, 'aucune FI'),
          e.inconnues ? h('small', { class: 'rouge' }, `${e.inconnues} FI à la périodicité inconnue (réglages de la GMAO › Périodicités)`) : null))),
    d.charge?.horsEth?.length ? h('p', { class: 'discret', style: { fontSize: '13px' } }, `${d.charge.horsEth.length} FI du parc sur un équipement hors des ETH de production : ${d.charge.horsEth.map((x) => x.numero).join(', ')}`) : null)

  // ---- corrélation Pareto ↔ fiches
  const zoneCorrelation = h('div')
  const lancer = async (bouton) => {
    bouton.disabled = true
    vider(bouton, ic('etincelle', 15), 'L’IA compare le Pareto et les fiches…')
    const r = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/analyse`, { methode: 'POST' }), 'Analyse de corrélation enregistrée')
    if (r) window.ktec.recharger()
    else { bouton.disabled = false; vider(bouton, ic('etincelle', 15), 'Analyse de corrélation') }
  }
  const boutonAnalyse = h('button', { class: 'principal', disabled: Boolean(etat.partage?.autreAdmin), title: etat.partage?.autreAdmin ? 'Un autre poste modifie le fichier : réessayez plus tard' : '', onclick: (e) => lancer(e.currentTarget) }, ic('etincelle', 15), d.analyse ? 'Refaire l’analyse de corrélation' : 'Analyse de corrélation')
  const a = d.analyse
  vider(zoneCorrelation,
    h('div', { class: 'tete-correlation' },
      jauge(a?.pertinence ?? null, { taille: 92, seuil: d.seuil, libelle: 'pertinence' }),
      h('div', { style: { flex: 1 } },
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, a ? `Les fiches couvrent ${pct(a.pertinence)} du Pareto des pannes (chaque panne compte pour son nombre de cas). ${a.fichesSansCible.length} fiche${a.fichesSansCible.length > 1 ? 's' : ''} sans cible, ${a.trous.length} panne${a.trous.length > 1 ? 's' : ''} du Pareto sans fiche. Demandes de niveau 1 qui visent le Pareto : ${a.demandes.couvertes} sur ${a.demandes.total}.` : 'Pas encore d’analyse : l’IA regarde, pour chaque panne du Pareto, quelles fiches et quelles demandes la visent.'),
        a ? h('div', { class: 'date-analyse' }, ic('horloge', 13), `Analyse du ${dateFr(a.date)}`, a.perimee ? h('span', { class: 'etiquette orange' }, 'à refaire : pannes ou fiches changées depuis') : null) : null,
        a?.resume ? h('div', { class: 'texte-ia resume-correlation' }, h('div', { html: texteIA(a.resume) })) : null),
      boutonAnalyse),
    d.pareto.length ? h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau pareto-mn1' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Machine'), h('th', {}, 'Panne qui revient'), h('th', {}, 'Cas (12 mois)'), h('th', {}, 'Cumul'), h('th', {}, 'Fiches qui la visent'), h('th', {}, ''))),
      h('tbody', {}, d.pareto.slice(0, 15).map((p) => {
        const x = parCode.get(p.code)
        const trou = a && x && !x.fiches.length
        return h('tr', { class: trou ? 'trou-pareto' : '' },
          h('td', { class: 'mono discret' }, p.code),
          h('td', {}, h('a', { href: `#/analyse/${p.machine}`, class: 'mono' }, p.repere), p.designation ? h('div', { class: 'discret petit-texte' }, p.designation) : null),
          h('td', { title: x?.commentaire || '' }, p.symptome),
          h('td', { class: 'nombre' }, String(p.nombre)),
          h('td', {}, h('div', { class: 'cumul-pareto' }, h('i', { style: { width: `${Math.round(p.cumul * 100)}%` } }), h('span', {}, pct(p.cumul)))),
          h('td', {}, x ? (x.fiches.length ? x.fiches.map((fid) => h('span', { class: 'etiquette' }, etiquetteFiche(fid))) : h('span', { class: 'etiquette orange' }, 'aucune')) : h('span', { class: 'discret' }, '—'),
            x?.demandes?.length ? h('span', { class: 'discret petit-texte' }, ` · ${x.demandes.length} demande${x.demandes.length > 1 ? 's' : ''}`) : null),
          h('td', {}, trou ? h('button', { class: 'petit', title: 'L’IA rédige un brouillon de fiche pour cette panne', onclick: () => proposerFiche(d, p) }, ic('etincelle', 13), 'Proposer une fiche') : null))
      })))) : h('p', { class: 'discret' }, 'Pas de panne qui revient (3 cas au moins) sur les machines de maintenance de ce parc ces 12 derniers mois.'))
  const carteCorrelation = h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic('graphique', 18), 'Pareto des pannes ↔ fiches')), zoneCorrelation)

  // ---- fiches
  const enPlus = (f) => h('div', { class: 'enplus-mn1 badges-fiche' },
    f.fi_gmao ? h('span', { class: 'fi-gmao', title: 'La FI de la GMAO qui porte cette fiche' }, ic('coche', 13), f.fi_gmao) : h('span', { class: 'etiquette' }, 'sans FI'),
    f.aAnalyser ? h('span', { class: 'etiquette orange', title: 'Fréquence de l’import, provisoire : analysez la machine, puis confirmez la fréquence' }, 'à analyser') : null,
    f.sansCible ? h('span', { class: 'etiquette orange', title: f.suggestion ? `Ne vise aucune panne du Pareto : passer en ${f.suggestion.frequence} libérerait ${arrondi(f.suggestion.gain)} fiche par semaine` : 'Ne vise aucune panne du Pareto' }, 'sans cible', f.suggestion ? ` · ${f.suggestion.frequence.toLowerCase()} ? (−${arrondi(f.suggestion.gain)}/sem.)` : '') : null,
    f.demandes ? h('span', { class: 'etiquette violet', title: 'Demandes de niveau 1 sur cette machine ces 12 mois, malgré la fiche : geste mal fait, ou fiche à revoir ?' }, `${f.demandes} demande${f.demandes > 1 ? 's' : ''} malgré la fiche`) : null,
    avantApres(f.avantApres),
    h('div', { class: 'actions-fiche-mn1' },
      f.machine_id ? h('a', { href: `#/analyse/${f.machine_id}`, class: 'discret petit' }, ic('graphique', 13), 'Analyse') : null,
      admin ? h('button', { class: 'petit', title: f.fi_gmao ? 'Mettre cette fiche dans une autre FI' : 'Créer ou choisir la FI de cette fiche dans la GMAO (simulation d’abord)', onclick: () => dialogueFi(f, d) }, ic('base', 13), f.fi_gmao ? 'Changer de FI' : 'Créer la FI') : null,
      admin ? h('button', { class: 'discret petit icone-seule', title: 'Corriger la fiche', onclick: () => corrigerFiche(f) }, ic('crayon', 14)) : null,
      admin && !f.fi_gmao ? h('button', { class: 'discret petit icone-seule', title: 'Archiver la fiche (elle quitte le parc, son historique reste)', onclick: () => archiver(f) }, ic('boite', 14)) : null))
  const recherche = h('input', { type: 'search', placeholder: 'Filtrer : étiquette, machine, zone, geste…' })
  const tri = h('select', { class: 'fin' }, [['', 'Par ETH'], ['utilite', 'Les moins utiles d’abord'], ['sans', 'Sans FI d’abord'], ['alertes', 'Alertes d’abord']].map(([v, t]) => h('option', { value: v }, t)))
  const liste = h('div', { class: 'fiches-mn1' })
  const alertes = (f) => (f.aAnalyser ? 1 : 0) + (f.sansCible ? 2 : 0) + (f.demandes ? 1 : 0)
  const dessinerFiches = () => {
    const mots = recherche.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const visibles = d.fiches.filter((f) => mots.every((m) => [f.action, f.etiquette, f.zone, f.machine_nom, f.repere, f.eth, f.fi_gmao].join(' ').toLowerCase().includes(m)))
    if (tri.value === 'utilite') visibles.sort((x, y) => (u.get(x.id) || 0) - (u.get(y.id) || 0))
    if (tri.value === 'sans') visibles.sort((x, y) => Boolean(x.fi_gmao) - Boolean(y.fi_gmao))
    if (tri.value === 'alertes') visibles.sort((x, y) => alertes(y) - alertes(x))
    vider(liste, visibles.length ? visibles.map((f) => carteFiche(f, { enPlus: enPlus(f) })) : h('p', { class: 'discret' }, d.fiches.length ? 'Aucune fiche ne correspond.' : 'Pas encore de fiche dans ce parc : importez un classeur, gardez des gestes depuis l’analyse d’une machine, ou proposez une fiche pour une panne du Pareto.'))
  }
  recherche.addEventListener('input', dessinerFiches)
  tri.addEventListener('change', dessinerFiches)
  const carteFiches = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('document', 18), 'Fiches du parc'),
      h('div', { class: 'actions' },
        d.fiches.length ? h('button', { class: 'petit', onclick: () => imprimerFiches(d.fiches) }, ic('document', 14), `Imprimer les ${d.fiches.length}`) : null,
        h('button', { class: 'petit discret', onclick: () => voirArchives(d) }, ic('boite', 14), `Archives (${d.archivees})`))),
    h('div', { class: 'filtres-mn1' }, recherche, tri),
    liste)
  dessinerFiches()

  // ---- demandes de niveau 1 du parc
  const carteDemandes = d.demandes ? h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('historique', 18), 'Demandes de niveau 1 du parc'), h('span', { class: 'discret' }, `12 mois : ${d.demandes.total}, dont ${d.demandes.ouvertes} ouvertes ; ${d.demandes.surMachineAvecFiche} sur une machine qui a déjà une fiche`)),
    d.demandes.dernieres.length ? h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Machine'), h('th', {}, 'Description'), h('th', {}, 'Fiche'), h('th', {}, 'État'))),
      h('tbody', {}, d.demandes.dernieres.map((x) => h('tr', {},
        h('td', { class: 'discret' }, dateFr(x.date)), h('td', { class: 'mono' }, x.machine), h('td', { class: 'texte-2' }, x.description),
        h('td', {}, x.fiche ? h('span', { class: 'etiquette violet', title: 'Cette machine a déjà une fiche : signe d’un geste mal fait ou d’une fiche à revoir' }, x.fiche.etiquette || 'fiche') : ''),
        h('td', {}, h('span', { class: `etiquette ${x.close ? '' : 'violet'}` }, x.etat || (x.close ? 'Close' : 'Ouverte')))))))) : h('p', { class: 'discret' }, 'Aucune demande sur 12 mois.')) : null

  vider(zone, entete, h('div', { class: 'parc-mn1' }, carteChargeParc, carteCorrelation, carteFiches, carteDemandes))
}

// L'avant / après d'une fiche : correctifs par mois avant et depuis son entrée dans une FI.
function avantApres(x) {
  if (!x) return null
  if (x.sansMachine) return h('span', { class: 'discret petit-texte', title: 'Reliez son équipement à une machine de maintenance (Administration › Parcs machines) pour mesurer l’effet' }, 'effet non mesurable')
  if (x.evolution === null) return h('span', { class: 'discret petit-texte', title: `Depuis le ${dateFr(x.debut)} : moins d’un mois de recul` }, `en place depuis le ${dateFr(x.debut)}`)
  const baisse = x.evolution < 0
  return h('span', { class: `avant-apres ${baisse ? 'baisse' : 'hausse'}`, title: `${x.cible} : ${x.avant} en 12 mois avant le ${dateFr(x.debut)}, ${x.apres} en ${x.moisApres} mois depuis` }, ic(baisse ? 'coche' : 'alerte', 12), `${baisse ? '' : '+'}${Math.round(x.evolution * 100)} % de pannes`)
}

// ---------------------------------------------------------------- actions sur les fiches

export async function corrigerFiche(f) {
  const etiquette = h('input', { type: 'text', value: f.etiquette || '' })
  const zoneMachine = h('input', { type: 'text', value: f.zone || '' })
  const action = h('textarea', { rows: 8 }, f.action)
  const frequence = h('select', {}, h('option', { value: '' }, 'À préciser'), FREQUENCES.map((x) => h('option', { value: x, selected: x === f.frequence }, x)))
  const confirmerFrequence = h('input', { type: 'checkbox', checked: f.frequence_source === 'analyse' || f.frequence_source === 'manuelle' })
  const evite = h('input', { type: 'text', value: f.evite })
  const ok = await fenetre({
    titre: `Fiche de niveau 1 — ${nomMachine(f) || f.etiquette}`,
    large: true,
    contenu: h('div', { class: 'grille', style: { gap: '10px' } },
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Étiquette (code de la carte)'), etiquette),
        h('label', { class: 'champ' }, h('span', {}, 'Zone de la machine'), zoneMachine)),
      h('label', { class: 'champ' }, h('span', {}, 'Points à vérifier (un par ligne ; « Porte : » pour un intertitre)'), action),
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Fréquence préconisée'), frequence),
        h('label', { class: 'case' }, confirmerFrequence, ' Fréquence confirmée (d’après l’analyse de la machine)')),
      h('label', { class: 'champ' }, h('span', {}, 'Panne évitée'), evite)),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { await api(`/api/mn1/fiches/${f.id}`, { methode: 'POST', corps: { etiquette: etiquette.value, zone: zoneMachine.value, action: action.value, frequence: frequence.value, evite: evite.value, confirmerFrequence: confirmerFrequence.checked } }); return true } },
    ],
  })
  if (ok) {
    notifier('Fiche enregistrée')
    window.ktec.recharger()
  }
}

async function archiver(f) {
  if (!(await confirmer('Archiver cette fiche ? Elle quitte le parc ; on pourra la ramener depuis les archives.', { texte: 'Archiver' }))) return
  if (await essayer(() => api(`/api/mn1/fiches/${f.id}/ranger`, { methode: 'POST', corps: { archivee: true } }), 'Fiche archivée')) window.ktec.recharger()
}

async function voirArchives(d) {
  const fiches = await essayer(() => api(`/api/mn1/archives?parc=${encodeURIComponent(d.parc.id)}`))
  if (!fiches) return
  const admin = peutModifier()
  await fenetre({
    titre: `${d.parc.nom} : fiches archivées`,
    large: true,
    contenu: fiches.length ? h('div', { class: 'archives-mn1' }, fiches.map((f) => h('div', { class: 'archive-mn1' },
      h('div', { class: 'tete-archive' }, h('b', {}, [f.etiquette, f.machine_nom || f.repere, f.zone].filter(Boolean).join(' · ') || `Fiche ${f.id}`), h('span', { class: 'discret' }, `archivée le ${dateFr(f.archivee_le)}`),
        admin ? h('button', { class: 'petit', onclick: async (e) => { if (await essayer(() => api(`/api/mn1/fiches/${f.id}/ranger`, { methode: 'POST', corps: { archivee: false, parc: d.parc.id } }), 'Fiche ramenée dans le parc')) e.currentTarget.closest('.archive-mn1').remove() } }, ic('retour', 13), 'Ramener') : null),
      f.historique.length ? h('ul', { class: 'historique-fiche' }, f.historique.map((x) => h('li', {}, h('span', { class: 'mono' }, x.numero), ` · ${dateFr(x.debut)} → ${x.fin ? dateFr(x.fin) : 'en cours'}${x.motif ? ` (${x.motif})` : ''}`))) : h('p', { class: 'discret petit-texte' }, 'Jamais mise dans une FI.'))))
      : h('p', { class: 'discret' }, 'Aucune fiche archivée.'),
    boutons: [{ texte: 'Fermer', classe: 'principal', valeur: true }],
  })
  window.ktec.recharger()
}

// Un trou du Pareto : l'IA rédige un brouillon de fiche, qu'on relit avant de l'enregistrer (administrateur).
async function proposerFiche(d, panne) {
  notifier('L’IA rédige une fiche pour cette panne…')
  const b = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/proposer`, { methode: 'POST', corps: { code: panne.code } }))
  if (!b) return
  const admin = peutModifier()
  const machine = h('input', { type: 'text', value: b.machine_nom })
  const zoneMachine = h('input', { type: 'text', value: b.zone })
  const etiquette = h('input', { type: 'text', value: '' , placeholder: 'code de la carte, si vous en avez un' })
  const action = h('textarea', { rows: 7 }, b.action)
  const frequence = h('select', {}, FREQUENCES.filter((x) => x !== 'Quotidienne').map((x) => h('option', { value: x, selected: x === b.frequence }, x)))
  const evite = h('input', { type: 'text', value: b.evite })
  const ok = await fenetre({
    titre: `Brouillon de fiche — ${panne.repere} : ${panne.symptome}`,
    large: true,
    contenu: h('div', { class: 'grille', style: { gap: '10px' } },
      h('p', { class: 'texte-2', style: { margin: 0 } }, `Rédigé par l’IA pour la panne ${panne.code} (${panne.nombre} cas en 12 mois). Relisez et corrigez : rien n’est enregistré sans vous.`),
      h('div', { class: 'grille grille-3', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Machine'), machine),
        h('label', { class: 'champ' }, h('span', {}, 'Zone'), zoneMachine),
        h('label', { class: 'champ' }, h('span', {}, 'Étiquette'), etiquette)),
      h('label', { class: 'champ' }, h('span', {}, 'Points à vérifier (un par ligne)'), action),
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Fréquence préconisée'), frequence),
        h('label', { class: 'champ' }, h('span', {}, 'Panne évitée'), evite))),
    boutons: admin
      ? [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Enregistrer la fiche dans le parc', classe: 'principal', action: async () => { await api('/api/mn1/fiches', { methode: 'POST', corps: { parc: d.parc.id, machine_nom: machine.value, zone: zoneMachine.value, etiquette: etiquette.value, action: action.value, frequence: frequence.value, evite: evite.value } }); return true } }]
      : [{ texte: 'Fermer', classe: 'principal', valeur: null }],
  })
  if (ok) {
    notifier('Fiche ajoutée au parc')
    window.ktec.recharger()
  }
}
