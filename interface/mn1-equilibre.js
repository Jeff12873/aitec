// Le tableau correctif × préventif d'une ligne (à côté du Pareto), en grosses cases : les pannes en hauteur, les
// visites d'observation en largeur, sur 12 mois. D'abord les ETH de la ligne ; un clic zoome sur les machines d'une ETH.
// Quatre cadrans, « beaucoup » voulant dire le tiers le plus haut des éléments affichés (la médiane alertait sur la
// moitié d'entre eux : une alerte partout n'alerte plus) :
//   beaucoup de pannes, peu de visites      : pas assez de préventif (rouge) ;
//   beaucoup de pannes, beaucoup de visites : mal ciblé, on ne regarde pas au bon endroit (violet) ;
//   peu de pannes, beaucoup de visites      : trop de préventif ? (orange), ou le préventif marche si les pannes ont
//                                             nettement baissé depuis les 12 mois d'avant (vert) ;
//   peu de pannes, peu de visites           : rien à signaler.
// Le préventif systématique (changer une pièce à date fixe) est écarté :
// l'IA classe chaque gamme, l'administrateur corrige (blocs/mn1/equilibre.js).

import { h, vider, ic, essayer } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { modeAdmin } from '/socle/etat.js'
import { lienMachine } from './prevtec.js'
import { demonstrateurMachine } from './prevtec-machine.js'
import { inception } from './animer.js'

const ECART = 2 // même règle que le serveur (equilibre.js, zone)

const tiersHaut = (valeurs) => {
  const tri = [...valeurs].sort((a, b) => a - b)
  return tri.length ? tri[Math.floor(tri.length * 2 / 3)] : 0
}
// Les seuils de « beaucoup », sur les éléments affichés (2 au moins : une panne isolée n'est pas « beaucoup »).
const seuilsDe = (liste) => ({ c: Math.max(2, tiersHaut(liste.map((e) => e.correctifs))), p: Math.max(2, tiersHaut(liste.map((e) => e.preventifs))) })
const baisseNette = (e) => e.correctifsAvant - e.correctifs >= 2 && e.correctifs <= e.correctifsAvant * 0.75
function zone(e, s) {
  const pannes = e.correctifs >= s.c
  const visites = e.preventifs >= s.p
  if (pannes) return visites ? 'violet' : 'rouge'
  if (visites) return baisseNette(e) ? 'vert' : 'orange'
  return 'gris'
}

