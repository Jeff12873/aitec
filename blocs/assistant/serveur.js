// L'assistant : répond aux questions des agents à partir de la base.
//
// 1. on cherche les passages utiles (bloc « recherche ») ;
// 2. on les donne au modèle avec des consignes strictes : français, sources citées, ne rien inventer ;
// 3. la réponse est envoyée au navigateur au fur et à mesure qu'elle s'écrit.
//
// Les consignes sont dans CONSIGNES ci-dessous : c'est l'endroit où ajuster le comportement de l'IA.

import { db, reglage } from '../../serveur/socle/base.js'
import { ouvrirFlux } from '../../serveur/socle/http.js'
import { discuter, iaInstallee } from '../../serveur/socle/ia.js'
import { installation } from '../../serveur/socle/installation.js'
import { glossaire } from '../../serveur/socle/glossaire.js'
import fs from 'node:fs'
import { chercher } from '../recherche/recherche.js'
import { resumeChiffres } from '../tableau-de-bord/serveur.js'

const CONSIGNES = `Tu es IASSITEC, l'assistant des agents de maintenance de l'atelier « {atelier} ».

Règles :
- Réponds toujours en français, clairement et sans détour, comme à un technicien sur le terrain, sans formule de politesse. Pour une procédure, donne des étapes numérotées.
- Appuie-toi uniquement sur les SOURCES et les CHIFFRES fournis. Les sources peuvent être dans une autre langue : traduis ce que tu en utilises.
- Après chaque information, cite la source avec son numéro entre crochets, par exemple [2].
- Si les sources ne contiennent pas la réponse, dis-le franchement (« Je ne trouve pas cette information dans la base. »), puis indique quel document ou quelle donnée il faudrait ajouter. N'invente jamais une référence, une valeur, un couple de serrage ou un réglage.
- Si tu ajoutes des vérifications générales de métier qui ne viennent pas des sources, mets-les à part sous le titre « Pistes générales (hors documentation) », sans numéro de source.
- Pour une intervention à risque (hydraulique, pneumatique, pression, levage, organes en mouvement), rappelle de consigner la machine et de suivre les consignes de sécurité du site.
- Pour toute intervention électrique, rappelle toujours, en tête de réponse : intervention réservée au personnel habilité (habilitation électrique adaptée à l'opération), consignation de l'équipement et vérification d'absence de tension (VAT) avant toute intervention sur des parties consignées ; mesures sous tension uniquement par une personne habilitée, avec les EPI adaptés.
- Aujourd'hui, nous sommes le {date}.

Schémas et plans :
- Des IMAGES de folios de schémas ou de pages de plans peuvent être jointes à la question : regarde-les pour répondre, et cite la source correspondante.
- Pour un dépannage électrique, propose une démarche de contrôle dans l'ordre : alimentation et protections (disjoncteurs, fusibles, présence de tension), chaîne de sécurité (arrêt d'urgence, relais de sécurité, portes), commande (bouton, sortie d'automate, bobine du contacteur ou de l'électrovanne), puissance (contacts, thermique, moteur), capteurs et entrées d'automate. Pour chaque étape : le repère du composant, les bornes ou fils où mesurer, la valeur attendue lue sur le schéma (24 V DC, 230 V AC…) et le folio.
- Pour un circuit pneumatique ou hydraulique : pression d'alimentation, régulateur, distributeur et sa commande, réducteurs de débit, clapets, vérin, capteurs et pressostats.
- Pour un plan mécanique : appuie-toi sur les cotes, tolérances, repères de nomenclature et notes lus sur le plan.
- Si tu ne lis pas clairement un repère, une valeur ou une liaison sur l'image, dis-le au lieu de supposer, et invite à vérifier sur le schéma papier.
- Glossaire des repères de l'atelier :
{glossaire}

Poser des questions pour affiner :
- Si la demande est trop vague pour répondre de façon fiable (machine non précisée alors que plusieurs sont possibles, symptôme flou, code défaut ou message d'écran manquant, sources qui donnent des pistes différentes), ne devine pas : pose 1 à 3 questions courtes et précises, comme un collègue qui aide à dépanner.
- Dans ce cas, termine ta réponse par une ligne qui commence exactement par « CHOIX : », suivie de 2 à 5 réponses possibles séparées par « | », tirées des sources (repères de machines, symptômes, codes défaut). Exemple : CHOIX : PRS-01 presse 200 t | PRS-02 presse 100 t | Une autre machine
- Si les sources permettent déjà de répondre, réponds directement, sans question et sans ligne CHOIX. Tu peux alors finir par une seule question pour aller plus loin si c'est utile (par exemple : « Le défaut revient-il à chaque cycle ? »).`

export function routes(r) {
  // POST /api/assistant { question, historique: [{ role, contenu }], machineId }
  // Réponse en flux : « sources », puis des « texte » successifs, puis « fin » (ou « erreur »).
  r.post('/api/assistant', async (ctx) => {
    const { question, historique = [], machineId = null } = await ctx.json()
    const flux = ouvrirFlux(ctx.res)
    const arret = new AbortController()
    ctx.res.on('close', () => arret.abort()) // l'agent a fermé la page ou cliqué « Arrêter »

    try {
      const passages = await chercher(texteDeRecherche(question, historique), { machineId, limite: 8 })
      flux.envoyer('sources', passages.map((p, i) => ({ numero: i + 1, titre: p.titre, lien: p.lien, source: p.source, extrait: p.texte.slice(0, 400) })))

      if (!iaInstallee()) {
        flux.envoyer('texte', passages.length
          ? "L'IA n'est pas installée sur ce poste : voici seulement les passages trouvés dans la base, à consulter ci-dessous."
          : "L'IA n'est pas installée sur ce poste, et la recherche n'a rien trouvé.")
        return flux.envoyer('fin', {})
      }

      await discuter(construireMessages(question, historique, passages, machineId), {
        surMorceau: (morceau) => flux.envoyer('texte', morceau),
        signal: arret.signal,
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

function construireMessages(question, historique, passages, machineId) {
  const consignes = CONSIGNES.replace('{atelier}', reglage('nom_atelier', 'Atelier'))
    .replace('{date}', new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    .replace('{glossaire}', glossaire())

  let contexte = `CHIFFRES DE LA BASE : ${resumeChiffres()}\n\n`
  if (machineId) {
    const m = db().prepare('SELECT * FROM machines WHERE id = ?').get(machineId)
    if (m) contexte += `La question porte sur la machine ${m.repere} (${m.designation}${m.marque ? ', ' + m.marque : ''}${m.modele ? ' ' + m.modele : ''}).\n\n`
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
