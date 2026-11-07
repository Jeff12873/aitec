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
import { encartCalendrier } from './mn1-circuit.js'
import { jauge, courbe, ecartTendance, tendance } from './mn1-graphiques.js'
import { nuageEquilibre } from './mn1-equilibre.js'
import { estPrevtec, filEtapes, bandeauVerdict, evolutionPanne, lienMachine } from './prevtec.js'

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)} %`)
const arrondi = (n) => (n === null || n === undefined ? '?' : (Math.round(n * 100) / 100).toLocaleString('fr-FR'))

// integre : le parc choisi en haut d'AITEC, affiché directement à la place des vignettes (sans « Tous les parcs »),
// avec un bandeau qui explique sa charge, sa pertinence, sa tendance et ce qu'il reste à faire.
// Un lien vers l'analyse (dans PREVTEC : le démonstrateur de la machine), seulement pour une machine du parc maintenance (ou la machine de maintenance liée à une
// machine de production) ; sinon le texte seul, pas cliquable.
const lienAnalyse = (d, id, contenu) => (d.analysables?.[id] ? h('a', { href: lienMachine(d.parc.id, d.analysables[id]), title: estPrevtec ? 'Étape 3 : cette machine, ses pannes face à tous ses préventifs' : '' }, contenu) : contenu)

export async function afficherParc(zone, id, { integre = false } = {}) {
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
    integre ? null : h('a', { class: 'bouton petit discret', href: '#/mn1' }, ic('retour', 14), 'Tous les parcs'),
    h('div', { class: 'titre-parc' }, h('img', { src: LOGO_MN1, alt: '' }), h('div', {}, h('h1', {}, d.parc.nom), h('p', { class: 'sous-titre' }, `${d.fiches.length} fiche${d.fiches.length > 1 ? 's' : ''} · ${d.parc.production} machines de production · ${d.parc.maintenance} de maintenance`))),
    h('div', { class: 'espace' }),
    d.tendance?.length ? h('small', { class: 'discret legende-tendance', title: `Correctifs du parc, mois par mois : ${d.tendance.map((x) => x.n).join(', ')}` }, 'courbe : correctifs, 12 mois') : null,
    admin ? h('button', { class: 'discret icone-seule', title: 'Réglages du parc : maximum par ETH, paramètres de ses FI', onclick: () => reglerParc(d.parc) }, ic('reglages', 18)) : null)

  // ---- charge des opérateurs, par ETH
  const carteChargeParc = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('personne', 18), 'Charge des opérateurs'), h('span', { class: 'discret' }, `maximum ${arrondi(d.reglages.parSemaine)} fiche${d.reglages.parSemaine > 1 ? 's' : ''} par semaine et par ETH · FI lues dans la GMAO ${d.lecture.date ? ilYa(d.lecture.date) : ''}`)),
    d.erreurCharge ? h('div', { class: 'bandeau' }, ic('alerte'), d.erreurCharge)
      : !d.charge.eths.length ? h('p', { class: 'discret' }, 'Ce parc n’a pas encore de racine de production avec des ETH (Administration › Parcs machines).')
        : h('div', { class: 'eths-parc' }, d.charge.eths.map((e) => h('div', { class: `eth-parc${e.taux > 1 + 1e-9 ? ' depasse' : ''}` },
          h('div', { class: 'tete-eth' }, h('b', {}, e.libelle), h('span', { class: 'discret' }, `${arrondi(e.charge)} / ${arrondi(e.max)} par semaine`),
            // Suspendre est possible à tout moment ; le bouton est rouge quand l'ETH dépasse son maximum.
            admin && e.fi.some((x) => x.actif) ? (e.taux > 1 + 1e-9
              ? h('button', { class: 'petit danger', onclick: () => dialogueSuspension(d, e) }, ic('stop', 13), 'Choisir les FI à suspendre')
              : h('button', { class: 'petit discret', title: 'Suspendre une ou plusieurs FI de cet ETH (elles pourront être réactivées)', onclick: () => dialogueSuspension(d, e) }, ic('stop', 13), 'Suspendre des FI')) : null),
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
  let allerAFiche = () => {} // défini avec la liste des fiches, plus bas
  const tableauPareto = h('table', { class: 'tableau pareto-mn1' })
  // Les colonnes se trient d'un clic (un 2e clic inverse) ; au départ, l'ordre du Pareto.
  const lignes = d.pareto.slice(0, 15).map((p, rang) => ({ p, x: parCode.get(p.code), rang }))
  const COLONNES = [
    ['code', 'Code', (l) => l.p.code],
    ['machine', 'Machine', (l) => l.p.repere || ''],
    ['panne', 'Panne qui revient', (l) => l.p.symptome || ''],
    ['cas', 'Cas (12 mois)', (l) => l.p.nombre],
    ['evolution', 'Évolution', (l) => ({ nouvelle: 3, monte: 2, stable: 1, baisse: 0 }[l.p.evolution] ?? 1), 'Les cas des 12 derniers mois face aux 12 mois d’avant (entre parenthèses) : ↑ monte, ↓ baisse, ✦ nouvelle.'],
    ['part', 'Part des pannes', (l) => l.p.part, [
      'Part des pannes : ce que pèse cette panne parmi toutes les pannes qui reviennent dans le tableau (ses cas sur 12 mois, divisés par le total des cas).',
      '',
      'Ex. 50 % : une panne sur deux du parc, c’est celle-là. Une fiche qui la vise évite beaucoup ; c’est elle à couvrir en premier.',
    ].join('\n')],
    ['fiches', 'Fiches qui la visent', (l) => l.x?.fiches.length ?? -1],
  ]
  let triPareto = { col: 'code', sens: 1 }
  const dessinerPareto = () => {
    const [, , valeur] = COLONNES.find(([c]) => c === triPareto.col)
    const triees = [...lignes].sort((l1, l2) => {
      const v1 = valeur(l1)
      const v2 = valeur(l2)
      const ecart = typeof v1 === 'number' ? v1 - v2 : String(v1).localeCompare(String(v2), 'fr', { numeric: true })
      return (ecart || l1.rang - l2.rang) * triPareto.sens
    })
    vider(tableauPareto,
      h('thead', {}, h('tr', {}, COLONNES.map(([c, titre, , aide]) => h('th', {
        class: `triable${triPareto.col === c ? ' trie' : ''}`, title: aide || 'Trier par cette colonne (un 2e clic inverse)',
        onclick: () => { triPareto = { col: c, sens: triPareto.col === c ? -triPareto.sens : 1 }; dessinerPareto() },
      }, titre, aide ? h('span', { class: 'aide-colonne' }, '?') : null, triPareto.col === c ? h('span', { class: 'sens-tri' }, triPareto.sens > 0 ? ' ▲' : ' ▼') : null)), h('th', {}, ''))),
      h('tbody', {}, triees.map(({ p, x }) => {
        const trou = a && x && !x.fiches.length
        return h('tr', { class: trou ? 'trou-pareto' : '' },
          h('td', { class: 'mono discret' }, p.code),
          h('td', {}, lienAnalyse(d, p.machine, h('span', { class: 'mono' }, p.repere)), p.designation ? h('div', { class: 'discret petit-texte' }, p.designation) : null),
          h('td', { title: x?.commentaire || '' }, p.symptome),
          h('td', { class: 'nombre' }, String(p.nombre)),
          h('td', {}, evolutionPanne(p)),
          h('td', {}, h('div', { class: 'part-pareto', title: `${p.nombre} cas sur 12 mois : ${pct(p.part)} des pannes qui reviennent` }, h('i', { style: { width: `${Math.round(p.part * 100)}%` } }), h('span', {}, pct(p.part)))),
          h('td', {}, x ? (x.fiches.length ? x.fiches.map((fid) => h('button', { class: 'etiquette lien-fiche', title: 'Descendre jusqu’à la fiche', onclick: () => allerAFiche(fid) }, etiquetteFiche(fid))) : h('span', { class: 'etiquette orange' }, 'aucune')) : h('span', { class: 'discret' }, '—'),
            x?.demandes?.length ? h('span', { class: 'discret petit-texte' }, ` · ${x.demandes.length} demande${x.demandes.length > 1 ? 's' : ''}`) : null),
          h('td', {}, trou ? h('button', { class: 'petit', title: 'L’IA rédige un brouillon de fiche pour cette panne', onclick: () => proposerFiche(d, p) }, ic('etincelle', 13), 'Proposer une fiche') : null))
      })))
  }
  dessinerPareto()
  vider(zoneCorrelation,
    h('div', { class: 'tete-correlation' },
      jauge(a?.pertinence ?? null, { taille: 92, seuil: d.seuil, libelle: 'pertinence' }),
      h('div', { style: { flex: 1 } },
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, a ? `Les fiches couvrent ${pct(a.pertinence)} du Pareto des pannes (chaque panne compte pour son nombre de cas). ${a.fichesSansCible.length} fiche${a.fichesSansCible.length > 1 ? 's' : ''} sans cible, ${a.trous.length} panne${a.trous.length > 1 ? 's' : ''} du Pareto sans fiche. Demandes de niveau 1 qui visent le Pareto : ${a.demandes.couvertes} sur ${a.demandes.total}.` : 'Pas encore d’analyse : l’IA regarde, pour chaque panne du Pareto, quelles fiches et quelles demandes la visent.'),
        a ? h('div', { class: 'date-analyse' }, ic('horloge', 13), `Analyse du ${dateFr(a.date)}`, a.perimee ? h('span', { class: 'etiquette orange' }, 'à refaire : pannes ou fiches changées depuis') : null) : null,
        a?.resume ? h('div', { class: 'texte-ia resume-correlation' }, h('div', { html: texteIA(a.resume) })) : null),
      boutonAnalyse),
    d.pareto.length ? h('div', { class: 'tableau-conteneur' }, tableauPareto) : h('p', { class: 'discret' }, 'Pas de panne qui revient (3 cas au moins) sur les machines de maintenance de ce parc ces 12 derniers mois.'))
  // Deux vues dans la même carte : le Pareto des pannes face aux fiches, ou le nuage correctif × préventif.
  let nuage = null
  const titreCarte = h('h2', {}, ic('graphique', 18), 'Pareto des pannes ↔ fiches')
  const corpsCarte = h('div', {}, zoneCorrelation)
  const choixVue = h('div', { class: 'segments petits' })
  const montrerVue = (vue) => {
    vider(choixVue, [['pareto', 'Pareto ↔ fiches', 'Les pannes qui reviennent, et les fiches qui les visent'], ['nuage', 'Correctif × préventif', 'Chaque équipement : ses correctifs face à son préventif d’observation (12 mois)']].map(([cle, texte, aide]) => h('button', { class: vue === cle ? 'choisi' : '', title: aide, onclick: () => montrerVue(cle) }, texte)))
    vider(titreCarte, ic('graphique', 18), vue === 'nuage' ? 'Correctif × préventif par équipement' : 'Pareto des pannes ↔ fiches')
    if (vue === 'nuage') nuage = nuage || nuageEquilibre(d)
    vider(corpsCarte, vue === 'nuage' ? nuage : zoneCorrelation)
  }
  montrerVue('pareto')
  const carteCorrelation = h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, titreCarte, choixVue), corpsCarte)

  // ---- fiches
  const enPlus = (f) => h('div', { class: 'enplus-mn1 badges-fiche' },
    !f.fi_gmao ? h('span', { class: 'etiquette' }, 'sans FI')
      : f.etatFi === 'supprimee' ? h('span', { class: 'etiquette rouge fi-disparue', title: 'Cette FI n’existe plus dans la GMAO : créez-en une autre, ou archivez la fiche' }, ic('alerte', 13), `${f.fi_gmao} · supprimée dans la GMAO`)
      : f.etatFi === 'inactive' ? h('span', { class: 'etiquette orange', title: 'Cette FI est inactive (suspendue ou archivée) dans la GMAO : la fiche n’est plus faite' }, ic('alerte', 13), `${f.fi_gmao} · inactive dans la GMAO`)
      : h('span', { class: 'fi-gmao', title: f.etatFi ? 'La FI de la GMAO qui porte cette fiche, active' : 'La FI de la GMAO qui porte cette fiche (GMAO non lue : état inconnu)' }, ic('coche', 13), f.fi_gmao),
    f.aAnalyser ? h('span', { class: 'etiquette orange', title: 'Fréquence de l’import, provisoire : analysez la machine, puis confirmez la fréquence' }, 'à analyser') : null,
    f.sansCible ? h('span', { class: 'etiquette orange', title: f.suggestion ? `Ne vise aucune panne du Pareto : passer en ${f.suggestion.frequence} libérerait ${arrondi(f.suggestion.gain)} fiche par semaine` : 'Ne vise aucune panne du Pareto' }, 'sans cible', f.suggestion ? ` · ${f.suggestion.frequence.toLowerCase()} ? (−${arrondi(f.suggestion.gain)}/sem.)` : '') : null,
    f.demandes ? h('span', { class: 'etiquette violet', title: 'Demandes de niveau 1 sur cette machine ces 12 mois, malgré la fiche : geste mal fait, ou fiche à revoir ?' }, `${f.demandes} demande${f.demandes > 1 ? 's' : ''} malgré la fiche`) : null,
    avantApres(f.avantApres),
    h('div', { class: 'actions-fiche-mn1' },
      d.analysables?.[f.machine_id] || d.analysables?.[f.machine_prod] ? h('a', { href: `#/analyse/${d.analysables[f.machine_id] || d.analysables[f.machine_prod]}`, class: 'discret petit' }, ic('graphique', 13), 'Analyse') : null,
      admin ? h('button', { class: 'petit', title: f.fi_gmao ? 'Mettre cette fiche dans une autre FI' : 'Créer ou choisir la FI de cette fiche dans la GMAO (simulation d’abord)', onclick: () => dialogueFi(f, d) }, ic('base', 13), f.fi_gmao ? 'Changer de FI' : 'Créer la FI') : null,
      admin ? h('button', { class: 'discret petit icone-seule', title: 'Corriger la fiche', onclick: () => corrigerFiche(f) }, ic('crayon', 14)) : null,
      admin && (!f.fi_gmao || f.etatFi === 'supprimee') ? h('button', { class: 'discret petit icone-seule', title: 'Archiver la fiche (elle quitte le parc, son historique reste)', onclick: () => archiver(f) }, ic('boite', 14)) : null,
      admin && f.fi_gmao && f.etatFi !== 'supprimee' ? h('button', { class: 'discret petit icone-seule supprimer-fi', title: `Supprimer la FI ${f.fi_gmao} dans la GMAO (la fiche reste ici, sans FI)`, onclick: () => supprimerFiGmao(f) }, ic('poubelle', 14)) : null))
  const recherche = h('input', { type: 'search', placeholder: 'Filtrer : étiquette, machine, zone, geste…' })
  const tri = h('select', { class: 'fin' }, [['', 'Par ETH'], ['utilite', 'Les moins utiles d’abord'], ['sans', 'Sans FI d’abord'], ['alertes', 'Alertes d’abord']].map(([v, t]) => h('option', { value: v }, t)))
  const liste = h('div', { class: 'fiches-mn1' })
  // Les filtres rapides, avec le nombre de fiches de chacun ; un seul à la fois.
  const ilYaJours = (date, jours) => date && Date.now() - new Date(date).getTime() < jours * 86_400_000
  const FILTRES = [
    ['', 'Toutes', () => true, ''],
    ['nouvelles', 'Nouvelles', (f) => ilYaJours(f.cree_le, 30), 'Créées ces 30 derniers jours'],
    ['utilisees', 'Utilisées', (f) => Boolean(f.fi_gmao) && f.etatFi !== 'supprimee' && f.etatFi !== 'inactive', 'Portées par une FI active de la GMAO'],
    ['sansfi', 'Sans FI', (f) => !f.fi_gmao || f.etatFi === 'supprimee' || f.etatFi === 'inactive', 'Pas dans une FI active : les opérateurs ne la font pas (FI supprimée ou inactive dans la GMAO comprises)'],
    ['utiles', 'Visent le Pareto', (f) => (u.get(f.id) || 0) > 0, 'Visent au moins une panne du Pareto (d’après l’analyse de corrélation)'],
    ['sanscible', 'Sans cible', (f) => f.sansCible, 'Ne visent aucune panne du Pareto'],
    ['aanalyser', 'À analyser', (f) => f.aAnalyser, 'Fréquence de l’import, encore provisoire'],
    ['demandes', 'Demandes malgré la fiche', (f) => f.demandes > 0, 'Des demandes de niveau 1 sur la machine ces 12 mois, malgré la fiche'],
  ]
  let filtre = ''
  const boutonsFiltre = h('div', { class: 'segments petits' })
  const dessinerBoutonsFiltre = () => vider(boutonsFiltre, FILTRES.map(([cle, texte, garde, aide]) => {
    const n = d.fiches.filter(garde).length
    return cle && !n ? null : h('button', { class: filtre === cle ? 'choisi' : '', title: aide, onclick: () => { filtre = cle; dessinerBoutonsFiltre(); dessinerFiches() } }, texte, h('span', { class: 'nombre-filtre' }, String(n)))
  }))
  const alertes = (f) => (f.aAnalyser ? 1 : 0) + (f.sansCible ? 2 : 0) + (f.demandes ? 1 : 0)
  const reperee = (carte, id) => {
    carte.dataset.fiche = id
    return carte
  }
  const dessinerFiches = () => {
    const mots = recherche.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const garde = FILTRES.find(([cle]) => cle === filtre)[2]
    const visibles = d.fiches.filter(garde).filter((f) => mots.every((m) => [f.action, f.etiquette, f.zone, f.machine_nom, f.repere, f.eth, f.fi_gmao].join(' ').toLowerCase().includes(m)))
    if (tri.value === 'utilite') visibles.sort((x, y) => (u.get(x.id) || 0) - (u.get(y.id) || 0))
    if (tri.value === 'sans') visibles.sort((x, y) => Boolean(x.fi_gmao) - Boolean(y.fi_gmao))
    if (tri.value === 'alertes') visibles.sort((x, y) => alertes(y) - alertes(x))
    // Le pourquoi en plus, propre au parc : combien de pannes du Pareto la fiche vise (analyse de corrélation).
    const pourquoi = (f) => (a ? [['Les pannes visées', (u.get(f.id) || 0) ? `Elle vise ${u.get(f.id)} panne${u.get(f.id) > 1 ? 's' : ''} du Pareto du parc, d’après l’analyse de corrélation du ${dateFr(a.date)}.` : 'L’analyse de corrélation ne la relie à aucune panne du Pareto du parc.']] : [])
    vider(liste, visibles.length ? visibles.map((f) => reperee(carteFiche(f, { enPlus: enPlus(f), pourquoi: pourquoi(f) }), f.id)) : h('p', { class: 'discret' }, d.fiches.length ? 'Aucune fiche ne correspond.' : 'Pas encore de fiche dans ce parc : importez un classeur, gardez des gestes depuis l’analyse d’une machine, ou proposez une fiche pour une panne du Pareto.'))
  }
  // Depuis le Pareto : la fiche est montrée (le filtre est vidé si elle était cachée) et clignote un instant.
  allerAFiche = (id) => {
    if (!liste.querySelector(`[data-fiche="${id}"]`) && (recherche.value || filtre)) {
      recherche.value = ''
      filtre = ''
      dessinerBoutonsFiltre()
      dessinerFiches()
    }
    const carte = liste.querySelector(`[data-fiche="${id}"]`)
    if (!carte) return notifier('Cette fiche n’est plus dans le parc (archivée ?).')
    carte.scrollIntoView({ behavior: 'smooth', block: 'center' })
    carte.classList.remove('fiche-montree')
    void carte.offsetWidth
    carte.classList.add('fiche-montree')
  }
  recherche.addEventListener('input', dessinerFiches)
  tri.addEventListener('change', dessinerFiches)
  const carteFiches = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('document', 18), 'Fiches du parc'),
      h('div', { class: 'actions' },
        admin ? h('button', { class: 'petit discret', title: 'Reprendre les fiches d’un fichier .vignettes dans ce parc', onclick: () => importerVignettes(d, () => afficherParc(zone, id)) }, ic('dossier', 14), 'Importer') : null,
        admin && d.fiches.length ? h('button', { class: 'petit discret', title: 'Les fiches en cours du parc dans un fichier .vignettes', onclick: () => exporterVignettes(d) }, ic('telecharger', 14), 'Exporter') : null,
        d.fiches.length ? h('button', { class: 'petit', onclick: () => imprimerFiches(d.fiches) }, ic('document', 14), `Imprimer les ${d.fiches.length}`) : null,
        h('button', { class: 'petit discret', onclick: () => voirArchives(d) }, ic('boite', 14), `Archives (${d.archivees})`))),
    h('div', { class: 'filtres-mn1' }, recherche, tri, boutonsFiltre),
    liste)
  dessinerBoutonsFiltre()
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

  // La courbe des correctifs en grand, derrière l'en-tête et la charge (floutée sous la carte).
  const fond = d.tendance?.length ? h('div', { class: 'fond-tendance-parc' }, courbe(d.tendance.map((x) => x.n), { largeur: 1400, hauteur: 210 })) : null
  // Le bandeau de synthèse : un clic sur une chose « à faire » filtre les fiches et y descend.
  const filtrer = (cle) => {
    filtre = cle
    recherche.value = ''
    dessinerBoutonsFiltre()
    dessinerFiches()
    carteFiches.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const synthese = integre ? bandeauSynthese(d, { filtrer, compter: (cle) => d.fiches.filter(FILTRES.find(([c]) => c === cle)[2]).length }) : null
  // À droite, le calendrier des équipes du parc : il pèse sur tous les indicateurs de la maintenance N1.
  carteFiches.classList.add('carte-fiches-parc')
  const haut = h('div', { class: 'haut-parc' }, h('div', { class: 'colonne-parc' }, synthese, carteChargeParc), encartCalendrier(d.parc, admin))
  // PREVTEC suit le parcours : le fil (étape 2), le verdict du plan et le Pareto d'abord, puis la charge et les fiches.
  if (estPrevtec) vider(zone, filEtapes(2, d.parc), h('div', { class: 'scene-parc' }, fond, entete, bandeauVerdict(d.plan)), h('div', { class: 'parc-mn1' }, carteCorrelation), haut, h('div', { class: 'parc-mn1' }, carteFiches, carteDemandes))
  else vider(zone, h('div', { class: 'scene-parc' }, fond, entete, haut), h('div', { class: 'parc-mn1' }, carteCorrelation, carteFiches, carteDemandes))
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
  const etiquette = h('input', { type: 'text', value: f.etiquette || '', readOnly: true, title: 'Ligne-ETH-numéro, calculée par AITEC : elle suit la fiche si on la réaffecte' })
  const zoneMachine = h('input', { type: 'text', value: f.zone || '' })
  const action = h('textarea', { rows: 8 }, f.action)
  const frequence = h('select', {}, h('option', { value: '' }, 'À préciser'), FREQUENCES.map((x) => h('option', { value: x, selected: x === f.frequence }, x)))
  const confirmerFrequence = h('input', { type: 'checkbox', checked: f.frequence_source === 'analyse' || f.frequence_source === 'manuelle' })
  const evite = h('input', { type: 'text', value: f.evite })
  // Réaffecter la fiche à un autre équipement de production du parc (machine et ETH) : la liste se filtre en tapant.
  let equipements = []
  if (f.parc) equipements = (await api(`/api/mn1/parcs/${encodeURIComponent(f.parc)}/equipements`).catch(() => [])).filter((e) => e.niveau >= 3 || e.machine)
  const libelleEquipement = (e) => `${e.code}${e.designation ? ' — ' + e.designation : ''}${e.eth ? ` · ETH ${e.eth}` : ''}`
  const actuel = equipements.find((e) => String(e.noeud) === String(f.noeud))
  const filtre = h('input', { type: 'search', placeholder: 'Chercher un code ou une désignation…' })
  const choixEquipement = h('select', { size: 6 })
  const remplirChoix = () => {
    const mots = filtre.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const garde = choixEquipement.value
    vider(choixEquipement,
      h('option', { value: '' }, actuel ? `Garder : ${libelleEquipement(actuel)}` : `Garder : ${nomMachine(f) || 'machine actuelle'}${f.eth ? ` · ETH ${f.eth}` : ''}`),
      equipements.filter((e) => mots.every((m) => libelleEquipement(e).toLowerCase().includes(m))).slice(0, 300).map((e) => h('option', { value: String(e.noeud) }, libelleEquipement(e))))
    choixEquipement.value = garde
  }
  filtre.addEventListener('input', remplirChoix)
  remplirChoix()
  const ok = await fenetre({
    titre: `Fiche de niveau 1 — ${nomMachine(f) || f.etiquette}`,
    large: true,
    contenu: h('div', { class: 'grille', style: { gap: '10px' } },
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Étiquette (ligne-ETH-numéro, automatique)'), etiquette),
        h('label', { class: 'champ' }, h('span', {}, 'Zone de la machine'), zoneMachine)),
      h('label', { class: 'champ' }, h('span', {}, 'Points à vérifier (un par ligne ; « Porte : » pour un intertitre)'), action),
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Fréquence préconisée'), frequence),
        h('label', { class: 'case' }, confirmerFrequence, ' Fréquence confirmée (d’après l’analyse de la machine)')),
      h('label', { class: 'champ' }, h('span', {}, 'Panne évitée'), evite),
      equipements.length ? h('div', { class: 'champ' }, h('span', {}, 'Machine et ETH : réaffecter à un équipement de production du parc'), filtre, choixEquipement) : null),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { await api(`/api/mn1/fiches/${f.id}`, { methode: 'POST', corps: { zone: zoneMachine.value, action: action.value, frequence: frequence.value, evite: evite.value, confirmerFrequence: confirmerFrequence.checked, equipement: choixEquipement.value || null } }); return true } },
    ],
  })
  if (ok) {
    notifier('Fiche enregistrée')
    window.ktec.recharger()
  }
}

