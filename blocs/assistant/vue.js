// L'assistant : une discussion avec l'IA, qui répond à partir de la base et cite ses sources.
// La conversation est gardée sur ce poste (pas dans le fichier partagé).

import { h, vider, ic, notifier } from '/socle/ui.js'
import { api, flux } from '/socle/api.js'
import { texteIA } from '/socle/texte-ia.js'
import { etat } from '/socle/etat.js'

const SUGGESTIONS = [
  'Quelles machines tombent le plus souvent en panne cette année ?',
  'Quelles sont les pannes qui reviennent sur le convoyeur ?',
  'Comment remplacer le filtre hydraulique de la presse ?',
  'Quelles sont les dernières interventions sur le compresseur ?',
]

// Conversation en cours : [{ role: 'agent' | 'assistant', contenu, sources }]
let conversation = lireConversation()
let machineChoisie = ''
let enCours = null // AbortController de la réponse en cours

export default {
  chemin: 'assistant',
  titre: 'Assistant IA',
  icone: 'etincelle',
  menu: true,
  aide: 'assistant',
  rafraichir: false, // ne pas recharger l'écran pendant une discussion

  async afficher(zone, { query }) {
    const machines = await api('/api/machines')
    if (query.machine) machineChoisie = query.machine

    const messages = h('div', { class: 'messages' })
    const saisie = h('textarea', {
      placeholder: 'Posez votre question… (Entrée pour envoyer, Maj + Entrée pour aller à la ligne)',
      rows: 2,
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          envoyer()
        }
      },
      oninput: () => {
        saisie.style.height = 'auto'
        saisie.style.height = Math.min(220, saisie.scrollHeight) + 'px'
      },
    })
    const boutonEnvoyer = h('button', { class: 'principal', title: 'Envoyer', onclick: () => (enCours ? arreter() : envoyer()) }, ic('avion', 18))
    const choixMachine = h(
      'select',
      { onchange: (e) => (machineChoisie = e.target.value) },
      h('option', { value: '' }, 'Toute la base'),
      machines.map((m) => h('option', { value: m.id, selected: String(m.id) === String(machineChoisie) }, `${m.repere} — ${m.designation}`)),
    )

    function dessinerMessages() {
      vider(messages)
      if (!conversation.length) {
        messages.append(
          h(
            'div',
            { class: 'vide', style: { paddingTop: '60px' } },
            ic('etincelle', 40),
            h('h2', { style: { color: 'var(--texte)', marginBottom: '6px' } }, 'Que voulez-vous savoir ?'),
            h('p', {}, 'L’assistant répond à partir de vos machines, interventions et documents, et cite ses sources.'),
            h('div', { class: 'suggestions', style: { justifyContent: 'center', marginTop: '18px' } }, SUGGESTIONS.map((s) => h('button', { onclick: () => envoyer(s) }, s))),
          ),
        )
        return
      }
      conversation.forEach((message, i) => messages.append(dessinerMessage({ ...message, dernier: i === conversation.length - 1 }, envoyer)))
    }

    async function envoyer(texte) {
      const question = (texte ?? saisie.value).trim()
      if (!question || enCours) return
      saisie.value = ''
      saisie.style.height = 'auto'

      const historique = conversation.map((m) => ({ role: m.role, contenu: m.contenu }))
      conversation.push({ role: 'agent', contenu: question })
      const reponse = { role: 'assistant', contenu: '', sources: [], enCours: true }
      conversation.push(reponse)
      dessinerMessages()
      let element = messages.lastElementChild
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const remplacer = () => {
        const nouveau = dessinerMessage(reponse, envoyer)
        element.replaceWith(nouveau)
        element = nouveau
      }

      enCours = new AbortController()
      vider(boutonEnvoyer, ic('stop', 18))
      boutonEnvoyer.title = 'Arrêter'
      try {
        await flux('/api/assistant', { question, historique, machineId: Number(machineChoisie) || null }, (type, donnees) => {
          if (type === 'sources') reponse.sources = donnees
          if (type === 'texte') reponse.contenu += donnees
          if (type === 'erreur') reponse.contenu += `\n\n⚠ ${donnees.message}`
          remplacer()
        }, enCours.signal)
      } catch (erreur) {
        if (erreur.name !== 'AbortError') reponse.contenu += `\n\n⚠ ${erreur.message}`
      } finally {
        reponse.enCours = false
        enCours = null
        vider(boutonEnvoyer, ic('avion', 18))
        boutonEnvoyer.title = 'Envoyer'
        dessinerMessages()
        garderConversation()
        saisie.focus()
      }
    }

    function arreter() {
      enCours?.abort()
    }

    function nouvelleConversation() {
      arreter()
      conversation = []
      garderConversation()
      dessinerMessages()
      saisie.focus()
    }

    dessinerMessages()
    vider(
      zone,
      h(
        'div',
        { class: 'discussion' },
        h(
          'div',
          { class: 'fil' },
          !etat.ia?.installee ? h('div', { class: 'bandeau' }, ic('alerte'), "L'IA n'est pas installée sur ce poste : l'assistant montre seulement les passages trouvés. Voir l’aide « Installation ».") : null,
          messages,
          h('div', { class: 'saisie' }, h('div', { class: 'saisie-boite' }, saisie, boutonEnvoyer)),
        ),
        h(
          'div',
          { class: 'carte', style: { position: 'sticky', top: '86px' } },
          h('h3', { style: { marginBottom: '10px' } }, 'Machine concernée'),
          choixMachine,
          h('p', { class: 'discret', style: { fontSize: '13px', marginTop: '8px' } }, 'Choisir une machine limite la recherche à ses documents, sa fiche et ses interventions.'),
          h('div', { class: 'actions', style: { marginTop: '16px' } }, h('button', { onclick: nouvelleConversation }, ic('plus', 16), 'Nouvelle conversation')),
          h('h3', { style: { margin: '22px 0 8px' } }, 'Bon à savoir'),
          h('ul', { class: 'texte-2', style: { paddingLeft: '18px', fontSize: '14px', margin: 0 } },
            h('li', {}, 'Les numéros [1], [2]… renvoient aux sources : cliquez pour les ouvrir.'),
            h('li', {}, 'Les notices en anglais ou en allemand sont traduites dans la réponse.'),
            h('li', {}, 'L’IA peut se tromper : vérifiez toujours dans la source avant d’intervenir.'),
          ),
        ),
      ),
    )
    saisie.focus()

    // Question transmise par la page de recherche (« Poser la question à l'IA »).
    const transmise = sessionStorage.getItem('iassitec-question')
    if (transmise) {
      sessionStorage.removeItem('iassitec-question')
      envoyer(transmise)
    }
  },
}

