// La maintenance de niveau 1 : les fiches gardées depuis l'analyse des machines, et le tableau de bord des
// demandes d'intervention de niveau 1 (le type de demande est choisi à l'écran, parmi ceux de la base).
// Les demandes sont lues en direct dans la base de la GMAO, avec la requête réglée dans « Données de la GMAO »
// (colonnes : numero, date, machine, type, description, demandeur, etat, arret) ; rien n'est recopié.

import { db, reglage, reglageJson, modifierReglage, noterModification, transaction } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { exigerEcriture } from 'ktec/partage.js'
import { executerRequete } from 'ktec/mysql.js'
import { lireTableur } from '../../lib/tableurs.js'
import { reglagesGmao, enregistrerReglagesGmao, creerFi, equipementsDeLaLigne, remplir, reglagesDuParc, enregistrerReglagesDuParc, PROPRES_AU_PARC } from './gmao.js'
import { lireDemandes, close } from './demandes.js'
import { vignettes, detailDuParc, seuilPertinence, SEUIL_PERTINENCE } from './parcs.js'
import { planifier, executer, suspendre, resumePlan, equipementsDuParc, lireFiGmao } from './fi.js'
import { analyser, proposerFiche } from './correlation.js'
import { lireParcs } from '../../lib/parcs.js'

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

// Le bandeau du haut : pourquoi la maintenance de niveau 1 (modifiable par l'administrateur).
export const DESCRIPTION = 'La maintenance de niveau 1, ce sont les gestes simples que les opérateurs font sur leur machine : regarder, écouter, toucher, nettoyer, resserrer. Faits régulièrement, ils montrent les petites anomalies avant qu’elles ne deviennent des pannes : moins d’arrêts subis, des interventions préparées plutôt qu’urgentes, et des opérateurs qui connaissent mieux leur machine.'

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

function moisDe(date) {
  return date.slice(0, 7)
}

