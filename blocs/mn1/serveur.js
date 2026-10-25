// La maintenance de niveau 1 : les fiches gardées depuis l'analyse des machines, et le tableau de bord des
// demandes d'intervention de niveau 1 (le type de demande est choisi à l'écran, parmi ceux de la base).
// Les demandes sont lues en direct dans la base de la GMAO, avec la requête réglée dans « Données de la GMAO »
// (colonnes : numero, date, machine, type, description, demandeur, etat, arret) ; rien n'est recopié.

import { db, reglage, modifierReglage, noterModification } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { lireArborescencesTableau } from '../../lib/arborescence.js'
import { requetes } from '../import-gmao/synchronisation.js'

const POUR = ['Production', 'Maintenance']
const FREQUENCES = ['Quotidienne', 'Hebdomadaire', 'Mensuelle', 'Trimestrielle', 'Semestrielle', 'Annuelle']

function lireFiches(where = '', ...valeurs) {
  return db()
    .prepare(`SELECT f.*, m.repere, m.designation FROM fiches_mn1 f LEFT JOIN machines m ON m.id = f.machine_id ${where} ORDER BY f.ligne, f.eth, m.repere, f.id`)
    .all(...valeurs)
}

function nettoyerFiche(f) {
  const propre = {
    pour: POUR.includes(f.pour) ? f.pour : 'Maintenance',
    action: String(f.action || '').trim().slice(0, 400),
    frequence: FREQUENCES.includes(f.frequence) ? f.frequence : '',
    evite: String(f.evite || '').trim().slice(0, 300),
  }
  if (!propre.action) throw new ErreurHttp(400, 'Le geste est obligatoire.')
  return propre
}

// ---------------------------------------------------------------- demandes d'intervention

let cache = { cle: '', quand: 0, lignes: [] }

