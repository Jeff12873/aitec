// Lecture des tableaux : CSV, Excel (.xlsx) et LibreOffice (.ods), sans bibliothèque.
//
// lireTableur(nom, octets) → [{ feuille: 'Feuil1', lignes: [['A1', 'B1'], ['A2', 'B2'], …] }]
// Toutes les valeurs sont rendues en texte (les nombres Excel restent des nombres écrits en texte).
// Utilisé par l'import GMAO et par la lecture des documents.

import { lireZip, lireTexteDansZip } from './zip.js'

export function lireTableur(nom, octets) {
  const extension = nom.toLowerCase().split('.').pop()
  if (extension === 'xlsx' || extension === 'xlsm') return lireXlsx(octets)
  if (extension === 'ods') return lireOds(octets)
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') return [{ feuille: nom, lignes: lireCsv(decoderTexte(octets)) }]
  throw new Error(`Format de tableau non reconnu : .${extension} (formats acceptés : CSV, XLSX, ODS)`)
}

// ---------------------------------------------------------------- texte

// Les exports de GMAO sont souvent en UTF-8, parfois en Windows-1252 (Excel français) : on essaie les deux.
export function decoderTexte(octets) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(octets)
  }
}

export function decoderEntites(texte) {
  return texte
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
}

// ---------------------------------------------------------------- CSV

export function lireCsv(texte) {
  const premiereLigne = texte.slice(0, texte.indexOf('\n') >= 0 ? texte.indexOf('\n') : texte.length)
  const separateur = [';', '\t', ',', '|'].sort((a, b) => compter(premiereLigne, b) - compter(premiereLigne, a))[0]

  const lignes = []
  let ligne = []
  let valeur = ''
  let entreGuillemets = false
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        valeur += '"'
        i++
      } else if (c === '"') entreGuillemets = false
      else valeur += c
    } else if (c === '"') entreGuillemets = true
    else if (c === separateur) {
      ligne.push(valeur)
      valeur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++
      ligne.push(valeur)
      lignes.push(ligne)
      ligne = []
      valeur = ''
    } else valeur += c
  }
  if (valeur || ligne.length) {
    ligne.push(valeur)
    lignes.push(ligne)
  }
  return lignes.map((l) => l.map((v) => v.trim())).filter((l) => l.some((v) => v !== ''))
}

function compter(texte, caractere) {
  return texte.split(caractere).length - 1
}

// ---------------------------------------------------------------- Excel (.xlsx)

function lireXlsx(octets) {
  const fichiers = lireZip(octets)
  const classeur = lireTexteDansZip(fichiers, 'xl/workbook.xml') || ''
  const liens = lireTexteDansZip(fichiers, 'xl/_rels/workbook.xml.rels') || ''
  const partages = lireTextesPartages(lireTexteDansZip(fichiers, 'xl/sharedStrings.xml') || '')

  const cibles = {}
  for (const [, id, cible] of liens.matchAll(/<Relationship[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) cibles[id] = cible
  for (const [, cible, id] of liens.matchAll(/<Relationship[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)) cibles[id] = cible

  const feuilles = []
  for (const [balise] of classeur.matchAll(/<sheet\b[^>]*>/g)) {
    const nom = decoderEntites(balise.match(/name="([^"]*)"/)?.[1] || 'Feuille')
    const id = balise.match(/r:id="([^"]*)"/)?.[1]
    let cible = cibles[id]
    if (!cible) continue
    cible = cible.startsWith('/') ? cible.slice(1) : 'xl/' + cible
    const xml = lireTexteDansZip(fichiers, cible)
    if (xml) feuilles.push({ feuille: nom, lignes: lireFeuilleXlsx(xml, partages) })
  }
  return feuilles
}

function lireTextesPartages(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, contenu]) =>
    decoderEntites([...contenu.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  )
}

function lireFeuilleXlsx(xml, partages) {
  const lignes = []
  for (const [, contenuLigne] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const ligne = []
    for (const [, attributs, contenu = ''] of contenuLigne.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = attributs.match(/r="([A-Z]+)\d+"/)?.[1]
      const type = attributs.match(/t="([^"]+)"/)?.[1]
      let valeur = contenu.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
      if (type === 's') valeur = partages[Number(valeur)] ?? ''
      else if (type === 'inlineStr') valeur = [...contenu.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')
      else if (type === 'b') valeur = valeur === '1' ? 'VRAI' : 'FAUX'
      valeur = decoderEntites(valeur)
      const colonne = reference ? numeroDeColonne(reference) : ligne.length
      while (ligne.length < colonne) ligne.push('')
      ligne[colonne] = valeur.trim()
    }
    if (ligne.some((v) => v !== '')) lignes.push(ligne)
  }
  return lignes
}

// « A » → 0, « Z » → 25, « AA » → 26
function numeroDeColonne(lettres) {
  let n = 0
  for (const lettre of lettres) n = n * 26 + (lettre.charCodeAt(0) - 64)
  return n - 1
}

// ---------------------------------------------------------------- LibreOffice (.ods)

function lireOds(octets) {
  const xml = lireTexteDansZip(lireZip(octets), 'content.xml') || ''
  const feuilles = []
  for (const [, attributs, contenu] of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const nom = decoderEntites(attributs.match(/table:name="([^"]*)"/)?.[1] || 'Feuille')
    const lignes = []
    for (const [, attributsLigne, contenuLigne] of contenu.matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const ligne = []
      const cellules = (contenuLigne || '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)
      for (const [, attributsCellule, contenuCellule = ''] of cellules) {
        const repetitions = Math.min(Number(attributsCellule.match(/table:number-columns-repeated="(\d+)"/)?.[1] || 1), 200)
        const date = attributsCellule.match(/office:date-value="([^"]+)"/)?.[1]
        const nombre = attributsCellule.match(/office:value="([^"]+)"/)?.[1]
        const texte = decoderEntites(
          [...contenuCellule.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map((p) => p[1].replace(/<text:s[^>]*\/>/g, ' ').replace(/<[^>]+>/g, '')).join('\n'),
        )
        const valeur = (date ? date.slice(0, 10) : nombre ?? texte).trim()
        for (let i = 0; i < repetitions; i++) ligne.push(valeur)
      }
      while (ligne.length && ligne[ligne.length - 1] === '') ligne.pop()
      if (!ligne.length) continue
      const repetitionsLigne = Math.min(Number(attributsLigne.match(/table:number-rows-repeated="(\d+)"/)?.[1] || 1), 1000)
      for (let i = 0; i < repetitionsLigne; i++) lignes.push([...ligne])
    }
    feuilles.push({ feuille: nom, lignes })
  }
  return feuilles
}