// Supprimer la FI d'une fiche dans la GMAO : simulée d'abord, puis écrite après confirmation. La fiche reste.
async function supprimerFiGmao(f) {
  const simulation = await essayer(() => api('/api/mn1/fi/supprimer', { methode: 'POST', corps: { fiche: f.id } }))
  if (!simulation) return
  if (!simulation.modifiees) return notifier(`La simulation ne modifierait rien pour ${f.fi_gmao} : vérifiez le SQL de suppression.`, 'erreur')
  if (!(await confirmer(`Supprimer la FI ${f.fi_gmao} dans la GMAO ? Ce sera réellement écrit. La fiche reste dans AITEC, sans FI.`, { texte: 'Supprimer la FI', danger: true }))) return
  const r = await essayer(() => api('/api/mn1/fi/supprimer', { methode: 'POST', corps: { fiche: f.id, valider: true } }), `FI ${f.fi_gmao} supprimée dans la GMAO`)
  if (r) window.ktec.recharger()
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
  if (await relireFiche(d.parc.id, b, `Brouillon de fiche — ${panne.repere} : ${panne.symptome}`, `Rédigé par l’IA pour la panne ${panne.code} (${panne.nombre} cas en 12 mois). Relisez et corrigez : rien n’est enregistré sans vous.`)) window.ktec.recharger()
}

