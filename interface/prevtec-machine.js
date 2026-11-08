// PREVTEC, étape 3 : le Démonstrateur d'une machine, 3e niveau de zoom de la carte de la ligne (ETH › machines ›
// Démonstrateur), fidèle au classeur de son auteur. En colonnes les équipements de la machine, le plus en panne à
// gauche, noms en biais et cases carrées ; en lignes les visites du plan ; à la croisée, l'endroit où chaque visite
// est posée ; sous chaque colonne, l'un des 4 diagnostics (pas de préventif, mauvais point contrôlé ou énoncé trop
// vague, préventif ok, sur maintenance). Un clic sur une case ouvre « Je décide » pour cette visite et cet équipement.
// Calcul : blocs/mn1/demonstrateur.js.

import { h, ic, dateFr, essayer, fenetre, notifier, confirmer } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { modeAdmin } from '/socle/etat.js'
import { ouvrirFicheVisite } from './fiche-visite.js'
import { LOGO_MN1 } from './fiches-mn1.js'
import { relireFiche } from './mn1-parc.js'
import { choixFormat, lignesDe, pointsAffiches } from './texte-fiche.js'

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

// Le menu du clic droit : [[libellé, action], …], à l'endroit du clic ; il se ferme au clic suivant ou avec Échap.
function menuContextuel(ev, actions) {
  ev.preventDefault()
  document.querySelector('.menu-contextuel')?.remove()
  const menu = h('div', { class: 'menu-contextuel', role: 'menu' }, actions.map(([texte, action]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { fermer(); action() } }, texte)))
  const fermer = () => { menu.remove(); document.removeEventListener('pointerdown', dehors, true); document.removeEventListener('keydown', echap, true) }
  const dehors = (e) => { if (!menu.contains(e.target)) fermer() }
  const echap = (e) => { if (e.key === 'Escape') fermer() }
  document.body.append(menu)
  const r = menu.getBoundingClientRect()
  menu.style.left = `${Math.min(ev.clientX, innerWidth - r.width - 6)}px`
  menu.style.top = `${Math.min(ev.clientY, innerHeight - r.height - 6)}px`
  document.addEventListener('pointerdown', dehors, true)
  document.addEventListener('keydown', echap, true)
}

const FREQUENCES_VISITE = ['Mensuelle', 'Trimestrielle', 'Semestrielle', 'Annuelle']

