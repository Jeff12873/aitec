// Les réglages de la maintenance de niveau 1 (administrateur) :
//   - la GMAO : paramètres des FI (listes lues dans la GMAO, par leur nom), périodicités, SQL du site ;
//   - un parc : son maximum de fiches par semaine et par ETH, et ce qu'il règle autrement que les autres ;
//   - le bandeau du haut : la description et le seuil d'alerte de pertinence.

import { h, vider, ic, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'

const PARAMETRES = [
  ['modele', 'FI modèle (structure copiée)'],
  ['intervenant', 'Intervenant'],
  ['emetteur', 'Émetteur'],
  ['type', 'Type de maintenance'],
  ['utilisateur', 'Utilisateur GMAO'],
]
const FREQUENCES = ['Hebdomadaire', 'Mensuelle', 'Trimestrielle', 'Semestrielle', 'Annuelle']

// Un choix lu dans la GMAO (affiché par son nom, la valeur gardée en coulisse) ; sans liste : une saisie.
function choixGmao(liste, valeur, { vide = null } = {}) {
  if (Array.isArray(liste) && liste.length) {
    const options = [...(vide ? [{ valeur: '', libelle: vide }] : []), ...liste]
    if (valeur && !options.some((o) => o.valeur === String(valeur))) options.push({ valeur: String(valeur), libelle: `${valeur} (absent de la liste)` })
    return h('select', {}, options.map((o) => h('option', { value: o.valeur, selected: String(valeur ?? '') === o.valeur }, o.libelle)))
  }
  return h('input', { type: 'text', value: valeur ?? '', placeholder: vide || '' })
}

// ---------------------------------------------------------------- GMAO

export async function reglerGmao() {
  const [r, listes] = await Promise.all([essayer(() => api('/api/mn1/gmao/reglages')), api('/api/mn1/gmao/listes').catch(() => ({}))])
  if (!r) return
  const onglets = h('div', { class: 'segments', style: { marginBottom: '14px' } })
  const corps = h('div')
  const champs = {}

  // Paramètres des FI : listes de la GMAO (par nom), et valeurs simples.
  const parametres = h('div', {},
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Les valeurs utilisées par défaut pour toutes les FI de niveau 1 (chaque parc peut en régler certaines autrement). Les listes viennent de la GMAO : on choisit un nom, AITEC garde l’identifiant.'),
    h('div', { class: 'grille grille-2', style: { gap: '10px' } },
      PARAMETRES.map(([cle, libelle]) => {
        champs[cle] = choixGmao(listes[cle], r[cle], { vide: Array.isArray(listes[cle]) ? '— à choisir —' : 'valeur attendue par le SQL' })
        return h('label', { class: 'champ' }, h('span', {}, libelle, listes[cle]?.erreur ? h('small', { class: 'rouge' }, ` — liste illisible : ${listes[cle].erreur}`) : ''), champs[cle])
      }),
      [['tpsPrevu', 'Temps prévu (h)', 'number'], ['delai', 'Retard admissible (jours)', 'number'], ['parSemaine', 'Maximum de fiches par semaine et par ETH', 'number'], ['numero', 'Modèle du numéro ({parc} {eth} {eth_fiche} {nnn})'], ['titre', 'Modèle du titre ({machine} {etiquette} {zone} {repere})']]
        .map(([cle, libelle, type]) => {
          champs[cle] = h('input', { type: type || 'text', value: r[cle] ?? '', step: type === 'number' ? 'any' : null })
          return h('label', { class: 'champ' }, h('span', {}, libelle), champs[cle])
        })))

  // Périodicités : les unités de la GMAO, et la périodicité de chaque fréquence de fiche.
  const unites = Object.entries(r.unites || {}).map(([code, u]) => ({ code: h('input', { type: 'text', value: code, style: { width: '70px' } }), nom: h('input', { type: 'text', value: u.nom }), jours: h('input', { type: 'number', step: 'any', value: u.jours, style: { width: '100px' } }) }))
  const tableUnites = h('tbody')
  const dessinerUnites = () => vider(tableUnites, unites.map((u) => h('tr', {}, h('td', {}, u.code), h('td', {}, u.nom), h('td', {}, u.jours))))
  dessinerUnites()
  const frequences = Object.fromEntries(FREQUENCES.map((f) => [f, { periot: h('input', { type: 'text', value: r.frequences?.[f]?.[0] ?? '', style: { width: '70px' } }), val: h('input', { type: 'number', value: r.frequences?.[f]?.[1] ?? '', style: { width: '90px' } }) }]))
  const periodicites = h('div', {},
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Le poids d’une FI dans la charge vient de sa périodicité dans la GMAO (unité × nombre). Une FI qui revient toutes les 4 semaines compte pour ¼ de fiche par semaine.'),
    h('h3', {}, 'Unités de périodicité de la GMAO'),
    h('table', { class: 'tableau compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Nom'), h('th', {}, 'Durée (jours)'))), tableUnites),
    h('button', { class: 'petit', style: { marginTop: '6px' }, onclick: () => { unites.push({ code: h('input', { type: 'text', style: { width: '70px' } }), nom: h('input', { type: 'text' }), jours: h('input', { type: 'number', step: 'any', style: { width: '100px' } }) }); dessinerUnites() } }, ic('plus', 14), 'Une unité'),
    h('h3', {}, 'Périodicité de chaque fréquence de fiche'),
    h('table', { class: 'tableau compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Fréquence préconisée'), h('th', {}, 'Code d’unité'), h('th', {}, 'Nombre'))),
      h('tbody', {}, FREQUENCES.map((f) => h('tr', {}, h('td', {}, f), h('td', {}, frequences[f].periot), h('td', {}, frequences[f].val))))))

  // Le SQL du site : lecture, création, modification, suspension, et les listes.
  const zone = (cle, libelle, aide, lignes = 8) => {
    champs[cle] = h('textarea', { class: 'sql', rows: lignes, spellcheck: false }, r[cle] || '')
    return h('label', { class: 'champ' }, h('span', {}, libelle), h('small', { class: 'aide' }, aide), champs[cle])
  }
  const listesSql = Object.fromEntries(PARAMETRES.map(([cle]) => [cle, h('textarea', { class: 'sql', rows: 2, spellcheck: false }, r.listes?.[cle] || '')]))
  const sql = h('div', {},
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Le SQL du site, rangé dans le fichier de connaissances. Écritures : SELECT, SET, INSERT et UPDATE seulement, toujours simulées avant d’être validées. Paramètres : :numero :titre :obser :parc :date_deb :date_limite :date_jour :heure :modele :intervenant :emetteur :type :tps_prevu :periot :val_periot :delai :utilisateur.'),
    zone('sqlLecture', 'Lecture des FI de niveau 1', 'Colonnes numero, actif, periot, val_periot, equipement (+ titre, date_deb) ; :motif est un LIKE sur le numéro.', 5),
    zone('sql', 'Création d’une FI', 'SELECT de contrôle, SET, INSERT, SELECT de récapitulatif.', 10),
    zone('sqlModification', 'Modification (remplacement de la fiche, réactivation)', 'UPDATE de la FI :numero (titre, description, équipement, périodicité, ACTIF à 1).', 6),
    zone('sqlSuspension', 'Suspension', 'UPDATE de la FI :numero (ACTIF à 0).', 3),
    h('h3', {}, 'Listes de choix (colonnes valeur et libelle)'),
    PARAMETRES.map(([cle, libelle]) => h('label', { class: 'champ' }, h('span', {}, libelle), listesSql[cle])))

  const pages = { parametres: ['Paramètres des FI', parametres], periodicites: ['Périodicités', periodicites], sql: ['SQL du site', sql] }
  const montrer = (cle) => {
    vider(onglets, Object.entries(pages).map(([c, [titre]]) => h('button', { class: c === cle ? 'choisi' : '', onclick: () => montrer(c) }, titre)))
    vider(corps, pages[cle][1])
  }
  montrer('parametres')

  const ok = await fenetre({
    titre: 'Maintenance de niveau 1 : la GMAO',
    large: true,
    contenu: h('div', {}, onglets, corps),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => {
        await api('/api/mn1/gmao/reglages', { methode: 'POST', corps: {
          ...Object.fromEntries(Object.entries(champs).map(([cle, e]) => [cle, e.value])),
          unites: Object.fromEntries(unites.filter((u) => u.code.value.trim() && Number(u.jours.value) > 0).map((u) => [u.code.value.trim(), { nom: u.nom.value, jours: Number(u.jours.value) }])),
          frequences: Object.fromEntries(FREQUENCES.map((f) => [f, [frequences[f].periot.value.trim(), Number(frequences[f].val.value)]])),
          listes: Object.fromEntries(Object.entries(listesSql).map(([cle, e]) => [cle, e.value])),
        } })
        return true
      } },
    ],
  })
  if (ok) {
    notifier('Réglages de la GMAO enregistrés')
    window.ktec.recharger()
  }
}

