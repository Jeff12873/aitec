// Les « passages » : les morceaux de texte que l'IA peut retrouver.
//
// Un document est découpé en passages d'environ 1 200 caractères (une demi-page),
// qui se chevauchent un peu pour ne pas couper une explication en deux.
// Chaque fiche (machine, intervention) donne un seul passage.

import { db } from '../../serveur/socle/base.js'
import { relancerIndexeur } from './indexeur.js'

const TAILLE = 1200
const CHEVAUCHEMENT = 150

export function decouper(texte) {
  texte = nettoyerTexte(texte)
  if (texte.length <= TAILLE) return texte ? [texte] : []

  const morceaux = []
  let debut = 0
  while (debut < texte.length) {
    let fin = Math.min(debut + TAILLE, texte.length)
    // On coupe de préférence à la fin d'un paragraphe, sinon d'une phrase, sinon d'un mot.
    if (fin < texte.length) {
      const zone = texte.slice(debut + TAILLE / 2, fin)
      const coupure = Math.max(zone.lastIndexOf('\n\n'), zone.lastIndexOf('. '), zone.lastIndexOf('\n'))
      if (coupure > 0) fin = debut + TAILLE / 2 + coupure + 1
      else if (zone.lastIndexOf(' ') > 0) fin = debut + TAILLE / 2 + zone.lastIndexOf(' ')
    }
    morceaux.push(texte.slice(debut, fin).trim())
    if (fin >= texte.length) break
    debut = Math.max(fin - CHEVAUCHEMENT, debut + 1)
  }
  return morceaux.filter(Boolean)
}

export function nettoyerTexte(texte) {
  return String(texte || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Remplace tous les passages d'une source.
//   pages : [{ page, texte }]   (page = null pour une fiche ou un document sans pages)
export function remplacerPassages(source, sourceId, machineId, pages) {
  const base = db()
  base.prepare('DELETE FROM passages WHERE source = ? AND source_id = ?').run(source, sourceId)
  ajouterPassages(source, sourceId, machineId, pages)
}

// « titre » : répété en tête de chaque morceau (pour qu'un morceau de fiche de folio dise toujours de quel folio il vient).
export function ajouterPassages(source, sourceId, machineId, pages, { titre = '' } = {}) {
  const inserer = db().prepare('INSERT INTO passages (source, source_id, machine_id, page, texte) VALUES (?, ?, ?, ?, ?)')
  let nombre = 0
  for (const { page, texte } of pages) {
    for (const morceau of decouper(texte)) {
      inserer.run(source, sourceId, machineId ?? null, page ?? null, titre ? `${titre}\n${morceau}` : morceau)
      nombre++
    }
  }
  if (nombre) relancerIndexeur()
  return nombre
}

export function supprimerPassages(source, sourceId) {
  db().prepare('DELETE FROM passages WHERE source = ? AND source_id = ?').run(source, sourceId)
}

export function changerMachineDesPassages(source, sourceId, machineId) {
  db().prepare('UPDATE passages SET machine_id = ? WHERE source = ? AND source_id = ?').run(machineId ?? null, source, sourceId)
}
