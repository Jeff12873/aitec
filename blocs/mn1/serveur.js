// La maintenance de niveau 1 : les fiches gardées depuis l'analyse des machines, et le tableau de bord des
// demandes d'intervention de niveau 1 (le type de demande est choisi à l'écran, parmi ceux de la base).
// Les demandes sont lues en direct dans la base de la GMAO, avec la requête réglée dans « Données de la GMAO »
// (colonnes : numero, date, machine, type, description, demandeur, etat, arret) ; rien n'est recopié.

import { db, reglage, reglageJson, modifierReglage, noterModification, transaction } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { lireArborescencesTableau } from '../../lib/arborescence.js'
import { requetes } from '../import-gmao/synchronisation.js'
import { lireTableur } from '../../lib/tableurs.js'
import { reglagesGmao, enregistrerReglagesGmao, creerFi, equipementsDeLaLigne, remplir } from './gmao.js'

const FREQUENCES = ['Quotidienne', 'Hebdomadaire', 'Mensuelle', 'Trimestrielle', 'Semestrielle', 'Annuelle']

// Les paramètres du rouage : combien de fiches les opérateurs tirent par semaine, et combien de fiches imprimer
// par fréquence (hebdomadaire : une par semaine du mois, soit 5 ; mensuelle : 1…). Quotidienne : trop fréquent
// pour une fiche, on renvoie vers le responsable de production ou un focus maintenance.
const PARAMETRES = { parSemaine: 2, fiches: { Hebdomadaire: 5, Mensuelle: 1, Trimestrielle: 1, Semestrielle: 1, Annuelle: 1 } }
function parametres() {
  const p = reglageJson('mn1_parametres', {}) || {}
  return { parSemaine: Number(p.parSemaine) > 0 ? Number(p.parSemaine) : PARAMETRES.parSemaine, fiches: { ...PARAMETRES.fiches, ...(p.fiches || {}) } }
}

function lireFiches(where = '', ...valeurs) {
  return db()
    .prepare(`SELECT f.*, m.repere, m.designation FROM fiches_mn1 f LEFT JOIN machines m ON m.id = f.machine_id ${where} ORDER BY f.ligne, f.eth, coalesce(m.repere, f.machine_nom), f.etiquette, f.id`)
    .all(...valeurs)
}

// Les fiches de niveau 1 sont toujours pour la production (les opérateurs).
function nettoyerFiche(f) {
  const propre = {
    pour: 'Production',
    action: String(f.action || '').trim().slice(0, 4000),
    etiquette: String(f.etiquette || '').trim().slice(0, 30),
    zone: String(f.zone || '').trim().slice(0, 120),
    frequence: FREQUENCES.includes(f.frequence) ? f.frequence : '',
    evite: String(f.evite || '').trim().slice(0, 300),
  }
  if (!propre.action) throw new ErreurHttp(400, 'Le geste est obligatoire.')
  return propre
}

// ---------------------------------------------------------------- import d'un classeur

