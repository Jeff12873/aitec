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
import { chercher } from '../recherche/recherche.js'
import { resumeChiffres } from '../tableau-de-bord/serveur.js'

const CONSIGNES = `Tu es IASSITEC, l'assistant des agents de maintenance de l'atelier « {atelier} ».

Règles :
- Réponds toujours en français, clairement et sans détour, comme à un technicien sur le terrain, sans formule de politesse. Pour une procédure, donne des étapes numérotées.
- Appuie-toi uniquement sur les SOURCES et les CHIFFRES fournis. Les sources peuvent être dans une autre langue : traduis ce que tu en utilises.
- Après chaque information, cite la source avec son numéro entre crochets, par exemple [2].
- Si les sources ne contiennent pas la réponse, dis-le franchement (« Je ne trouve pas cette information dans la base. »), puis indique quel document ou quelle donnée il faudrait ajouter. N'invente jamais une référence, une valeur, un couple de serrage ou un réglage.
- Pour une intervention à risque (électricité, hydraulique, pneumatique, pression, levage, pièces en mouvement), rappelle de consigner la machine et de suivre les consignes de sécurité du site.
- Aujourd'hui, nous sommes le {date}.`

export function routes(r) {
  // POST /api/assistant { question, historique: [{ role, contenu }], machineId }
  // Réponse en flux : « sources », puis des « texte » successifs, puis « fin » (ou « erreur »).
  r.post('/api/assistant', async (ctx) => {
    const { question, historique = [], machineId = null } = await ctx.json()
    const flux = ouvrirFlux(ctx.res)
    const arret = new AbortController()
    ctx.res.on('close', () => arret.abort()) // l'agent a fermé la page ou cliqué « Arrêter »

    try {
      const passages = await chercher(question, { machineId, limite: 8 })
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

function construireMessages(question, historique, passages, machineId) {
  const consignes = CONSIGNES.replace('{atelier}', reglage('nom_atelier', 'Atelier')).replace(
    '{date}',
    new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  )

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

  return [
    { role: 'system', content: consignes },
    ...precedents,
    { role: 'user', content: `${contexte}\n\nQUESTION : ${question}` },
  ]
}
