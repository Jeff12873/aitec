// Les deux premiers niveaux de l'arborescence des machines (ligne › sous-ensemble), avec les machines d'AITEC
// rangées dessous. L'arbre vient de la requête réglée dans PDRTec (même fichier de connaissances) ; sans elle,
// ou sans connexion à la base : null (on garde la simple liste des machines).
// La GMAO peut tenir plusieurs arborescences (maintenance, bâtiments…) : si la requête donne une colonne
// « arbre » (le nom de l'arborescence), on n'en garde qu'une, choisie dans Administration ; par défaut celle
// qui range le plus de machines d'AITEC.
// Sert à l'assistant (machine concernée) et à l'analyse des pannes connues.

import { db, reglage } from './base.js'
import { lireInfo } from 'ktec/ktec.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'

export async function lireArborescence() {
  const sql = lireInfo('pdrtec.arborescence', null)?.arbre
  if (!sql || !etatConnexion().ouverte) return null
  const r2 = await executerRequete(sql.replace(/--[^\n]*/g, ''), 1_000_000)
  const i = (nom) => r2.colonnes.findIndex((c) => c.nom.toLowerCase() === nom)
  const [iN, iP, iC, iD, iO, iA] = ['noeud', 'parent', 'code', 'designation', 'ordre', 'arbre'].map(i)
  if (iN < 0 || iP < 0 || iC < 0) return null
  const noeuds = new Map(r2.lignes.map((l) => [String(l[iN]), { id: String(l[iN]), parent: String(l[iP] ?? ''), code: String(l[iC] ?? '').trim(), desi: String(l[iD] ?? '').trim(), ordre: Number(l[iO]) || 0, arbre: iA < 0 ? '' : String(l[iA] ?? '').trim(), enfants: [] }]))
  for (const n of noeuds.values()) noeuds.get(n.parent)?.enfants.push(n)
  const parRepere = new Map(db().prepare('SELECT id, repere FROM machines').all().map((m) => [String(m.repere).trim(), m.id]))
  // Toutes les machines d'AITEC sous un nœud (lui compris).
  const sous = (n, acc = new Set()) => { const id = parRepere.get(n.code); if (id) acc.add(id); n.enfants.forEach((e) => sous(e, acc)); return acc }
  const libelle = (n) => (n.desi && n.desi !== n.code ? `${n.code} (${n.desi})` : n.code)
  const tri = (a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code, 'fr', { numeric: true })
  // Les lignes : les vraies racines (sans parent) ; une machine dont le parent n'est plus actif n'en est pas une.
  const racines = [...noeuds.values()].filter((n) => !n.parent || n.parent === '0' || n.parent === 'null')
  const lignesDe = (liste) => liste.sort(tri)
    .map((n) => ({ id: n.id, libelle: libelle(n), machines: [...sous(n)], enfants: n.enfants.sort(tri).map((e) => ({ id: e.id, libelle: libelle(e), machines: [...sous(e)] })).filter((e) => e.machines.length) }))
    .filter((n) => n.machines.length)
  if (iA < 0) return { arbres: [], arbre: '', lignes: lignesDe(racines) }
  // Un nœud sans arborescence (racine orpheline) n'est proposé dans aucune.
  const parArbre = new Map()
  for (const n of racines) parArbre.set(n.arbre, [...(parArbre.get(n.arbre) || []), n])
  const arbres = [...parArbre].map(([nom, liste]) => ({ nom, machines: new Set(liste.flatMap((n) => [...sous(n)])).size })).filter((a) => a.nom && a.machines).sort((a, b) => b.machines - a.machines)
  const voulu = reglage('arborescence_machines', '')
  const arbre = voulu && arbres.some((a) => a.nom === voulu) ? voulu : arbres[0]?.nom || ''
  return { arbres, arbre, lignes: lignesDe(parArbre.get(arbre) || []) }
}