const cle = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// La feuille qui a une colonne « action » ; ses colonnes reconnues à leur intitulé.
function fichesDuClasseur(feuilles) {
  for (const { lignes } of feuilles) {
    const iTete = lignes.findIndex((l) => l.some((c) => cle(c) === 'action'))
    if (iTete < 0) continue
    const tete = lignes[iTete].map(cle)
    const colonne = (...noms) => { for (const n of noms) { const i = tete.indexOf(n); if (i >= 0) return i } return -1 }
    const iEtiquette = colonne('etiquette imp', 'code etiquette', 'code', 'etiquette')
    const iZone2 = colonne('zone n2', 'zone 2', 'sous zone')
    const c = {
      ligne: colonne('ligne'),
      eth: colonne('eth'),
      // Avec une colonne « zone n2 », « zone » est la machine ; sinon c'est la zone, et la machine a sa colonne.
      machine: iZone2 >= 0 ? colonne('machine', 'zone') : colonne('machine', 'equipement'),
      zone: iZone2 >= 0 ? iZone2 : colonne('zone'),
      action: colonne('action'),
      etiquette: iEtiquette,
    }
    const v = (l, n) => (c[n] < 0 ? '' : String(l[c[n]] ?? '').trim())
    const parCle = new Map()
    for (const l of lignes.slice(iTete + 1)) {
      const action = v(l, 'action')
      if (!action) continue
      const f = { ligne: v(l, 'ligne'), eth: v(l, 'eth'), machine: v(l, 'machine'), zone: v(l, 'zone'), etiquette: v(l, 'etiquette') }
      const k = [f.ligne, f.machine, f.etiquette || f.zone].join('\u0001')
      if (!parCle.has(k)) parCle.set(k, { ...f, actions: [] })
      parCle.get(k).actions.push(action)
    }
    return [...parCle.values()].map((f) => ({ ...f, action: f.actions.join('\n').replace(/\r/g, '').trim() }))
  }
  return []
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

  r.get('/api/mn1/parametres', () => ({ ...parametres(), origine: PARAMETRES }))

  // { parSemaine, fiches: { Hebdomadaire: 5, … } } (administrateur)
  r.post('/api/mn1/parametres', async (ctx) => {
    exigerEcriture()
    const { parSemaine, fiches = {} } = await ctx.json()
    const propres = Object.fromEntries(Object.keys(PARAMETRES.fiches).map((f) => [f, Math.max(1, Math.min(31, Math.round(Number(fiches[f]) || PARAMETRES.fiches[f])))]))
    modifierReglage('mn1_parametres', { parSemaine: Math.max(1, Math.min(50, Math.round(Number(parSemaine) || PARAMETRES.parSemaine))), fiches: propres })
    noterModification()
    return parametres()
  })

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
    const r2 = db().prepare('UPDATE fiches_mn1 SET pour = ?, action = ?, frequence = ?, evite = ?, etiquette = ?, zone = ?, modifie_le = ? WHERE id = ?').run(propre.pour, propre.action, propre.frequence, propre.evite, propre.etiquette, propre.zone, new Date().toISOString(), ctx.params.id)
    if (!r2.changes) throw new ErreurHttp(404, 'Fiche introuvable')
    noterModification()
    return lireFiches('WHERE f.id = ?', Number(ctx.params.id))[0]
  })

  // Import d'un classeur de fiches de contrôle (Excel, LibreOffice, CSV) : une ligne par point à vérifier, avec
  // les colonnes ligne, ETH, machine, zone, action et étiquette (code de la carte). Les points d'une même étiquette
  // forment une fiche ; une étiquette déjà importée est mise à jour. Nom du fichier dans l'en-tête X-Nom.
  r.post('/api/mn1/import', async (ctx) => {
    exigerEcriture()
    const nom = decodeURIComponent(ctx.req.headers['x-nom'] || 'fiches.xlsx')
    const frequence = FREQUENCES.includes(ctx.query.frequence) ? ctx.query.frequence : 'Mensuelle'
    const fiches = fichesDuClasseur(lireTableur(nom, await ctx.octets()))
    if (!fiches.length) throw new ErreurHttp(400, 'Aucune fiche trouvée : il faut une feuille avec au moins les colonnes « action » et « étiquette » (ou « zone »).')
    const maintenant = new Date().toISOString()
    const existante = db().prepare("SELECT id FROM fiches_mn1 WHERE origine = 'import' AND ligne = ? AND etiquette = ? AND machine_nom = ?")
    const modifier = db().prepare('UPDATE fiches_mn1 SET eth = ?, zone = ?, action = ?, modifie_le = ? WHERE id = ?')
    const creer = db().prepare("INSERT INTO fiches_mn1 (machine_id, pour, etiquette, machine_nom, zone, origine, action, frequence, evite, ligne, eth, cree_le, modifie_le) VALUES (NULL, 'Production', ?, ?, ?, 'import', ?, ?, '', ?, ?, ?, ?)")
    let creees = 0
    let modifiees = 0
    transaction(() => {
      for (const f of fiches) {
        const deja = existante.get(f.ligne, f.etiquette, f.machine)
        if (deja) { modifier.run(f.eth, f.zone, f.action, maintenant, deja.id); modifiees++ }
        else { creer.run(f.etiquette, f.machine, f.zone, f.action, frequence, f.ligne, f.eth, maintenant, maintenant); creees++ }
      }
    })
    noterModification()
    return { creees, modifiees, total: fiches.length }
  })

  // ---- Création dans la GMAO (administrateur)

  r.get('/api/mn1/gmao/reglages', () => reglagesGmao())

  r.post('/api/mn1/gmao/reglages', async (ctx) => {
    ctx.exigerAdmin()
    return enregistrerReglagesGmao(await ctx.json())
  })

  // Les équipements d'une ligne (pour choisir l'ID de l'équipement de la FI) : ?ligne=…
  r.get('/api/mn1/gmao/equipements', (ctx) => equipementsDeLaLigne(ctx.query.ligne))

  // Ce que la fenêtre de création propose : numéro, titre (d'après les modèles des réglages).
  r.post('/api/mn1/gmao/proposition', async (ctx) => {
    const { ligne = '', eth = '', machine = '', repere = '', nn = 1 } = await ctx.json()
    const r2 = reglagesGmao()
    const v = { ligne, eth, machine, repere, nn: String(nn).padStart(2, '0') }
    return { numero: remplir(r2.numero, v), titre: remplir(r2.titre, v) }
  })

  // { ids, numero, titre, parc, dateDeb, valider } : simule (valider absent) ou crée la FI.
  r.post('/api/mn1/gmao/creer', async (ctx) => {
    ctx.exigerAdmin()
    return creerFi(await ctx.json())
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