// d : le détail du parc (pour son id). Renvoie l'élément ; les données se chargent à l'affichage.
// machine : le Démonstrateur à ouvrir d'emblée ; surNiveau({ machine, eth, retour }) : appelé à chaque niveau (retour :
// { texte, action }, ou null en haut) ; seulMachine : le retour du Démonstrateur revient à la ligne (panneau Pareto) ;
// affichage : ce que l'administrateur a choisi pour les carrés.
export function nuageEquilibre(d, { machine = null, placeParOu = null, surNiveau = () => {}, seulMachine = false, affichage = { carres: ['pannes', 'visites', 'aRegarder'], nomCarres: 'repere', nomsEth: {} } } = {}) {
  parcCourant = d.parc.id
  const zoneNuage = h('div', { class: 'equilibre-mn1' }, h('p', { class: 'discret' }, 'Lecture des interventions…'))
  let donnees = null
  let ethChoisi = null // null : les ETH de la ligne ; sinon l'id de l'ETH dont on voit les machines
  let machineChoisie = null // l'id de la machine dont on voit le Démonstrateur (3e niveau)

  const charger = async () => {
    donnees = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/equilibre`))
    if (!donnees) return vider(zoneNuage, h('p', { class: 'discret' }, 'Lecture impossible.'))
    if (machine) {
      // Un équipement ou une machine : on la replace dans son ETH, pour la flèche de retour.
      const e = donnees.equipements.find((x) => String(x.id) === String(machine) || String(x.machine.id) === String(machine))
      if (e) { ethChoisi = e.eth?.id || ''; machineChoisie = e.machine.id }
      machine = null
    }
    dessiner()
  }
  const adresse = (id) => history.replaceState(null, '', `#/mn1/parc/${encodeURIComponent(d.parc.id)}${id ? `?machine=${id}` : ''}`)
  const ouvrirDemonstrateur = async () => {
    const eth = donnees.equipements.find((e) => (e.eth?.id || '') === ethChoisi)?.eth
    const retour = seulMachine
      ? { texte: d.parc.nom, action: () => (location.hash = `#/mn1/parc/${encodeURIComponent(d.parc.id)}`) }
      : { texte: `Machines de ${eth?.code || 'Hors ETH'}`, action: () => inception(zoneNuage, null, () => { machineChoisie = null; adresse(null); return dessiner() }, false) }
    vider(zoneNuage, h('p', { class: 'discret curseur' }, 'Lecture des pannes et des visites de la machine'))
    const choisie = machineChoisie
    const r = await essayer(() => demonstrateurMachine(d.parc.id, choisie, {
      surChange: (x) => surNiveau({ machine: x.machine, eth, retour, resume: resumeMachine(donnees.equipements, choisie, { machine: x.machine, colonnes: x.colonnes, lignes: x.lignes }) }),
    }))
    if (!r) return
    vider(zoneNuage, r.element)
    adresse(r.machine.id)
    surNiveau({ machine: r.machine, eth, retour, resume: resumeMachine(donnees.equipements, machineChoisie, r) })
    window.scrollTo({ top: 0 })
  }

  const dessiner = async () => {
    if (machineChoisie !== null) return ouvrirDemonstrateur()
    const tous = donnees.equipements.map((e) => ({ ...e, preventifs: e.n1 + e.techniciens })).filter((e) => e.correctifs || e.preventifs)
    // Deux niveaux : les ETH de la ligne, puis (clic) les machines d'un ETH, sous-ensembles regroupés.
    const regrouper = (equipements, cle, decrire) => {
      const groupes = new Map()
      for (const e of equipements) {
        const k = cle(e)
        const g = groupes.get(k) || { ...decrire(e), correctifs: 0, preventifs: 0, correctifsAvant: 0, heures: 0, equipements: 0 }
        g.correctifs += e.correctifs
        g.heures += e.heures
        g.correctifsAvant += e.correctifsAvant
        g.preventifs += e.preventifs
        g.equipements++
        groupes.set(k, g)
      }
      return [...groupes.values()]
    }
    const eth = tous.find((e) => (e.eth?.id || '') === ethChoisi)?.eth
    const liste = ethChoisi === null
      ? regrouper(tous, (e) => e.eth?.id || '', (e) => ({ type: 'eth', id: e.eth?.id || '', repere: e.eth?.code || 'Hors ETH', designation: e.eth?.libelle || 'Équipements rangés hors des ETH' }))
      : regrouper(tous.filter((e) => (e.eth?.id || '') === ethChoisi), (e) => e.machine.id, (e) => ({ type: 'machine', id: e.machine.id, repere: e.machine.repere || e.repere, designation: e.machine.designation || e.designation, analyse: e.machine.id }))
    const totaux = { correctifs: liste.reduce((t, e) => t + e.correctifs, 0), preventifs: liste.reduce((t, e) => t + e.preventifs, 0) }
    const seuils = seuilsDe(liste)
    for (const e of liste) e.zone = zone(e, seuils)
    // Une ETH alerte par ce qu'elle contient : ses machines rouges (ou orange), comptées comme au zoom.
    if (ethChoisi === null) {
      for (const e of liste) {
        const machines = regrouper(tous.filter((x) => (x.eth?.id || '') === e.id), (x) => x.machine.id, () => ({}))
        const s2 = seuilsDe(machines)
        const zones = machines.map((m) => zone(m, s2))
        e.rouges = zones.filter((z) => z === 'rouge' || z === 'violet').length
        e.oranges = zones.filter((z) => z === 'orange').length
        e.machines = machines.length
      }
    }
    const compte = (z) => liste.filter((e) => e.zone === z).length
    surNiveau({ machine: null, eth, retour: ethChoisi === null ? null : { texte: 'Toutes les ETH', action: () => inception(zoneNuage, null, () => { ethChoisi = null; return dessiner() }, false) } })
    const aRegarder = liste.filter((e) => e.zone === 'rouge' || e.zone === 'violet').sort((a, b) => b.correctifs - a.correctifs)
    const surEntretien = liste.filter((e) => e.zone === 'orange').sort((a, b) => b.preventifs - a.preventifs)
    const g = donnees.gammes

    const boutonClasser = h('button', { class: 'petit', title: 'L’IA lit le titre de chaque préventif de la ligne : observation (contrôle, vérification) ou systématique (échange, remplacement). Gardé dans le fichier.' }, ic('etincelle', 13), g.aClasser ? `Classer ${g.aClasser} entretien${g.aClasser > 1 ? 's' : ''} par l’IA` : 'Préventif & entretiens classés')
    boutonClasser.classList.toggle('ia-a-faire', g.aClasser > 0)
    boutonClasser.disabled = !g.aClasser || !donnees.iaInstallee
    boutonClasser.onclick = async () => {
      boutonClasser.disabled = true
      vider(boutonClasser, ic('etincelle', 13), 'L’IA classe les gammes…')
      const r = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(d.parc.id)}/gammes`, { methode: 'POST' }))
      if (r) await charger()
      else { boutonClasser.disabled = false; vider(boutonClasser, ic('etincelle', 13), 'Réessayer le classement') }
    }

    // « Par où commencer » est la conclusion du tableau : elle s'affiche sous le verdict de la ligne.
    if (placeParOu) vider(placeParOu, ethChoisi === null ? parOuCommencer(liste, totaux, (id) => inception(zoneNuage, null, () => { ethChoisi = id; return dessiner() })) : null)
    vider(zoneNuage,
      h('div', { class: 'tete-equilibre' },
        ethChoisi !== null ? h('button', { class: 'barre-retour', title: 'Revenir au tableau des ETH', onclick: () => inception(zoneNuage, null, () => { ethChoisi = null; return dessiner() }, false) }, ic('retour', 16), 'Toutes les ETH') : null,
        ethChoisi !== null ? h('div', { class: 'retour-tableau' }, h('b', {}, eth?.libelle || 'Hors ETH'), h('span', { class: 'discret' }, ' : ses machines')) : null),
      liste.length
        ? tableauCases(liste, { niveau: ethChoisi === null ? 'eth' : 'machine', affichage, zoomer: (id, el) => inception(zoneNuage, el, () => { ethChoisi = id; return dessiner() }), ouvrir: (id, el) => inception(zoneNuage, el, () => { machineChoisie = id; return dessiner() }) })
        : h('p', { class: 'discret' }, 'Ni correctif ni préventif sur les machines de maintenance de cette ligne ces 12 derniers mois.'),
      h('div', { class: 'legende-fixe' },
        [['rouge', 'Beaucoup de pannes, peu de visites : pas assez de préventif'], ['violet', 'Beaucoup des deux : mal ciblé'], ['orange', 'Peu de pannes, beaucoup de visites : trop de préventif ?'], ['vert', 'Beaucoup de visites et pannes en nette baisse : le préventif marche'], ['gris', 'Peu des deux : rien à signaler']].map(([z, texte]) => h('span', {}, h('i', { class: `case-legende ${z}` }), `${texte} (${compte(z)})`))),
      h('p', { class: 'discret petit-texte' }, `${ethChoisi === null ? `${liste.length} ETH` : `${liste.length} machine${liste.length > 1 ? 's' : ''}`}, ${totaux.correctifs} pannes et ${totaux.preventifs} visites d’observation sur 12 mois. « Beaucoup » : ${seuils.c} pannes ou ${seuils.p} visites au moins, le tiers le plus haut de ce qui est affiché.${ethChoisi === null ? ' Cliquez une ETH pour voir ses machines.' : ' Cliquez une machine pour ouvrir son Démonstrateur.'}`),
      ethChoisi !== null && (aRegarder.length || surEntretien.length) ? h('div', { class: 'a-regarder' },
        aRegarder.length ? h('div', {}, h('b', {}, 'À regarder d’abord'), aRegarder.slice(0, 8).map(puce)) : null,
        surEntretien.length ? h('div', {}, h('b', {}, 'Préventif à alléger ?'), surEntretien.slice(0, 8).map(puce)) : null) : null,
      h('div', { class: 'gammes-equilibre' },
        h('div', { class: 'ligne-gammes' },
          h('span', { class: 'texte-2' }, `${g.total} préventif${g.total > 1 ? 's' : ''} & entretien${g.total > 1 ? 's' : ''}, dont ${g.ecartes} écarté${g.ecartes > 1 ? 's' : ''} du tableau par leur étiquette.`,
            g.aClasser ? h('span', { class: 'etiquette orange', title: 'Classées d’après les mots du titre seulement (échange, remplacement…), en attendant l’IA' }, `${g.aClasser} à classer`) : null),
          donnees.iaInstallee ? boutonClasser : h('span', { class: 'discret petit-texte' }, 'IA non installée : classement d’après les mots du titre.')),
        listeGammes(g)))
  }

  // Les gammes, la plus fréquente d'abord : l'administrateur corrige le classement d'un clic.
  const listeGammes = (g) => {
    const corps = h('div', { class: 'liste-gammes' })
    const details = h('details', {}, h('summary', {}, 'Voir Préventif & entretiens'), corps)
    details.addEventListener('toggle', () => {
      if (!details.open || corps.childElementCount) return
      const PAR = { ia: 'IA', admin: 'administrateur', mots: 'mots du titre' }
      for (const x of g.liste) {
        const choix = h('select', { class: 'fin', disabled: !modeAdmin(), title: modeAdmin() ? '' : 'Seul l’administrateur corrige le classement' },
          donnees.etiquettes.map((e) => h('option', { value: e.id, selected: x.classe === e.id, title: e.interet }, e.nom)))
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
let parcCourant = null // le parc du nuage affiché, pour les liens vers ses machines
const lien = (e, contenu) => (e.analyse ? h('a', { href: lienMachine(parcCourant, e.analyse) }, contenu) : contenu)
function puce(e) {
  return h('span', { class: `puce-equipement ${e.zone}`, title: `${e.designation || e.repere} : ${e.correctifs} correctif${e.correctifs > 1 ? 's' : ''}, ${e.preventifs} préventif${e.preventifs > 1 ? 's' : ''}` },
    lien(e, h('span', { class: 'mono' }, e.repere || '?')), h('small', {}, ` ${e.correctifs} / ${e.preventifs}`))
}

// Le tableau en grosses cases : les pannes en hauteur (beaucoup en haut), les visites en largeur, par tranches
// (0, 1–2, 3–5, 6–10, 11–20…). Chaque case prend la couleur de sa zone : rouge sous la moitié de la pente de la
// ligne (beaucoup de pannes pour peu de visites), orange au-dessus du double, vert entre les deux.
const BORNES = [0, 1, 3, 6, 11, 21, 51, 101, 201, 501, 1001, 2001]
const tranches = (max) => {
  const b = BORNES.filter((x) => x <= max)
  return b.map((de, i) => ({ de, a: (b[i + 1] ?? Infinity) - 1, libelle: b[i + 1] === undefined ? (de ? `${de}+` : '0') : de === b[i + 1] - 1 ? String(de) : `${de}–${b[i + 1] - 1}` }))
}
const indiceDe = (lesTranches, v) => lesTranches.findIndex((t) => v >= t.de && v <= t.a)
// Les tranches adaptées à ce qu'on regarde (une poignée d'ETH aux grands nombres) : 5 tranches au plus, bornées sur
// les valeurs réelles, arrondies à des nombres ronds.
const rond = (x) => (x <= 10 ? Math.round(x) : x <= 50 ? Math.round(x / 5) * 5 : x <= 200 ? Math.round(x / 10) * 10 : Math.round(x / 50) * 50)
function tranchesAdaptees(valeurs) {
  const tri = [...valeurs].sort((a, b) => a - b)
  if (tri.length > 12) return tranches(Math.max(1, tri[tri.length - 1]))
  const bornes = [...new Set([0, ...[0.2, 0.4, 0.6, 0.8].map((q) => rond(tri[Math.floor(q * (tri.length - 1))])).filter((x) => x > 0)])].sort((a, b) => a - b)
  return bornes.map((de, i) => ({ de, a: (bornes[i + 1] ?? Infinity) - 1, libelle: bornes[i + 1] === undefined ? (de ? `${de}+` : '0') : de === bornes[i + 1] - 1 ? String(de) : `${de}–${bornes[i + 1] - 1}` }))
}

// Le seuil de « beaucoup » devient une borne de tranche : chaque case est tout entière d'un côté du cadran.
function avecSeuil(lesTranches, seuil) {
  const bornes = [...new Set([...lesTranches.map((x) => x.de), seuil])].sort((a, b) => a - b)
  return bornes.map((de, i) => {
    const a = (bornes[i + 1] ?? Infinity) - 1
    return { de, a, libelle: a === Infinity ? `${de}+` : de === a ? String(de) : `${de}–${a}` }
  })
}

// Par où commencer, au niveau des ETH : la plus problématique d'abord, en une phrase chacune.
function parOuCommencer(liste, totaux, zoomer) {
  const ratio = (e) => (e.correctifs ? e.preventifs / e.correctifs : null)
  const virgule = (x) => (Math.round(x * 10) / 10).toLocaleString('fr-FR')
  const evol = (e) => {
    if (!e.correctifsAvant) return 'pas de comparaison possible'
    const v = Math.round(((e.correctifs - e.correctifsAvant) / e.correctifsAvant) * 100)
    return `pannes ${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} % sur 12 mois`
  }
  const moyenne = totaux.correctifs ? totaux.preventifs / totaux.correctifs : null
  const tri = [...liste].sort((a, b) => b.rouges - a.rouges || (b.correctifs - b.correctifsAvant) - (a.correctifs - a.correctifsAvant))
  return h('div', { class: 'par-ou-commencer' },
    h('b', {}, 'Par où commencer : les plus gros gains possibles'),
    h('ol', {}, tri.map((e) => h('li', {},
      h('button', { class: 'lien-synthese', onclick: () => zoomer(e.id) }, h('span', { class: 'mono' }, e.repere)),
      ` : ${e.rouges ? `${e.rouges} machine${e.rouges > 1 ? 's' : ''} à regarder` : 'rien d’alarmant'} · ${evol(e)}${ratio(e) !== null && moyenne !== null ? ` · ${virgule(ratio(e))} visite par panne (ligne : ${virgule(moyenne)})` : ''}`))))
}

// Pourquoi regarder cette machine, en quelques phrases tirées des chiffres : son rang dans son ETH (« la pire » seulement
// si elle l'est), le rang de son ETH dans la ligne, le sens de ses pannes, où elles se concentrent et ce que dit le préventif.
function resumeMachine(equipements, machineId, { machine, colonnes, lignes }) {
  const liste = equipements.map((e) => ({ ...e, preventifs: e.n1 + e.techniciens }))
  const somme = (l, cle) => l.reduce((s, e) => s + e[cle], 0)
  const siens = liste.filter((e) => e.machine.id === machineId)
  if (!siens.length) return null
  const ethDe = (e) => e.eth?.id || ''
  const eth = siens[0].eth
  const memeEth = liste.filter((e) => ethDe(e) === ethDe(siens[0]))
  const total = (l, cle) => [...l.reduce((m, e) => m.set(cle(e), (m.get(cle(e)) || 0) + e.correctifs), new Map()).values()]
  const rang = (valeur, valeurs) => valeurs.filter((v) => v > valeur).length + 1
  const pannes = somme(siens, 'correctifs')
  const avant = somme(siens, 'correctifsAvant')
  const pannesEth = somme(memeEth, 'correctifs')
  const pannesLigne = somme(liste, 'correctifs')
  const nomEth = eth?.code || 'Hors ETH'
  const rangMachine = rang(pannes, total(memeEth, (e) => e.machine.id))
  const rangEth = rang(pannesEth, total(liste, ethDe))
  const nieme = (n) => (n === 1 ? '1re' : `${n}e`)
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
  const qui = rangMachine === 1 ? `la machine la plus en panne de ${nomEth}` : `la ${nieme(rangMachine)} machine la plus en panne de ${nomEth}`
  const quelEth = rangEth === 1 ? `${nomEth} est l’ETH la plus en panne de la ligne` : `${nomEth} est la ${nieme(rangEth)} ETH la plus en panne de la ligne`
  const titre = `${machine.repere} est ${qui} (${pannes} pannes sur ${pannesEth} en 12 mois, ${pct(pannes, pannesEth)} %). ${quelEth} (${pannesEth} sur ${pannesLigne}).`
  const suite = []
  const ecart = avant ? Math.round(((pannes - avant) / avant) * 100) : null
  suite.push(ecart === null ? 'Pas de panne sur les 12 mois d’avant.' : Math.abs(ecart) < 5 ? `Ses pannes sont stables (${avant} sur les 12 mois d’avant).` : `Ses pannes ${ecart > 0 ? 'montent' : 'baissent'} de ${Math.abs(ecart)} % (${avant} sur les 12 mois d’avant).`)
  const heures = Math.round(somme(siens, 'heures'))
  if (heures) suite.push(`Elles ont coûté ${heures} h de dépannage.`)
  const haut = colonnes.filter((c) => c.pannes).slice(0, 3)
  if (haut.length && pannes) suite.push(`Elles se concentrent sur ${haut.map((c) => `${c.repere} (${c.pannes})`).join(', ')}, soit ${pct(somme(haut, 'pannes'), pannes)} %.`)
  const machines = regrouperParMachine(memeEth)
  const z = zone({ correctifs: pannes, correctifsAvant: avant, preventifs: somme(siens, 'preventifs') }, seuilsDe(machines))
  const LECTURE = { violet: 'Beaucoup de pannes malgré beaucoup de visites : le préventif regarde sans doute au mauvais endroit.', rouge: 'Beaucoup de pannes pour peu de visites : pas assez de préventif.', orange: 'Peu de pannes pour beaucoup de visites : trop de préventif ?', vert: 'Beaucoup de visites et des pannes en nette baisse : le préventif marche.' }
  if (LECTURE[z]) suite.push(LECTURE[z])
  const mal = colonnes.filter((c) => c.diagnostic === 'mauvais' || c.diagnostic === 'pas').length
  if (mal) suite.push(`${mal} équipement${mal > 1 ? 's' : ''} sur ${colonnes.length} ${mal > 1 ? 'ont' : 'a'} un préventif absent ou mal ciblé.`)
  const entieres = lignes.filter((g) => g.machineEntiere).length
  if (entieres) suite.push(`${entieres} visite${entieres > 1 ? 's' : ''} sur ${lignes.length} ${entieres > 1 ? 'restent posées' : 'reste posée'} sur la machine entière.`)
  return { titre, suite: suite.join(' ') }
}
const regrouperParMachine = (equipements) => [...equipements.reduce((m, e) => {
  const g = m.get(e.machine.id) || { correctifs: 0, preventifs: 0 }
  g.correctifs += e.correctifs
  g.preventifs += e.preventifs
  return m.set(e.machine.id, g)
}, new Map()).values()]

const virgule1 = (x) => (Math.round(x * 10) / 10).toLocaleString('fr-FR')
// Le nom d'un carré : renommé par l'administrateur, sinon le repère ou la désignation (le dernier morceau du chemin).
function nomCarre(e, a) {
  if (e.type === 'eth' && a.nomsEth[e.id]) return a.nomsEth[e.id]
  if (a.nomCarres !== 'designation' || !e.id) return e.repere
  const d = e.type === 'eth' ? /\((.*)\)$/.exec(e.designation)?.[1] : String(e.designation || '').split('/').pop()
  return d || e.repere
}
// Ce qui s'écrit dans un carré d'ETH : les variables choisies (Hors ETH garde pannes et visites).
function lignesCarre(e, a) {
  const pct = e.correctifsAvant ? Math.round(((e.correctifs - e.correctifsAvant) / e.correctifsAvant) * 100) : null
  const V = {
    pannes: `${e.correctifs} pannes`,
    visites: `${e.preventifs} visites`,
    evolution: pct === null ? null : `pannes ${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)} %`,
    heures: `${Math.round(e.heures)} h`,
    ratio: e.correctifs ? `${virgule1(e.preventifs / e.correctifs)} visite par panne` : null,
  }
  return (e.id ? a.carres : ['pannes', 'visites']).map((k) => V[k]).filter(Boolean).join(' · ')
}

function tableauCases(liste, { niveau, zoomer, ouvrir, affichage: a }) {
  // Peu d'éléments (les ETH) : des tranches adaptées ; beaucoup (les machines) : les tranches fixes.
  const s = seuilsDe(liste)
  const lignesC = avecSeuil(tranchesAdaptees(liste.map((e) => e.correctifs)), s.c).reverse() // beaucoup de pannes en haut
  const colonnesP = avecSeuil(tranchesAdaptees(liste.map((e) => e.preventifs)), s.p)
  const fond = (tc, tp) => (tc.de >= s.c ? (tp.de >= s.p ? 'violet' : 'rouge') : tp.de >= s.p ? 'orange' : 'gris')
  const cases = []
  lignesC.forEach((tc, r) => {
    cases.push(h('div', { class: 'etiquette-ligne-cases' }, tc.libelle))
    colonnesP.forEach((tp) => {
      const dedans = liste.filter((e) => indiceDe(lignesC, e.correctifs) === r && indiceDe(colonnesP, e.preventifs) === colonnesP.indexOf(tp))
      const puceCase = (e) => niveau === 'eth'
        ? h('button', { class: `puce-case puce-eth ${e.rouges ? 'rouge alerte' : e.oranges ? 'orange' : e.zone}`, title: `${e.designation} : ${e.correctifs} pannes, ${e.preventifs} visites, ${e.machines} machines — cliquer pour voir ses machines`, onclick: (ev) => zoomer(e.id, ev.currentTarget) },
          h('b', {}, nomCarre(e, a)), h('small', {}, lignesCarre(e, a)),
          e.id && !a.carres.includes('aRegarder') ? null : e.rouges ? h('span', { class: 'a-regarder-eth' }, `${e.rouges} à regarder`) : e.oranges ? h('span', { class: 'a-alleger-eth' }, `${e.oranges} à alléger ?`) : h('span', { class: 'ok-eth' }, 'rien d’alarmant'))
        : h('button', { class: `puce-case ${e.zone}`, title: `${e.designation || e.repere} : ${e.correctifs} pannes, ${e.preventifs} visites — ouvrir son Démonstrateur`, onclick: (ev) => ouvrir(e.id, ev.currentTarget) }, nomCarre(e, a))
      const montrees = dedans.sort((a, b) => b.correctifs - a.correctifs).slice(0, 4)
      const couleur = dedans.length && dedans.every((e) => e.zone === dedans[0].zone) ? dedans[0].zone : fond(tc, tp)
      cases.push(h('div', { class: `case-tableau ${couleur}${dedans.length ? ' occupee' : ''}${tc.de === s.c ? ' frontiere-c' : ''}${tp.de === s.p ? ' frontiere-p' : ''}`, title: dedans.length > 4 ? dedans.map((e) => `${e.repere} (${e.correctifs} / ${e.preventifs})`).join('\n') : '' },
        montrees.map(puceCase),
        dedans.length > 4 ? h('span', { class: 'reste-case' }, `+${dedans.length - 4}`) : null))
    })
  })
  return h('div', { class: 'tableau-cases-zone' },
    h('div', { class: 'axe-pannes' }, 'pannes (12 mois) ↑'),
    h('div', { class: 'tableau-cases', style: { gridTemplateColumns: `auto repeat(${colonnesP.length}, minmax(0, 1fr))` } },
      cases,
      h('div'), colonnesP.map((tp) => h('div', { class: 'etiquette-colonne-cases' }, tp.libelle))),
    h('div', { class: 'axe-visites' }, 'visites d’observation (12 mois) →'))
}