// ?parc=… : les demandes des machines du parc choisi en haut d'AITEC (jamais celles des machines masquées).
async function tableau(parcVoulu = '') {
  const demandes = await lireDemandes()
  if (!demandes) return { reglee: false }
  const types = [...demandes.reduce((c, d) => (d.type ? c.set(d.type, (c.get(d.type) || 0) + 1) : c), new Map())].sort((a, b) => b[1] - a[1]).map(([nom, nombre]) => ({ nom, nombre }))
  const voulu = reglage('mn1_type_demande', '')
  // Par défaut : le type dont le nom parle de maintenance, sinon le plus fréquent.
  const type = voulu && types.some((t) => t.nom === voulu) ? voulu : (types.find((t) => /maint/i.test(t.nom)) || types[0])?.nom || ''

  // La place de chaque machine (parc, ETH).
  const parRepere = new Map(db().prepare('SELECT id, repere, designation FROM machines').all().map((m) => [m.repere, m]))
  const p = await lireParcs().catch(() => null)
  const place = new Map()
  for (const parc of p?.parcs || []) {
    for (const racine of [...parc.production, ...parc.maintenance, ...parc.autres]) {
      for (const n of p.detail(racine)) if (n.machine && !place.has(n.machine)) place.set(n.machine, { parc: parc.id, eth: n.eth })
    }
  }
  const masquees = p?.machinesMasquees || new Set()
  const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10)
  const depuis12Mois = ilYa(365)
  const retenues = demandes
    .filter((d) => d.type === type && d.date)
    .map((d) => {
      const m = parRepere.get(d.machine)
      return { ...d, machineId: m?.id || null, designation: m?.designation || '', ...(m ? place.get(m.id) : null), close: close(d.etat) }
    })
    .filter((d) => !(d.machineId && masquees.has(d.machineId)) && (!parcVoulu || place.get(d.machineId)?.parc === parcVoulu))
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
  // Les machines qui ont une fiche (celle de la fiche, son équipement de production, et sa machine de maintenance).
  const avecFiche = new Set(db().prepare('SELECT machine_id, machine_prod FROM fiches_mn1 WHERE archivee = 0').all().flatMap((f) => [f.machine_id, f.machine_prod, p?.liens?.[f.machine_prod]]).filter(Boolean))
  const machines = compter(annee, 'machine').slice(0, 8).map(([repere, nombre]) => {
    const m = parRepere.get(repere)
    return { repere, nombre, id: m?.id || null, designation: m?.designation || '', fiche: m ? avecFiche.has(m.id) : false }
  })
  return {
    reglee: true,
    types,
    type,
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

// Réglages et SQL : réservés à l'administrateur (ctx.exigerModeAdmin, KTEC 0.6 et plus).
const reserve = (r) => Object.fromEntries(['get', 'post', 'delete'].map((m) => [m, (chemin, action) => r[m](chemin, (ctx) => {
  ctx.exigerModeAdmin?.()
  return action(ctx)
})]))

export function routes(r) {
  const admin = reserve(r)
  r.get('/api/mn1/fiches', () => lireFiches())

  r.get('/api/mn1/parametres', () => ({ ...parametres(), origine: PARAMETRES }))

  // { parSemaine, fiches: { Hebdomadaire: 5, … } } (administrateur)
  admin.post('/api/mn1/parametres', async (ctx) => {
    exigerEcriture()
    const { parSemaine, fiches = {} } = await ctx.json()
    const propres = Object.fromEntries(Object.keys(PARAMETRES.fiches).map((f) => [f, Math.max(1, Math.min(31, Math.round(Number(fiches[f]) || PARAMETRES.fiches[f])))]))
    modifierReglage('mn1_parametres', { parSemaine: Math.max(1, Math.min(50, Math.round(Number(parSemaine) || PARAMETRES.parSemaine))), fiches: propres })
    noterModification()
    return parametres()
  })

  // Depuis l'analyse d'une machine : { machine_id, action, frequence, evite, eth, ligne } (fréquence préconisée).
  // Depuis un trou du Pareto (brouillon de l'IA relu) : { parc, machine_nom, zone, etiquette, action, frequence, evite }.
  // Un même geste sur la même machine n'est gardé qu'une fois.
  r.post('/api/mn1/fiches', async (ctx) => {
    exigerEcriture()
    const f = await ctx.json()
    const propre = nettoyerFiche(f)
    const maintenant = new Date().toISOString()
    if (!f.machine_id) {
      if (!f.parc) throw new ErreurHttp(400, 'Machine ou parc obligatoire.')
      const id = db()
        .prepare("INSERT INTO fiches_mn1 (machine_id, pour, etiquette, machine_nom, zone, origine, action, frequence, frequence_source, evite, ligne, eth, parc, cree_le, modifie_le) VALUES (NULL, 'Production', ?, ?, ?, 'ia', ?, ?, 'manuelle', ?, '', '', ?, ?, ?)")
        .run(propre.etiquette, String(f.machine_nom || '').trim().slice(0, 120), propre.zone, propre.action, propre.frequence, propre.evite, String(f.parc), maintenant, maintenant).lastInsertRowid
      noterModification()
      return lireFiches('WHERE f.id = ?', Number(id))[0]
    }
    const machine = db().prepare('SELECT id FROM machines WHERE id = ?').get(f.machine_id)
    if (!machine) throw new ErreurHttp(404, 'Machine introuvable')
    const deja = db().prepare('SELECT id FROM fiches_mn1 WHERE machine_id = ? AND lower(action) = lower(?)').get(machine.id, propre.action)
    if (deja) return lireFiches('WHERE f.id = ?', deja.id)[0]
    const id = db()
      .prepare("INSERT INTO fiches_mn1 (machine_id, pour, action, frequence, frequence_source, evite, ligne, eth, cree_le, modifie_le) VALUES (?, ?, ?, ?, 'analyse', ?, ?, ?, ?, ?)")
      .run(machine.id, propre.pour, propre.action, propre.frequence, propre.evite, String(f.ligne || ''), String(f.eth || ''), maintenant, maintenant).lastInsertRowid
    noterModification()
    return lireFiches('WHERE f.id = ?', Number(id))[0]
  })

  // Corriger une fiche ; une fréquence choisie ici (après l'analyse de la machine) n'est plus provisoire.
  r.post('/api/mn1/fiches/:id', async (ctx) => {
    exigerEcriture()
    const entree = await ctx.json()
    const propre = nettoyerFiche(entree)
    const avant = db().prepare('SELECT frequence, frequence_source FROM fiches_mn1 WHERE id = ?').get(ctx.params.id)
    if (!avant) throw new ErreurHttp(404, 'Fiche introuvable')
    const source = entree.confirmerFrequence || avant.frequence !== propre.frequence ? (propre.frequence ? 'manuelle' : avant.frequence_source) : avant.frequence_source
    db().prepare('UPDATE fiches_mn1 SET pour = ?, action = ?, frequence = ?, frequence_source = ?, evite = ?, etiquette = ?, zone = ?, modifie_le = ? WHERE id = ?').run(propre.pour, propre.action, propre.frequence, source, propre.evite, propre.etiquette, propre.zone, new Date().toISOString(), ctx.params.id)
    noterModification()
    return lireFiches('WHERE f.id = ?', Number(ctx.params.id))[0]
  })

  // Import d'un classeur de fiches de contrôle (Excel, LibreOffice, CSV) : une ligne par point à vérifier, avec
  // les colonnes ligne, ETH, machine, zone, action et étiquette (code de la carte). Les points d'une même étiquette
  // forment une fiche ; une étiquette déjà importée est mise à jour. Nom du fichier dans l'en-tête X-Nom.
  admin.post('/api/mn1/import', async (ctx) => {
    exigerEcriture()
    const nom = decodeURIComponent(ctx.req.headers['x-nom'] || 'fiches.xlsx')
    const frequence = FREQUENCES.includes(ctx.query.frequence) ? ctx.query.frequence : 'Mensuelle'
    const fiches = fichesDuClasseur(lireTableur(nom, await ctx.octets()))
    if (!fiches.length) throw new ErreurHttp(400, 'Aucune fiche trouvée : il faut une feuille avec au moins les colonnes « action » et « étiquette » (ou « zone »).')
    const maintenant = new Date().toISOString()
    const existante = db().prepare("SELECT id FROM fiches_mn1 WHERE origine = 'import' AND ligne = ? AND etiquette = ? AND machine_nom = ?")
    const modifier = db().prepare('UPDATE fiches_mn1 SET eth = ?, zone = ?, action = ?, modifie_le = ? WHERE id = ?')
    const creer = db().prepare("INSERT INTO fiches_mn1 (machine_id, pour, etiquette, machine_nom, zone, origine, action, frequence, frequence_source, evite, ligne, eth, cree_le, modifie_le) VALUES (NULL, 'Production', ?, ?, ?, 'import', ?, ?, 'import', '', ?, ?, ?, ?)")
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

  admin.get('/api/mn1/gmao/reglages', () => reglagesGmao())

  admin.post('/api/mn1/gmao/reglages', async (ctx) => {
    ctx.exigerAdmin()
    return enregistrerReglagesGmao(await ctx.json())
  })

  // Les équipements d'une ligne (pour choisir l'ID de l'équipement de la FI) : ?ligne=…
  r.get('/api/mn1/gmao/equipements', (ctx) => equipementsDeLaLigne(ctx.query.ligne))

  // Ce que la fenêtre de création propose : numéro, titre (d'après les modèles des réglages).
  admin.post('/api/mn1/gmao/proposition', async (ctx) => {
    const { ligne = '', eth = '', machine = '', repere = '', nn = 1 } = await ctx.json()
    const r2 = reglagesGmao()
    const v = { ligne, eth, machine, repere, nn: String(nn).padStart(2, '0') }
    return { numero: remplir(r2.numero, v), titre: remplir(r2.titre, v) }
  })

  // { ids, numero, titre, parc, dateDeb, valider } : simule (valider absent) ou crée la FI.
  admin.post('/api/mn1/gmao/creer', async (ctx) => {
    ctx.exigerAdmin()
    return creerFi(await ctx.json())
  })

  r.delete('/api/mn1/fiches/:id', (ctx) => {
    exigerEcriture()
    db().prepare('DELETE FROM fiches_mn1 WHERE id = ?').run(ctx.params.id)
    noterModification()
    return { supprimee: true }
  })

  // Le tableau de bord des demandes de niveau 1 : ?parc=…
  r.get('/api/mn1/demandes', (ctx) => tableau(String(ctx.query.parc || '')))

  // ---- Parcs : vignettes, fiche du parc, analyse de corrélation

  // Les vignettes (les FI de la GMAO sont relues à chaque ouverture : ?relire=1).
  r.get('/api/mn1/vignettes', async (ctx) => {
    if (ctx.query.relire) await lireFiGmao({ force: true }).catch(() => {})
    return vignettes()
  })

  r.get('/api/mn1/parcs/:id', async (ctx) => {
    const d = await detailDuParc(ctx.params.id)
    if (!d) throw new ErreurHttp(404, 'Parc introuvable')
    return d
  })

  // Analyse de corrélation par l'IA (aussi en consultation : le résultat est enregistré).
  r.post('/api/mn1/parcs/:id/analyse', (ctx) => analyser(ctx.params.id))

  // Brouillon de fiche pour une panne du Pareto qu'aucune fiche ne vise : { code } (rien n'est enregistré).
  r.post('/api/mn1/parcs/:id/proposer', async (ctx) => proposerFiche(ctx.params.id, String((await ctx.json()).code || '')))

  // Les réglages propres au parc (administrateur) : maximum par ETH, paramètres de ses FI.
  admin.get('/api/mn1/parcs/:id/reglages', (ctx) => {
    const r2 = reglagesDuParc(ctx.params.id)
    return { propres: r2.propres, generaux: Object.fromEntries(PROPRES_AU_PARC.map((cle) => [cle, reglagesGmao()[cle]])) }
  })
  admin.post('/api/mn1/parcs/:id/reglages', async (ctx) => {
    ctx.exigerAdmin()
    return enregistrerReglagesDuParc(ctx.params.id, await ctx.json()).propres
  })

  // Les équipements de production du parc (l'équipement d'une FI), par ETH.
  admin.get('/api/mn1/parcs/:id/equipements', async (ctx) => (await equipementsDuParc(ctx.params.id)).equipements.filter((n) => n.niveau >= 2).map(({ noeud, code, designation, niveau, ethCode, ethLibelle, machine }) => ({ noeud, code, designation, niveau, eth: ethCode, ethLibelle, machine })))

  // Ranger une fiche dans un parc, l'archiver ou la ramener : { parc } ou { archivee: true | false }.
  admin.post('/api/mn1/fiches/:id/ranger', async (ctx) => {
    ctx.exigerAdmin()
    const { parc, archivee } = await ctx.json()
    const f = db().prepare('SELECT id, fi_gmao FROM fiches_mn1 WHERE id = ?').get(ctx.params.id)
    if (!f) throw new ErreurHttp(404, 'Fiche introuvable')
    const maintenant = new Date().toISOString()
    if (parc !== undefined) db().prepare('UPDATE fiches_mn1 SET parc = ?, modifie_le = ? WHERE id = ?').run(String(parc || ''), maintenant, f.id)
    if (archivee !== undefined) {
      if (archivee && f.fi_gmao) throw new ErreurHttp(409, `Cette fiche porte la FI ${f.fi_gmao} : remplacez-la ou suspendez la FI d’abord.`)
      db().prepare('UPDATE fiches_mn1 SET archivee = ?, archivee_le = ?, modifie_le = ? WHERE id = ?').run(archivee ? 1 : 0, archivee ? maintenant : null, maintenant, f.id)
    }
    noterModification()
    return lireFiches('WHERE f.id = ?', f.id)[0]
  })

  // Les fiches archivées d'un parc, avec leur historique dans les FI.
  r.get('/api/mn1/archives', (ctx) => {
    const fiches = db().prepare('SELECT f.*, m.repere FROM fiches_mn1 f LEFT JOIN machines m ON m.id = f.machine_id WHERE f.archivee = 1 AND (? = \'\' OR f.parc = ?) ORDER BY f.archivee_le DESC').all(ctx.query.parc || '', ctx.query.parc || '')
    const historique = db().prepare('SELECT numero, debut, fin, motif FROM fiches_mn1_fi WHERE fiche_id = ? ORDER BY debut')
    return fiches.map((f) => ({ ...f, historique: historique.all(f.id) }))
  })

  // ---- FI de niveau 1 dans la GMAO (administrateur) : le plan, puis la simulation ou l'écriture.
  // { parc, fiche, noeud, dateDeb, cible: nouvelle | reactiver | remplacer, numero, remplacer: [numéros] }
  admin.post('/api/mn1/fi/plan', async (ctx) => resumePlan(await planifier(await ctx.json())))
  admin.post('/api/mn1/fi/executer', async (ctx) => {
    ctx.exigerAdmin()
    const demande = await ctx.json()
    return executer(demande, { valider: Boolean(demande.valider) })
  })
  // Maximum baissé : suspendre des FI. { parc, numeros, valider }
  admin.post('/api/mn1/fi/suspendre', async (ctx) => {
    ctx.exigerAdmin()
    const demande = await ctx.json()
    return suspendre(demande, { valider: Boolean(demande.valider) })
  })

  // Les listes de choix des paramètres de FI, lues dans la GMAO (requêtes des réglages : colonnes valeur, libelle).
  admin.get('/api/mn1/gmao/listes', async () => {
    const r2 = reglagesGmao()
    const listes = {}
    for (const [cle, sql] of Object.entries(r2.listes || {})) {
      if (!sql) continue
      try {
        const res = await executerRequete(sql.replace(/--[^\n]*/g, ''), 5000)
        const iV = res.colonnes.findIndex((c) => c.nom.toLowerCase() === 'valeur')
        const iL = res.colonnes.findIndex((c) => c.nom.toLowerCase() === 'libelle')
        listes[cle] = res.lignes.map((l) => ({ valeur: String(l[iV < 0 ? 0 : iV] ?? ''), libelle: String(l[iL < 0 ? (iV < 0 ? 0 : iV) : iL] ?? '') }))
      } catch (e) {
        listes[cle] = { erreur: e.message }
      }
    }
    return listes
  })

  // Le bandeau du haut : la description (modifiable par l'administrateur) et le seuil d'alerte de pertinence.
  r.get('/api/mn1/entete', () => ({ description: reglage('mn1_description', '') || DESCRIPTION, origine: DESCRIPTION, seuil: seuilPertinence(), seuilOrigine: SEUIL_PERTINENCE }))
  admin.post('/api/mn1/entete', async (ctx) => {
    ctx.exigerAdmin()
    const { description, seuil } = await ctx.json()
    if (description !== undefined) {
      const propre = String(description || '').trim().slice(0, 1500)
      modifierReglage('mn1_description', propre === DESCRIPTION ? '' : propre)
    }
    if (seuil !== undefined) modifierReglage('mn1_seuil_pertinence', String(Math.max(0.05, Math.min(1, Number(seuil) || SEUIL_PERTINENCE))))
    noterModification()
    return { description: reglage('mn1_description', '') || DESCRIPTION, seuil: seuilPertinence() }
  })

  // Le type de demande compté comme niveau 1 (administrateur).
  admin.post('/api/mn1/type', async (ctx) => {
    exigerEcriture()
    const { type = '' } = await ctx.json()
    modifierReglage('mn1_type_demande', String(type))
    noterModification()
    return { type }
  })
}

// Au démarrage, une fois le fichier ouvert : les vignettes sont calculées une première fois (arborescence, FI de la
// GMAO, Pareto), pour que la première ouverture de l'écran soit rapide.
setTimeout(() => vignettes().catch(() => {}), 20_000).unref()
