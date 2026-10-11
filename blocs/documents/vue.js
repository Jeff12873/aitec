// Les documents : dépôt de fichiers, lecture par l'IA, consultation et traduction.
//
// Les PDF et les images sont lus ici, dans le navigateur, avec pdf.js :
//   - une page qui contient du texte : on envoie ce texte ;
//   - une page sans texte (scan) ou une photo : on l'envoie en image à l'IA, qui la lit.

import { h, vider, ic, tableau, fenetre, confirmer, essayer, notifier, dateFr, tailleFr, apresPause } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { estAdmin } from '/socle/etat.js'
import { texteIA } from '/socle/texte-ia.js'

const ETATS = {
  lu: ['vert', 'Lu par l’IA'],
  'a-lire': ['orange', 'À lire'],
  'piece-jointe': ['', 'Pièce jointe'],
  erreur: ['rouge', 'Erreur'],
}

export default {
  chemin: 'documents',
  titre: 'Documents',
  icone: 'document',
  menu: false,
  aide: 'documents',

  async afficher(zone, { query }) {
    const machines = await api('/api/machines')
    const liste = h('div')
    const recherche = h('input', { type: 'search', placeholder: 'Nom du document…' })
    const machine = h('select', {}, h('option', { value: '' }, 'Toutes les machines'), machines.map((m) => h('option', { value: m.id, selected: String(m.id) === query.machine }, `${m.repere} — ${m.designation}`)))
    const suivi = h('div', { class: 'legende', style: { marginTop: '14px' } })

    async function charger() {
      const documents = await api('/api/documents?' + new URLSearchParams({ q: recherche.value, machine: machine.value }))
      vider(
        liste,
        tableau({
          lignes: documents,
          vide: 'Aucun document. Déposez les notices, schémas, procédures, fiches techniques…',
          colonnes: [
            { titre: 'Nom', valeur: (d) => h('a', { href: `/api/documents/${d.id}/fichier`, target: '_blank' }, d.nom) },
            { titre: 'Machine', valeur: (d) => (d.repere ? h('a', { href: `#/parc/${d.machine_id}`, class: 'mono' }, d.repere) : '') },
            { titre: 'État', valeur: (d) => h('span', { class: `etiquette ${ETATS[d.etat]?.[0] || ''}`, title: d.message }, ETATS[d.etat]?.[1] || d.etat) },
            { titre: 'Taille', classe: 'nombre', valeur: (d) => tailleFr(d.taille) },
            { titre: 'Ajouté', valeur: (d) => h('span', { class: 'texte-2' }, `${dateFr(d.ajoute_le)} ${d.ajoute_par ? '· ' + d.ajoute_par : ''}`) },
            {
              titre: '',
              valeur: (d) =>
                h('div', { class: 'actions', style: { flexWrap: 'nowrap' } },
                  d.passages ? h('button', { class: 'petit', title: 'Voir le texte lu et le traduire', onclick: () => voirTexte(d) }, ic('oeil', 15)) : null,
                  estAdmin() && d.etat !== 'lu' && d.etat !== 'piece-jointe' ? h('button', { class: 'petit', title: 'Lire ce document', onclick: () => relire(d, machine.value) }, ic('rafraichir', 15), 'Lire') : null,
                  estAdmin() ? h('button', { class: 'petit', title: 'Machine, nom…', onclick: () => modifier(d, machines) }, ic('crayon', 15)) : null,
                  estAdmin() ? h('button', { class: 'petit danger', title: 'Supprimer', onclick: () => supprimer(d) }, ic('poubelle', 15)) : null,
                ),
            },
          ],
        }),
      )
    }
    recherche.addEventListener('input', apresPause(charger))
    machine.addEventListener('change', charger)

    // Zone de dépôt (mode administrateur)
    const choixFichiers = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: (e) => deposer([...e.target.files]) })
    const depot = h(
      'div',
      {
        class: 'depot',
        onclick: () => choixFichiers.click(),
        ondragover: (e) => {
          e.preventDefault()
          depot.classList.add('survol')
        },
        ondragleave: () => depot.classList.remove('survol'),
        ondrop: (e) => {
          e.preventDefault()
          depot.classList.remove('survol')
          deposer([...e.dataTransfer.files])
        },
      },
      ic('envoyer', 30),
      h('div', {}, h('strong', {}, 'Déposez vos fichiers ici'), ' ou cliquez pour les choisir'),
      h('div', { class: 'discret', style: { fontSize: '13px', marginTop: '4px' } }, 'PDF (même scannés), Word, Excel, LibreOffice, PowerPoint, CSV, texte, photos… Les autres fichiers sont rangés en pièces jointes.'),
      choixFichiers,
    )

    async function deposer(fichiers) {
      for (const fichier of fichiers) {
        const ligne = suiviFichier(suivi, fichier.name)
        try {
          ligne.etape('Envoi…', 0.05)
          const entetes = { 'X-Nom': encodeURIComponent(fichier.name), 'X-Machine': machine.value || '' }
          let resultat
          try {
            resultat = await api('/api/documents', { methode: 'POST', fichier, entetes })
          } catch (erreur) {
            if (erreur.statut !== 409 || !(await confirmer(`${erreur.message} L’ajouter quand même ?`))) throw erreur
            resultat = await api('/api/documents?forcer=1', { methode: 'POST', fichier, entetes })
          }
          if (resultat.lecture === 'navigateur') await lireDansLeNavigateur(resultat.id, fichier, ligne)
          ligne.fin(resultat.lecture === 'aucune' ? 'Rangé en pièce jointe' : 'Lu par l’IA')
        } catch (erreur) {
          ligne.erreur(erreur.message)
        }
      }
      charger()
    }

    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Documents'), h('p', { class: 'sous-titre' }, 'Notices, schémas, procédures : tout ce que l’IA peut lire pour vous répondre'))),
      estAdmin() ? h('div', { class: 'carte', style: { marginBottom: '16px' } }, h('p', { class: 'texte-2' }, 'Machine à laquelle rattacher les fichiers déposés : choisissez-la dans le filtre ci-dessous (facultatif).'), depot, suivi) : null,
      h('div', { class: 'filtres' }, recherche, machine),
      liste,
    )
    await charger()
  },
}

