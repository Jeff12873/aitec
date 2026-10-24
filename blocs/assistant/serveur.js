// L'assistant : répond aux questions des agents à partir de la base.
//
// 1. on cherche les passages utiles (bloc « recherche ») ;
// 2. on les donne au modèle avec des consignes strictes : français, sources citées, ne rien inventer ;
// 3. la réponse est envoyée au navigateur au fur et à mesure qu'elle s'écrit.
//
// Les consignes sont dans CONSIGNES ci-dessous : c'est l'endroit où ajuster le comportement de l'IA.

import { db, reglage } from '../../lib/base.js'
import { ouvrirFlux } from 'ktec/http.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { installation } from 'ktec/installation.js'
import { glossaire } from '../../lib/glossaire.js'
import fs from 'node:fs'
import { chercher } from '../recherche/recherche.js'
import { resumeChiffres } from '../tableau-de-bord/serveur.js'
import { lireInfo } from 'ktec/ktec.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'

const CONSIGNES = `Tu es AITEC, l'assistant de dépannage des agents de maintenance de l'atelier « {atelier} ». Tu réponds comme un technicien d'assistance expérimenté au téléphone avec un collègue devant la machine : court, précis, dans l'ordre où on vérifie.

Forme des réponses (toujours) :
- Pas d'introduction, pas de reformulation de la question, pas de conclusion, pas de politesse.
- Phrases courtes (20 mots au plus), une information par ligne. Pas de longs paragraphes.
- Structure d'une réponse de dépannage :
  **Cause probable** : une phrase. S'il y en a plusieurs, 3 au plus, de la plus probable à la moins probable.
  **À vérifier** : étapes numérotées, 3 à 6, de la plus simple et rapide à la plus longue. Chaque étape : une action (verbe à l'infinitif), le repère du composant, la valeur ou l'état attendu, la source [n].
  **Sécurité** : une seule ligne, seulement si l'intervention présente un risque.
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

Poser des questions pour affiner :
- Demande trop vague pour répondre de façon fiable (machine non précisée, symptôme flou, code défaut ou message d'écran manquant, sources qui divergent) : ne devine pas, pose 1 à 3 questions courtes.
- Dans ce cas, termine par une ligne qui commence exactement par « CHOIX : », suivie de 2 à 5 réponses possibles séparées par « | », tirées des sources. Exemple : CHOIX : PRS-01 presse 200 t | PRS-02 presse 100 t | Une autre machine
- Si les sources permettent de répondre : réponds directement, sans ligne CHOIX. Au plus une question finale si elle fait avancer le dépannage (« Le défaut revient-il à chaque cycle ? »).`

export function routes(r) {
  // Les deux premiers niveaux de l'arborescence des machines (ligne › sous-ensemble), avec les machines d'AITEC
  // rangées dessous. L'arbre vient de la requête réglée dans PDRTec (même fichier de connaissances) ; sans elle,
  // ou sans connexion à la base : null (on garde la simple liste des machines).
  r.get('/api/arborescence', async () => {
    const sql = lireInfo('pdrtec.arborescence', null)?.arbre
    if (!sql || !etatConnexion().ouverte) return null
    const r2 = await executerRequete(sql.replace(/--[^\n]*/g, ''), 1_000_000)
    const i = (nom) => r2.colonnes.findIndex((c) => c.nom.toLowerCase() === nom)
    const [iN, iP, iC, iD, iO] = ['noeud', 'parent', 'code', 'designation', 'ordre'].map(i)
    if (iN < 0 || iP < 0 || iC < 0) return null
    const noeuds = new Map(r2.lignes.map((l) => [String(l[iN]), { id: String(l[iN]), parent: String(l[iP] ?? ''), code: String(l[iC] ?? '').trim(), desi: String(l[iD] ?? '').trim(), ordre: Number(l[iO]) || 0, enfants: [] }]))
    for (const n of noeuds.values()) noeuds.get(n.parent)?.enfants.push(n)
    const parRepere = new Map(db().prepare('SELECT id, repere FROM machines').all().map((m) => [String(m.repere).trim(), m.id]))
    // Toutes les machines d'AITEC sous un nœud (lui compris).
    const sous = (n, acc = new Set()) => { const id = parRepere.get(n.code); if (id) acc.add(id); n.enfants.forEach((e) => sous(e, acc)); return acc }
    const libelle = (n) => (n.desi && n.desi !== n.code ? `${n.code} (${n.desi})` : n.code)
    const tri = (a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code, 'fr', { numeric: true })
    // Les lignes : les vraies racines (sans parent) ; une machine dont le parent n'est plus actif n'en est pas une.
    return [...noeuds.values()].filter((n) => !n.parent || n.parent === '0' || n.parent === 'null').sort(tri)
      .map((n) => ({ id: n.id, libelle: libelle(n), machines: [...sous(n)], enfants: n.enfants.sort(tri).map((e) => ({ id: e.id, libelle: libelle(e), machines: [...sous(e)] })).filter((e) => e.machines.length) }))
      .filter((n) => n.machines.length)
  })

  // POST /api/assistant { question, historique: [{ role, contenu }], machineId }
  // Réponse en flux : « sources », puis des « texte » successifs, puis « fin » (ou « erreur »).
  r.post('/api/assistant', async (ctx) => {
    const { question, historique = [], machineId = null, machineIds = null, groupe = '' } = await ctx.json()
    const flux = ouvrirFlux(ctx.res)
    const arret = new AbortController()
    ctx.res.on('close', () => arret.abort()) // l'agent a fermé la page ou cliqué « Arrêter »

    try {
      // Une machine, ou toutes celles d'une ligne / d'un sous-ensemble de l'arborescence.
      const filtre = machineIds?.length ? machineIds : machineId
      const passages = await chercher(texteDeRecherche(question, historique), { machineId: filtre, limite: 8 })
      flux.envoyer('sources', passages.map((p, i) => ({ numero: i + 1, titre: p.titre, lien: p.lien, source: p.source, extrait: p.texte.slice(0, 400) })))

      if (!iaInstallee()) {
        flux.envoyer('texte', passages.length
          ? "L'IA n'est pas installée sur ce poste : voici seulement les passages trouvés dans la base, à consulter ci-dessous."
          : "L'IA n'est pas installée sur ce poste, et la recherche n'a rien trouvé.")
        return flux.envoyer('fin', {})
      }

      await discuter(construireMessages(question, historique, passages, machineId, machineIds?.length ? { nom: groupe, nombre: machineIds.length } : null), {
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

function construireMessages(question, historique, passages, machineId, groupe = null) {
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