// AAAAMMJJ, AAAA-MM-JJ ou une date : → AAAA-MM-JJ
function dateIso(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const t = String(v ?? '').trim()
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : ''
}
// Une demande est close si son état le dit (mots courants, accents ignorés).
const close = (etat) => /clos|clotur|termin|sold|realis|annul|refus|archiv/.test(String(etat || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
const vrai = (v) => v === true || v === 1 || /^(1|o|oui|vrai|true|x)$/i.test(String(v ?? '').trim())

async function lireDemandes() {
  const sql = requetes().demandes
  if (!sql) return null
  if (!etatConnexion().ouverte) throw new ErreurHttp(401, 'Connexion MySQL fermée : saisissez le mot de passe.')
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

function moisDe(date) {
  return date.slice(0, 7)
}

async function tableau(lignesVoulues) {
  const demandes = await lireDemandes()
  if (!demandes) return { reglee: false }
  const types = [...demandes.reduce((c, d) => (d.type ? c.set(d.type, (c.get(d.type) || 0) + 1) : c), new Map())].sort((a, b) => b[1] - a[1]).map(([nom, nombre]) => ({ nom, nombre }))
  const voulu = reglage('mn1_type_demande', '')
  // Par défaut : le type dont le nom parle de maintenance, sinon le plus fréquent.
  const type = voulu && types.some((t) => t.nom === voulu) ? voulu : (types.find((t) => /maint/i.test(t.nom)) || types[0])?.nom || ''

  // La place de chaque machine (ligne, ETH), et les lignes à garder.
  const parRepere = new Map(db().prepare('SELECT id, repere, designation FROM machines').all().map((m) => [m.repere, m]))
  const arbre = await lireArborescencesTableau().catch(() => null)
  const place = new Map()
  for (const l of arbre?.lignes || []) {
    for (const id of l.machines) if (!place.has(id)) place.set(id, { ligneId: l.id, ligne: l.libelle, eth: '' })
    for (const e of l.enfants) for (const id of e.machines) place.set(id, { ligneId: l.id, ligne: l.libelle, eth: e.libelle })
  }
  const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
  const depuis12Mois = ilYa(365)
  const retenues = demandes
    .filter((d) => d.type === type && d.date)
    .map((d) => {
      const m = parRepere.get(d.machine)
      return { ...d, machineId: m?.id || null, designation: m?.designation || '', ...(m ? place.get(m.id) : null), close: close(d.etat) }
    })
    .filter((d) => !lignesVoulues.length || lignesVoulues.includes(d.ligneId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.numero.localeCompare(a.numero, 'fr', { numeric: true }))
  const annee = retenues.filter((d) => d.date >= depuis12Mois)

  const compter = (liste, cle) => [...liste.reduce((c, d) => (d[cle] ? c.set(d[cle], (c.get(d[cle]) || 0) + 1) : c), new Map())].sort((a, b) => b[1] - a[1])
  const parMois = []
  const aujourdhui = new Date()
  for (let k = 11; k >= 0; k--) {
    const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - k, 1)
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const du = annee.filter((x) => moisDe(x.date) === cle)
    parMois.push({ mois: cle, ouvertes: du.filter((x) => !x.close).length, closes: du.filter((x) => x.close).length })
  }
  const avecFiche = new Set(db().prepare('SELECT DISTINCT machine_id FROM fiches_mn1').all().map((f) => f.machine_id))
  const machines = compter(annee, 'machine').slice(0, 8).map(([repere, nombre]) => {
    const m = parRepere.get(repere)
    return { repere, nombre, id: m?.id || null, designation: m?.designation || '', fiche: m ? avecFiche.has(m.id) : false }
  })
  return {
    reglee: true,
    types,
    type,
    lignes: (arbre?.lignes || []).map((l) => ({ id: l.id, libelle: l.libelle })),
    tuiles: {
      annee: annee.length,
      ouvertes: retenues.filter((d) => !d.close).length,
      arret: retenues.filter((d) => !d.close && d.arret).length,
      mois: retenues.filter((d) => d.date >= ilYa(30)).length,
      moisAvant: retenues.filter((d) => d.date >= ilYa(60) && d.date < ilYa(30)).length,
    },
    parMois,
    machines,
    eth: compter(annee, 'eth').slice(0, 8).map(([nom, nombre]) => ({ nom, nombre })),
    demandeurs: compter(annee, 'demandeur').slice(0, 8).map(([nom, nombre]) => ({ nom, nombre })),
    // Les machines qui ont des demandes de niveau 1 mais pas encore de fiche : par où commencer.
    sansFiche: machines.filter((m) => m.id && !m.fiche).slice(0, 6),
    dernieres: retenues.slice(0, 12).map(({ numero, date, machine, machineId, designation, eth, description, demandeur, etat, arret, close: c }) => ({ numero, date, machine, machineId, designation, eth, description, demandeur, etat, arret, close: c })),
  }
}

// ---------------------------------------------------------------- routes

export function routes(r) {
  r.get('/api/mn1/fiches', () => lireFiches())

  // { machine_id, pour, action, frequence, evite, eth, ligne } ; un même geste sur la même machine n'est gardé qu'une fois.
  r.post('/api/mn1/fiches', async (ctx) => {
    exigerEcriture()
    const f = await ctx.json()
    const machine = db().prepare('SELECT id FROM machines WHERE id = ?').get(f.machine_id)
    if (!machine) throw new ErreurHttp(404, 'Machine introuvable')
    const propre = nettoyerFiche(f)
    const deja = db().prepare('SELECT id FROM fiches_mn1 WHERE machine_id = ? AND lower(action) = lower(?)').get(machine.id, propre.action)
    if (deja) return lireFiches('WHERE f.id = ?', deja.id)[0]
    const maintenant = new Date().toISOString()
    const id = db()
      .prepare('INSERT INTO fiches_mn1 (machine_id, pour, action, frequence, evite, ligne, eth, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(machine.id, propre.pour, propre.action, propre.frequence, propre.evite, String(f.ligne || ''), String(f.eth || ''), maintenant, maintenant).lastInsertRowid
    noterModification()
    return lireFiches('WHERE f.id = ?', Number(id))[0]
  })

  r.post('/api/mn1/fiches/:id', async (ctx) => {
    exigerEcriture()
    const propre = nettoyerFiche(await ctx.json())
    const r2 = db().prepare('UPDATE fiches_mn1 SET pour = ?, action = ?, frequence = ?, evite = ?, modifie_le = ? WHERE id = ?').run(propre.pour, propre.action, propre.frequence, propre.evite, new Date().toISOString(), ctx.params.id)
    if (!r2.changes) throw new ErreurHttp(404, 'Fiche introuvable')
    noterModification()
    return lireFiches('WHERE f.id = ?', Number(ctx.params.id))[0]
  })

  r.delete('/api/mn1/fiches/:id', (ctx) => {
    exigerEcriture()
    db().prepare('DELETE FROM fiches_mn1 WHERE id = ?').run(ctx.params.id)
    noterModification()
    return { supprimee: true }
  })

  // Le tableau de bord des demandes de niveau 1 : ?lignes=id1,id2
  r.get('/api/mn1/demandes', (ctx) => tableau(String(ctx.query.lignes || '').split(',').filter(Boolean)))

  // Le type de demande compté comme niveau 1 (administrateur).
  r.post('/api/mn1/type', async (ctx) => {
    exigerEcriture()
    const { type = '' } = await ctx.json()
    modifierReglage('mn1_type_demande', String(type))
    noterModification()
    return { type }
  })
}
