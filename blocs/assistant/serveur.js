// L'assistant : répond aux questions des agents à partir de la base.
//
// 1. on cherche les passages utiles (bloc « recherche ») ;
// 2. on les donne au modèle avec des consignes strictes : français, sources citées, ne rien inventer ;
// 3. la réponse est envoyée au navigateur au fur et à mesure qu'elle s'écrit.
//
// Les consignes sont dans CONSIGNES ci-dessous : c'est l'endroit où ajuster le comportement de l'IA.

import { db, reglage, modifierReglage, noterModification } from '../../lib/base.js'
import { ouvrirFlux, ErreurHttp } from 'ktec/http.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { installation } from 'ktec/installation.js'
import { glossaire } from '../../lib/glossaire.js'
import fs from 'node:fs'
import { chercher, decrirePassage } from '../recherche/recherche.js'
import { sansBalises } from '../recherche/passages.js'
import { pannesProches } from '../pannes/serveur.js'
import { resumeChiffres } from '../tableau-de-bord/serveur.js'
import { lireArborescence } from '../../lib/arborescence.js'

const CONSIGNES = `Tu es AITEC, l'assistant de dépannage des agents de maintenance de l'atelier « {atelier} ». Tu réponds comme un technicien d'assistance expérimenté au téléphone avec un collègue devant la machine : court, précis, dans l'ordre où on vérifie.

Forme des réponses (toujours) :
- Pas d'introduction, pas de reformulation de la question, pas de conclusion, pas de politesse.
- Phrases courtes (20 mots au plus), une information par ligne. Pas de longs paragraphes.
- Structure d'une réponse de dépannage :
  **Causes probables** : 2 à 4, numérotées, de la plus probable à la moins probable. Une ligne par cause, en trois parties :
    l'organe précis (repère ou nom exact lu dans les sources) — ce qui lâche et pourquoi cela donne le symptôme — l'indice qui la rend probable (panne identique le JJ/MM/AAAA, réglage modifié, pièce d'usure, intervention récente) [n].
    Exemple de forme (machine fictive) : 1. Électrovanne de descente — bobine coupée, le vérin ne reçoit plus d'air en descente — même panne le 14/03/2024, bobine remplacée [4].
    Repère seulement s'il est écrit tel quel dans les sources ; sinon nomme l'organe sans repère. N'invente jamais une lettre ou un numéro de repère.
  **À vérifier** : étapes numérotées, 3 à 6, de la plus rapide à la plus longue. Chaque étape : une action (verbe à l'infinitif), le repère, la valeur ou l'état attendu, la cause qu'elle confirme ou écarte (→ cause 2), la source [n].
  **Sécurité** : une seule ligne, seulement si l'intervention présente un risque.
- Jamais de cause vague (« commande défaillante », « problème électrique », « paramétrage incorrect ») : nomme le composant et sa panne (bobine coupée, contact collé, fusible fondu, fil desserré, capteur déréglé ou encrassé, joint usé, distributeur grippé, sortie d'automate HS…).
- Une panne identique déjà réparée dans les interventions est la cause la plus probable : dis ce qui avait été fait et quand.
- Une source « Panne connue » résume une panne déjà vue plusieurs fois sur la machine (causes, remèdes, nombre de cas) : si elle correspond au symptôme, ses causes passent en premier, avec leur nombre de cas.
- Une cause hors du domaine coché : précède-la de son domaine (« Côté hydraulique : … »).
- Chaque ligne (cause ou vérification) qui s'appuie sur une intervention donne le nom de l'intervenant, tel qu'écrit dans la source : « … le 14/03/2024 par DUPONT, JEAN [2] ».
- Ligne PRÉVENTIF RÉCENT présente : un préventif vient d'être fait sur ces machines (l'agent le voit déjà en bandeau). Ce qui a été touché ce jour-là est une cause possible : cite-la parmi les causes si elle peut expliquer le symptôme.
- Pour une question d'information (une valeur, une référence, une date d'intervention) : la réponse en une ou deux lignes, avec la source. Rien d'autre.
- Pour une procédure demandée (démontage, réglage) : étapes numérotées, sans commentaire entre les étapes.
- Valeurs exactes avec leur unité (24 V DC, 6 bar, 35 N·m), repères tels qu'écrits sur les schémas.

Fond :
- Réponds en français. Appuie-toi uniquement sur les SOURCES et les CHIFFRES fournis ; traduis ce que tu utilises des sources en langue étrangère.
- Cite la source de chaque information avec son numéro entre crochets, par exemple [2].
- Si les sources ne contiennent pas la réponse : « Je ne trouve pas cette information dans la base. », puis en une ligne le document ou la donnée à ajouter. N'invente jamais une référence, une valeur, un couple de serrage ou un réglage.
- Des vérifications générales de métier qui ne viennent pas des sources : à part, sous « Pistes générales (hors documentation) », 3 lignes au plus, sans numéro de source.
- Risque hydraulique, pneumatique, pression, levage ou organes en mouvement : ligne Sécurité = consigner la machine, suivre les consignes du site.
- Intervention électrique : ligne Sécurité en tête de réponse = personnel habilité, consignation et vérification d'absence de tension (VAT) ; mesures sous tension par une personne habilitée avec les EPI.
- Aujourd'hui, nous sommes le {date}.

Schémas et plans :
- Des IMAGES de folios de schémas ou de pages de plans peuvent être jointes : regarde-les et cite la source.
- Dépannage électrique, ordre des vérifications : alimentation et protections, chaîne de sécurité (arrêt d'urgence, relais de sécurité, portes), commande (bouton, sortie d'automate, bobine), puissance (contacts, thermique, moteur), capteurs et entrées d'automate. Pour chaque étape : repère, bornes où mesurer, valeur attendue, folio.
- Pneumatique ou hydraulique : pression d'alimentation, régulateur, distributeur et sa commande, réducteurs de débit, clapets, vérin, capteurs et pressostats.
- Plan mécanique : cotes, tolérances, repères de nomenclature et notes lus sur le plan.
- Repère, valeur ou liaison illisible sur l'image : dis-le, n'invente pas.
- Glossaire des repères de l'atelier :
{glossaire}

Précisions cochées par l'agent (ligne PRÉCISIONS) :
- Elles sont sûres : tiens-en compte et ne repose jamais une question qu'elles tranchent déjà.
- Domaine coché : causes de ce domaine d'abord. Une cause d'un autre domaine seulement si les sources la désignent, et dis-le (« côté pneumatique : … »).
- Fréquence cochée : « à chaque cycle » oriente vers une panne franche (organe HS, coupure) ; « de temps en temps » vers un faux contact, un capteur limite, une usure ; « depuis une intervention » vers ce qui a été touché ce jour-là.

Poser des questions pour affiner :
- Demande trop vague pour répondre de façon fiable (machine non précisée, symptôme flou, code défaut ou message d'écran manquant, sources qui divergent) : ne devine pas, pose 1 à 3 questions courtes.
- Dans ce cas, termine par une ligne qui commence exactement par « CHOIX : », suivie de 2 à 5 réponses possibles séparées par « | », tirées des sources. Exemple : CHOIX : PRS-01 presse 200 t | PRS-02 presse 100 t | Une autre machine
- Si les sources permettent de répondre : réponds directement, sans ligne CHOIX. Au plus une question finale si elle fait avancer le dépannage (« Le défaut revient-il à chaque cycle ? »).`

