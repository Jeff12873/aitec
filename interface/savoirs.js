// Ajouter un savoir depuis l'assistant : une expérience écrite, la correction d'une réponse, ou un document
// (notice, schéma, photo), avec les machines concernées et la personne de la GMAO qui le dit.
// L'IA s'en sert dès la question suivante (blocs/savoirs/serveur.js, blocs/documents/serveur.js).

import { h, vider, ic, notifier, fenetre, confirmer } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier } from '/socle/etat.js'
import { deposerDocument, suiviFichier, GENRES } from '../blocs/documents/vue.js'

const CLE_AUTEUR = 'aitec-savoir-auteur'
const libelleMachine = (m) => (m.designation && m.designation !== m.repere ? `${m.repere} — ${m.designation}` : m.repere)

// machines : toutes les machines (pour le choix) ; preselection : ids ; correction : { question, reponse }.
// → true si quelque chose a été ajouté.
export async function ajouterSavoir({ machines = [], preselection = [], correction = null } = {}) {
  const [personnes, arborescence] = await Promise.all([api('/api/savoirs/personnes').catch(() => []), api('/api/arborescence').catch(() => null)])
  let genre = 'experience'

  // Les machines concernées : l'arborescence à cocher, et leurs pastilles.
  const choisies = new Set(preselection.map(Number).filter(Boolean))
  const puces = h('div', { class: 'puces-machines' })
  const champMachine = h('input', { type: 'search', placeholder: 'Filtrer : un repère ou un nom…', autocomplete: 'off' })
  const arbre = h('div', { class: 'arbre-machines' })
  const parId = new Map(machines.map((m) => [m.id, m]))
  // Ligne › sous-ensemble › machines ; une machine rangée directement sous la ligne reste sous la ligne.
  const noeuds = (arborescence?.lignes?.length ? arborescence.lignes : [{ id: 'tout', libelle: 'Toutes les machines', machines: machines.map((m) => m.id), enfants: [] }]).map((l) => {
    const rangees = new Set(l.enfants.flatMap((e) => e.machines))
    return { ...l, directes: l.machines.filter((id) => !rangees.has(id)) }
  })
  const ouverts = new Set()
  const caseDe = (ids) => {
    const dedans = ids.filter((id) => choisies.has(id)).length
    return h('input', { type: 'checkbox', checked: dedans === ids.length && ids.length > 0, indeterminate: dedans > 0 && dedans < ids.length, onchange: (e) => { ids.forEach((id) => (e.target.checked ? choisies.add(id) : choisies.delete(id))); dessinerPuces() } })
  }
  const feuille = (id) => h('label', { class: 'noeud-machine feuille' }, caseDe([id]), ` ${parId.has(id) ? libelleMachine(parId.get(id)) : `machine ${id}`}`)
  const correspond = (id, mots) => mots.every((m) => libelleMachine(parId.get(id) || { repere: '' }).toLowerCase().includes(m))
  function branche(cle, libelle, ids, enfants, mots) {
    const ouvert = mots.length > 0 || ouverts.has(cle)
    return h('div', { class: 'branche-machines' },
      h('div', { class: 'noeud-machine' },
        h('button', { type: 'button', class: 'discret icone-seule petit', title: ouvert ? 'Replier' : 'Déplier', onclick: () => { ouverts.has(cle) ? ouverts.delete(cle) : ouverts.add(cle); dessinerArbre() } }, ouvert ? '▾' : '▸'),
        h('label', {}, caseDe(ids), ` ${libelle}`), h('small', { class: 'discret' }, ` ${ids.length}`)),
      ouvert ? h('div', { class: 'enfants-machines' }, enfants()) : null)
  }
  function dessinerArbre() {
    const mots = champMachine.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const garder = (ids) => (mots.length ? ids.filter((id) => correspond(id, mots)) : ids)
    vider(arbre, noeuds.map((l) => {
      const ids = garder(l.machines)
      if (!ids.length) return null
      return branche(l.id, l.libelle, ids, () => [
        l.enfants.map((e) => { const siens = garder(e.machines); return siens.length ? branche(`${l.id}/${e.id}`, e.libelle, siens, () => siens.slice(0, 300).map(feuille), mots) : null }),
        garder(l.directes).slice(0, 300).map(feuille),
      ], mots)
    }))
  }
  champMachine.addEventListener('input', dessinerArbre)
  function dessinerPuces() {
    const ids = [...choisies]
    vider(puces, ids.length > 12
      ? h('span', { class: 'puce-machine seule' }, `${ids.length} machines cochées`)
      : ids.map((id) => {
        const m = parId.get(id)
        return h('span', { class: 'puce-machine' }, m ? libelleMachine(m) : `machine ${id}`,
          h('button', { class: 'discret icone-seule', title: 'Retirer', onclick: () => { choisies.delete(id); dessinerPuces() } }, ic('x', 12)))
      }))
    dessinerArbre()
  }
  dessinerPuces()

  // Qui le dit : une personne de la GMAO (les intervenants de l'historique).
  let dernier = ''
  try { dernier = localStorage.getItem(CLE_AUTEUR) || '' } catch {}
  const champAuteur = h('input', { list: 'savoir-personnes', value: personnes.includes(dernier) ? dernier : '', placeholder: 'NOM, PRÉNOM', autocomplete: 'off' })
  const listePersonnes = h('datalist', { id: 'savoir-personnes' }, personnes.map((p) => h('option', { value: p })))

  const situation = h('input', { value: correction?.question || '', placeholder: 'Le symptôme ou la situation (ex. défaut variateur au démarrage)' })
  const texte = h('textarea', { rows: 6, placeholder: correction ? 'Ce qui était vraiment en cause, ce qui a marché…' : 'Ce qui a marché, l’organe en cause, le geste ou le réglage à connaître…' })
  const choixGenre = h('select', {}, Object.entries(GENRES).map(([v, t]) => h('option', { value: v }, t)))
  const fichiers = h('input', { type: 'file', multiple: true })
  const suivi = h('div', { class: 'suivi-depot' })

  const zoneExperience = h('div', { class: 'formulaire' },
    h('label', { class: 'champ large' }, h('span', {}, 'Situation'), situation),
    h('label', { class: 'champ large' }, h('span', {}, correction ? 'Ce qu’il fallait répondre *' : 'Ce qu’il faut savoir *'), texte))
  const zoneDocument = h('div', { class: 'formulaire', hidden: true },
    h('label', { class: 'champ' }, h('span', {}, 'Type de fichier'), choixGenre),
    h('label', { class: 'champ large' }, h('span', {}, 'Fichiers (notice, schéma, photo de plaque…) *'), fichiers),
    suivi)
  const segments = h('div', { class: 'segments' })
  const dessinerSegments = () => vider(segments,
    [['experience', 'Une expérience', 'personne'], ['document', 'Un document ou une photo', 'document']].map(([v, t, icone]) =>
      h('button', { class: genre === v ? 'choisi' : '', onclick: () => { genre = v; zoneExperience.hidden = v !== 'experience'; zoneDocument.hidden = v !== 'document'; dessinerSegments() } }, ic(icone, 15), t)))
  dessinerSegments()

  const contenu = h('div', {},
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, correction
      ? 'La réponse de l’assistant n’était pas la bonne ? Dites ce qu’il en était : l’assistant s’en servira dès la prochaine question, en vous citant.'
      : 'Votre savoir-faire sert à tout l’atelier : l’assistant s’en sert dès la prochaine question, et le cite comme source avec votre nom.'),
    correction ? null : segments,
    h('div', { class: 'formulaire', style: { marginTop: '12px' } },
      h('div', { class: 'champ large' }, h('span', {}, 'Machines concernées'), champMachine, arbre, puces),
      h('label', { class: 'champ large' }, h('span', {}, 'Qui le dit ? *'), champAuteur, listePersonnes,
        h('small', { class: 'aide' }, personnes.length ? 'Une personne de la GMAO : choisissez-la dans la liste.' : 'Aucune personne connue : synchronisez les interventions de la GMAO.'))),
    zoneExperience, zoneDocument)

  return Boolean(await fenetre({
    titre: correction ? 'Corriger la réponse' : 'Ajouter un savoir',
    large: true,
    contenu,
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      { texte: 'Enregistrer', classe: 'principal', action: async () => {
        const auteur = champAuteur.value.trim()
        if (!auteur) throw new Error('Dites qui le dit.')
        if (personnes.length && !personnes.includes(auteur)) throw new Error(`« ${auteur} » n’est pas une personne connue de la GMAO : choisissez-la dans la liste.`)
        try { localStorage.setItem(CLE_AUTEUR, auteur) } catch {}
        const ids = [...choisies]
        if (genre === 'experience') {
          if (!texte.value.trim()) throw new Error('Écrivez ce qu’il faut savoir.')
          await api('/api/savoirs', { methode: 'POST', corps: { genre: correction ? 'correction' : 'experience', situation: situation.value, texte: texte.value, auteur, machines: ids, question: correction?.question || '', reponse: correction?.reponse || '' } })
          notifier('Merci ! L’assistant s’en servira dès la prochaine question.')
          return true
        }
        if (!fichiers.files.length) throw new Error('Choisissez au moins un fichier.')
        let bons = 0
        for (const fichier of fichiers.files) {
          const ligne = suiviFichier(suivi, fichier.name)
          try {
            await deposerDocument(fichier, ligne, { machine: ids[0] || '', genre: choixGenre.value, entetes: { 'X-Contribution': '1', 'X-Machines': ids.join(','), 'X-Auteur': encodeURIComponent(auteur) } })
            bons++
          } catch (erreur) {
            ligne.erreur(erreur.message)
          }
        }
        if (!bons) return false // on laisse la fenêtre ouverte sur les erreurs
        notifier(`${bons} document${bons > 1 ? 's' : ''} ajouté${bons > 1 ? 's' : ''} : l’assistant s’en sert dès maintenant.`)
        return true
      } },
    ],
  }))
}