// Rend { element, machine } : la matrice.
export async function demonstrateurMachine(parcId, machineId, { surChange = () => {} } = {}) {
  const base = `/api/mn1/parcs/${encodeURIComponent(parcId)}/machines/${machineId}`
  let courant = null
  // Le tableau seul est redessiné, la page ne bouge pas ; le défilement des colonnes est gardé.
  const remplacer = (d) => {
    const ancien = courant
    const defile = ancien?.querySelector('.demo-conteneur')?.scrollLeft || 0
    courant = construire(d)
    if (!ancien) return
    ancien.replaceWith(courant)
    const conteneur = courant.querySelector('.demo-conteneur')
    if (conteneur) conteneur.scrollLeft = defile
    surChange(d)
  }
  const actualiser = async () => {
    const d = await essayer(() => api(base))
    if (d) remplacer(d)
  }

  function construire(d) {
    const m = d.machine
    const col = d.colonnes
    const decider = (g, equipement) => (location.hash = `#/mn1/decider/${encodeURIComponent(d.parc.id)}/${m.id}/${equipement}?pose=${g.pose}&titre=${encodeURIComponent(g.titre)}`)
    const infos = (c, enPlus = '') => [c.designation || c.repere, enPlus, `${c.pannes} pannes sur 12 mois · ${c.diagnostic === 'rien' ? 'rien à signaler' : `${SIGNES[c.diagnostic]} ${c.libelle}`}`, c.pannes ? sensDe(c) : '', c.raison].filter(Boolean).join('\n')

    const tete = h('tr', {}, h('th', { class: 'coin-demo' }, 'Visites ↓ · équipements →'),
      h('th', { class: 'col-t', title: 'Taux t : la part des passages sans rien trouver (RAS, OK, conforme…), parmi ceux où le mainteneur a écrit une observation.' }, 't'),
      h('th', { class: 'col-passages', title: 'Passages sur 12 mois' }, 'pass.'),
      h('th', { class: 'col-passages', title: 'Fiches de niveau 1 : les demandes de niveau 1 sur leur machine, 12 mois' }, 'DI'),
      col.map((c) => h('th', { class: `biais ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, title: infos(c) }, h('div', {}, h('span', { class: 'mono' }, c.repere)))),
      h('th', { class: 'biais', title: 'Les visites posées sur la machine entière, pas sur un organe' }, h('div', {}, h('span', { class: 'mono discret' }, 'machine entière'))))
    const lignePannes = h('tr', { class: 'ligne-pannes-demo' }, h('th', {}, 'pannes (12 mois)'), h('td'), h('td'), h('td'),
      col.map((c) => h('td', { class: `carre nb-pannes ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, title: infos(c) }, h('b', {}, String(c.pannes)), c.pannes ? h('small', { class: { monte: 'rouge', nouvelle: 'rouge', baisse: 'vert' }[c.evolution] || '' }, FLECHES[c.evolution] || '') : null)), h('td', { class: 'carre' }))
    const posee = (g, c) => g.equipement === c.id && !g.machineEntiere
    // En mode administrateur : une visite se glisse sur un autre équipement, dans PREVTEC seulement. « Valider le déplacement »
    // (clic droit) simule, puis écrit dans la GMAO après avoir vu ce que cela ferait.
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
      if (ok) { notifier(`FI ${r.numero} déplacée dans la GMAO`); actualiser() }
    }
    let enCours = null
    const deplacable = (g) => modeAdmin() && !g.deplacee
    const aValider = (g) => deplacable(g) && (g.dapresTitre || g.placee)
    // La bulle bouge tout de suite ; les diagnostics suivent quand le serveur a répondu.
    const placer = async (g, c) => {
      const avant = { equipement: g.equipement, machineEntiere: g.machineEntiere, placee: g.placee, dapresTitre: g.dapresTitre }
      if (c) {
        Object.assign(g, { equipement: c.id, machineEntiere: false, placee: true, dapresTitre: false })
        remplacer(d)
      }
      if (await essayer(() => api(`${base}/placer`, { methode: 'POST', corps: { pose: g.pose, titre: g.titre, vers: c ? c.id : null } }))) return actualiser()
      Object.assign(g, avant)
      remplacer(d)
    }
    const sourceGlisser = (g) => (deplacable(g) ? {
      draggable: true,
      ondragstart: (e) => { enCours = g; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.closest('tr').classList.add('en-deplacement') },
      ondragend: (e) => { enCours = null; e.currentTarget.closest('tr').classList.remove('en-deplacement') },
    } : {})
    const cibleGlisser = (g, c) => (deplacable(g) ? {
      ondragover: (e) => { if (enCours === g && !posee(g, c)) { e.preventDefault(); e.currentTarget.classList.add('survolee') } },
      ondragleave: (e) => e.currentTarget.classList.remove('survolee'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('survolee'); if (enCours === g && !posee(g, c)) placer(g, c) },
    } : {})
    const corps = d.lignes.map((g) => h('tr', {},
      h('th', { class: 'titre-visite', title: `${g.titre}${g.dapresTitre ? '\nPosée sur la machine entière : rattachée à cet organe d’après son titre' : ''}` },
        g.code ? h('span', { class: 'etiquette code-visite', title: `${g.code.niveau ? `Niveau ${g.code.niveau} · ` : ''}${g.code.type}` }, g.code.code) : null, g.titre),
      h('td', { class: 'col-t discret', title: g.t === null ? 'Aucune observation écrite sur ces passages' : `${g.rien} sans rien trouver sur ${g.ecrits} passage${g.ecrits > 1 ? 's' : ''} avec une observation (${g.passages} en tout)` }, g.t === null ? '—' : `${Math.round(g.t * 100)} %`),
      h('td', { class: 'col-passages nombre', title: `Dernier passage le ${dateFr(g.derniere)}` }, String(g.passages)),
      h('td', { class: 'col-passages' }),
      col.map((c) => (posee(g, c)
        ? h('td', {
          class: `carre croisee col-clic posee${g.placee ? ' provisoire' : g.dapresTitre ? ' titre' : ''}${deplacable(g) ? ' deplacable' : ''}`,
          ...sourceGlisser(g),
          title: `${infos(c, g.placee ? `Provisoire : « ${g.titre} » déplacée ici dans PREVTEC. Pas active, pas évaluée par l’IA ; à valider au clic droit` : g.dapresTitre ? `○ « ${g.titre} » : posée sur la machine entière, rattachée ici d’après son titre` : `● « ${g.titre} » : visite posée sur cet équipement`)}\nCliquer : je décide${deplacable(g) ? '\nGlisser sur un équipement : la déplacer dans PREVTEC' : ''}`,
          onclick: () => decider(g, c.id),
          oncontextmenu: (e) => menuContextuel(e, [['Je décide', () => decider(g, c.id)], ...(aValider(g) ? [['Valider le déplacement (GMAO)', () => deplacer(g, c)]] : []), ...(g.placee && deplacable(g) ? [['Annuler le déplacement', () => placer(g, null)]] : [])]),
        }, g.placee ? '' : '●')
        // Une case vide ne propose rien : elle sert seulement à recevoir une visite glissée.
        : h('td', { class: 'carre croisee', ...cibleGlisser(g, c) }))),
      g.machineEntiere
        ? h('td', { class: `carre croisee col-clic posee vague${deplacable(g) ? ' deplacable' : ''}`, ...sourceGlisser(g), title: `« ${g.titre} » face à la machine entière\nCliquer : je décide${deplacable(g) ? '\nGlisser sur un équipement : la déplacer dans PREVTEC' : ''}`, onclick: () => decider(g, m.id), oncontextmenu: (e) => menuContextuel(e, [['Je décide', () => decider(g, m.id)]]) }, '●')
        : h('td', { class: 'carre croisee' })))

    // ---- les visites préparées dans PREVTEC : une ligne vide, puis une fiche de l'IA dans la case de l'équipement
    const admin = modeAdmin()
    const entiere = { id: m.id, repere: m.repere, designation: m.designation }
    const recharger = actualiser
    const retirerVisite = async (l) => { if (await confirmer('Retirer cette visite préparée, et ses fiches ? Rien ne change dans la GMAO.', { texte: 'Retirer', danger: true }) && await essayer(() => api(`/api/mn1/locales/${l.id}/retirer`, { methode: 'POST' }))) recharger() }
    const imprimer = (l, c) => ouvrirFicheVisite(base, { pose: c.id, titre: l.titre, locale: l.id })
    const creerFiche = async (l, c) => {
      let b = { titre: l.titre, points: [], frequence: 'Trimestrielle', pourquoi: '' }
      if (d.iaInstallee) {
        notifier(`L’IA lit les pannes de ${c.repere}…`)
        const r = await essayer(() => api(`${base}/locales/proposer`, { methode: 'POST', corps: { equipement: c.id } }))
        if (!r) return
        b = { ...r, titre: l.titre || r.titre }
      }
      const titre = h('input', { type: 'text', value: b.titre })
      const points = h('textarea', { rows: 9 }, b.points.join('\n'))
      const mise = choixFormat(points)
      const frequence = h('select', {}, FREQUENCES_VISITE.map((x) => h('option', { value: x, selected: x === b.frequence }, x)))
      const ok = await fenetre({
        titre: `Nouvelle fiche — ${c.repere}`,
        large: true,
        contenu: h('div', { class: 'grille', style: { gap: '10px' } },
          h('p', { class: 'texte-2', style: { margin: 0 } }, 'Pour le mainteneur, dans PREVTEC seulement : rien n’est écrit dans la GMAO. Relisez et corrigez.'),
          b.pourquoi ? h('p', { class: 'discret', style: { margin: 0 } }, b.pourquoi) : null,
          h('label', { class: 'champ' }, h('span', {}, 'Titre de la visite'), titre),
          h('div', { class: 'champ' }, h('span', { class: 'tete-format' }, 'Points à contrôler (un par ligne)', mise.boutons), points, mise.apercu),
          h('label', { class: 'champ' }, h('span', {}, 'Fréquence proposée'), frequence)),
        boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Enregistrer dans PREVTEC', classe: 'principal', action: async () => { await api(`/api/mn1/locales/${l.id}/fiche`, { methode: 'POST', corps: { equipement: c.id, titre: titre.value, points: lignesDe(points.value), frequence: frequence.value, pourquoi: b.pourquoi, format: mise.format() } }); return true } }],
      })
      if (ok) { notifier('Fiche enregistrée dans PREVTEC'); recharger() }
    }
    const validerFiche = async (l, c) => {
      const adresse = `${base}/locales/${l.id}/valider`
      const r = await essayer(() => api(adresse, { methode: 'POST', corps: { equipement: c.id } }))
      if (!r) return
      if (!r.modifiees) return notifier('La simulation ne créerait rien : vérifiez le SQL de création d’une visite.', 'erreur')
      const ok = await fenetre({
        titre: 'Valider la visite dans la GMAO',
        contenu: h('div', {}, h('p', { style: { marginTop: 0 } }, h('b', {}, r.titre)), h('p', {}, h('span', { class: 'mono' }, r.numero), ' sur ', h('b', { class: 'mono' }, r.repere)), h('p', { class: 'texte-2' }, `Simulation : ${r.modifiees} ligne${r.modifiees > 1 ? 's' : ''} écrite${r.modifiees > 1 ? 's' : ''} dans la GMAO.`)),
        boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Créer la FI dans la GMAO', classe: 'principal', action: async () => { await api(adresse, { methode: 'POST', corps: { equipement: c.id, valider: true } }); return true } }],
      })
      if (ok) { notifier(`FI ${r.numero} créée dans la GMAO`); recharger() }
    }
    const retirerSaFiche = async (l, c) => { if (await essayer(() => api(`/api/mn1/locales/${l.id}/fiche/retirer`, { methode: 'POST', corps: { equipement: c.id } }))) recharger() }
    const voirFiche = (l, c, f) => fenetre({
      titre: `${l.titre || 'Visite préparée'} — ${c.repere}`,
      large: true,
      contenu: h('div', {}, h('p', { class: 'discret', style: { marginTop: 0 } }, `${f.validee ? `Validée dans la GMAO : ${f.validee.numero}` : 'Dans PREVTEC seulement'}${f.frequence ? ` · ${f.frequence}` : ''}`), f.pourquoi ? h('p', { class: 'texte-2' }, f.pourquoi) : null, pointsAffiches(f.points, f.format)),
      boutons: [
        admin && !f.validee ? { texte: 'Retirer la fiche', classe: 'discret', action: async () => { await retirerSaFiche(l, c); return true } } : null,
        { texte: 'Imprimer', classe: 'discret', action: () => { imprimer(l, c); return true } },
        { texte: 'Fermer', classe: 'principal', valeur: true },
      ].filter(Boolean),
    })
    const caseLocale = (l, c) => {
      const f = l.fiches[c.id]
      const menu = f
        ? [['Voir la fiche', () => voirFiche(l, c, f)], ['Imprimer', () => imprimer(l, c)], ...(admin && !f.validee ? [['Valider : créer la FI (GMAO)', () => validerFiche(l, c)], ['Retirer la fiche', () => retirerSaFiche(l, c)]] : [])]
        : admin ? [['Créer la fiche par l’IA', () => creerFiche(l, c)]] : []
      return h('td', {
        class: `carre croisee ${f ? `fiche-locale${f.validee ? ' validee' : ''}` : ''} ${f || admin ? 'col-clic' : ''}`,
        title: f ? `${f.validee ? `Validée dans la GMAO : ${f.validee.numero}` : `Fiche préparée dans PREVTEC pour ${c.repere}, à valider au clic droit`}\nCliquer : la voir` : admin ? `Cliquer : créer une fiche pour ${c.repere}, rédigée par l’IA d’après ses pannes` : '',
        onclick: () => (f ? voirFiche(l, c, f) : admin ? creerFiche(l, c) : null),
        oncontextmenu: (e) => (menu.length || admin ? menuContextuel(e, [...menu, ...(admin && !Object.values(l.fiches).some((x) => x.validee) ? [['Retirer cette visite', () => retirerVisite(l)]] : [])]) : null),
      }, f ? ic('document', 24) : '')
    }
    const lignesLocales = (d.locales || []).map((l) => h('tr', { class: 'ligne-locale' },
      h('th', { class: 'titre-visite', title: l.titre || 'Visite préparée dans PREVTEC' }, h('span', { class: 'etiquette code-visite locale' }, 'PREVTEC'), l.titre || 'Nouvelle visite : cliquez la case de l’équipement concerné'),
      h('td', { class: 'col-t' }), h('td', { class: 'col-passages' }), h('td', { class: 'col-passages' }),
      col.map((c) => caseLocale(l, c)), caseLocale(l, entiere)))
    // ---- les fiches de niveau 1 de la machine, à part
    const nombre = (x) => (Math.round(x * 100) / 100).toLocaleString('fr-FR')
    const placerN1 = async (f, c) => {
      const avant = { equipement: f.equipement, machineEntiere: f.machineEntiere }
      Object.assign(f, { equipement: c.id, machineEntiere: c.id === m.id })
      remplacer(d)
      if (await essayer(() => api('/api/mn1/fiches-n1/placer', { methode: 'POST', corps: { fiche: f.id, vers: c.id } }))) return actualiser()
      Object.assign(f, avant)
      remplacer(d)
    }
    const voirN1 = (f) => fenetre({
      titre: `${f.etiquette || 'Fiche de niveau 1'}${f.nom ? ` — ${f.nom}` : ''}`,
      large: true,
      contenu: h('div', {}, h('p', { class: 'discret', style: { marginTop: 0 } }, `${f.active ? (f.papier ? 'Active, sur papier' : `Active, FI ${f.fi}`) : 'Brouillon : les opérateurs ne la font pas'}${f.frequence ? ` · ${f.frequence}` : ''}`), h('div', { class: 'texte-brut-fiche' }, f.action)),
      boutons: [{ texte: 'Fermer', classe: 'discret', valeur: true }, { texte: 'Ouvrir dans Maintenance de niveau 1', classe: 'principal', action: () => { location.hash = `#/niveau1/${encodeURIComponent(d.parc.id)}`; return true } }],
    })
    // Une nouvelle fiche N1 sur cet équipement : rédigée par l'IA pour sa panne principale, comme dans « Je décide ».
    const creerN1 = async (c) => {
      if (!c.panne) return notifier(`Pas de panne à viser sur ${c.repere}.`, 'erreur')
      notifier('L’IA rédige une fiche pour cette panne…')
      const b = await essayer(() => api(`${base}/fiche`, { methode: 'POST', corps: { panne: c.panne.cle } }))
      if (!b) return
      const POIDS = { Hebdomadaire: 1, Mensuelle: 12 / 52, Trimestrielle: 4 / 52, Semestrielle: 2 / 52, Annuelle: 1 / 52 }
      const depasse = d.charge && d.charge.charge + (POIDS[b.frequence] || 0) > d.charge.max
      if (depasse) notifier(`Attention : cette fiche ferait dépasser la charge de ${d.charge.eth}.`, 'erreur')
      if (await relireFiche(d.parc.id, b, `Fiche N1 — ${c.repere} : ${c.panne.symptome}`, `${depasse ? `Attention : ${d.charge.eth} est à ${d.charge.charge} fiche par semaine pour un maximum de ${d.charge.max}. ` : ''}Rédigée par l’IA. Relisez et corrigez : rien n’est écrit dans la GMAO.`, { machine_id: c.id })) actualiser()
    }
    const caseN1 = (f, c) => {
      const ici = f.equipement === c.id
      if (!ici) return h('td', { class: 'carre croisee', ...(admin ? { oncontextmenu: (e) => menuContextuel(e, [['Créer une fiche N1 ici (IA)', () => creerN1(c)], ['Placer cette fiche ici', () => placerN1(f, c)]]), ondragover: (e) => { if (glisseN1 === f) { e.preventDefault(); e.currentTarget.classList.add('survolee') } }, ondragleave: (e) => e.currentTarget.classList.remove('survolee'), ondrop: (e) => { e.preventDefault(); if (glisseN1 === f) placerN1(f, c) } } : {}) })
      return h('td', {
        class: `carre croisee col-clic fiche-n1${f.active ? '' : ' brouillon'}${admin ? ' deplacable' : ''}`,
        title: `${f.active ? 'Fiche de niveau 1 active' : 'Brouillon de fiche de niveau 1 : ne compte pas dans le diagnostic'}\nCliquer : la voir${admin ? '\nGlisser sur un équipement : la placer' : ''}`,
        onclick: () => voirN1(f),
        oncontextmenu: (e) => menuContextuel(e, [['Voir la fiche', () => voirN1(f)], ['Ouvrir dans Maintenance de niveau 1', () => (location.hash = `#/niveau1/${encodeURIComponent(d.parc.id)}`)]]),
        ...(admin ? { draggable: true, ondragstart: (e) => { glisseN1 = f; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.closest('tr').classList.add('en-deplacement') }, ondragend: (e) => { glisseN1 = null; e.currentTarget.closest('tr').classList.remove('en-deplacement') } } : {}),
      }, h('img', { src: LOGO_MN1, alt: 'N1' }))
    }
    let glisseN1 = null
    const c0 = d.charge
    const teteN1 = (d.fichesN1 || []).length || c0 ? h('tr', { class: 'tete-n1' }, h('th', { class: 'titre-visite' }, h('img', { src: LOGO_MN1, alt: '' }), h('b', {}, 'Maintenance de niveau 1'),
      c0 ? h('span', { class: `charge-n1${c0.charge > c0.max ? ' depasse' : ''}`, title: `Charge des opérateurs de ${c0.eth} : maximum ${nombre(c0.max)} fiche par semaine` }, `${nombre(c0.charge)} / ${nombre(c0.max)} par semaine`) : null), h('td', { colspan: col.length + 4 })) : null
    const lignesN1 = (d.fichesN1 || []).map((f) => h('tr', { class: 'ligne-n1' },
      h('th', { class: 'titre-visite', title: `${f.etiquette || ''} ${f.nomStandard}` }, h('span', { class: `etiquette code-visite${f.active ? '' : ' brouillon'}` }, f.active ? 'N1' : 'brouillon'), f.nomStandard || f.etiquette),
      h('td', { class: 'col-t' }), h('td', { class: 'col-passages' }),
      h('td', { class: 'col-passages nombre', title: 'Demandes de niveau 1 sur la machine de cette fiche, 12 mois' }, f.di === null ? '—' : String(f.di)),
      col.map((c) => caseN1(f, c)), caseN1(f, entiere)))
    // « Nouvelle fiche » : une ligne vide, dont on clique la case de l'équipement concerné, comme pour une nouvelle visite.
    const ligneNouvelleN1 = () => h('tr', { class: 'ligne-n1 a-creer' },
      h('th', { class: 'titre-visite' }, h('span', { class: 'etiquette code-visite' }, 'N1'), 'Nouvelle fiche : cliquez la case de l’équipement concerné'),
      h('td'), h('td'), h('td'),
      [...col, entiere].map((c) => h('td', { class: 'carre croisee col-clic', title: `Créer une fiche N1 pour ${c.repere}, rédigée par l’IA d’après ses pannes`, onclick: () => creerN1(c), oncontextmenu: (e) => menuContextuel(e, [['Créer une fiche N1 ici (IA)', () => creerN1(c)]]) })))
    const ajoutN1 = admin && teteN1 ? h('tr', { class: 'ligne-ajout' }, h('th', { class: 'titre-visite' }, h('button', { class: 'petit', title: 'Une fiche de niveau 1 rédigée par l’IA, sur l’équipement que vous choisissez', onclick: (e) => e.currentTarget.closest('tr').replaceWith(ligneNouvelleN1()) }, ic('plus', 14), 'Nouvelle fiche'))) : null
    const ligneAjout = admin ? h('tr', { class: 'ligne-ajout' }, h('th', { class: 'titre-visite' }, h('button', { class: 'petit', title: 'Une visite préparée dans PREVTEC, sans rien écrire dans la GMAO', onclick: async () => { if (await essayer(() => api(`${base}/locales`, { methode: 'POST' }))) recharger() } }, ic('plus', 14), 'Nouvelle visite'))) : null
    const ligneDiag = h('tr', { class: 'ligne-diagnostics' }, h('th', {}, 'diagnostic'), h('td'), h('td'), h('td'),
      col.map((c) => h('td', { class: `carre diag-demo ${COULEURS_DIAGNOSTIC[c.diagnostic]}`, title: infos(c) }, SIGNES[c.diagnostic])), h('td', { class: 'carre' }))
    const element = h('div', { class: 'demonstrateur' },
      h('p', { class: 'discret petit-texte', style: { margin: '6px 0' } }, `${col.length} équipement${col.length > 1 ? 's' : ''} · ${d.lignes.length} visite${d.lignes.length > 1 ? 's' : ''} · 12 mois. Cliquez un ● ou un ○ pour décider de cette visite sur cet équipement.`),
      col.length || d.lignes.length ? h('div', { class: 'tableau-conteneur demo-conteneur' }, h('table', { class: 'matrice-demo' }, h('thead', {}, tete, lignePannes), h('tbody', {}, corps, lignesLocales, ligneAjout, teteN1, lignesN1, ajoutN1), h('tfoot', {}, ligneDiag)))
        : h('p', { class: 'discret' }, 'Ni panne ni visite sur cette machine ces 12 mois.'),
      h('div', { class: 'legende-demo' },
        ['pas', 'mauvais', 'ok', 'sur'].map((k) => h('span', { class: 'cle-demo' }, h('span', { class: `carre-legende diag-demo ${COULEURS_DIAGNOSTIC[k]}` }, SIGNES[k]), LIBELLES[k])),
        h('span', { class: 'cle-demo discret' }, h('span', { class: 'carre-legende fiche-locale' }, ic('document', 13)), 'fiche préparée dans PREVTEC, pas encore dans la GMAO'),
        h('span', { class: 'cle-demo discret' }, h('span', { class: 'carre-legende fiche-n1' }, h('img', { src: LOGO_MN1, alt: '' })), 'fiche de niveau 1 (pâle : brouillon)'),
        h('span', { class: 'cle-demo discret' }, h('span', { class: 'carre-legende provisoire' }), 'déplacement provisoire : pas actif, pas évalué par l’IA'),
        h('span', { class: 'discret' }, 'Clic droit sur une case : ses actions · ● visite posée sur l’équipement · ○ d’après son titre · t : part des passages sans rien trouver, parmi ceux avec une observation écrite')))
    element.querySelectorAll('td.posee.titre').forEach((td) => (td.textContent = '○'))
    return element
  }

  const d = await api(base)
  remplacer(d)
  return { element: courant, machine: d.machine, colonnes: d.colonnes, lignes: d.lignes }
}
