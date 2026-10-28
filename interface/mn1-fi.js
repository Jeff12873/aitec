// Les FI de niveau 1 dans la GMAO, depuis la fiche d'un parc (administrateur) :
//   - mettre une fiche dans une FI : nouvelle FI, réactivation d'une FI suspendue, ou remplacement de la fiche
//     d'une FI active (les autres FI cochées sont suspendues) ; la charge de l'ETH est recalculée en direct et
//     « Simuler » n'est possible que sous le maximum ; « Créer » seulement après une simulation réussie ;
//   - suspendre des FI quand le maximum a baissé.
// Les FI proposées au remplacement sont rangées de la moins utile à la plus utile : sans cible d'abord, puis
// celles dont la fiche vise le moins de cas du Pareto.

import { h, vider, ic, essayer, confirmer, fenetre, notifier, tableau } from '/socle/ui.js'
import { api } from '/socle/api.js'

const arrondi = (n) => (n === null || n === undefined ? '?' : (Math.round(n * 100) / 100).toLocaleString('fr-FR'))

// L'utilité d'une fiche : le nombre de cas du Pareto qu'elle vise (dernière analyse), 0 sans cible.
export function utilites(detail) {
  const u = new Map()
  for (const x of detail.analyse?.pareto || []) {
    const cas = detail.pareto.find((p) => p.code === x.code)?.nombre || 0
    for (const id of x.fiches) u.set(id, (u.get(id) || 0) + cas)
  }
  return u
}