export function routes(r) {
  // Les deux premiers niveaux de l'arborescence des machines (voir lib/arborescence.js).
  r.get('/api/arborescence', () => lireArborescence())

  // L'arborescence gardée pour choisir la machine (administrateur).
  r.post('/api/arborescence/choix', async (ctx) => {
    ctx.exigerAdmin()
    const { arbre = '' } = await ctx.json()
    if (typeof arbre !== 'string') throw new ErreurHttp(400, 'Arborescence inconnue')
    modifierReglage('arborescence_machines', arbre)
    noterModification()
    return { arbre }
  })

  // Avant de réfléchir : les machines dont parlent les meilleurs résultats de la recherche. S'il y en a plusieurs,
  // l'assistant propose de cocher la bonne (sans IA, donc tout de suite).
  r.post('/api/assistant/precisions', async (ctx) => {
    const { question = '', machineId = null, machineIds = null } = await ctx.json()
    if (!String(question).trim()) return { machines: [] }
    const trouves = await chercher(String(question), { machineId: machineIds?.length ? machineIds : machineId, limite: 15 })
    const compte = new Map()
    const lire = db().prepare('SELECT machine_id FROM passages WHERE id = ?')
    for (const p of trouves) {
      const id = lire.get(p.id)?.machine_id
      if (id) compte.set(id, (compte.get(id) || 0) + 1)
    }
    if (compte.size < 2) return { machines: [] }
    const decrire = db().prepare('SELECT id, repere, designation FROM machines WHERE id = ?')
    const machines = [...compte].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, nombre]) => ({ ...decrire.get(id), nombre })).filter((m) => m.id)
      .map((m) => ({ id: m.id, libelle: m.designation && m.designation !== m.repere ? `${m.repere} — ${m.designation}` : m.repere, nombre: m.nombre }))
    return { machines }
  })

  // POST /api/assistant { question, historique: [{ role, contenu }], machineId }
  // Réponse en flux : « sources », puis des « texte » successifs, puis « fin » (ou « erreur »).
  r.post('/api/assistant', async (ctx) => {
    const { question, historique = [], machineId = null, machineIds = null, groupe = '', precisions = [] } = await ctx.json()
    const flux = ouvrirFlux(ctx.res)
    const arret = new AbortController()
    ctx.res.on('close', () => arret.abort()) // l'agent a fermé la page ou cliqué « Arrêter »

    try {
      // Une machine, ou toutes celles d'une ligne / d'un sous-ensemble de l'arborescence.
      const filtre = machineIds?.length ? machineIds : machineId
      const recents = preventifRecent(machineIds?.length ? machineIds : machineId ? [machineId] : [])
      flux.envoyer('preventif', recents)
      // Les pannes connues des machines visées qui ressemblent à la question passent en tête des sources.
      const proches = pannesProches(question, machineIds?.length ? machineIds : machineId ? [machineId] : []).map(decrirePassage).filter(Boolean)
      const trouves = await chercher(texteDeRecherche(question, historique), { machineId: filtre, limite: 8 })
      const passages = [...proches, ...trouves.filter((p) => !proches.some((x) => x.id === p.id))].slice(0, 8)
      flux.envoyer('sources', passages.map((p, i) => ({ numero: i + 1, titre: p.titre, lien: p.lien, source: p.source, extrait: p.texte.slice(0, 400) })))

      if (!iaInstallee()) {
        flux.envoyer('texte', passages.length
          ? "L'IA n'est pas installée sur ce poste : voici seulement les passages trouvés dans la base, à consulter ci-dessous."
          : "L'IA n'est pas installée sur ce poste, et la recherche n'a rien trouvé.")
        return flux.envoyer('fin', {})
      }

      await discuter(construireMessages(question, historique, passages, machineId, machineIds?.length ? { nom: groupe, nombre: machineIds.length } : null, precisions, recents), {
        surMorceau: (morceau) => flux.envoyer('texte', morceau),
        signal: arret.signal,
        // Réponses courtes et régulières : une limite de longueur, peu de fantaisie.
        maxMots: 600,
        temperature: 0.2,
      })
      flux.envoyer('fin', {})
    } catch (erreur) {
      if (!arret.signal.aborted) flux.envoyer('erreur', { message: erreur.message })
    } finally {
      flux.fermer()
    }
  })
}

