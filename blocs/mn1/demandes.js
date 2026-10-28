// Les demandes d'intervention, lues en direct dans la base de la GMAO avec la requête réglée dans « Données de la
// GMAO » (colonnes : numero, date, machine, type, description, demandeur, etat, arret) ; rien n'est recopié.

import { ErreurHttp } from 'ktec/http.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { requetes } from '../import-gmao/synchronisation.js'

let cache = { cle: '', quand: 0, lignes: [] }

// AAAAMMJJ, AAAA-MM-JJ ou une date : → AAAA-MM-JJ
function dateIso(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const t = String(v ?? '').trim()
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : ''
}
// Une demande est close si son état le dit (mots courants, accents ignorés).
export const close = (etat) => /clos|clotur|termin|sold|realis|annul|refus|archiv/.test(String(etat || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
const vrai = (v) => v === true || v === 1 || /^(1|o|oui|vrai|true|x)$/i.test(String(v ?? '').trim())

export async function lireDemandes() {
  const sql = requetes().demandes
  if (!sql) return null
  if (!etatConnexion().ouverte) throw new ErreurHttp(401, 'Connexion à la GMAO indisponible (réglée par l’administrateur).')
  // Une minute de cache : l'écran se redessine souvent, la base n'a pas besoin d'être relue à chaque fois.
  if (cache.cle === sql && Date.now() - cache.quand < 60_000) return cache.lignes
  const r = await executerRequete(sql.replace(/--[^\n]*/g, ''), 1_000_000)
  const i = (nom) => r.colonnes.findIndex((c) => c.nom.toLowerCase() === nom)
  const col = Object.fromEntries(['numero', 'date', 'machine', 'type', 'description', 'demandeur', 'etat', 'arret'].map((n) => [n, i(n)]))
  if (col.date < 0 || col.machine < 0 || col.type < 0) throw new ErreurHttp(400, 'Requête des demandes : il faut au moins les colonnes date, machine et type.')
  const v = (l, n) => (col[n] < 0 ? '' : l[col[n]])
  const lignes = r.lignes.map((l) => ({
    numero: String(v(l, 'numero') ?? ''),
    date: dateIso(v(l, 'date')),
    machine: String(v(l, 'machine') ?? '').trim(),
    type: String(v(l, 'type') ?? '').trim(),
    description: String(v(l, 'description') ?? '').trim().slice(0, 300),
    demandeur: String(v(l, 'demandeur') ?? '').trim(),
    etat: String(v(l, 'etat') ?? '').trim(),
    arret: vrai(v(l, 'arret')),
  }))
  cache = { cle: sql, quand: Date.now(), lignes }
  return lignes
}

