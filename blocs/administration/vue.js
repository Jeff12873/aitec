// Administration d'AITEC : documents donnés à l'IA, données de la GMAO (base MySQL ou exports), et réglages
// (nom de l'atelier, glossaire, index de recherche, modèle d'IA, reprise d'un ancien fichier IASSITEC).
// Le fichier .ktec lui-même (ouverture, mot de passe, sauvegardes) se règle dans les Réglages de KTEC.

import { h, vider, ic, essayer, notifier, confirmer, tailleFr, nombreFr } from '/socle/ui.js'
import { menuDeroulant } from '../../interface/menu-deroulant.js'
import { api } from '/socle/api.js'
import { peutModifier, actualiserEtat } from '/socle/etat.js'
import { ouvrirModeAdmin } from '/socle/fichier.js'
import documents from '../documents/vue.js'
import importGmao from '../import-gmao/vue.js'

// Les trois onglets de l'administration. Documents et Données GMAO réutilisent les écrans de leurs blocs.
const ONGLETS = [
  ['documents', 'Documents', 'document'],
  ['import', 'Données de la GMAO', 'tableur'],
  ['reglages', 'Réglages', 'reglages'],
]

export default {
  chemin: 'administration',
  titre: 'Administration',
  icone: 'reglages',
  menu: true,
  aide: 'administration',

  async afficher(zone, { id, query }) {
    const onglet = ONGLETS.some(([cle]) => cle === id) ? id : 'documents'
    const contenu = h('div', { class: 'onglet-contenu' })
    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Administration'), h('p', { class: 'sous-titre' }, 'Ce que l’IA connaît (documents, données de la GMAO) et les réglages d’AITEC'))),
      h('div', { class: 'segments', style: { marginBottom: '20px' } },
        ONGLETS.map(([cle, titre, icone]) => h('button', { class: cle === onglet ? 'choisi' : '', onclick: () => (location.hash = `#/administration/${cle}`) }, ic(icone, 16), titre)),
      ),
      contenu,
    )
    if (onglet === 'reglages') return afficherReglages(contenu)
    if (!peutModifier()) {
      vider(contenu, h('div', { class: 'carte' }, h('div', { class: 'actions' }, ic('cadenas'), h('span', { style: { flex: 1 } }, 'Ajouter des documents ou mettre à jour les données de la GMAO demande le mode administrateur.'), h('button', { class: 'principal', onclick: ouvrirModeAdmin }, 'Passer en mode administrateur'))))
      return
    }
    if (onglet === 'documents') return documents.afficher(contenu, { query })
    return importGmao.afficher(contenu, { query })
  },
}

async function afficherReglages(zone) {
  const infos = await api('/api/admin/infos')
  vider(
    zone,
    h('div', { class: 'grille grille-2' },
      carteContenu(infos),
      carteModele(),
      peutModifier()
        ? [carteGlossaire(), carteAtelier(infos), carteArborescence(), carteIndex(infos), carteReprise(infos)]
        : h('div', { class: 'carte pleine' }, h('div', { class: 'actions' }, ic('cadenas'), h('span', { style: { flex: 1 } }, 'Le nom de l’atelier, le glossaire et l’index de recherche se règlent en mode administrateur.'), h('button', { onclick: ouvrirModeAdmin }, 'Passer en mode administrateur'))),
    ),
  )
}

function carte(icone, titre, ...contenu) {
  return h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic(icone, 18), titre)), ...contenu)
}

function ligne(libelle, valeur) {
  return h('div', { style: { display: 'flex', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--bord)' } }, h('span', { class: 'discret', style: { minWidth: '150px' } }, libelle), h('span', { style: { wordBreak: 'break-all' } }, valeur || '—'))
}

// ---------------------------------------------------------------- contenu

function carteContenu(infos) {
  const s = infos.statistiques
  return carte(
    'nuage',
    'Ce que l’IA connaît',
    ligne('Machines', nombreFr(s.machines)),
    ligne('Interventions', nombreFr(s.interventions)),
    ligne('Documents', `${nombreFr(s.documents)} (${tailleFr(s.octetsDocuments)})`),
    ligne('Passages', nombreFr(s.passages)),
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: '10px' } }, 'Tout est rangé dans le fichier de connaissances commun de KTEC : ', h('span', { class: 'mono' }, infos.fichier), '.'),
  )
}