// ---------------------------------------------------------------- un parc

export async function reglerParc(parc) {
  const [r, listes] = await Promise.all([essayer(() => api(`/api/mn1/parcs/${encodeURIComponent(parc.id)}/reglages`)), api('/api/mn1/gmao/listes').catch(() => ({}))])
  if (!r) return
  const g = r.generaux
  const libelleListe = (cle, v) => (Array.isArray(listes[cle]) ? listes[cle].find((o) => o.valeur === String(v))?.libelle : null) || v || 'non réglé'
  const champs = {
    parSemaine: h('input', { type: 'number', min: 0.25, step: 0.25, value: r.propres.parSemaine ?? '', placeholder: `général : ${g.parSemaine}` }),
    ...Object.fromEntries(PARAMETRES.map(([cle]) => [cle, choixGmao(listes[cle], r.propres[cle], { vide: `— général : ${libelleListe(cle, g[cle])} —` })])),
    tpsPrevu: h('input', { type: 'number', step: 'any', value: r.propres.tpsPrevu ?? '', placeholder: `général : ${g.tpsPrevu}` }),
    delai: h('input', { type: 'number', value: r.propres.delai ?? '', placeholder: `général : ${g.delai}` }),
    numero: h('input', { type: 'text', value: r.propres.numero ?? '', placeholder: `général : ${g.numero}` }),
    titre: h('input', { type: 'text', value: r.propres.titre ?? '', placeholder: `général : ${g.titre}` }),
  }
  const libelles = { parSemaine: 'Maximum de fiches par semaine et par ETH', ...Object.fromEntries(PARAMETRES), tpsPrevu: 'Temps prévu (h)', delai: 'Retard admissible (jours)', numero: 'Modèle du numéro', titre: 'Modèle du titre' }
  const ok = await fenetre({
    titre: `Parc ${parc.nom} : réglages`,
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Laissez vide pour reprendre le réglage général. Baisser le maximum ne suspend aucune FI tout seul : la charge passe en alerte et vous choisissez les FI à suspendre. L’augmenter ne crée aucune FI : il laisse seulement la place d’en créer.'),
      h('div', { class: 'grille grille-2', style: { gap: '10px' } }, Object.entries(champs).map(([cle, e]) => h('label', { class: `champ${cle === 'parSemaine' ? ' large' : ''}` }, h('span', {}, libelles[cle]), e)))),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { await api(`/api/mn1/parcs/${encodeURIComponent(parc.id)}/reglages`, { methode: 'POST', corps: Object.fromEntries(Object.entries(champs).map(([cle, e]) => [cle, e.value])) }); return true } },
    ],
  })
  if (ok) {
    notifier('Réglages du parc enregistrés')
    window.ktec.recharger()
  }
}

