// Le parc : la liste des machines et leur fiche.

import { db } from '../../lib/base.js'
import { creerTable, routesTable } from '../../lib/tables.js'
import { remplacerPassages, supprimerPassages } from '../recherche/passages.js'
import { perimetreParc, filtreMachines } from '../../lib/parcs.js'

export const machines = creerTable({
  table: 'machines',
  cle: 'repere',
  champs: [
    { nom: 'repere', libelle: 'Repère', type: 'texte', obligatoire: true },
    { nom: 'designation', libelle: 'Désignation', type: 'texte', obligatoire: true },
    { nom: 'famille', type: 'texte' },
    { nom: 'marque', type: 'texte' },
    { nom: 'modele', type: 'texte' },
    { nom: 'numero_serie', type: 'texte' },
    { nom: 'emplacement', type: 'texte' },
    { nom: 'mise_en_service', type: 'date' },
    { nom: 'etat', type: 'texte' },
    { nom: 'notes', type: 'texte' },
  ],
})

// Le texte que l'IA « lit » pour cette machine.
export function indexerMachine(id) {
  const m = machines.lire(id)
  if (!m) return supprimerPassages('machine', id)
  const lignes = [
    `Machine ${m.repere} : ${m.designation}.`,
    m.famille && `Famille : ${m.famille}.`,
    (m.marque || m.modele) && `Marque et modèle : ${[m.marque, m.modele].filter(Boolean).join(' ')}.`,
    m.numero_serie && `Numéro de série : ${m.numero_serie}.`,
    m.emplacement && `Emplacement : ${m.emplacement}.`,
    m.mise_en_service && `Mise en service : ${m.mise_en_service}.`,
    m.etat && `État : ${m.etat}.`,
    m.notes && `Notes : ${m.notes}`,
  ]
  remplacerPassages('machine', id, id, [{ page: null, texte: lignes.filter(Boolean).join('\n') }])
}

export function routes(r) {
  routesTable(r, 'machines', machines, {
    // ?parc=… : le parc choisi en haut d'AITEC ; sans lui, tout sauf les machines masquées.
    lister: async (query) => {
      const conditions = [filtreMachines(await perimetreParc(query.parc || ''), 'm.id')]
      const valeurs = []
      if (query.q) {
        conditions.push(`(m.repere LIKE ? OR m.designation LIKE ? OR m.marque LIKE ? OR m.modele LIKE ? OR m.emplacement LIKE ?)`)
        valeurs.push(...Array(5).fill(`%${query.q}%`))
      }
      if (query.famille) {
        conditions.push('m.famille = ?')
        valeurs.push(query.famille)
      }
      return db()
        .prepare(
          `SELECT m.*,
             (SELECT count(*) FROM documents d WHERE d.machine_id = m.id) AS nb_documents,
             (SELECT count(*) FROM interventions i WHERE i.machine_id = m.id) AS nb_interventions,
             (SELECT max(date) FROM interventions i WHERE i.machine_id = m.id) AS derniere_intervention
           FROM machines m ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
           ORDER BY m.repere COLLATE NOCASE`,
        )
        .all(...valeurs)
    },

    // La fiche complète : la machine, ses documents, ses dernières interventions.
    detailler: (m) => ({
      ...m,
      documents: db().prepare('SELECT id, nom, type, taille, etat FROM documents WHERE machine_id = ? ORDER BY nom').all(m.id),
      interventions: db().prepare('SELECT * FROM interventions WHERE machine_id = ? ORDER BY date DESC LIMIT 50').all(m.id),
    }),

    apresEcriture: (id) => indexerMachine(id),
    apresSuppression: (id) => supprimerPassages('machine', id),
  })

  // Valeurs déjà utilisées, pour proposer des choix dans les formulaires et les filtres.
  r.get('/api/machines-valeurs', () => ({
    familles: valeursDistinctes('famille'),
    emplacements: valeursDistinctes('emplacement'),
    etats: valeursDistinctes('etat'),
  }))
}

function valeursDistinctes(colonne) {
  return db()
    .prepare(`SELECT DISTINCT ${colonne} AS v FROM machines WHERE ${colonne} <> '' ORDER BY 1 COLLATE NOCASE`)
    .all()
    .map((l) => l.v)
}
