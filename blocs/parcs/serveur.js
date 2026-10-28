// Les parcs machines : la liste du sélecteur (en haut d'AITEC) et leur réglage (Administration › Parcs machines).

import { ErreurHttp } from 'ktec/http.js'
import { db } from '../../lib/base.js'
import { exigerEcriture } from 'ktec/partage.js'
import { reglagesParcs, enregistrerParcs, lireParcs, listeParcs, NON_CLASSE } from '../../lib/parcs.js'

export function routes(r) {
  // Pour le sélecteur : [{ id, nom, machines }].
  r.get('/api/parcs', () => listeParcs())

  // Pour le réglage : les racines de l'arborescence et les groupes.
  r.get('/api/parcs/reglages', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const p = await lireParcs()
    if (!p) throw new ErreurHttp(409, 'Arborescence illisible : il faut la connexion à la GMAO et la requête d’arborescence (réglée dans PDRTEC).')
    return {
      racines: p.racines.filter((x) => x.machines.size).map((x) => ({ id: x.id, code: x.code, designation: x.designation, machines: x.machines.size })),
      ...reglagesParcs(),
    }
  })

  r.post('/api/parcs/reglages', async (ctx) => {
    ctx.exigerModeAdmin?.()
    exigerEcriture()
    const corps = await ctx.json()
    return enregistrerParcs({ ...reglagesParcs(), ...corps })
  })

  // Les machines de production d'un parc et leur machine de maintenance (reliée, ou proposée d'après les codes :
  // même code sans le préfixe de l'arborescence, ex. « P_12.3 » ↔ « 12.3 »).
  r.get('/api/parcs/:id/liens', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const p = await lireParcs()
    const parc = p?.parcs.find((x) => x.id === ctx.params.id && x.id !== NON_CLASSE)
    if (!parc) throw new ErreurHttp(404, 'Parc introuvable')
    const noms = new Map(db().prepare('SELECT id, repere, designation FROM machines').all().map((m) => [m.id, m]))
    const aPlat = (racines) => racines.flatMap((id) => p.detail(id)).filter((n) => n.machine && n.niveau > 1)
    const production = aPlat(parc.production)
    const maintenance = aPlat(parc.maintenance)
    const sansPrefixe = (code) => String(code).replace(/^[A-Z]{1,3}_/i, '').toLowerCase()
    const parCode = new Map(maintenance.map((n) => [sansPrefixe(n.code), n.machine]))
    const vus = new Set()
    return {
      production: production.filter((n) => !vus.has(n.machine) && vus.add(n.machine)).map((n) => ({
        machine: n.machine, code: n.code, designation: n.designation, eth: n.eth, niveau: n.niveau,
        lien: p.liens[n.machine] ?? null,
        proposition: parCode.get(sansPrefixe(n.code)) ?? null,
      })),
      maintenance: [...new Map(maintenance.map((n) => [n.machine, { machine: n.machine, code: n.code, designation: n.designation || noms.get(n.machine)?.designation || '' }])).values()],
    }
  })
}
