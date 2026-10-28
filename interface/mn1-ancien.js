// L'ancien mode de la maintenance de niveau 1 (avant les parcs) : fiches par ligne › ETH › machine, une FI par
// machine, charge par secteur, fiches à imprimer par fréquence. Gardé le temps que le nouveau mode fasse ses
// preuves (bouton « Ancien mode » du menu), puis à retirer.

import { h, vider, ic, essayer, confirmer, fenetre, notifier, tableau } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier } from '/socle/etat.js'
import { LOGO_MN1, FREQUENCES, carteFiche, carteCharge, definirParametres, imprimerFiches, nomMachine } from './fiches-mn1.js'
import { corrigerFiche } from './mn1-parc.js'

const filtres = { texte: '', frequence: '' }

// ---------------------------------------------------------------- fiches

export async function afficherFiches(zone) {
  const fiches = await api('/api/mn1/fiches')
  const barreImport = peutModifier() ? boutonImport() : null
  if (!fiches.length) {
    return vider(zone, barreImport, h('div', { class: 'carte vide' }, h('img', { src: LOGO_MN1, alt: '', style: { width: '56px', opacity: 0.8 } }),
      h('p', {}, 'Pas encore de fiche. Importez un classeur de fiches de contrôle, ou gardez des gestes depuis la fiche d’analyse d’une machine (« Analyse », puis « Garder dans les fiches MN1 »).')))
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
      && mots.every((m) => [f.action, f.evite, f.repere, f.designation, f.machine_nom, f.zone, f.etiquette, f.eth, f.ligne].join(' ').toLowerCase().includes(m)))
    // Ligne › ETH › machine ; « Imprimer » imprime tout le groupe.
    const groupes = new Map()
    for (const f of visibles) {
      const cle = [f.ligne || 'Sans ligne', f.eth, f.repere || f.machine_nom].filter(Boolean).join(' › ')
      ;(groupes.get(cle) || groupes.set(cle, []).get(cle)).push(f)
    }
    // Le rang de chaque machine dans sa ligne et son ETH (le « NN » du numéro de FI proposé).
    const rangs = new Map()
    const vus = new Map()
    for (const [titre, groupe] of groupes) {
      const cle = `${groupe[0].ligne}\u0001${groupe[0].eth}`
      vus.set(cle, (vus.get(cle) || 0) + 1)
      rangs.set(titre, vus.get(cle))
    }
    vider(liste, visibles.length ? [...groupes].map(([titre, groupe]) => h('section', { class: 'groupe-fiches-mn1' },
      h('div', { class: 'tete-groupe-mn1' },
        h('h2', {}, titre, h('span', { class: 'discret' }, ` · ${groupe.length} fiche${groupe.length > 1 ? 's' : ''}`)),
        etatGmao(groupe, rangs.get(titre)),
        h('button', { class: 'petit', title: 'Imprimer toutes les fiches de ce groupe', onclick: () => imprimerFiches(groupe) }, ic('document', 14), groupe.length > 1 ? `Imprimer les ${groupe.length}` : 'Imprimer')),
      h('div', { class: 'fiches-mn1' }, groupe.map((f) => carteFiche(f, { enPlus: actionsFiche(f) }))))) : h('p', { class: 'discret' }, 'Aucune fiche ne correspond aux filtres.'))
  }
  recherche.addEventListener('input', () => { filtres.texte = recherche.value; dessiner() })
  vider(zone, barreImport, carteCharge(fiches), zoneFiltres, liste)
  dessiner()
}

