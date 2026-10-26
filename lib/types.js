// Les familles de types d'intervention : Correctif, Préventif ou Autre. Chaque GMAO nomme ses types à sa façon
// (« Intervention de dépannage », « Préventif », « Intervention de graissage », parfois un simple code) : on les
// range par des mots courants, et l'administrateur corrige ce qui est mal rangé (réglage « familles_types »).
// Les chiffres (pannes, part du préventif, graphiques) comptent par famille.

import { db, reglageJson } from './base.js'

export const FAMILLES = ['Correctif', 'Préventif', 'Autre']

const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// La famille devinée d'après le nom du type.
export function familleParDefaut(type) {
  const t = sansAccents(type)
  if (/depann|correct|curati|palliat|panne|repar|incident|urgen|bris/.test(t)) return 'Correctif'
  if (/preventi|systemat|conditionnel|graiss|lubrif|entretien|ronde|planifi|niveau 1/.test(t)) return 'Préventif'
  return 'Autre'
}

export function familleDe(type) {
  const choisies = reglageJson('familles_types', {}) || {}
  return FAMILLES.includes(choisies[type]) ? choisies[type] : familleParDefaut(type)
}

// Les types présents dans la base, avec leur nombre d'interventions et leur famille.
export function typesPresents() {
  return db()
    .prepare('SELECT type, count(*) AS nombre FROM interventions GROUP BY type ORDER BY nombre DESC')
    .all()
    .map((t) => ({ ...t, famille: familleDe(t.type), parDefaut: familleParDefaut(t.type) }))
}

// « type IN ('…', '…') » : les types d'une famille, écrits dans la requête (« 0 » s'il n'y en a aucun).
export function sqlFamille(famille, colonne = 'type') {
  const types = typesPresents().filter((t) => t.famille === famille).map((t) => `'${String(t.type).replace(/'/g, "''")}'`)
  return types.length ? `${colonne} IN (${types.join(', ')})` : '0'
}