function carteModele() {
  const zone = h('div', {}, h('p', { class: 'discret' }, 'Chargement…'))
  let minuterie = null

  async function dessiner() {
    const etat = await api('/api/modeles')
    if (!zone.isConnected && minuterie) return clearTimeout(minuterie)
    if (!etat.installe) return vider(zone, h('p', { class: 'discret' }, 'L’IA n’est pas installée sur ce poste : lancez d’abord l’installation de KTEC.'))
    const t = etat.telechargement
    const enCours = t && !t.fini && !t.erreur
    vider(
      zone,
      etat.modeles.map((m) =>
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--bord)' } },
          h('div', { style: { flex: 1 } },
            h('b', {}, m.nom), ' ',
            m.code === etat.actif ? h('span', { class: 'etiquette accent' }, 'utilisé') : null, ' ',
            m.code === etat.conseille ? h('span', { class: 'etiquette' }, 'conseillé pour ce poste') : null,
            h('div', { class: 'discret', style: { fontSize: '13px' } }, `${m.tailleGo.toLocaleString('fr-FR')} Go — ${m.pour}`),
          ),
          m.code === etat.actif ? null : h('button', { class: 'petit', disabled: enCours, onclick: () => choisir(m) }, m.present ? 'Utiliser' : 'Télécharger et utiliser'),
        ),
      ),
      enCours ? h('div', { style: { marginTop: '12px' } }, h('div', { class: 'texte-2' }, `Téléchargement : ${tailleFr(t.recu)} sur ${tailleFr(t.total)}`), h('div', { class: 'progression', style: { marginTop: '6px' } }, h('div', { style: { width: `${Math.min(100, (t.recu / t.total) * 100)}%` } }))) : null,
      t?.erreur ? h('div', { class: 'bandeau', style: { marginTop: '12px' } }, ic('alerte'), t.erreur) : null,
    )
    clearTimeout(minuterie)
    if (enCours) minuterie = setTimeout(dessiner, 2000)
  }

  async function choisir(m) {
    const message = m.present
      ? `Utiliser ${m.nom} sur ce poste ? L’IA redémarre à la prochaine question.`
      : `Télécharger ${m.nom} (${m.tailleGo.toLocaleString('fr-FR')} Go) puis l’utiliser sur ce poste ? Il faut une connexion à Internet ; AITEC reste utilisable pendant le téléchargement.`
    if (!(await confirmer(message))) return
    const resultat = await essayer(() => api(`/api/modeles/${m.code}`, { methode: 'POST' }))
    if (resultat?.pret) notifier(`${m.nom} est maintenant utilisé.`)
    dessiner()
  }

  dessiner()
  return carte(
    'etincelle',
    'Modèle d’IA de ce poste',
    h('p', { class: 'texte-2' }, 'Un modèle plus lourd comprend mieux les schémas et les questions difficiles, mais demande plus de mémoire et répond plus lentement. Ce choix ne concerne que ce poste, et vaut pour toutes les applications KTEC.'),
    zone,
  )
}

// ---------------------------------------------------------------- glossaire des repères (commun)

function carteGlossaire() {
  const texte = h('textarea', { rows: 12, class: 'mono', style: { fontSize: '13px' } })
  api('/api/glossaire').then((g) => (texte.value = g.texte))
  return h(
    'div',
    { class: 'carte pleine' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('livre', 18), 'Glossaire des repères')),
    h('p', { class: 'texte-2' }, 'Ce que signifient les repères de vos schémas (une ligne par code). L’IA s’en sert pour lire les folios et pour répondre : adaptez-le aux conventions de votre site. Après une modification, « Tout relire » dans Documents fait relire les schémas avec le nouveau glossaire.'),
    texte,
    h('div', { class: 'actions', style: { marginTop: '10px' } },
      h('button', { class: 'principal', onclick: () => essayer(() => api('/api/admin/glossaire', { methode: 'POST', corps: { texte: texte.value } }), 'Glossaire enregistré') }, 'Enregistrer'),
      h('button', { class: 'discret', onclick: async () => { if (await confirmer('Revenir au glossaire d’origine ?')) { await essayer(() => api('/api/admin/glossaire', { methode: 'POST', corps: { texte: '' } })); texte.value = (await api('/api/glossaire')).texte } } }, 'Revenir à l’original'),
    ),
  )
}

// ---------------------------------------------------------------- arborescence des machines