function actionsFiche(f) {
  return h('div', { class: 'actions-fiche-mn1' },
    f.machine_id ? h('a', { href: `#/analyse/${f.machine_id}`, class: 'discret petit' }, ic('graphique', 13), 'Analyse') : h('span', { class: 'origine-mn1' }, 'importée'),
    peutModifier() ? h('button', { class: 'discret petit icone-seule', title: 'Corriger la fiche', onclick: () => corrigerFiche(f) }, ic('crayon', 14)) : null,
    peutModifier() ? h('button', { class: 'discret petit icone-seule', title: 'Supprimer la fiche', onclick: async () => {
      if (await confirmer('Supprimer cette fiche de niveau 1 ?', { danger: true, texte: 'Supprimer' }) && await essayer(() => api(`/api/mn1/fiches/${f.id}`, { methode: 'DELETE' }))) window.ktec.recharger()
    } }, ic('poubelle', 14)) : null)
}

// Import d'un classeur de fiches de contrôle (une ligne par point à vérifier : ligne, ETH, machine, zone, action,
// étiquette) : les fiches sont créées, ou mises à jour si l'étiquette a déjà été importée.
export function boutonImport() {
  const frequence = h('select', { class: 'fin' }, FREQUENCES.filter((f) => f !== 'Quotidienne').map((f) => h('option', { value: f, selected: f === 'Mensuelle' }, f)))
  const choix = h('input', { type: 'file', accept: '.xlsx,.xls,.ods,.csv', style: { display: 'none' } })
  choix.onchange = async () => {
    const fichier = choix.files[0]
    if (!fichier) return
    const r = await essayer(() => api(`/api/mn1/import?frequence=${encodeURIComponent(frequence.value)}`, { methode: 'POST', fichier, entetes: { 'X-Nom': encodeURIComponent(fichier.name) } }))
    if (r) {
      notifier(`${r.total} fiches lues : ${r.creees} nouvelles, ${r.modifiees} mises à jour`)
      window.ktec.recharger()
    }
  }
  return h('div', { class: 'barre-import-mn1' },
    h('button', { onclick: () => choix.click() }, ic('telecharger', 16), 'Importer un classeur de fiches'),
    h('label', { class: 'discret' }, 'fréquence des fiches importées ', frequence),
    choix)
}

// ---------------------------------------------------------------- création de la FI dans la GMAO

// La FI déjà créée pour cette machine, ou le bouton pour la créer (administrateur).
function etatGmao(groupe, rang) {
  const numeros = [...new Set(groupe.map((f) => f.fi_gmao).filter(Boolean))]
  if (numeros.length) return h('span', { class: 'fi-gmao', title: 'FI créée dans la GMAO pour ces fiches' }, ic('coche', 13), numeros.join(', '))
  return peutModifier() ? h('button', { class: 'petit', title: 'Créer la FI de cette machine dans la GMAO (simulation d’abord)', onclick: () => creerDansGmao(groupe, rang) }, ic('base', 14), 'Créer la FI dans la GMAO') : null
}

