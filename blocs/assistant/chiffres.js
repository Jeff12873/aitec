// Les chiffres de la base en une phrase, donnés à l'assistant pour les questions de chiffres simples (« combien de
// machines ? »). Tout sauf les machines masquées dans Administration › Lignes.

import { db, reglage } from '../../lib/base.js'
import { filtreMachines, machinesMasquees } from '../../lib/parcs.js'

export function resumeChiffres() {
  const p = { ids: null, exclus: [...machinesMasquees()] }
  const compter = (sql) => db().prepare(sql).get().n
  const machine = filtreMachines(p, 'machine_id')
  const machines = compter(`SELECT count(*) AS n FROM machines WHERE ${filtreMachines(p, 'id')}`)
  const horsService = compter(`SELECT count(*) AS n FROM machines WHERE ${filtreMachines(p, 'id')} AND etat <> '' AND etat NOT LIKE 'En service%'`)
  const interventions = compter(`SELECT count(*) AS n FROM interventions WHERE ${machine}`)
  const recentes = compter(`SELECT count(*) AS n FROM interventions WHERE ${machine} AND date >= date('now', '-30 days')`)
  const documents = compter(`SELECT count(*) AS n FROM documents WHERE ${machine}`)
  return `Atelier « ${reglage('nom_atelier', 'Atelier')} » : ${machines} machines (${horsService} hors service), ${interventions} interventions enregistrées dont ${recentes} ces 30 derniers jours, ${documents} documents.`
}