// Le brouillon d'une fiche (rédigé par l'IA), relu et corrigé avant de l'enregistrer dans le parc (administrateur).
// Rend vrai si la fiche est enregistrée.
export async function relireFiche(parcId, b, titre, intro) {
  const admin = peutModifier()
  const machine = h('input', { type: 'text', value: b.machine_nom })
  const zoneMachine = h('input', { type: 'text', value: b.zone })
  const action = h('textarea', { rows: 7 }, b.action)
  const frequence = h('select', {}, FREQUENCES.filter((x) => x !== 'Quotidienne').map((x) => h('option', { value: x, selected: x === b.frequence }, x)))
  const evite = h('input', { type: 'text', value: b.evite })
  const ok = await fenetre({
    titre,
    large: true,
    contenu: h('div', { class: 'grille', style: { gap: '10px' } },
      h('p', { class: 'texte-2', style: { margin: 0 } }, intro),
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Machine'), machine),
        h('label', { class: 'champ' }, h('span', {}, 'Zone'), zoneMachine)),
      h('label', { class: 'champ' }, h('span', {}, 'Points à vérifier (un par ligne)'), action),
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Fréquence préconisée'), frequence),
        h('label', { class: 'champ' }, h('span', {}, 'Panne évitée'), evite))),
    boutons: admin
      ? [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Enregistrer la fiche dans le parc', classe: 'principal', action: async () => { await api('/api/mn1/fiches', { methode: 'POST', corps: { parc: parcId, machine_nom: machine.value, zone: zoneMachine.value, action: action.value, frequence: frequence.value, evite: evite.value } }); return true } }]
      : [{ texte: 'Fermer', classe: 'principal', valeur: null }],
  })
  if (ok) notifier('Fiche ajoutée au parc')
  return Boolean(ok)
}

