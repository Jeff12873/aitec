// Les documents : dépôt de fichiers, lecture par l'IA, consultation et traduction.
//
// Les PDF et les images sont lus ici, dans le navigateur, avec pdf.js :
//   - une page qui contient du texte : on envoie ce texte ;
//   - une page sans texte (scan) ou une photo : on l'envoie en image à l'IA, qui la lit.

import { h, vider, ic, tableau, fenetre, confirmer, essayer, notifier, dateFr, tailleFr, apresPause } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { estAdmin } from '/socle/etat.js'
import { texteIA } from '/socle/texte-ia.js'

export const GENRES = { document: 'Documents', schema: 'Schémas (électriques, pneumatiques…)', plan: 'Plans mécaniques' }

const ETATS = {
  lu: ['vert', 'Lu par l’IA'],
  'a-lire': ['orange', 'À lire'],
  'piece-jointe': ['', 'Pièce jointe'],
  erreur: ['rouge', 'Erreur'],
  images: ['violet', 'Analyse des images…'],
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
    const avancement = h('div')
    const recherche = h('input', { type: 'search', placeholder: 'Nom du document…' })
    const machine = h('select', {}, h('option', { value: '' }, 'Toutes les machines'), machines.map((m) => h('option', { value: m.id, selected: String(m.id) === query.machine }, `${m.repere} — ${m.designation}`)))
    const zoneSuivi = h('div', { class: 'legende', style: { marginTop: '14px' } })
    const genre = h('select', { style: { width: 'auto' } }, Object.entries(GENRES).map(([cle, libelle]) => h('option', { value: cle }, libelle)))

    let suivi = null
    async function charger() {
      const [documents, lecture] = await Promise.all([api('/api/documents?' + new URLSearchParams({ q: recherche.value, machine: machine.value })), api('/api/documents/lecture-images')])
      vider(avancement, lecture.images ? bandeauLecture(lecture) : null)
      // Tant que l'IA lit des images, la liste se met à jour toute seule.
      clearTimeout(suivi)
      if (documents.some((d) => d.etat === 'images')) suivi = setTimeout(() => liste.isConnected && charger(), 10_000)
      vider(
        liste,
        tableau({
          lignes: documents,
          vide: 'Aucun document. Déposez les notices, schémas, procédures, fiches techniques…',
          colonnes: [
            { titre: 'Nom', valeur: (d) => [h('a', { href: `/api/documents/${d.id}/fichier`, target: '_blank' }, d.nom), d.genre && d.genre !== 'document' ? [' ', h('span', { class: 'etiquette violet' }, d.genre === 'schema' ? 'Schéma' : 'Plan')] : null] },
            { titre: 'Machine', valeur: (d) => (d.repere ? h('a', { href: `#/parc/${d.machine_id}`, class: 'mono' }, d.repere) : '') },
            { titre: 'État', valeur: (d) => h('span', { class: `etiquette ${ETATS[d.etat]?.[0] || ''}`, title: d.message }, ETATS[d.etat]?.[1] || d.etat) },
            { titre: 'Taille', classe: 'nombre', valeur: (d) => tailleFr(d.taille) },
            { titre: 'Ajouté', valeur: (d) => h('span', { class: 'texte-2' }, `${dateFr(d.ajoute_le)} ${d.ajoute_par ? '· ' + d.ajoute_par : ''}`) },
            {
              titre: '',
              valeur: (d) =>
                h('div', { class: 'actions', style: { flexWrap: 'nowrap' } },
                  d.passages ? h('button', { class: 'petit', title: 'Voir le texte lu et le traduire', onclick: () => voirTexte(d) }, ic('oeil', 15)) : null,
                  estAdmin() && ['a-lire', 'erreur'].includes(d.etat) ? h('button', { class: 'petit', title: 'Lire ce document', onclick: () => relire(d) }, ic('rafraichir', 15), 'Lire') : null,
                  estAdmin() && !['a-lire', 'erreur', 'piece-jointe'].includes(d.etat) ? h('button', { class: 'petit', title: 'Relire ce document (texte et images)', onclick: () => relire(d) }, ic('rafraichir', 15)) : null,
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
      h('div', { class: 'discret', style: { fontSize: '13px', marginTop: '4px' } }, 'PDF (même scannés), Word, Excel, PowerPoint (récents et anciens, photos comprises), LibreOffice, CSV, texte, photos… Les autres fichiers sont rangés en pièces jointes.'),
      choixFichiers,
    )

    async function deposer(fichiers) {
      for (const fichier of fichiers) {
        const ligne = suiviFichier(zoneSuivi, fichier.name)
        try {
          ligne.etape('Envoi…', 0.05)
          const entetes = { 'X-Nom': encodeURIComponent(fichier.name), 'X-Machine': machine.value || '', 'X-Genre': genre.value }
          let resultat
          try {
            resultat = await api('/api/documents', { methode: 'POST', fichier, entetes })
          } catch (erreur) {
            if (erreur.statut !== 409 || !(await confirmer(`${erreur.message} L’ajouter quand même ?`))) throw erreur
            resultat = await api('/api/documents?forcer=1', { methode: 'POST', fichier, entetes })
          }
          if (resultat.lecture === 'navigateur') await lireDansLeNavigateur(resultat.id, fichier, ligne, genre.value)
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
      estAdmin()
        ? h('div', { class: 'carte', style: { marginBottom: '16px' } },
            h('div', { class: 'actions', style: { marginBottom: '12px' } }, h('span', { class: 'texte-2' }, 'Les fichiers déposés sont des :'), genre),
            h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Schémas et plans (PDF) : chaque page est analysée par l’IA, qui la regardera aussi pour répondre (compter environ une minute par page). Machine de rattachement : choisissez-la dans le filtre ci-dessous (facultatif).'),
            depot, zoneSuivi)
        : null,
      avancement,
      h('div', { class: 'filtres' }, recherche, machine, estAdmin() ? h('button', { title: 'Relire Word, Excel, PowerPoint… avec la dernière version d’IASSITEC (images comprises)', onclick: relireTout }, ic('rafraichir', 16), 'Tout relire') : null),
      liste,
    )
    await charger()

    async function relireTout() {
      if (!(await confirmer('Relire tous les documents Word, Excel, PowerPoint, LibreOffice et texte ? Les images qu’ils contiennent seront lues par l’IA en arrière-plan (cela peut prendre du temps). Les PDF et les photos ne sont pas concernés.'))) return
      const resultat = await essayer(() => api('/api/documents/relire-tout', { methode: 'POST' }))
      if (resultat) {
        notifier(`${resultat.relus} documents relus. Lecture des images en cours…`)
        charger()
      }
    }
  },
}

// Avancement de la lecture des images en arrière-plan (environ 2 secondes par image avec une carte graphique).
function bandeauLecture({ documents, images }) {
  const minutes = Math.max(1, Math.round((images * 2) / 60))
  return h(
    'div',
    { class: 'bandeau info' },
    h('span', { class: 'point anime' }),
    h('div', {},
      h('strong', {}, `L’IA lit les images : ${images} restante${images > 1 ? 's' : ''} dans ${documents} document${documents > 1 ? 's' : ''}`),
      ` (environ ${minutes} min avec une carte graphique, bien plus sur le processeur). `,
      'Le texte des documents est déjà interrogeable ; restez en mode administrateur jusqu’à la fin, sinon la lecture reprendra au prochain passage.',
    ),
  )
}

// ---------------------------------------------------------------- lecture des PDF et des images

async function lireDansLeNavigateur(id, fichier, ligne, genre = 'document') {
  const nom = fichier.name.toLowerCase()
  try {
    verifierImagesDuNavigateur()
    if (nom.endsWith('.pdf')) await lirePdf(id, fichier, ligne, genre)
    else await lireImage(id, fichier, ligne)
  } catch (erreur) {
    await api(`/api/documents/${id}/fin`, { methode: 'POST', corps: { erreur: erreur.message } })
    throw erreur
  }
}

// Lecture d'un PDF, page par page :
//   - le texte de la page (s'il y en a) ;
//   - schéma ou plan : chaque page est dessinée en image (entière + deux moitiés agrandies) et envoyée au
//     serveur, où l'IA l'analysera en arrière-plan ; l'image entière est gardée pour les questions ;
//   - document : une page scannée (sans texte) est lue tout de suite par l'IA ; une page avec des photos
//     est envoyée pour que l'IA décrive les illustrations en arrière-plan.
async function lirePdf(id, fichier, ligne, genre) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'
  const pdf = await pdfjs.getDocument({ data: await fichier.arrayBuffer(), cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true }).promise
  const envoyerImage = (numero, partie, image) => api(`/api/documents/${id}/rendu?page=${numero}&partie=${partie}`, { methode: 'POST', fichier: image })

  let lot = []
  for (let numero = 1; numero <= pdf.numPages; numero++) {
    const page = await pdf.getPage(numero)
    const contenu = await page.getTextContent()
    let texte = contenu.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('')
    const avancement = numero / pdf.numPages

    if (genre === 'schema' || genre === 'plan') {
      ligne.etape(`Page ${numero} / ${pdf.numPages} : préparation des images`, avancement)
      const toile = await dessinerPage(page, 3200)
      await envoyerImage(numero, 'page', await enJpeg(toile, 1800))
      await envoyerImage(numero, 'gauche', await enJpeg(toile, 1800, 'gauche'))
      await envoyerImage(numero, 'droite', await enJpeg(toile, 1800, 'droite'))
    } else if (texte.replace(/\s/g, '').length < 30) {
      ligne.etape(`Page ${numero} / ${pdf.numPages} : lecture du scan par l’IA…`, avancement)
      texte = (await api(`/api/documents/${id}/image?page=${numero}`, { methode: 'POST', fichier: await enJpeg(await dessinerPage(page, 1600)) })).texte
    } else {
      ligne.etape(`Page ${numero} / ${pdf.numPages}`, avancement)
      if (await contientDesPhotos(page, pdfjs)) await envoyerImage(numero, 'page', await enJpeg(await dessinerPage(page, 1600)))
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

// Certains navigateurs (LibreWolf, Firefox avec « resistFingerprinting », Brave…) brouillent les images
// produites par les pages, pour empêcher le pistage. IASSITEC enregistrerait alors des rayures à la place
// des pages : on vérifie avant, en dessinant quatre couleurs connues et en les relisant.
export function verifierImagesDuNavigateur() {
  const toile = document.createElement('canvas')
  toile.width = toile.height = 4
  const contexte = toile.getContext('2d', { willReadFrequently: true })
  const couleurs = ['#ff0000', '#00ff00', '#0000ff', '#ffffff']
  couleurs.forEach((couleur, i) => {
    contexte.fillStyle = couleur
    contexte.fillRect((i % 2) * 2, Math.floor(i / 2) * 2, 2, 2)
  })
  const attendu = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]
  const lu = contexte.getImageData(0, 0, 4, 4).data
  const fiable = attendu.every(([r, v, b], i) => {
    const position = ((Math.floor(i / 2) * 2) * 4 + (i % 2) * 2) * 4
    return lu[position] === r && lu[position + 1] === v && lu[position + 2] === b
  })
  if (!fiable) {
    throw new Error(
      'Ce navigateur brouille les images des pages (protection contre le pistage : LibreWolf, Firefox renforcé, Brave…). ' +
        'IASSITEC ne peut pas y lire les schémas, plans et PDF scannés. Autorisez 127.0.0.1 dans ses réglages, ' +
        'ou ouvrez IASSITEC dans Chrome, Edge ou Firefox (voir l’aide « Dépannage »).',
    )
  }
}

// La page contient-elle une vraie image (photo, capture), et pas seulement un logo ?
async function contientDesPhotos(page, pdfjs) {
  const operations = await page.getOperatorList()
  return operations.fnArray.some((fonction, i) => {
    if (fonction !== pdfjs.OPS.paintImageXObject && fonction !== pdfjs.OPS.paintImageXObjectRepeat) return false
    const [, largeur, hauteur] = operations.argsArray[i]
    return largeur * hauteur >= 250 * 250
  })
}

// Dessine la page sur une toile d'environ « taille » pixels de côté.
async function dessinerPage(page, taille) {
  const vue = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(6, taille / Math.max(vue.width, vue.height)) })
  const toile = document.createElement('canvas')
  toile.width = Math.round(viewport.width)
  toile.height = Math.round(viewport.height)
  const contexte = toile.getContext('2d')
  contexte.fillStyle = '#fff'
  contexte.fillRect(0, 0, toile.width, toile.height)
  await page.render({ canvasContext: contexte, viewport }).promise
  return toile
}

// Image JPEG de la toile (ou de sa moitié gauche / droite, dans le sens de la longueur), « taille » pixels au plus.
function enJpeg(toile, taille = 1600, moitie = null) {
  let x = 0
  let y = 0
  let largeur = toile.width
  let hauteur = toile.height
  if (moitie) {
    // On coupe dans le sens de la plus grande dimension, avec un recouvrement de 10 %.
    if (largeur >= hauteur) {
      largeur = Math.round(toile.width * 0.55)
      x = moitie === 'gauche' ? 0 : toile.width - largeur
    } else {
      hauteur = Math.round(toile.height * 0.55)
      y = moitie === 'gauche' ? 0 : toile.height - hauteur
    }
  }
  const echelle = Math.min(1, taille / Math.max(largeur, hauteur))
  const sortie = document.createElement('canvas')
  sortie.width = Math.round(largeur * echelle)
  sortie.height = Math.round(hauteur * echelle)
  sortie.getContext('2d').drawImage(toile, x, y, largeur, hauteur, 0, 0, sortie.width, sortie.height)
  return new Promise((ok) => sortie.toBlob(ok, 'image/jpeg', 0.85))
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
      await lireDansLeNavigateur(d.id, fichier, suiviFichier(zone, d.nom), d.genre)
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
  const genre = h('select', {}, Object.entries(GENRES).map(([cle, libelle]) => h('option', { value: cle, selected: cle === d.genre }, libelle)))
  await fenetre({
    titre: 'Modifier le document',
    contenu: h('div', { class: 'formulaire' },
      h('label', { class: 'champ large' }, h('span', {}, 'Nom'), nom),
      h('label', { class: 'champ large' }, h('span', {}, 'Machine'), machine),
      h('label', { class: 'champ large' }, h('span', {}, 'Type'), genre, h('small', { class: 'aide' }, 'Pour un PDF, changer le type fait relire le document.')),
    ),
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      {
        texte: 'Enregistrer',
        classe: 'principal',
        action: async () => {
          await api(`/api/documents/${d.id}`, { methode: 'PUT', corps: { nom: nom.value.trim(), machine_id: machine.value, genre: genre.value } })
          if (genre.value !== d.genre && d.nom.toLowerCase().endsWith('.pdf')) await relire({ ...d, genre: genre.value })
          else window.iassitec.recharger()
        },
      },
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
