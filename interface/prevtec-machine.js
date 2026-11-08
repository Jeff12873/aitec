// PREVTEC, étape 3 : le Démonstrateur d'une machine, 3e niveau de zoom de la carte de la ligne (ETH › machines ›
// Démonstrateur), fidèle au classeur de son auteur. En colonnes les équipements de la machine, le plus en panne à
// gauche, noms en biais et cases carrées ; en lignes les visites du plan ; à la croisée, l'endroit où chaque visite
// est posée ; sous chaque colonne, l'un des 4 diagnostics (pas de préventif, mauvais point contrôlé ou énoncé trop
// vague, préventif ok, sur maintenance). Un clic sur une case ouvre « Je décide » pour cette visite et cet équipement.
// Calcul : blocs/mn1/demonstrateur.js.

import { h, dateFr, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { modeAdmin } from '/socle/etat.js'

const COULEURS_DIAGNOSTIC = { pas: 'rouge', mauvais: 'violet', ok: 'vert', sur: 'orange', rien: '' }
const SIGNES = { pas: '!', mauvais: '?', ok: '✓', sur: '+', rien: '' }
const LIBELLES = { pas: 'pas de préventif', mauvais: 'mauvais point contrôlé ou énoncé trop vague', ok: 'préventif ok', sur: 'sur maintenance' }
const FLECHES = { monte: '↑', baisse: '↓', stable: '=', nouvelle: '✦' }
const sensDe = (c) => ({
  monte: `↑ en hausse : ${c.precedent} les 12 mois d’avant`,
  baisse: `↓ en baisse : ${c.precedent} les 12 mois d’avant`,
  stable: `= stable : ${c.precedent} les 12 mois d’avant`,
  nouvelle: '✦ nouvelle : aucune panne les 12 mois d’avant',
}[c.evolution] || '')

// Rend { element, machine } : la matrice.
export async function demonstrateurMachine(parcId, machineId) {
  const base = `/api/mn1/parcs/${encodeURIComponent(parcId)}/machines/${machineId}`
  const d = await api(base)
  const m = d.machine
  const col = d.colonnes
  const decider = (g, equipement) => (location.hash = `#/mn1/decider/${encodeURIComponent(d.parc.id)}/${m.id}/${equipement}?pose=${g.pose}&titre=${encodeURIComponent(g.titre)}`)
  const infos = (c, enPlus = '') => [c.designation || c.repere, enPlus, `${c.pannes} pannes sur 12 mois · ${c.diagnostic === 'rien' ? 'rien à signaler' : `${SIGNES[c.diagnostic]} ${c.libelle}`}`, c.pannes ? sensDe(c) : '', c.raison].filter(Boolean).join('\n')

  const tete = h('tr', {}, h('th', { class: 'coin-demo' }, 'Visites ↓ · équipements →'),
    h('th', { class: 'col-t', title: 'Taux t : la part des passages sans rien trouver (RAS, OK, conforme…), parmi ceux où le mainteneur a écrit une observation.' }, 't'),
    h('th', { class: 'col-passages', title: 'Passages sur 12 mois' }, 'pass.'),
    col.map((c) => h('th', { class: `biais ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, title: infos(c) }, h('div', {}, h('span', { class: 'mono' }, c.repere)))),
    h('th', { class: 'biais', title: 'Les visites posées sur la machine entière, pas sur un organe' }, h('div', {}, h('span', { class: 'mono discret' }, 'machine entière'))))
  const lignePannes = h('tr', { class: 'ligne-pannes-demo' }, h('th', {}, 'pannes (12 mois)'), h('td'), h('td'),
    col.map((c) => h('td', { class: `carre nb-pannes ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, title: infos(c) }, h('b', {}, String(c.pannes)), c.pannes ? h('small', { class: { monte: 'rouge', nouvelle: 'rouge', baisse: 'vert' }[c.evolution] || '' }, FLECHES[c.evolution] || '') : null)), h('td', { class: 'carre' }))
  const posee = (g, c) => g.equipement === c.id && !g.machineEntiere
  // En mode administrateur : une visite posée sur la machine entière dans la GMAO se glisse sur un organe. La simulation
  // part au lâcher ; on écrit après avoir vu ce qu'elle ferait.
  const deplacer = async (g, c) => {
    const corps = { pose: g.pose, titre: g.titre, vers: c.id }
    const r = await essayer(() => api(`${base}/deplacer`, { methode: 'POST', corps }))
    if (!r) return
    if (!r.modifiees) return notifier(`La simulation ne modifierait rien pour ${r.numero} : vérifiez le SQL de déplacement.`, 'erreur')
    const ok = await fenetre({
      titre: `Déplacer la FI ${r.numero}`,
      contenu: h('div', {},
        h('p', { style: { marginTop: 0 } }, h('b', {}, g.titre)),
        h('p', {}, h('span', { class: 'mono' }, r.de), ' → ', h('b', { class: 'mono' }, r.vers)),
        h('p', { class: r.modifiees > 1 ? 'etiquette orange' : 'texte-2' }, `Simulation : ${r.modifiees} ligne${r.modifiees > 1 ? 's' : ''} modifiée${r.modifiees > 1 ? 's' : ''} dans la GMAO.`),
        h('p', { class: 'discret petit-texte' }, 'Seuls les prochains passages seront sur cet organe ; les rapports déjà faits restent sur la machine entière.')),
      boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Appliquer dans la GMAO', classe: 'principal', action: async () => { await api(`${base}/deplacer`, { methode: 'POST', corps: { ...corps, valider: true } }); return true } }],
    })
    if (ok) { notifier(`FI ${r.numero} déplacée dans la GMAO`); window.ktec.recharger() }
  }
  let enCours = null
  const deplacable = (g) => modeAdmin() && g.pose === m.id && !g.deplacee
  const sourceGlisser = (g) => (deplacable(g) ? {
    draggable: true,
    ondragstart: (e) => { enCours = g; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.closest('tr').classList.add('en-deplacement') },
    ondragend: (e) => { enCours = null; e.currentTarget.closest('tr').classList.remove('en-deplacement') },
  } : {})
  const cibleGlisser = (g, c) => (deplacable(g) ? {
    ondragover: (e) => { if (enCours === g && !posee(g, c)) { e.preventDefault(); e.currentTarget.classList.add('survolee') } },
    ondragleave: (e) => e.currentTarget.classList.remove('survolee'),
    ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('survolee'); if (enCours === g && !posee(g, c)) deplacer(g, c) },
  } : {})
  const corps = d.lignes.map((g) => h('tr', {},
    h('th', { class: 'titre-visite', title: `${g.titre}${g.dapresTitre ? '\nPosée sur la machine entière : rattachée à cet organe d’après son titre' : ''}` },
      g.code ? h('span', { class: 'etiquette code-visite', title: `${g.code.niveau ? `Niveau ${g.code.niveau} · ` : ''}${g.code.type}` }, g.code.code) : null, g.titre),
    h('td', { class: 'col-t discret', title: g.t === null ? 'Aucune observation écrite sur ces passages' : `${g.rien} sans rien trouver sur ${g.ecrits} passage${g.ecrits > 1 ? 's' : ''} avec une observation (${g.passages} en tout)` }, g.t === null ? '—' : `${Math.round(g.t * 100)} %`),
    h('td', { class: 'col-passages nombre', title: `Dernier passage le ${dateFr(g.derniere)}` }, String(g.passages)),
    col.map((c) => h('td', { class: `carre croisee col-clic ${posee(g, c) ? `posee${g.dapresTitre ? ' titre' : ''}` : ''}${deplacable(g) && posee(g, c) ? ' deplacable' : ''}`, ...(posee(g, c) ? sourceGlisser(g) : cibleGlisser(g, c)), title: `${infos(c, posee(g, c) ? (g.dapresTitre ? `○ « ${g.titre} » : posée sur la machine entière, rattachée ici d’après son titre` : `● « ${g.titre} » : visite posée sur cet équipement`) : `« ${g.titre} » : pas posée sur cet équipement`)}\nCliquer : je décide${deplacable(g) && posee(g, c) ? '\nGlisser sur un organe : déplacer cette visite dans la GMAO' : ''}`, onclick: () => decider(g, c.id) }, posee(g, c) ? '●' : '')),
    h('td', { class: `carre croisee col-clic ${g.machineEntiere ? 'posee vague' : ''}${deplacable(g) && g.machineEntiere ? ' deplacable' : ''}`, ...(g.machineEntiere ? sourceGlisser(g) : {}), title: `« ${g.titre} » face à la machine entière\nCliquer : je décide${deplacable(g) && g.machineEntiere ? '\nGlisser sur un organe : déplacer cette visite dans la GMAO' : ''}`, onclick: () => decider(g, m.id) }, g.machineEntiere ? '●' : '')))
  const ligneDiag = h('tr', { class: 'ligne-diagnostics' }, h('th', {}, 'diagnostic'), h('td'), h('td'),
    col.map((c) => h('td', { class: `carre diag-demo ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, title: infos(c) }, SIGNES[c.diagnostic])), h('td', { class: 'carre' }))
  const element = h('div', { class: 'demonstrateur' },
    h('p', { class: 'discret petit-texte', style: { margin: '6px 0' } }, `${col.length} équipement${col.length > 1 ? 's' : ''} · ${d.lignes.length} visite${d.lignes.length > 1 ? 's' : ''} · 12 mois. Cliquez une case pour décider de cette visite sur cet équipement.`),
    col.length || d.lignes.length ? h('div', { class: 'tableau-conteneur demo-conteneur' }, h('table', { class: 'matrice-demo' }, h('thead', {}, tete, lignePannes), h('tbody', {}, corps), h('tfoot', {}, ligneDiag)))
      : h('p', { class: 'discret' }, 'Ni panne ni visite sur cette machine ces 12 mois.'),
    h('div', { class: 'legende-demo' },
      ['pas', 'mauvais', 'ok', 'sur'].map((k) => h('span', { class: 'cle-demo' }, h('span', { class: `carre-legende diag-demo ${COULEURS_DIAGNOSTIC[k]}` }, SIGNES[k]), LIBELLES[k])),
      h('span', { class: 'discret' }, '● visite posée sur l’équipement · ○ d’après son titre · t : part des passages sans rien trouver, parmi ceux avec une observation écrite')))
  element.querySelectorAll('td.posee.titre').forEach((td) => (td.textContent = '○'))
  return { element, machine: m }
}