// ---- les fiches du parc dans un fichier .vignettes (passage d'un fichier de connaissances à un autre)

async function exporterVignettes(d) {
  const contenu = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/export`))
  if (!contenu) return
  const lien = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(contenu, null, 1)], { type: 'application/json' })), download: `vignette-${d.parc.nom.replace(/[^\w.-]+/g, '_')}.vignettes` })
  document.body.append(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(lien.href), 10_000)
  notifier(`${contenu.fiches.length} fiches exportées`)
}

function importerVignettes(d, apres) {
  const choix = h('input', { type: 'file', accept: '.vignettes,application/json' })
  choix.onchange = async () => {
    const fichier = choix.files[0]
    if (!fichier) return
    let contenu
    try {
      contenu = JSON.parse(await fichier.text())
    } catch {
      return notifier('Ce fichier n’est pas lisible.', 'erreur')
    }
    const n = contenu?.fiches?.length || 0
    if (!(await confirmer(`Reprendre ${n} fiche${n > 1 ? 's' : ''} de « ${contenu?.parc || fichier.name} » dans le parc ${d.parc.nom} ? Les fiches déjà présentes ne sont pas doublées.`))) return
    const r = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/import`, { methode: 'POST', corps: contenu }))
    if (!r) return
    notifier(`${r.ajoutees} fiche${r.ajoutees > 1 ? 's' : ''} ajoutée${r.ajoutees > 1 ? 's' : ''}${r.deja ? `, ${r.deja} déjà là` : ''}${r.fiNonTrouvees.length ? ` ; FI absentes de cette GMAO, non reprises : ${r.fiNonTrouvees.join(', ')}` : ''}`)
    apres()
  }
  choix.click()
}

