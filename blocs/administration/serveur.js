// Administration d'AITEC : nom de l'atelier, glossaire des repères, index de recherche, modèle d'IA,
// et reprise des données d'un ancien fichier IASSITEC (.datassitec).
// (Le fichier .ktec, son mot de passe, les sauvegardes et les réglages du poste sont dans les Réglages de KTEC.)

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { db, reglage, modifierReglage, transaction } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { arreterIA } from 'ktec/ia.js'
import { dossierInstallationParDefaut, lireJson, reglagesPoste, journal } from 'ktec/installation.js'
import { etatPartage, noterModification } from 'ktec/partage.js'
import { relancerIndexeur, etatIndexation } from '../recherche/indexeur.js'
import { etatModeles, utiliserModele } from 'ktec/modeles.js'
import { glossaire, GLOSSAIRE_PAR_DEFAUT } from '../../lib/glossaire.js'

// Les tables reprises d'un fichier IASSITEC, dans l'ordre (les clés étrangères d'abord).
const TABLES_IASSITEC = ['machines', 'pieces', 'pieces_machines', 'interventions', 'documents', 'images_pages', 'passages']
// Réglages d'IASSITEC qui ne sont pas repris : le mot de passe et l'icône relèvent maintenant de KTEC.
const REGLAGES_IGNORES = ['format', 'mot_de_passe', 'icone', 'icone_type']

export function routes(r) {
  r.post('/api/admin/atelier', async (ctx) => {
    ctx.exigerAdmin()
    const { nom } = await ctx.json()
    if (!nom?.trim()) throw new ErreurHttp(400, "Donnez un nom à l'atelier.")
    modifierReglage('nom_atelier', nom.trim())
    noterModification()
  })

  // Recalcule tous les vecteurs (après un changement de modèle de recherche, par exemple).
  r.post('/api/admin/reindexer', (ctx) => {
    ctx.exigerAdmin()
    db().exec('UPDATE passages SET vecteur = NULL')
    noterModification()
    relancerIndexeur()
  })

  r.get('/api/admin/infos', () => {
    const statistiques = db().prepare("SELECT (SELECT count(*) FROM passages) AS passages, (SELECT count(*) FROM machines) AS machines, (SELECT count(*) FROM interventions) AS interventions, (SELECT count(*) FROM documents) AS documents, (SELECT coalesce(sum(taille), 0) FROM documents) AS octetsDocuments").get()
    const ancien = ancienFichierIassitec()
    return {
      atelier: reglage('nom_atelier', ''),
      fichier: etatPartage().fichier,
      statistiques,
      indexation: etatIndexation(),
      ancienFichier: ancien && fs.existsSync(ancien) ? { chemin: ancien, taille: fs.statSync(ancien).size } : null,
    }
  })

  // ---- glossaire des repères (commun à tous les postes)

  r.get('/api/glossaire', () => ({ texte: glossaire(), parDefaut: GLOSSAIRE_PAR_DEFAUT }))

  r.post('/api/admin/glossaire', async (ctx) => {
    ctx.exigerAdmin()
    const { texte } = await ctx.json()
    modifierReglage('glossaire', String(texte || '').trim() || null)
    noterModification()
  })

  // ---- modèle d'IA de ce poste (moyen, lourd…) : commun aux applications KTEC de ce poste

  r.get('/api/modeles', () => etatModeles())

  r.post('/api/modeles/:code', (ctx) => utiliserModele(ctx.params.code, arreterIA))

  // ---- reprise d'un fichier IASSITEC

  // { chemin, remplacer } : copie les machines, interventions, documents, passages (avec leurs vecteurs)
  // et réglages d'un .datassitec dans le .ktec. Le fichier d'origine n'est pas modifié.
  r.post('/api/admin/importer-datassitec', async (ctx) => {
    ctx.exigerAdmin()
    const { chemin, remplacer = false } = await ctx.json()
    if (!chemin || !fs.existsSync(chemin)) throw new ErreurHttp(404, `Fichier introuvable : ${chemin}`)
    const bilan = importerDatassitec(path.resolve(chemin), remplacer)
    noterModification()
    relancerIndexeur() // les passages sans vecteur seront calculés en arrière-plan
    return bilan
  })
}

// Le fichier IASSITEC que ce poste ouvrait (ancienne installation, ou dossier de développement d'AITEC).
function ancienFichierIassitec() {
  const candidats = [dossierInstallationParDefaut('IASSITEC'), ...reglagesPoste().applisDev]
  for (const dossier of candidats) {
    const fichier = lireJson(path.join(dossier, 'reglages-poste.json'), null)?.fichier
    if (fichier && fichier.endsWith('.datassitec')) return fichier
  }
  return null
}

function importerDatassitec(chemin, remplacer) {
  const source = new DatabaseSync(chemin, { readOnly: true })
  try {
    const format = Number(source.prepare("SELECT valeur FROM reglages WHERE cle = 'format'").get()?.valeur || 0)
    if (!format) throw new ErreurHttp(400, "Ce fichier n'est pas un fichier IASSITEC.")
    const deja = db().prepare('SELECT (SELECT count(*) FROM machines) + (SELECT count(*) FROM documents) + (SELECT count(*) FROM interventions) AS n').get().n
    if (deja && !remplacer) throw new ErreurHttp(409, 'AITEC contient déjà des machines, des interventions ou des documents : cochez « Remplacer » pour les remplacer par ceux du fichier.')
    const bilan = {}
    transaction(() => {
      // Les passages d'abord (l'index de recherche par mots suit tout seul, par ses déclencheurs).
      for (const table of [...TABLES_IASSITEC].reverse()) db().exec(`DELETE FROM ${table}`)
      for (const table of TABLES_IASSITEC) {
        const colonnesCible = new Set(db().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name))
        const colonnes = source.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((c) => colonnesCible.has(c))
        if (!colonnes.length) continue
        const inserer = db().prepare(`INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`)
        let n = 0
        for (const ligne of source.prepare(`SELECT ${colonnes.join(', ')} FROM ${table}`).iterate()) {
          inserer.run(...colonnes.map((c) => ligne[c]))
          n++
        }
        bilan[table] = n
      }
      for (const { cle, valeur } of source.prepare('SELECT cle, valeur FROM reglages').all()) {
        if (!REGLAGES_IGNORES.includes(cle)) db().prepare('INSERT OR REPLACE INTO reglages (cle, valeur) VALUES (?, ?)').run(cle, valeur)
      }
    })
    journal(`Fichier IASSITEC repris dans le fichier de connaissances : ${chemin} (${JSON.stringify(bilan)})`)
    return bilan
  } finally {
    source.close()
  }
}