const initiales = (nom) => String(nom || '?').split(/[,\s]+/).filter(Boolean).slice(0, 2).reverse().map((x) => x[0].toUpperCase()).join('')

// Ce que le site a écrit ou déposé sur la machine, avant les pistes : une bulle aux initiales pour une expérience, une
// icône document pour un fichier.
export function bandeauSavoirs(s) {
  if (!s?.experiences?.length && !s?.documents?.length) return null
  return h('div', { class: 'bandeau-preventif dernieres savoirs-associes' },
    h('div', { class: 'titre-preventif' }, ic('etincelle', 15), 'Savoirs associés'),
    s.experiences.map((x) => h('button', { type: 'button', class: 'ligne-savoir', title: `${x.auteur} : voir ce retour d’expérience`, onclick: () => voirSavoir(x.id) }, h('span', { class: 'bulle-initiales' }, initiales(x.auteur)), h('span', {}, x.texte))),
    s.documents.map((x) => h('a', { class: 'ligne-savoir', href: `/api/documents/${x.id}/fichier`, target: '_blank', rel: 'noopener', title: 'Ouvrir le document' }, h('span', { class: 'bulle-document' }, ic('document', 14)), h('span', {}, x.nom))))
}

// Un retour d'expérience cité en source : qui, quand, sur quelles machines, et ce qu'il dit.
export async function voirSavoir(id) {
  let s
  try {
    s = await api(`/api/savoirs/${id}`)
  } catch (erreur) {
    return notifier(erreur.message, 'erreur')
  }
  const supprimer = async () => {
    if (!(await confirmer('Supprimer ce retour d’expérience ? L’assistant ne s’en servira plus.', { texte: 'Supprimer', danger: true }))) return false
    await api(`/api/savoirs/${id}`, { methode: 'DELETE' })
    notifier('Retour d’expérience supprimé')
    return true
  }
  await fenetre({
    titre: s.genre === 'correction' ? 'Correction d’une réponse' : 'Retour d’expérience',
    contenu: h('div', { class: 'savoir-detail' },
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, ic('personne', 14), ` ${s.auteur}, le ${new Date(s.cree_le).toLocaleDateString('fr-FR')}`),
      s.machines.length ? h('div', { class: 'puces-machines' }, s.machines.map((m) => h('span', { class: 'puce-machine' }, libelleMachine(m)))) : null,
      s.situation ? h('p', {}, h('b', {}, 'Situation : '), s.situation) : null,
      s.genre === 'correction' && s.question ? h('p', { class: 'texte-2' }, h('b', {}, 'Question posée : '), s.question) : null,
      h('p', { style: { whiteSpace: 'pre-wrap' } }, s.texte)),
    boutons: [
      peutModifier() ? { texte: 'Supprimer', classe: 'discret', action: supprimer } : null,
      { texte: 'Fermer', classe: 'principal' },
    ].filter(Boolean),
  })
}