// ---------------------------------------------------------------- synthèse du parc choisi

// Quatre colonnes : la charge (le calcul en clair et un verdict), la pertinence (et les grosses pannes qu'aucune
// fiche ne vise), la tendance des correctifs, et ce qu'il reste à faire (cliquable).
function bandeauSynthese(d, { filtrer, compter }) {
  const colonne = (icone, titre, ...contenu) => h('div', { class: 'colonne-synthese' }, h('h3', {}, ic(icone, 16), titre), ...contenu)
  const verdict = (classe, texte) => h('p', { class: `verdict-synthese ${classe}` }, texte)

  // Charge : la plus haute d'un ETH, comparée au maximum réglé.
  let charge
  if (d.erreurCharge) charge = colonne('personne', 'Charge', h('p', { class: 'discret' }, d.erreurCharge))
  else if (!d.charge.eths.length) charge = colonne('personne', 'Charge', h('p', { class: 'discret' }, 'Pas encore d’ETH de production dans ce parc (Administration › Parcs machines).'))
  else {
    const plusHaut = d.charge.eths.reduce((m, e) => (e.taux > m.taux ? e : m))
    const total = d.charge.eths.reduce((s, e) => s + e.charge, 0)
    const taux = plusHaut.taux
    charge = colonne('personne', 'Charge',
      h('p', {}, h('b', { class: 'grand-synthese' }, pct(taux)), ' du maximum'),
      h('p', { class: 'texte-2' }, `${arrondi(total)} fiche${total > 1 ? 's' : ''} par semaine pour ${d.charge.eths.length} ETH ; l’ETH le plus chargé (${plusHaut.libelle}) en a ${arrondi(plusHaut.charge)} sur ${arrondi(plusHaut.max)} autorisées (${arrondi(d.reglages.parSemaine)} par semaine et par ETH).`),
      taux > 1 + 1e-9 ? verdict('rouge', 'Surchargé : des FI sont à suspendre ou à espacer.') : taux >= 0.85 ? verdict('orange', 'À la limite : peu de place pour une fiche de plus.') : verdict('vert', 'De la marge : on peut ajouter des fiches.'))
  }

  // Pertinence : la part des cas du Pareto visée par les fiches, et les 3 plus grosses pannes sans fiche.
  const a = d.analyse
  const parCode = new Map((a?.pareto || []).map((x) => [x.code, x]))
  const trous = d.pareto.filter((p) => parCode.get(p.code) && !parCode.get(p.code).fiches.length).slice(0, 3)
  const pertinence = colonne('loupe', 'Pertinence',
    a ? h('p', {}, h('b', { class: 'grand-synthese' }, pct(a.pertinence)), ' des pannes qui reviennent visées') : h('p', { class: 'discret' }, 'Pas encore d’analyse : elle se lance depuis la carte « Pareto et fiches » ci-dessous.'),
    a ? h('p', { class: 'texte-2' }, 'Chaque panne compte pour son nombre de cas sur 12 mois.') : null,
    trous.length ? h('div', {}, h('p', { class: 'petit-titre-synthese' }, 'Sans fiche, à viser en premier :'),
      h('ul', { class: 'liste-synthese' }, trous.map((p) => h('li', {}, lienAnalyse(d, p.machine, h('span', { class: 'mono' }, p.repere)), ` ${p.symptome} `, h('span', { class: 'discret' }, `(${p.nombre} cas)`))))) : a ? verdict('vert', 'Toutes les grosses pannes ont une fiche.') : null)

  // Tendance : les 3 derniers mois de correctifs, comparés à la moyenne des 12.
  const valeurs = (d.tendance || []).map((x) => x.n)
  const sens = valeurs.length ? tendance(valeurs) : null
  const ecart = valeurs.length ? ecartTendance(valeurs) : 0
  const moyenne = valeurs.length ? valeurs.reduce((s, n) => s + n, 0) / valeurs.length : 0
  const courbeTendance = colonne('graphique', 'Correctifs, 12 mois',
    valeurs.length ? h('div', { class: 'courbe-synthese' }, courbe(valeurs, { largeur: 300, hauteur: 56 })) : null,
    valeurs.length ? h('p', {}, h('b', { class: 'grand-synthese' }, `${ecart > 0 ? '+' : ''}${Math.round(ecart * 100)} %`), ' sur les 3 derniers mois') : h('p', { class: 'discret' }, 'Pas d’intervention corrective connue.'),
    valeurs.length ? h('p', { class: 'texte-2' }, `Moyenne : ${arrondi(moyenne)} correctif${moyenne > 1 ? 's' : ''} par mois.`) : null,
    sens === 'hausse' ? verdict('rouge', 'En hausse : les fiches ne suffisent pas.') : sens === 'baisse' ? verdict('vert', 'En baisse : les fiches portent leurs fruits.') : sens ? verdict('orange', 'Stable.') : null)

  // À faire : les filtres rapides des fiches qui demandent une action, et les ETH dépassés.
  const choses = [
    ['aanalyser', 'fiche à analyser', 'fiches à analyser'],
    ['sanscible', 'fiche sans cible', 'fiches sans cible'],
    ['demandes', 'fiche avec des demandes malgré elle', 'fiches avec des demandes malgré elles'],
    ['sansfi', 'fiche sans FI', 'fiches sans FI'],
  ].map(([cle, un, plusieurs]) => [cle, compter(cle), un, plusieurs]).filter(([, n]) => n)
  const depasses = d.erreurCharge ? [] : d.charge.eths.filter((e) => e.taux > 1 + 1e-9)
  const aFaire = colonne('coche', 'À faire',
    choses.length || depasses.length ? h('ul', { class: 'liste-synthese a-faire' },
      depasses.map((e) => h('li', {}, h('span', { class: 'etiquette rouge' }, e.libelle), ' dépasse son maximum')),
      choses.map(([cle, n, un, plusieurs]) => h('li', {}, h('button', { class: 'lien-synthese', onclick: () => filtrer(cle) }, h('b', {}, String(n)), ` ${n > 1 ? plusieurs : un}`)))) : verdict('vert', 'Rien d’urgent.'))

  return h('div', { class: 'carte synthese-parc' }, charge, pertinence, courbeTendance, aFaire)
}