// La GMAO peut tenir plusieurs arborescences : on choisit celle qui sert à désigner la machine dans l'assistant.
function carteArborescence() {
  const corps = h('div', {}, h('p', { class: 'discret' }, 'Lecture de l’arborescence…'))
  const charger = () => api('/api/arborescence').then((a) => {
    if (!a) return vider(corps, h('p', { class: 'texte-2' }, 'Pas d’arborescence : réglez sa requête dans PDRTec › Paramètres (et connectez-vous à la base de la GMAO).'))
    if (!a.arbres.length) return vider(corps, h('p', { class: 'texte-2' }, `${a.lignes.length} lignes, toutes arborescences confondues. Pour n’en garder qu’une (celle de la maintenance, par exemple), ajoutez à la requête de l’arborescence, dans PDRTec › Paramètres, une colonne « arbre » qui donne le nom de l’arborescence de chaque nœud.`))
    vider(corps,
      h('p', { class: 'texte-2' }, 'Celle qui sert à choisir la machine dans l’assistant (ligne, puis sous-ensemble).'),
      menuDeroulant({
        choix: a.arbres.map((x) => ({ valeur: x.nom, libelle: x.nom || '(sans nom)', nombre: x.machines })),
        valeur: a.arbre,
        surChoix: async (arbre) => { await essayer(() => api('/api/arborescence/choix', { methode: 'POST', corps: { arbre } }), 'Arborescence enregistrée'); charger() },
      }))
  }).catch((e) => vider(corps, h('p', { class: 'texte-2' }, `Arborescence illisible : ${e.message}`)))
  charger()
  return carte('reseau', 'Arborescence des machines', corps)
}

// ---------------------------------------------------------------- nom de l'atelier

function carteAtelier(infos) {
  const nom = h('input', { value: infos.atelier || '' })
  return carte(
    'usine',
    'Nom de l’atelier',
    h('p', { class: 'texte-2' }, 'Affiché sur le tableau de bord et donné à l’IA.'),
    h('div', { class: 'actions' }, nom, h('button', { class: 'principal', onclick: () => essayer(() => api('/api/admin/atelier', { methode: 'POST', corps: { nom: nom.value } }).then(actualiserEtat), 'Nom enregistré') }, 'Enregistrer')),
  )
}

function carteIndex(infos) {
  const restants = infos.indexation?.restants || 0
  return carte(
    'loupe',
    'Recherche par le sens',
    h('p', { class: 'texte-2' }, restants ? `${nombreFr(restants)} passages en attente : l’IA les prépare en arrière-plan tant que ce poste garde la main sur le fichier.` : 'Tous les passages sont prêts pour la recherche par le sens.'),
    h('p', { class: 'discret', style: { fontSize: '13px' } }, `${nombreFr(infos.statistiques?.passages || 0)} passages au total.`),
    h('button', {
      onclick: async () => {
        if (await confirmer('Tout recalculer ? Utile seulement après un changement du modèle de recherche. Cela peut prendre du temps.')) {
          await essayer(() => api('/api/admin/reindexer', { methode: 'POST' }), 'Recalcul lancé')
        }
      },
    }, ic('rafraichir', 16), 'Tout recalculer'),
  )
}

// ---------------------------------------------------------------- reprise d'un fichier IASSITEC

function carteReprise(infos) {
  const chemin = h('input', { value: infos.ancienFichier?.chemin || '', placeholder: 'Chemin du fichier .datassitec' })
  const remplacer = h('input', { type: 'checkbox' })
  const s = infos.statistiques
  const dejaRempli = s.machines + s.interventions + s.documents > 0
  return carte(
    'dossier',
    'Reprendre un fichier IASSITEC',
    h('p', { class: 'texte-2' }, 'Les machines, interventions, documents (avec leur lecture par l’IA), passages et réglages d’un ancien fichier .datassitec sont copiés dans le fichier de connaissances de KTEC. Le fichier d’origine n’est pas modifié.'),
    infos.ancienFichier ? h('p', { class: 'discret', style: { fontSize: '13px' } }, `Fichier trouvé sur ce poste : ${tailleFr(infos.ancienFichier.taille)}.`) : null,
    chemin,
    dejaRempli ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, remplacer, 'Remplacer ce qu’AITEC contient déjà') : null,
    h('div', { class: 'actions', style: { marginTop: '10px' } },
      h('button', {
        class: 'principal',
        onclick: async () => {
          if (!(await confirmer('Copier ce fichier IASSITEC dans le fichier de connaissances ? Avec beaucoup de documents, cela peut prendre une minute.'))) return
          const bilan = await essayer(() => api('/api/admin/importer-datassitec', { methode: 'POST', corps: { chemin: chemin.value.trim(), remplacer: remplacer.checked } }))
          if (bilan) {
            notifier(`Repris : ${nombreFr(bilan.machines || 0)} machines, ${nombreFr(bilan.interventions || 0)} interventions, ${nombreFr(bilan.documents || 0)} documents, ${nombreFr(bilan.passages || 0)} passages.`)
            window.ktec.recharger()
          }
        },
      }, ic('telecharger', 16), 'Reprendre ce fichier'),
    ),
  )
}
