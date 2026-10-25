// L'assistant : une discussion avec l'IA, qui répond à partir de la base et cite ses sources.
// La conversation est gardée sur ce poste (pas dans le fichier partagé).

import { h, vider, ic, notifier } from '/socle/ui.js'
import { menuDeroulant } from '../../interface/menu-deroulant.js'
import { api, flux } from '/socle/api.js'
import { texteIA } from '/socle/texte-ia.js'
import { etat } from '/socle/etat.js'

const SUGGESTIONS = [
  'Quelles machines tombent le plus souvent en panne cette année ?',
  'Quelles sont les pannes qui reviennent sur le convoyeur ?',
  'Comment remplacer le filtre hydraulique de la presse ?',
  'Quelles sont les dernières interventions sur le compresseur ?',
]

// Précisions proposées en cases à cocher avant la première question, si elle est courte (toutes facultatives).
const PRECISIONS = [
  ['Domaine', ['Électrique', 'Mécanique', 'Pneumatique', 'Hydraulique', 'Automatisme']],
  ['Symptôme', ['Ne démarre pas', 'S’arrête en cours de cycle', 'Bruit ou vibration', 'Fuite', 'Défaut affiché', 'Qualité des pièces', 'Usure ou casse']],
  ['Fréquence', ['À chaque cycle', 'De temps en temps', 'Depuis une intervention', 'Première fois']],
]
const MOTS_QUESTION_PRECISE = 12

// Conversation en cours : [{ role: 'agent' | 'assistant', contenu, sources }]
let conversation = lireConversation()
let machineChoisie = ''
// Arborescence (deux niveaux : ligne › sous-ensemble) : le nœud choisi limite la recherche à toutes ses machines.
let ligneChoisie = '', ensembleChoisi = ''
let enCours = null // AbortController de la réponse en cours

