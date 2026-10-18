// L'historique des interventions (pannes, préventif, réglages…).

import { db } from '../../lib/base.js'
import { creerTable, routesTable } from '../../lib/tables.js'
import { remplacerPassages, supprimerPassages } from '../recherche/passages.js'

export const interventions = creerTable({
  table: 'interventions',
  cle: 'numero',
  champs: [
    { nom: 'numero', type: 'texte', videNull: true },
    { nom: 'date', libelle: 'Date', type: 'date', obligatoire: true },
    { nom: 'machine_id', type: 'nombre' },
    { nom: 'type', type: 'texte' },
    { nom: 'description', libelle: 'Description', type: 'texte', obligatoire: true },
    { nom: 'cause', type: 'texte' },
    { nom: 'intervenant', type: 'texte' },
    { nom: 'duree_h', type: 'nombre' },
    { nom: 'statut', type: 'texte' },
  ],
})

export const TYPES = ['Correctif', 'Préventif', 'Amélioration', 'Réglage', 'Contrôle réglementaire', 'Autre']

export function indexerIntervention(id) {
  const i = db()
    .prepare('SELECT i.*, m.repere, m.designation AS machine FROM interventions i LEFT JOIN machines m ON m.id = i.machine_id WHERE i.id = ?')
    .get(id)
  if (!i) return supprimerPassages('intervention', id)
  const lignes = [
    `Intervention ${i.type.toLowerCase()}${i.numero ? ' n° ' + i.numero : ''} du ${i.date}${i.repere ? ` sur la machine ${i.repere} (${i.machine})` : ''}.`,
    `Description : ${i.description}`,
    i.cause && `Cause : ${i.cause}`,
    i.intervenant && `Intervenant : ${i.intervenant}.`,
    i.duree_h !== null && `Durée : ${i.duree_h} h.`,
    i.statut && `Statut : ${i.statut}.`,
  ]
  remplacerPassages('intervention', id, i.machine_id, [{ page: null, texte: lignes.filter(Boolean).join('\n') }])
}

export function routes(r) {
  routesTable(r, 'interventions', interventions, {
    lister: (query) => {
      const conditions = []
      const valeurs = []
      if (query.q) {
        conditions.push('(i.description LIKE ? OR i.cause LIKE ? OR i.numero LIKE ? OR m.repere LIKE ? OR i.intervenant LIKE ?)')
        valeurs.push(...Array(5).fill(`%${query.q}%`))
      }
      if (query.machine) {
        conditions.push('i.machine_id = ?')
        valeurs.push(Number(query.machine))
      }
      if (query.type) {
        conditions.push('i.type = ?')
        valeurs.push(query.type)
      }
      // 500 lignes au plus : l'historique complet se consulte par la recherche ou l'assistant.
      return db()
        .prepare(
          `SELECT i.*, m.repere, m.designation AS machine
           FROM interventions i LEFT JOIN machines m ON m.id = i.machine_id
           ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
           ORDER BY i.date DESC, i.id DESC LIMIT 500`,
        )
        .all(...valeurs)
    },
    detailler: (i) => ({ ...i, ...db().prepare('SELECT repere, designation AS machine FROM machines WHERE id = ?').get(i.machine_id ?? -1) }),
    apresEcriture: (id) => indexerIntervention(id),
    apresSuppression: (id) => supprimerPassages('intervention', id),
  })

  r.get('/api/interventions-types', () => {
    const utilises = db().prepare("SELECT DISTINCT type FROM interventions WHERE type <> ''").all().map((l) => l.type)
    return [...new Set([...TYPES, ...utilises])]
  })
}