// Quand l'agent répond à une question de l'assistant (« la PRS-01 », « défaut thermique »), sa réponse seule
// ne suffit pas pour chercher : on y ajoute ses deux messages précédents.
function texteDeRecherche(question, historique) {
  const precedents = historique.filter((m) => m.role === 'agent').slice(-2).map((m) => m.contenu)
  return [question, ...precedents.reverse()].join('\n')
}

function construireMessages(question, historique, passages, machineId, groupe = null, precisions = [], recents = []) {
  const consignes = CONSIGNES.replace('{atelier}', reglage('nom_atelier', 'Atelier'))
    .replace('{date}', new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    .replace('{glossaire}', glossaire())

  let contexte = `CHIFFRES DE LA BASE : ${resumeChiffres()}\n\n`
  if (machineId) {
    const m = db().prepare('SELECT * FROM machines WHERE id = ?').get(machineId)
    if (m) contexte += `La question porte sur la machine ${m.repere} (${m.designation}${m.marque ? ', ' + m.marque : ''}${m.modele ? ' ' + m.modele : ''}).\n\n`
  } else if (groupe) {
    contexte += `La question porte sur ${groupe.nom || 'un ensemble de machines'} (${groupe.nombre} machine${groupe.nombre > 1 ? 's' : ''} de l'arborescence).\n\n`
  }
  if (recents.length) contexte += `PRÉVENTIF RÉCENT (48 dernières heures) :\n${recents.map((r) => `- ${r.dateFr}, ${r.repere || 'machine ?'}, ${r.numero || 'sans n°'}, par ${r.intervenant || 'intervenant inconnu'} : ${r.description}`).join('\n')}\n\n`
  if (Array.isArray(precisions) && precisions.length) contexte += `PRÉCISIONS (cochées par l'agent, sûres) : ${precisions.map(String).join(' ; ')}.\n\n`
  contexte += passages.length
    ? 'SOURCES :\n\n' + passages.map((p, i) => `[${i + 1}] ${p.titre}\n${p.texte}`).join('\n\n')
    : 'SOURCES : aucune source trouvée dans la base pour cette question.'

  // On garde les 6 derniers messages de la conversation, pour les questions de suite (« et pour l'autre machine ? »).
  const precedents = historique.slice(-6).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.contenu).slice(0, 3000) }))

  // Folios de schémas et pages de plans trouvés par la recherche : on joint leur image (2 au plus),
  // pour que l'IA regarde le dessin et pas seulement sa fiche.
  const images = imagesDesFolios(passages)
  if (images.length) contexte += '\n\nIMAGES JOINTES : ' + images.map((im, i) => `image ${i + 1} = source [${im.numero}]`).join(', ') + '.'

  const texte = `${contexte}\n\nQUESTION : ${question}`
  return [
    { role: 'system', content: consignes },
    ...precedents,
    {
      role: 'user',
      content: images.length
        ? [...images.map((im) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${im.image.toString('base64')}` } })), { type: 'text', text: texte }]
        : texte,
    },
  ]
}

// Les interventions préventives des 48 dernières heures sur les machines visées (une machine, ou toutes celles
// de la ligne ou du sous-ensemble choisi). Les dates n'ont pas d'heure : on prend aujourd'hui et les deux jours
// d'avant. Un type est « préventif » s'il contient le mot, quelle que soit sa forme, accents ignorés.
function preventifRecent(ids) {
  ids = (ids || []).map(Number).filter(Boolean)
  if (!ids.length) return []
  const d = new Date(Date.now() - 48 * 3600 * 1000)
  const depuis = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return db()
    .prepare(`SELECT i.id, i.date, i.numero, i.type, i.description, i.intervenant, m.repere FROM interventions i LEFT JOIN machines m ON m.id = i.machine_id
              WHERE i.date >= ? AND i.machine_id IN (${ids.map(() => '?').join(',')}) ORDER BY i.date DESC, i.id DESC`)
    .all(depuis, ...ids)
    .filter((i) => sansAccents(i.type).includes('preventif'))
    .slice(0, 8)
    .map((i) => ({
      id: i.id,
      date: i.date,
      dateFr: i.date.split('-').reverse().join('/'),
      numero: i.numero,
      repere: i.repere,
      intervenant: i.intervenant,
      description: sansBalises(i.description).replace(/\s+/g, ' ').slice(0, 160),
    }))
}

const IMAGES_MAX = 2

function imagesDesFolios(passages) {
  const config = installation()
  if (!config?.modele?.vision || !fs.existsSync(config.modele.vision)) return [] // modèle sans « vision »
  const images = []
  const vues = new Set()
  passages.forEach((p, i) => {
    if (images.length >= IMAGES_MAX || p.source !== 'document' || !p.page) return
    const cle = `${p.sourceId}-${p.page}`
    if (vues.has(cle)) return
    vues.add(cle)
    try {
      const ligne = db()
        .prepare("SELECT ip.image FROM images_pages ip JOIN documents d ON d.id = ip.document_id WHERE ip.document_id = ? AND ip.page = ? AND ip.partie = 'page' AND d.genre IN ('schema', 'plan')")
        .get(p.sourceId, p.page)
      if (ligne) images.push({ numero: i + 1, image: Buffer.from(ligne.image) })
    } catch {
      // fichier d'une ancienne version, sans images de pages
    }
  })
  return images
}