// ---------------------------------------------------------------- le bandeau

export async function reglerEntete() {
  const e = await essayer(() => api('/api/mn1/entete'))
  if (!e) return
  const texte = h('textarea', { rows: 6 }, e.description)
  const seuil = h('input', { type: 'number', min: 5, max: 100, step: 5, value: Math.round(e.seuil * 100), style: { width: '100px' } })
  const ok = await fenetre({
    titre: 'Bandeau de la maintenance de niveau 1',
    large: true,
    contenu: h('div', {},
      h('label', { class: 'champ' }, h('span', {}, 'Pourquoi la maintenance de niveau 1 (texte affiché en haut de l’écran)'), texte),
      h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, 'Alerte de pertinence sous (%)'), seuil, h('small', { class: 'aide' }, 'Une vignette passe en alerte quand ses fiches couvrent moins que cette part du Pareto des pannes.'))),
    boutons: [
      { texte: 'Texte d’origine', classe: 'discret', action: () => { texte.value = e.origine; seuil.value = Math.round(e.seuilOrigine * 100); return false } },
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { await api('/api/mn1/entete', { methode: 'POST', corps: { description: texte.value, seuil: Number(seuil.value) / 100 } }); return true } },
    ],
  })
  if (ok) window.ktec.recharger()
}