function prochainLundi() {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// La jauge de charge d'un ETH : avant → après, sur le maximum.
function jaugeCharge(avant, apres, max) {
  const pct = (x) => `${Math.min(100, (x / max) * 100)}%`
  return h('div', { class: `jauge-eth${apres > max + 1e-9 ? ' depassee' : ''}` },
    h('div', { class: 'jauge-eth-barre' }, h('i', { class: 'avant', style: { width: pct(avant) } }), h('i', { class: 'apres', style: { width: pct(apres) } })),
    h('span', {}, `${arrondi(avant)} → `, h('b', {}, arrondi(apres)), ` / ${arrondi(max)} fiche${max > 1 ? 's' : ''} par semaine`))
}

// ---------------------------------------------------------------- mettre une fiche dans une FI

export async function dialogueFi(fiche, detail) {
  const equipements = await essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(detail.parc.id)}/equipements`))
  if (!equipements) return
  const u = utilites(detail)
  // L'équipement : celui de la fiche, sinon celui dont le nom ressemble à sa machine.
  const nom = String(fiche.machine_nom || fiche.designation || '').toLowerCase()
  const devine = fiche.noeud || equipements.find((e) => nom && (String(e.designation).toLowerCase().includes(nom) || nom.includes(String(e.designation).toLowerCase()) && e.designation))?.noeud || ''
  const parEth = new Map()
  for (const e of equipements) (parEth.get(e.ethLibelle) || parEth.set(e.ethLibelle, []).get(e.ethLibelle)).push(e)
  const equipement = h('select', {}, h('option', { value: '' }, '— équipement de production —'),
    [...parEth].map(([eth, liste]) => h('optgroup', { label: eth }, liste.map((e) => h('option', { value: e.noeud, selected: e.noeud === devine }, `${'· '.repeat(Math.max(0, e.niveau - 2))}${e.code}${e.designation ? ` — ${e.designation}` : ''}`)))))
  const date = h('input', { type: 'date', value: prochainLundi() })
  const zonePlan = h('div', { class: 'plan-fi' })
  const resultat = h('div', { class: 'resultat-gmao' })
  const boutonSimuler = h('button', { disabled: true }, ic('rafraichir', 15), 'Simuler')
  const boutonCreer = h('button', { class: 'principal', disabled: true }, ic('base', 15), 'Écrire dans la GMAO')
  let cible = '' // nouvelle | remplacer | reactiver:NUMÉRO
  const cochees = new Set()
  let plan = null
  let simulee = null

  const demande = () => {
    const reactiver = cible.startsWith('reactiver:')
    return { parc: detail.parc.id, fiche: fiche.id, noeud: equipement.value, dateDeb: date.value, cible: reactiver ? 'reactiver' : cible || 'nouvelle', numero: reactiver ? cible.slice(10) : '', remplacer: cible === 'remplacer' ? [...cochees] : [] }
  }
  const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  async function recalculer() {
    simulee = null
    boutonCreer.disabled = true
    vider(resultat)
    if (!equipement.value) { vider(zonePlan, h('p', { class: 'discret' }, 'Choisissez l’équipement de production : il dit dans quel ETH compte la FI.')); boutonSimuler.disabled = true; return }
    try {
      plan = await api('/api/mn1/fi/plan', { methode: 'POST', corps: demande() })
    } catch (e) {
      vider(zonePlan, h('div', { class: 'bandeau' }, ic('alerte'), e.message))
      boutonSimuler.disabled = true
      return
    }
    // Premier calcul : réactiver une FI suspendue s'il y en a, sinon une nouvelle, sinon remplacer.
    if (!cible) {
      cible = plan.suspendues.length ? `reactiver:${plan.suspendues[0].numero}` : 'nouvelle'
      if (cible === 'nouvelle' && !plan.respecte && plan.actives.length) cible = 'remplacer'
      if (cible !== 'nouvelle') return recalculer()
    }
    dessinerPlan()
  }

  function dessinerPlan() {
    const choix = (valeur, libelle, detailChoix, actif = true) => h('label', { class: `choix-fi${cible === valeur ? ' choisi' : ''}${actif ? '' : ' grise'}` },
      h('input', { type: 'radio', name: 'cible-fi', checked: cible === valeur, disabled: !actif, onchange: () => { cible = valeur; if (valeur !== 'remplacer') cochees.clear(); recalculer() } }),
      h('div', {}, h('b', {}, libelle), detailChoix ? h('div', { class: 'discret' }, detailChoix) : null))
    const actives = [...plan.actives].sort((a, b) => (u.get(a.fiche?.id) || 0) - (u.get(b.fiche?.id) || 0) || (b.poids || 0) - (a.poids || 0))
    vider(zonePlan,
      h('div', { class: 'tete-plan' }, h('div', {}, h('b', {}, plan.eth.libelle), h('span', { class: 'discret' }, ` · cette fiche pèse ${arrondi(plan.poids)} fiche par semaine (${fiche.frequence})`)), jaugeCharge(plan.eth.charge, plan.apres, plan.eth.max)),
      h('div', { class: 'choix-cible' },
        choix('nouvelle', cible === 'nouvelle' ? `Nouvelle FI ${plan.numero}` : 'Nouvelle FI', 'premier numéro jamais utilisé dans cet ETH'),
        plan.suspendues.length ? h('div', { class: 'choix-fi-groupe' }, plan.suspendues.map((s) => choix(`reactiver:${s.numero}`, `Réactiver ${s.numero}`, 'FI suspendue : elle repart avec cette fiche'))) : null,
        plan.actives.length ? choix('remplacer', 'Remplacer la fiche d’une FI active', 'la 1re FI cochée reçoit cette fiche (son historique reste) ; les autres cochées sont suspendues') : null),
      cible === 'remplacer' ? h('div', { class: 'liste-remplacer' }, actives.map((a) => {
        const utilite = u.get(a.fiche?.id)
        return h('label', { class: `remplacer-fi${cochees.has(a.numero) ? ' coche' : ''}` },
          h('input', { type: 'checkbox', checked: cochees.has(a.numero), onchange: (e) => { if (e.target.checked) cochees.add(a.numero); else cochees.delete(a.numero); recalculer() } }),
          h('span', { class: 'mono' }, a.numero),
          h('span', { class: 'texte-2' }, a.fiche ? [a.fiche.etiquette, a.fiche.machine, a.fiche.zone].filter(Boolean).join(' · ') : 'fiche inconnue (FI faite à la main)'),
          h('span', { class: 'discret' }, `${arrondi(a.poids)} / sem.`),
          h('span', { class: `etiquette ${utilite ? '' : 'orange'}` }, utilite ? `vise ${utilite} cas` : detail.analyse ? 'sans cible' : 'non analysée'))
      })) : null,
      plan.respecte ? null : h('div', { class: 'bandeau', style: { marginTop: '10px' } }, ic('alerte'), `Au-dessus du maximum : ${cible === 'remplacer' ? 'cochez d’autres FI à libérer' : 'remplacez une FI active, ou augmentez le maximum du parc'}.`))
    boutonSimuler.disabled = !plan.respecte
  }

  const montrer = (r, ecrit) => {
    const c = r.controles || {}
    vider(resultat,
      h('h3', {}, ecrit ? (r.ok ? 'Écrit dans la GMAO' : 'Rien n’a été écrit') : (r.ok ? 'Simulation réussie : rien n’a été écrit' : 'La simulation n’écrirait rien')),
      h('ul', { class: 'bilan-plan' },
        h('li', {}, { nouvelle: `Création de ${r.plan.numero}`, reactiver: `Réactivation de ${r.plan.numero}`, remplacer: `Remplacement de la fiche de ${r.plan.numero}` }[r.plan.cible], ` sur ${r.plan.equipement.code} (périodicité ${r.valeurs.periot} × ${r.valeurs.val_periot})`),
        r.plan.suspensions.length ? h('li', {}, `Suspension de ${r.plan.suspensions.join(', ')}`) : null,
        h('li', {}, `Lignes écrites : ${r.ecritures.map((e) => `${e.lignes}`).join(' + ') || '0'}`)),
      Object.keys(c).length ? h('div', { class: 'controles-gmao' }, Object.entries(c).map(([k, v]) => h('div', { class: `controle-gmao ${v === null || v === '' || (k === 'numero_deja_pris' && Number(v)) ? 'ko' : 'ok'}` }, h('span', {}, k), h('b', {}, String(v ?? '—'))))) : null,
      r.recapitulatif?.length ? tableau({ lignes: r.recapitulatif, colonnes: Object.keys(r.recapitulatif[0]).map((k) => ({ titre: k, valeur: (l) => l[k] ?? '' })) }) : null)
  }

  boutonSimuler.onclick = async () => {
    vider(resultat, h('p', { class: 'discret curseur' }, 'Simulation dans une transaction annulée'))
    const d = demande()
    const r = await essayer(() => api('/api/mn1/fi/executer', { methode: 'POST', corps: d }))
    if (!r) return vider(resultat)
    montrer(r, false)
    simulee = r.ok ? d : null
    boutonCreer.disabled = !simulee
  }
  boutonCreer.onclick = async () => {
    const d = demande()
    if (!simulee || !memes(simulee, d)) return
    const texte = { nouvelle: `Créer la FI ${plan.numero}`, reactiver: `Réactiver la FI ${plan.numero}`, remplacer: `Remplacer la fiche de la FI ${plan.numero}` }[plan.cible]
    if (!(await confirmer(`${texte}${plan.suspensions.length ? ` et suspendre ${plan.suspensions.join(', ')}` : ''} dans la base de la GMAO ? Ce sera réellement écrit.`, { texte: 'Écrire' }))) return
    const r = await essayer(() => api('/api/mn1/fi/executer', { methode: 'POST', corps: { ...d, valider: true } }))
    if (!r) return
    montrer(r, true)
    boutonCreer.disabled = true
    boutonSimuler.disabled = true
    if (r.ok) notifier(`${texte} : fait`)
  }
  equipement.onchange = () => { cible = ''; cochees.clear(); recalculer() }
  date.oninput = () => { simulee = null; boutonCreer.disabled = true }
  recalculer()
  const fermee = await fenetre({
    titre: `FI de niveau 1 — ${[fiche.etiquette, fiche.machine_nom || fiche.repere].filter(Boolean).join(' · ')}`,
    large: true,
    contenu: h('div', { class: 'creation-gmao' },
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Équipement de production'), equipement),
        h('label', { class: 'champ' }, h('span', {}, 'Première échéance'), date)),
      zonePlan,
      h('div', { class: 'actions', style: { marginTop: '12px' } }, boutonSimuler, boutonCreer),
      resultat),
    boutons: [{ texte: 'Fermer', classe: 'discret', valeur: true }],
  })
  if (fermee !== undefined) window.ktec.recharger()
}

// ---------------------------------------------------------------- suspendre des FI (maximum baissé)

export async function dialogueSuspension(detail, eth) {
  const u = utilites(detail)
  const actives = eth.fi.filter((x) => x.actif).sort((a, b) => (u.get(a.fiche?.id) || 0) - (u.get(b.fiche?.id) || 0) || (b.rang || 0) - (a.rang || 0))
  const cochees = new Set()
  const zone = h('div')
  const resultat = h('div', { class: 'resultat-gmao' })
  const boutonSimuler = h('button', {}, ic('rafraichir', 15), 'Simuler')
  const boutonSuspendre = h('button', { class: 'principal', disabled: true }, ic('stop', 15), 'Suspendre dans la GMAO')
  let simulee = null
  const apres = () => eth.charge - actives.filter((a) => cochees.has(a.numero)).reduce((s, a) => s + (a.poids || 0), 0)
  function dessiner() {
    simulee = null
    boutonSuspendre.disabled = true
    boutonSimuler.disabled = !cochees.size || apres() > eth.max + 1e-9
    vider(zone,
      jaugeCharge(eth.charge, apres(), eth.max),
      h('div', { class: 'liste-remplacer' }, actives.map((a) => h('label', { class: `remplacer-fi${cochees.has(a.numero) ? ' coche' : ''}` },
        h('input', { type: 'checkbox', checked: cochees.has(a.numero), onchange: (e) => { if (e.target.checked) cochees.add(a.numero); else cochees.delete(a.numero); dessiner() } }),
        h('span', { class: 'mono' }, a.numero),
        h('span', { class: 'texte-2' }, a.fiche ? [a.fiche.etiquette, a.fiche.machine_nom, a.fiche.zone].filter(Boolean).join(' · ') : 'fiche inconnue'),
        h('span', { class: 'discret' }, `${arrondi(a.poids)} / sem.`),
        h('span', { class: `etiquette ${u.get(a.fiche?.id) ? '' : 'orange'}` }, u.get(a.fiche?.id) ? `vise ${u.get(a.fiche.id)} cas` : detail.analyse ? 'sans cible' : 'non analysée')))))
  }
  boutonSimuler.onclick = async () => {
    const corps = { parc: detail.parc.id, numeros: [...cochees] }
    const r = await essayer(() => api('/api/mn1/fi/suspendre', { methode: 'POST', corps }))
    if (!r) return
    vider(resultat, h('p', {}, r.suspendues ? `Simulation réussie : ${r.suspendues} FI seraient suspendues (rien n’a été écrit).` : 'La simulation ne suspendrait rien : vérifiez le SQL de suspension.'))
    simulee = r.suspendues ? JSON.stringify(corps) : null
    boutonSuspendre.disabled = !simulee
  }
  boutonSuspendre.onclick = async () => {
    const corps = { parc: detail.parc.id, numeros: [...cochees] }
    if (simulee !== JSON.stringify(corps)) return
    if (!(await confirmer(`Suspendre ${corps.numeros.join(', ')} dans la GMAO ? Leurs fiches passent aux archives.`, { texte: 'Suspendre', danger: true }))) return
    const r = await essayer(() => api('/api/mn1/fi/suspendre', { methode: 'POST', corps: { ...corps, valider: true } }))
    if (!r) return
    vider(resultat, h('p', {}, `${r.suspendues} FI suspendues.`))
    boutonSuspendre.disabled = true
    notifier('FI suspendues')
  }
  dessiner()
  await fenetre({
    titre: `${eth.libelle} : FI à suspendre`,
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'La charge de cet ETH dépasse le maximum du parc. Cochez les FI à suspendre (les moins utiles d’abord) jusqu’à repasser sous le maximum. Les numéros ne changent pas ; une FI suspendue pourra être réactivée.'),
      zone, h('div', { class: 'actions', style: { marginTop: '12px' } }, boutonSimuler, boutonSuspendre), resultat),
    boutons: [{ texte: 'Fermer', classe: 'discret', valeur: true }],
  })
  window.ktec.recharger()
}
