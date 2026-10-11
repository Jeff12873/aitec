// Les pièces de rechange : stock, seuil de commande, machines concernées.

import { db, transaction } from '../../serveur/socle/base.js'
import { creerTable, routesTable } from '../../serveur/socle/tables.js'
import { remplacerPassages, supprimerPassages } from '../recherche/passages.js'

export const pieces = creerTable({
  table: 'pieces',
  cle: 'reference',
  champs: [
    { nom: 'reference', libelle: 'Référence', type: 'texte', obligatoire: true },
    { nom: 'designation', libelle: 'Désignation', type: 'texte', obligatoire: true },
    { nom: 'fabricant', type: 'texte' },
    { nom: 'fournisseur', type: 'texte' },
    { nom: 'stock', type: 'nombre' },
    { nom: 'seuil', type: 'nombre' },
    { nom: 'unite', type: 'texte' },
    { nom: 'emplacement', type: 'texte' },
    { nom: 'prix', type: 'nombre' },
    { nom: 'notes', type: 'texte' },
  ],
})

export function machinesDeLaPiece(pieceId) {
  return db()
    .prepare('SELECT m.id, m.repere, m.designation FROM machines m JOIN pieces_machines pm ON pm.machine_id = m.id WHERE pm.piece_id = ? ORDER BY m.repere')
    .all(pieceId)
}

// Rattache la pièce à ces machines (remplace les rattachements existants).
export function rattacherMachines(pieceId, machineIds) {
  transaction((base) => {
    base.prepare('DELETE FROM pieces_machines WHERE piece_id = ?').run(pieceId)
    const ajouter = base.prepare('INSERT OR IGNORE INTO pieces_machines (piece_id, machine_id) VALUES (?, ?)')
    for (const machineId of machineIds) ajouter.run(pieceId, machineId)
  })
}

export function indexerPiece(id) {
  const p = pieces.lire(id)
  if (!p) return supprimerPassages('piece', id)
  const surMachines = machinesDeLaPiece(id).map((m) => `${m.repere} (${m.designation})`)
  const lignes = [
    `Pièce de rechange ${p.reference} : ${p.designation}.`,
    p.fabricant && `Fabricant : ${p.fabricant}.`,
    p.fournisseur && `Fournisseur : ${p.fournisseur}.`,
    `Stock : ${p.stock ?? 0} ${p.unite} (seuil de commande : ${p.seuil ?? 0}).${p.seuil > 0 && (p.stock ?? 0) <= p.seuil ? ' À commander.' : ''}`,
    p.emplacement && `Rangement : ${p.emplacement}.`,
    p.prix !== null && `Prix unitaire : ${p.prix} €.`,
    surMachines.length && `Utilisée sur : ${surMachines.join(', ')}.`,
    p.notes && `Notes : ${p.notes}`,
  ]
  remplacerPassages('piece', id, null, [{ page: null, texte: lignes.filter(Boolean).join('\n') }])
}

export function routes(r) {
  routesTable(r, 'pieces', pieces, {
    lister: (query) => {
      const conditions = []
      const valeurs = []
      if (query.q) {
        conditions.push('(p.reference LIKE ? OR p.designation LIKE ? OR p.fabricant LIKE ? OR p.fournisseur LIKE ?)')
        valeurs.push(...Array(4).fill(`%${query.q}%`))
      }
      if (query.acommander) conditions.push('p.seuil > 0 AND p.stock <= p.seuil')
      if (query.machine) {
        conditions.push('p.id IN (SELECT piece_id FROM pieces_machines WHERE machine_id = ?)')
        valeurs.push(Number(query.machine))
      }
      return db()
        .prepare(
          `SELECT p.*, (SELECT group_concat(m.repere, ', ') FROM pieces_machines pm JOIN machines m ON m.id = pm.machine_id WHERE pm.piece_id = p.id) AS machines
           FROM pieces p ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
           ORDER BY p.reference COLLATE NOCASE`,
        )
        .all(...valeurs)
    },
    detailler: (p) => ({ ...p, machines: machinesDeLaPiece(p.id) }),
    apresEcriture: (id, donnees) => {
      if (Array.isArray(donnees.machines)) rattacherMachines(id, donnees.machines.map(Number))
      indexerPiece(id)
    },
    apresSuppression: (id) => supprimerPassages('piece', id),
  })
}
