// Routes de la recherche (barre de recherche en haut de l'écran).

import { chercher } from './recherche.js'
import { etatIndexation } from './indexeur.js'

export function routes(r) {
  // GET /api/recherche?q=pompe&machine=12
  r.get('/api/recherche', async (ctx) => {
    const question = (ctx.query.q || '').trim()
    if (!question) return []
    return chercher(question, { machineId: Number(ctx.query.machine) || null, limite: 15 })
  })

  r.get('/api/indexation', () => etatIndexation())
}