// ---------------------------------------------------------------- lecture des PDF et des images

async function lireDansLeNavigateur(id, fichier, ligne) {
  const nom = fichier.name.toLowerCase()
  try {
    if (nom.endsWith('.pdf')) await lirePdf(id, fichier, ligne)
    else await lireImage(id, fichier, ligne)
  } catch (erreur) {
    await api(`/api/documents/${id}/fin`, { methode: 'POST', corps: { erreur: erreur.message } })
    throw erreur
  }
}

async function lirePdf(id, fichier, ligne) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'
  const pdf = await pdfjs.getDocument({ data: await fichier.arrayBuffer(), cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true }).promise

  let lot = []
  for (let numero = 1; numero <= pdf.numPages; numero++) {
    const page = await pdf.getPage(numero)
    const contenu = await page.getTextContent()
    let texte = contenu.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('')

    // Page sans texte (scan) : on la fait lire par l'IA, en image.
    if (texte.replace(/\s/g, '').length < 30) {
      ligne.etape(`Page ${numero} / ${pdf.numPages} : lecture du scan par l’IA…`, numero / pdf.numPages)
      const image = await pageEnImage(page)
      texte = (await api(`/api/documents/${id}/image?page=${numero}`, { methode: 'POST', fichier: image })).texte
    } else {
      ligne.etape(`Page ${numero} / ${pdf.numPages}`, numero / pdf.numPages)
    }
    if (texte.trim()) lot.push({ page: numero, texte })
    // On envoie le texte par paquets de 20 pages.
    if (lot.length >= 20) {
      await api(`/api/documents/${id}/pages`, { methode: 'POST', corps: lot })
      lot = []
    }
  }
  if (lot.length) await api(`/api/documents/${id}/pages`, { methode: 'POST', corps: lot })
  await api(`/api/documents/${id}/fin`, { methode: 'POST', corps: { pages: pdf.numPages } })
}

async function pageEnImage(page) {
  const vue = page.getViewport({ scale: 1 })
  const echelle = Math.min(2, 1600 / Math.max(vue.width, vue.height)) // environ 1600 pixels de côté
  const viewport = page.getViewport({ scale: echelle })
  const toile = document.createElement('canvas')
  toile.width = Math.round(viewport.width)
  toile.height = Math.round(viewport.height)
  const contexte = toile.getContext('2d')
  contexte.fillStyle = '#fff'
  contexte.fillRect(0, 0, toile.width, toile.height)
  await page.render({ canvasContext: contexte, viewport }).promise
  return new Promise((ok) => toile.toBlob(ok, 'image/jpeg', 0.85))
}

async function lireImage(id, fichier, ligne) {
  ligne.etape('Lecture de l’image par l’IA…', 0.5)
  const image = await createImageBitmap(fichier)
  const echelle = Math.min(1, 1600 / Math.max(image.width, image.height))
  const toile = document.createElement('canvas')
  toile.width = Math.round(image.width * echelle)
  toile.height = Math.round(image.height * echelle)
  toile.getContext('2d').drawImage(image, 0, 0, toile.width, toile.height)
  const jpeg = await new Promise((ok) => toile.toBlob(ok, 'image/jpeg', 0.85))
  const { texte } = await api(`/api/documents/${id}/image?page=1`, { methode: 'POST', fichier: jpeg })
  if (texte.trim()) await api(`/api/documents/${id}/pages`, { methode: 'POST', corps: [{ page: null, texte }] })
  await api(`/api/documents/${id}/fin`, { methode: 'POST', corps: { pages: 1 } })
}