export default {
  chemin: 'assistant',
  titre: 'Assistant IA',
  icone: 'etincelle',
  menu: true,
  aide: 'assistant',
  rafraichir: false, // ne pas recharger l'écran pendant une discussion

  async afficher(zone, { query }) {
    const [machines, arborescence] = await Promise.all([api('/api/machines'), api('/api/arborescence').catch(() => null)])
    const arbre = arborescence?.lignes || null
    if (query.machine) { machineChoisie = query.machine; ligneChoisie = ''; ensembleChoisi = '' }

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
    // Avec l'arborescence : deux menus en cascade (ligne, puis sous-ensemble). Sans : la liste des machines.
    const zoneMachine = h('div', { class: 'choix-arbre' })
    // Les pannes connues de la machine (ou de la ligne) choisie, en pastilles : un clic pose la question.
    const zonePannes = h('div', { class: 'pastilles-pannes' })
    let demandePannes = 0
    async function majPannes() {
      const filtre = filtreMachines()
      const numero = ++demandePannes
      const pannes = filtre.machineId || filtre.machineIds ? await api('/api/pannes/suggestions', { methode: 'POST', corps: filtre }).catch(() => []) : []
      if (numero !== demandePannes) return // un autre choix est arrivé entre-temps
      const plusieurs = new Set(pannes.map((p) => p.machine_id)).size > 1
      vider(zonePannes, pannes.length ? [
        h('span', { class: 'titre-pastilles', title: 'Les pannes qui reviennent, tirées des rapports d’intervention' }, ic('historique', 14), 'Pannes connues'),
        pannes.map((p) => h('button', { class: 'pastille-panne', title: `${p.repere} : ${p.symptome} (${p.nombre} cas)`, onclick: () => repondre(`${p.symptome} sur ${p.repere}`, { machineId: p.machine_id }) },
          plusieurs ? h('b', { class: 'mono' }, p.repere) : null, h('span', {}, p.symptome), h('small', {}, p.nombre))),
      ] : null)
    }
    function dessinerChoix() {
      dessinerMenus()
      majPannes()
    }
    function dessinerMenus() {
      if (!arbre?.length) {
        return vider(zoneMachine, menuDeroulant({
          choix: [{ valeur: '', libelle: 'Toute la base' }, ...machines.map((m) => ({ valeur: String(m.id), libelle: `${m.repere} — ${m.designation}` }))],
          valeur: String(machineChoisie || ''),
          surChoix: (v) => { machineChoisie = v; dessinerChoix() },
          haut: true,
        }))
      }
      const ligne = arbre.find((n) => n.id === ligneChoisie)
      const machine = machineChoisie ? machines.find((m) => String(m.id) === String(machineChoisie)) : null
      // Une machine précise venue d'un autre écran (« Demander à l'assistant » depuis le parc).
      if (machine) {
        return vider(zoneMachine, h('div', { class: 'machine-precise' }, h('span', {}, `${machine.repere} — ${machine.designation}`), h('button', { class: 'discret icone-seule', title: 'Revenir à l’arborescence', onclick: () => { machineChoisie = ''; dessinerChoix() } }, ic('x', 14))))
      }
      vider(zoneMachine,
        menuDeroulant({
          choix: [{ valeur: '', libelle: 'Toute la base' }, ...arbre.map((n) => ({ valeur: n.id, libelle: n.libelle, nombre: n.machines.length }))],
          valeur: ligneChoisie,
          surChoix: (v) => { ligneChoisie = v; ensembleChoisi = ''; dessinerChoix() },
          haut: true,
        }),
        ligne?.enfants.length ? [
          h('span', { class: 'separateur-arbre' }, '›'),
          menuDeroulant({
            choix: [{ valeur: '', libelle: `Toute la ligne ${ligne.libelle.split(' ')[0]}` }, ...ligne.enfants.map((e) => ({ valeur: e.id, libelle: e.libelle, nombre: e.machines.length }))],
            valeur: ensembleChoisi,
            surChoix: (v) => { ensembleChoisi = v; dessinerChoix() },
            haut: true,
          }),
        ] : null)
    }
    // Le filtre envoyé à l'assistant : une machine, ou toutes celles du nœud choisi.
    function filtreMachines() {
      if (machineChoisie) return { machineId: Number(machineChoisie) || null }
      const ligne = arbre?.find((n) => n.id === ligneChoisie)
      const ensemble = ligne?.enfants.find((e) => e.id === ensembleChoisi)
      const noeud = ensemble || ligne
      return noeud ? { machineIds: noeud.machines, groupe: noeud.libelle } : {}
    }
    dessinerChoix()

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
      conversation.forEach((message, i) => messages.append(dessinerMessage({ ...message, dernier: i === conversation.length - 1 }, rappels, message)))
    }

    // Le volet des sources, fermé tant qu'on ne le demande pas (« 8 sources » sous une réponse, ou un renvoi [n]) :
    // les sources de la réponse choisie, ou l'aide.
    const panneau = h('div', { class: 'contenu-panneau' })
    const boutonsOnglets = h('div', { class: 'segments onglets-panneau' })
    const fermerTiroir = () => { tiroir.hidden = true; document.removeEventListener('keydown', surEchap) }
    const surEchap = (e) => e.key === 'Escape' && fermerTiroir()
    const tiroir = h('aside', { class: 'tiroir-sources', hidden: true },
      h('div', { class: 'entete-tiroir' }, boutonsOnglets, h('button', { class: 'discret icone-seule', title: 'Fermer (Échap)', onclick: fermerTiroir }, ic('x', 16))),
      panneau)
    const ouvrirTiroir = () => { tiroir.hidden = false; document.addEventListener('keydown', surEchap) }
    let onglet = 'sources'
    let sourcesDe = null // la réponse dont on montre les sources
    function dessinerPanneau(surligne = null) {
      vider(boutonsOnglets,
        h('button', { class: onglet === 'sources' ? 'choisi' : '', onclick: () => { onglet = 'sources'; dessinerPanneau() } }, ic('document', 15), `Sources${sourcesDe?.sources?.length ? ` (${sourcesDe.sources.length})` : ''}`),
        h('button', { class: onglet === 'aide' ? 'choisi' : '', onclick: () => { onglet = 'aide'; dessinerPanneau() } }, ic('aide', 15), 'Aide'))
      if (onglet === 'aide') {
        return vider(panneau, h('ul', { class: 'texte-2', style: { paddingLeft: '18px', fontSize: '14px', margin: 0 } },
          h('li', {}, 'Les numéros [1], [2]… et « 8 sources » sous une réponse ouvrent ce volet : cliquez sur une source pour l’ouvrir.'),
          h('li', {}, 'Une question courte ? L’assistant propose quelques cases à cocher pour la préciser.'),
          h('li', {}, 'Les notices en anglais ou en allemand sont traduites dans la réponse.'),
          h('li', {}, 'L’IA peut se tromper : vérifiez toujours dans la source avant d’intervenir.')))
      }
      const sources = sourcesDe?.sources || []
      if (!sources.length) return vider(panneau, h('p', { class: 'discret', style: { fontSize: '14px' } }, sourcesDe?.enCours ? 'Recherche dans la base…' : 'Les sources de la réponse s’afficheront ici.'))
      vider(panneau, sources.map((s) => h('button', { class: `source-panneau${String(s.numero) === String(surligne) ? ' surlignee' : ''}`, title: 'Ouvrir la source', onclick: () => ouvrirSource(s) },
        h('div', { class: 'titre-source' }, h('b', {}, s.numero), ic(icone(s.source), 14), h('span', {}, s.titre)),
        s.extrait ? h('div', { class: 'extrait-source' }, s.extrait) : null)))
      panneau.querySelector('.surlignee')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    // ouvrir : à la demande de l'agent (sinon le volet, s'il est ouvert, suit simplement la réponse en cours).
    function montrerSources(message, numero = null, ouvrir = false) {
      sourcesDe = message
      if (ouvrir) onglet = 'sources'
      dessinerPanneau(numero)
      if (ouvrir) ouvrirTiroir()
    }
    const rappels = { envoyer, montrerSources }

    // Une question tapée pour commencer une conversation : si elle est courte, ou si la recherche hésite entre
    // plusieurs machines, des cases à cocher pour préciser avant que l'IA réfléchisse. Sinon, réponse directe.
    async function envoyer(texte) {
      const question = (texte ?? saisie.value).trim()
      if (!question || enCours) return
      saisie.value = ''
      saisie.style.height = 'auto'
      if (texte !== undefined || conversation.length) return repondre(question, filtreMachines())

      const courte = question.split(/\s+/).length < MOTS_QUESTION_PRECISE
      const machines = machineChoisie ? [] : (await api('/api/assistant/precisions', { methode: 'POST', corps: { question, ...filtreMachines() } }).catch(() => ({ machines: [] }))).machines
      if (!courte && !machines.length) return repondre(question, filtreMachines())
      proposerPrecisions(question, courte ? PRECISIONS : [], machines)
    }

    function proposerPrecisions(question, groupes, machines) {
      const coches = []
      const groupe = (titre, options) => h('div', { class: 'groupe-precisions' },
        h('div', { class: 'titre-precisions' }, titre),
        h('div', { class: 'coches-precisions' }, options.map((o) => {
          const c = h('input', { type: 'checkbox' })
          coches.push({ titre, o, c })
          return h('label', { class: 'coche-precision' }, c, h('span', {}, o.libelle ?? o))
        })))
      const continuer = (avecPrecisions) => {
        const choisies = avecPrecisions ? coches.filter((x) => x.c.checked) : []
        const machinesCochees = choisies.filter((x) => x.titre === 'Machine').map((x) => x.o)
        const autres = choisies.filter((x) => x.titre !== 'Machine')
        // Les précisions partent à part (l'IA les sait sûres) ; la recherche garde la question telle quelle.
        const precisions = autres.map((x) => `${x.titre.toLowerCase()} : ${x.o.toLowerCase()}`)
        const textes = [...autres.map((x) => x.o.toLowerCase()), ...machinesCochees.map((m) => `machine ${m.libelle}`)]
        const affiche = textes.length ? `${question} (précisions : ${textes.join(', ')})` : question
        const filtre = machinesCochees.length === 1
          ? { machineId: machinesCochees[0].id } // une seule machine : sa fiche est donnée à l'IA
          : machinesCochees.length ? { machineIds: machinesCochees.map((m) => m.id), groupe: machinesCochees.map((m) => m.libelle).join(', ') } : filtreMachines()
        repondre(question, filtre, { precisions, affiche })
      }
      vider(messages)
      messages.append(
        h('div', { class: 'message agent' }, question),
        h('div', { class: 'message ia' },
          h('div', { class: 'avatar' }, ic('etincelle', 18)),
          h('div', { class: 'corps carte-precisions' },
            h('p', { class: 'texte-2' }, 'Pour une réponse plus juste, cochez ce qui correspond (tout est facultatif) :'),
            machines.length ? groupe('Machine', machines) : null,
            groupes.map(([titre, options]) => groupe(titre, options)),
            h('div', { class: 'actions', style: { marginTop: '12px' } },
              h('button', { class: 'principal', onclick: () => continuer(true) }, ic('etincelle', 16), 'Chercher avec ces précisions'),
              h('button', { class: 'discret', onclick: () => continuer(false) }, 'Répondre directement')))))
      messages.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    async function repondre(question, filtre, { precisions = [], affiche = question } = {}) {
      const historique = conversation.map((m) => ({ role: m.role, contenu: m.contenu }))
      conversation.push({ role: 'agent', contenu: affiche })
      const reponse = { role: 'assistant', contenu: '', sources: [], enCours: true }
      conversation.push(reponse)
      dessinerMessages()
      let element = messages.lastElementChild
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      montrerSources(reponse)
      const remplacer = () => {
        const nouveau = dessinerMessage(reponse, rappels)
        element.replaceWith(nouveau)
        element = nouveau
      }

      enCours = new AbortController()
      vider(boutonEnvoyer, ic('stop', 18))
      boutonEnvoyer.title = 'Arrêter'
      try {
        await flux('/api/assistant', { question, historique, precisions, ...filtre }, (type, donnees) => {
          if (type === 'sources') { reponse.sources = donnees; montrerSources(reponse) }
          if (type === 'preventif') reponse.preventif = donnees
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
      montrerSources(null)
      saisie.focus()
    }

    dessinerMessages()
    vider(
      zone,
      h(
        'div',
        { class: 'discussion discussion-pleine' },
        h(
          'div',
          { class: 'fil' },
          h('div', { class: 'haut-discussion' },
            h('button', { class: 'discret petit', title: 'Aide de l’assistant', onclick: () => { onglet = 'aide'; dessinerPanneau(); ouvrirTiroir() } }, ic('aide', 14), 'Aide'),
            h('button', { class: 'discret petit', onclick: nouvelleConversation }, ic('plus', 14), 'Nouvelle conversation')),
          !etat.ia?.installee ? h('div', { class: 'bandeau' }, ic('alerte'), "L'IA n'est pas installée sur ce poste : l'assistant montre seulement les passages trouvés. Voir l’aide « Installation ».") : null,
          messages,
          zonePannes,
          h('div', { class: 'barre-machine' },
            h('span', { class: 'titre-barre-machine', title: arbre?.length ? 'Choisir une ligne ou un sous-ensemble limite la recherche aux documents, fiches et interventions de ses machines.' : 'Choisir une machine limite la recherche à ses documents, sa fiche et ses interventions.' }, ic('usine', 15), 'Machine concernée'),
            zoneMachine),
          h('div', { class: 'saisie' }, h('div', { class: 'saisie-boite' }, saisie, boutonEnvoyer)),
        ),
      ),
      tiroir,
    )
    montrerSources([...conversation].reverse().find((m) => m.role === 'assistant') || null)
    saisie.focus()

    // Question transmise par la page de recherche (« Poser la question à l'IA »).
    const transmise = sessionStorage.getItem('aitec-question')
    if (transmise) {
      sessionStorage.removeItem('aitec-question')
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

// original : l'objet de la conversation (le message affiché peut en être une copie), pour montrer ses sources.
function dessinerMessage(message, { envoyer, montrerSources }, original = message) {
  if (message.role === 'agent') return h('div', { class: 'message agent' }, message.contenu)

  const { texte: contenu, choix } = separerChoix(message.contenu)
  const texte = h('div', { class: `texte-ia ${message.enCours ? 'curseur' : ''}`, html: contenu ? texteIA(contenu) : '' })
  if (!message.contenu && message.enCours) texte.innerHTML = '<p class="discret">Recherche dans la base…</p>'
  texte.addEventListener('click', (e) => {
    const numero = e.target.dataset?.source
    if (numero && message.sources?.some((s) => String(s.numero) === numero)) montrerSources(original, numero, true)
  })

  return h(
    'div',
    { class: 'message ia' },
    h('div', { class: 'avatar' }, ic('etincelle', 18)),
    h(
      'div',
      { class: 'corps' },
      // Préventif fait ces 48 dernières heures sur les machines visées : à savoir avant de chercher plus loin.
      message.preventif?.length
        ? h('div', { class: 'bandeau-preventif' },
          h('div', { class: 'titre-preventif' }, ic('horloge', 15), `Préventif dans les dernières 48 h (${message.preventif.length})`),
          message.preventif.map((p) => h('a', { class: 'ligne-preventif', href: `#/interventions/${p.id}` },
            h('b', {}, p.dateFr), ` — ${p.repere || '?'} — `, h('span', { class: 'intervenant' }, p.intervenant || 'intervenant inconnu'),
            p.description ? h('span', { class: 'texte-3' }, ` — ${p.description}`) : null)))
        : null,
      texte,
      !message.enCours && choix.length && message.dernier
        ? h('div', { class: 'suggestions', style: { marginTop: '10px' } }, choix.map((c) => h('button', { onclick: () => envoyer(c) }, c)))
        : null,
      !message.enCours && message.contenu
        ? h('div', { class: 'actions', style: { marginTop: '8px' } },
          message.sources?.length ? h('button', { class: 'discret petit', title: 'Voir les sources de cette réponse', onclick: () => montrerSources(original, null, true) }, ic('document', 14), `${message.sources.length} source${message.sources.length > 1 ? 's' : ''}`) : null,
          h('button', { class: 'discret petit', onclick: () => navigator.clipboard.writeText(contenu).then(() => notifier('Réponse copiée')) }, 'Copier'))
        : null,
    ),
  )
}

function icone(source) {
  return { document: 'document', machine: 'usine', intervention: 'cle', panne: 'historique' }[source] || 'document'
}

function ouvrirSource(source) {
  if (source.lien.startsWith('#')) location.hash = source.lien
  else window.open(source.lien, '_blank')
}

// La conversation survit à un changement d'écran et au rechargement de la page.
function lireConversation() {
  try {
    return JSON.parse(localStorage.getItem('aitec-conversation') || '[]')
  } catch {
    return []
  }
}

function garderConversation() {
  try {
    localStorage.setItem('aitec-conversation', JSON.stringify(conversation.slice(-40)))
  } catch {
    // stockage indisponible : la conversation ne sera simplement pas gardée
  }
}