// L'assistant peut finir par « CHOIX : réponse 1 | réponse 2 » : on affiche ces réponses en boutons.
function separerChoix(contenu) {
  const lignes = contenu.split('\n')
  const index = lignes.findIndex((l) => /^\s*\**CHOIX\**\s*:/i.test(l))
  if (index < 0) return { texte: contenu, choix: [] }
  const choix = lignes[index].replace(/^\s*\**CHOIX\**\s*:\s*/i, '').split('|').map((c) => c.trim()).filter(Boolean)
  return { texte: lignes.slice(0, index).join('\n'), choix }
}

function dessinerMessage(message, envoyer) {
  if (message.role === 'agent') return h('div', { class: 'message agent' }, message.contenu)

  const { texte: contenu, choix } = separerChoix(message.contenu)
  const texte = h('div', { class: `texte-ia ${message.enCours ? 'curseur' : ''}`, html: contenu ? texteIA(contenu) : '' })
  if (!message.contenu && message.enCours) texte.innerHTML = '<p class="discret">Recherche dans la base…</p>'
  texte.addEventListener('click', (e) => {
    const numero = e.target.dataset?.source
    const source = message.sources?.find((s) => String(s.numero) === numero)
    if (source) ouvrirSource(source)
  })

  return h(
    'div',
    { class: 'message ia' },
    h('div', { class: 'avatar' }, ic('etincelle', 18)),
    h(
      'div',
      { class: 'corps' },
      texte,
      !message.enCours && choix.length && message.dernier
        ? h('div', { class: 'suggestions', style: { marginTop: '10px' } }, choix.map((c) => h('button', { onclick: () => envoyer(c) }, c)))
        : null,
      message.sources?.length
        ? h('div', { class: 'sources' }, message.sources.map((s) => h('button', { class: 'source', title: s.extrait, onclick: () => ouvrirSource(s) }, h('b', {}, s.numero), ic(icone(s.source), 14), h('span', {}, s.titre))))
        : null,
      !message.enCours && message.contenu
        ? h('div', { class: 'actions', style: { marginTop: '8px' } }, h('button', { class: 'discret petit', onclick: () => navigator.clipboard.writeText(contenu).then(() => notifier('Réponse copiée')) }, 'Copier'))
        : null,
    ),
  )
}

function icone(source) {
  return { document: 'document', machine: 'usine', intervention: 'cle' }[source] || 'document'
}

function ouvrirSource(source) {
  if (source.lien.startsWith('#')) location.hash = source.lien
  else window.open(source.lien, '_blank')
}

// La conversation survit à un changement d'écran et au rechargement de la page.
function lireConversation() {
  try {
    return JSON.parse(localStorage.getItem('iassitec-conversation') || '[]')
  } catch {
    return []
  }
}

function garderConversation() {
  try {
    localStorage.setItem('iassitec-conversation', JSON.stringify(conversation.slice(-40)))
  } catch {
    // stockage indisponible : la conversation ne sera simplement pas gardée
  }
}
