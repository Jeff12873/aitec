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
  const personnes = await api('/api/savoirs/personnes').catch(() => [])
  let genre = 'experience'

  // Les machines concernées : un champ qui propose les machines en tapant, et leurs pastilles.
  const choisies = new Set(preselection.map(Number).filter(Boolean))
  const puces = h('div', { class: 'puces-machines' })
  const listeMachines = h('datalist', { id: 'savoir-machines' }, machines.map((m) => h('option', { value: libelleMachine(m) })))
  const champMachine = h('input', { list: 'savoir-machines', placeholder: 'Tapez un repère ou un nom, puis choisissez…', autocomplete: 'off' })
  champMachine.addEventListener('change', () => {
    const m = machines.find((x) => libelleMachine(x) === champMachine.value || x.repere === champMachine.value.trim())
    if (m) choisies.add(m.id)
    champMachine.value = ''
    dessinerPuces()
  })
  function dessinerPuces() {
    vider(puces, [...choisies].map((id) => {
      const m = machines.find((x) => x.id === id)
      return h('span', { class: 'puce-machine' }, m ? libelleMachine(m) : `machine ${id}`,
        h('button', { class: 'discret icone-seule', title: 'Retirer', onclick: () => { choisies.delete(id); dessinerPuces() } }, ic('x', 12)))
    }))
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
      h('div', { class: 'champ large' }, h('span', {}, 'Machines concernées'), champMachine, listeMachines, puces),
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