// La prochaine date d'un lundi (1re échéance proposée), au format AAAA-MM-JJ.
function prochainLundi() {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function creerDansGmao(groupe, rang) {
  const f0 = groupe[0]
  const machine = f0.machine_nom || f0.repere || ''
  const [equipements, proposition] = await Promise.all([
    api(`/api/mn1/gmao/equipements?ligne=${encodeURIComponent(f0.ligne || '')}`).catch(() => []),
    api('/api/mn1/gmao/proposition', { methode: 'POST', corps: { ligne: f0.ligne, eth: f0.eth, machine, repere: f0.repere || '', nn: rang } }),
  ])
  const numero = h('input', { type: 'text', value: proposition.numero })
  const titre = h('input', { type: 'text', value: proposition.titre })
  const parc = h('input', { type: 'text', placeholder: 'ID de l’équipement (nœud de l’arborescence)', list: 'mn1-equipements' })
  const liste = h('datalist', { id: 'mn1-equipements' }, equipements.map((e) => h('option', { value: e.id }, `${'· '.repeat(Math.max(0, e.niveau - 1))}${e.code}${e.designation ? ` — ${e.designation}` : ''}`)))
  // Taper le repère de la machine dans le titre remplit l'équipement s'il est trouvé dans la ligne.
  const choisirParRepere = () => {
    const repere = (titre.value.match(/\b\d{3}\.\d+\b/) || [])[0]
    const e = repere && equipements.find((x) => x.code === repere)
    if (e && !parc.value) parc.value = e.id
  }
  choisirParRepere()
  const date = h('input', { type: 'date', value: prochainLundi() })
  const resultat = h('div', { class: 'resultat-gmao' })
  let simulee = null // les valeurs de la dernière simulation réussie
  const valeurs = () => ({ ids: groupe.map((f) => f.id), numero: numero.value, titre: titre.value, parc: parc.value, dateDeb: date.value })
  const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const boutonCreer = h('button', { class: 'principal', disabled: true }, ic('base', 15), 'Créer dans la GMAO')
  for (const champ of [numero, titre, parc, date]) champ.addEventListener('input', () => { boutonCreer.disabled = !(simulee && memes(simulee, valeurs())) })

  const montrer = (r, creation) => {
    const c = r.controles || {}
    const manque = ['id_fi_modele', 'id_intervenant', 'id_emetteur', 'id_type', 'id_machi'].filter((k) => k in c && !c[k])
    const ligneControle = (libelle, valeur, ok) => h('div', { class: `controle-gmao ${ok ? 'ok' : 'ko'}` }, ic(ok ? 'coche' : 'alerte', 13), h('span', {}, libelle), h('b', {}, valeur ?? '—'))
    vider(resultat,
      h('h3', {}, creation ? (r.creee ? 'FI créée dans la GMAO' : 'Rien n’a été créé') : (r.creee ? 'Simulation réussie : rien n’a été écrit' : 'La simulation ne créerait rien')),
      h('div', { class: 'controles-gmao' },
        ligneControle('FI modèle', c.id_fi_modele, Boolean(c.id_fi_modele)),
        ligneControle('Intervenant', c.id_intervenant, Boolean(c.id_intervenant)),
        ligneControle('Émetteur', c.id_emetteur, Boolean(c.id_emetteur)),
        ligneControle('Type de maintenance', c.id_type, Boolean(c.id_type)),
        ligneControle('Numéro libre', Number(c.numero_deja_pris) ? 'déjà pris' : 'oui', !Number(c.numero_deja_pris)),
        ligneControle('Équipement connu', c.id_machi, Boolean(c.id_machi)),
        c.derniere_fi_sur_equipement ? h('div', { class: 'discret', style: { fontSize: '13px' } }, 'Dernière FI sur cet équipement : ', h('b', {}, c.derniere_fi_sur_equipement)) : null),
      r.recapitulatif?.length ? tableau({ lignes: r.recapitulatif, colonnes: Object.keys(r.recapitulatif[0]).map((k) => ({ titre: k, valeur: (l) => l[k] ?? '' })) }) : null,
      manque.length ? h('p', { class: 'alerte-mn1' }, ic('alerte', 14), 'Un contrôle échoue : vérifiez les réglages de création (bouton base de données en haut du menu) ou l’équipement.') : null)
  }

  const simuler = async () => {
    vider(resultat, h('p', { class: 'discret curseur' }, 'Simulation dans une transaction annulée'))
    const v = valeurs()
    const r = await essayer(() => api('/api/mn1/gmao/creer', { methode: 'POST', corps: v }))
    if (!r) return vider(resultat)
    montrer(r, false)
    simulee = r.creee ? v : null
    boutonCreer.disabled = !simulee
  }
  boutonCreer.onclick = async () => {
    if (!simulee || !memes(simulee, valeurs())) return
    if (!(await confirmer(`Créer la FI ${numero.value} dans la base de la GMAO ? Elle sera réellement écrite.`, { texte: 'Créer la FI' }))) return
    const r = await essayer(() => api('/api/mn1/gmao/creer', { methode: 'POST', corps: { ...valeurs(), valider: true } }))
    if (!r) return
    montrer(r, true)
    boutonCreer.disabled = true
    if (r.creee) notifier(`FI ${numero.value} créée dans la GMAO`)
  }

  const fermee = await fenetre({
    titre: `Créer la FI dans la GMAO — ${machine}`,
    large: true,
    contenu: h('div', { class: 'creation-gmao' },
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, `Une FI pour les ${groupe.length} fiche${groupe.length > 1 ? 's' : ''} de cette machine (${groupe.map((f) => f.etiquette || f.zone).filter(Boolean).join(', ')}). « Simuler » exécute tout dans une transaction annulée ; « Créer » n’est possible qu’après une simulation réussie.`),
      h('div', { class: 'grille grille-2', style: { gap: '10px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Numéro de la FI'), numero),
        h('label', { class: 'champ' }, h('span', {}, 'Titre (désignation)'), titre),
        h('label', { class: 'champ' }, h('span', {}, `Équipement (ID) — ${equipements.length} dans la ligne`), parc, liste),
        h('label', { class: 'champ' }, h('span', {}, 'Première échéance'), date)),
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        h('button', { onclick: simuler }, ic('rafraichir', 15), 'Simuler'),
        boutonCreer),
      resultat),
    boutons: [{ texte: 'Fermer', classe: 'discret', valeur: true }],
  })
  if (fermee !== undefined) window.ktec.recharger()
}