// Une ligne de suivi par fichier déposé.
function suiviFichier(conteneur, nom) {
  const texte = h('span', { class: 'texte-2' }, 'En attente')
  const barre = h('div')
  const ligne = h('div', { style: { display: 'block' } }, h('div', { class: 'actions', style: { justifyContent: 'space-between' } }, h('b', {}, nom), texte), h('div', { class: 'progression', style: { marginTop: '6px' } }, barre))
  conteneur.prepend(ligne)
  return {
    etape(message, avancement) {
      texte.textContent = message
      barre.style.width = `${Math.round(avancement * 100)}%`
    },
    fin(message) {
      texte.textContent = '✓ ' + message
      barre.style.width = '100%'
    },
    erreur(message) {
      texte.textContent = '⚠ ' + message
      texte.style.color = 'var(--rouge)'
    },
  }
}

// ---------------------------------------------------------------- actions sur un document

async function relire(d) {
  const resultat = await essayer(() => api(`/api/documents/${d.id}/relire`, { methode: 'POST' }))
  if (!resultat) return
  if (resultat.lecture === 'navigateur') {
    // Le navigateur doit relire le fichier : on le récupère depuis la base.
    const reponse = await fetch(`/api/documents/${d.id}/fichier`)
    const fichier = new File([await reponse.blob()], d.nom, { type: reponse.headers.get('Content-Type') })
    const zone = h('div', { class: 'legende' })
    fenetre({ titre: `Lecture de ${d.nom}`, contenu: zone })
    try {
      await lireDansLeNavigateur(d.id, fichier, suiviFichier(zone, d.nom))
      notifier('Document lu')
    } catch (erreur) {
      notifier(erreur.message, 'erreur')
    }
  }
  window.iassitec.recharger()
}

async function modifier(d, machines) {
  const nom = h('input', { value: d.nom })
  const machine = h('select', {}, h('option', { value: '' }, '— aucune —'), machines.map((m) => h('option', { value: m.id, selected: m.id === d.machine_id }, `${m.repere} — ${m.designation}`)))
  await fenetre({
    titre: 'Modifier le document',
    contenu: h('div', { class: 'formulaire' }, h('label', { class: 'champ large' }, h('span', {}, 'Nom'), nom), h('label', { class: 'champ large' }, h('span', {}, 'Machine'), machine)),
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      { texte: 'Enregistrer', classe: 'principal', action: () => api(`/api/documents/${d.id}`, { methode: 'PUT', corps: { nom: nom.value.trim(), machine_id: machine.value } }).then(() => window.iassitec.recharger()) },
    ],
  })
}

async function supprimer(d) {
  if (!(await confirmer(`Supprimer « ${d.nom} » de la base ?`, { texte: 'Supprimer', danger: true }))) return
  if (await essayer(() => api(`/api/documents/${d.id}`, { methode: 'DELETE' }), 'Document supprimé')) window.iassitec.recharger()
}

// Le texte lu, page par page, avec traduction en français.
async function voirTexte(d) {
  const passages = await api(`/api/documents/${d.id}/texte`)
  const pages = new Map()
  for (const p of passages) pages.set(p.page, [...(pages.get(p.page) || []), p.texte])

  const contenu = h(
    'div',
    {},
    h('p', { class: 'texte-2' }, 'Voici le texte que l’IA a lu dans ce document. « Traduire » donne la version française d’une page.'),
    [...pages.entries()].map(([page, morceaux]) => {
      const texte = morceaux.join('\n…\n')
      const zoneTexte = h('div', { class: 'texte-2', style: { whiteSpace: 'pre-wrap', fontSize: '14px' } }, texte)
      const bouton = h('button', {
        class: 'petit',
        onclick: async () => {
          bouton.disabled = true
          bouton.textContent = 'Traduction…'
          const resultat = await essayer(() => api('/api/traduire', { methode: 'POST', corps: { texte } }))
          bouton.remove()
          if (resultat) {
            zoneTexte.classList.remove('texte-2')
            zoneTexte.style.whiteSpace = 'normal'
            zoneTexte.innerHTML = texteIA(resultat.texte)
          }
        },
      }, ic('langue', 15), 'Traduire')
      return h('div', { class: 'carte', style: { marginBottom: '12px', padding: '14px 16px' } }, h('div', { class: 'actions', style: { justifyContent: 'space-between', marginBottom: '8px' } }, h('b', {}, page ? `Page ${page}` : 'Texte'), bouton), zoneTexte)
    }),
  )
  fenetre({ titre: d.nom, contenu, large: true })
}