// Les réglages de création (administrateur) : le SQL du site (rangé dans le fichier de connaissances), la FI
// modèle, l'intervenant, l'émetteur, le type, l'utilisateur, la périodicité et les modèles de numéro et de titre.
export async function reglerCreationGmao() {
  const r = await essayer(() => api('/api/mn1/gmao/reglages'))
  if (!r) return
  const champ = (cle, libelle, attributs = {}) => {
    const e = h('input', { type: attributs.type || 'text', value: r[cle] ?? '', ...attributs })
    return { cle, e, element: h('label', { class: 'champ' }, h('span', {}, libelle), e) }
  }
  const champs = [
    champ('modele', 'FI modèle (structure copiée)'),
    champ('intervenant', 'Intervenant (code)'),
    champ('emetteur', 'Émetteur (code)'),
    champ('type', 'Type de maintenance'),
    champ('utilisateur', 'Utilisateur GMAO (ID)'),
    champ('tpsPrevu', 'Temps prévu (h)', { type: 'number', step: '0.25' }),
    champ('periot', 'Unité de périodicité (code GMAO)', { type: 'number' }),
    champ('valPeriot', 'Périodicité (nombre d’unités)', { type: 'number' }),
    champ('delai', 'Retard admissible (jours)', { type: 'number' }),
    champ('numero', 'Modèle du numéro ({ligne} {eth} {machine} {nn})'),
    champ('titre', 'Modèle du titre ({n} = chiffres de la ligne, {machine}, {repere})'),
  ]
  const sql = h('textarea', { class: 'sql', rows: 14, spellcheck: false, placeholder: 'Le SQL de création (SELECT de contrôle, SET, INSERT, SELECT de récapitulatif), avec les paramètres :numero :titre :obser :parc…' }, r.sql)
  const ok = await fenetre({
    titre: 'Création des FI dans la GMAO',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Rangés dans le fichier de connaissances. Le SQL n’accepte que des SELECT, SET et INSERT ; il est toujours simulé avant d’être validé. Paramètres : :numero :titre :obser :parc :date_deb :date_limite :date_jour :heure :modele :intervenant :emetteur :type :tps_prevu :periot :val_periot :delai :utilisateur.'),
      h('div', { class: 'grille grille-3', style: { gap: '10px' } }, champs.map((c) => c.element)),
      h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, 'SQL de création'), sql)),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => { await api('/api/mn1/gmao/reglages', { methode: 'POST', corps: { ...Object.fromEntries(champs.map((c) => [c.cle, c.e.value])), sql: sql.value } }); return true } },
    ],
  })
  if (ok) notifier('Réglages de création enregistrés')
}

// Le rouage : combien de fiches les opérateurs tirent par semaine, et combien de fiches imprimer par fréquence.
export async function reglerParametres() {
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

