// Lecture et écriture des tables simples (machines, pièces, interventions), avec leurs routes.
//
// Chaque bloc décrit ses champs une seule fois :
//   { nom: 'designation', type: 'texte' | 'nombre' | 'date', obligatoire: true }
// et obtient : lister, lire, enregistrer, supprimer + les routes /api/<chemin>.

import { db } from './base.js'
import { noterModification } from './partage.js'
import { ErreurHttp } from './http.js'

export function creerTable({ table, champs, cle }) {
  const noms = champs.map((c) => c.nom)

  function nettoyer(donnees) {
    const propre = {}
    for (const champ of champs) {
      if (!(champ.nom in donnees)) continue
      propre[champ.nom] = convertir(donnees[champ.nom], champ.type)
      // Un code unique vide doit rester « NULL » : sinon deux lignes sans code seraient en conflit.
      if (champ.videNull && propre[champ.nom] === '') propre[champ.nom] = null
    }
    for (const champ of champs) {
      const vide = propre[champ.nom] === '' || propre[champ.nom] === null
      if (champ.obligatoire && champ.nom in propre && vide) {
        throw new ErreurHttp(400, `Le champ « ${champ.libelle || champ.nom} » est obligatoire.`)
      }
    }
    return propre
  }

  return {
    table,
    champs,

    lire(id) {
      return db().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null
    },

    // Retrouve une ligne par sa clé métier (repère, référence, numéro).
    lireParCle(valeur) {
      if (!cle || valeur === undefined || valeur === null || valeur === '') return null
      return db().prepare(`SELECT * FROM ${table} WHERE ${cle} = ?`).get(String(valeur)) || null
    },

    // Crée la ligne (sans id) ou la modifie (avec id). Renvoie l'id.
    enregistrer(donnees, id = null) {
      const propre = nettoyer(donnees)
      propre.modifie_le = new Date().toISOString()
      const colonnes = Object.keys(propre)
      if (id) {
        if (!this.lire(id)) throw new ErreurHttp(404, 'Introuvable')
        const affectations = colonnes.map((c) => `${c} = ?`).join(', ')
        db().prepare(`UPDATE ${table} SET ${affectations} WHERE id = ?`).run(...Object.values(propre), id)
        return Number(id)
      }
      for (const champ of champs) {
        if (champ.obligatoire && !(champ.nom in propre)) throw new ErreurHttp(400, `Le champ « ${champ.libelle || champ.nom} » est obligatoire.`)
      }
      const resultat = db()
        .prepare(`INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`)
        .run(...Object.values(propre))
      return Number(resultat.lastInsertRowid)
    },

    supprimer(id) {
      db().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    },

    noms,
  }
}

// Routes standard : liste, fiche, création, modification, suppression.
//   apresEcriture(id)    → mise à jour de l'index de recherche, etc.
//   apresSuppression(id)
//   lister(query)        → requête de liste propre au bloc
export function routesTable(routes, chemin, table, { lister, detailler, apresEcriture, apresSuppression }) {
  routes.get(`/api/${chemin}`, (ctx) => lister(ctx.query))

  routes.get(`/api/${chemin}/:id`, (ctx) => {
    const ligne = table.lire(ctx.params.id)
    if (!ligne) throw new ErreurHttp(404, 'Introuvable')
    return detailler ? detailler(ligne) : ligne
  })

  routes.post(`/api/${chemin}`, async (ctx) => {
    ctx.exigerAdmin()
    const donnees = await ctx.json()
    const id = enregistrerSansDoublon(table, donnees)
    apresEcriture?.(id, donnees)
    noterModification()
    return { id }
  })

  routes.put(`/api/${chemin}/:id`, async (ctx) => {
    ctx.exigerAdmin()
    const donnees = await ctx.json()
    const id = enregistrerSansDoublon(table, donnees, ctx.params.id)
    apresEcriture?.(id, donnees)
    noterModification()
    return { id }
  })

  routes.delete(`/api/${chemin}/:id`, (ctx) => {
    ctx.exigerAdmin()
    table.supprimer(ctx.params.id)
    apresSuppression?.(Number(ctx.params.id))
    noterModification()
    return { ok: true }
  })
}

function enregistrerSansDoublon(table, donnees, id) {
  try {
    return table.enregistrer(donnees, id)
  } catch (erreur) {
    if (/UNIQUE constraint/.test(erreur.message)) throw new ErreurHttp(409, 'Ce code existe déjà.')
    throw erreur
  }
}

// ---------------------------------------------------------------- conversions

export function convertir(valeur, type) {
  if (valeur === undefined || valeur === null) return type === 'texte' ? '' : null
  if (type === 'nombre') return lireNombre(valeur)
  if (type === 'date') return lireDate(valeur)
  return String(valeur).trim()
}

// « 1 234,50 », « 1234.5 », « 12 € » → 1234.5
export function lireNombre(valeur) {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null
  const texte = String(valeur).replace(/[\s €]/g, '').replace(',', '.')
  if (texte === '') return null
  const nombre = Number(texte)
  return Number.isFinite(nombre) ? nombre : null
}

// Accepte AAAA-MM-JJ, JJ/MM/AAAA, JJ/MM/AA et les dates Excel (nombre de jours depuis 1900).
// Renvoie AAAA-MM-JJ, ou '' si la date est illisible.
export function lireDate(valeur) {
  if (valeur === '' || valeur === null || valeur === undefined) return ''
  if (typeof valeur === 'number' || /^\d{5}(\.\d+)?$/.test(String(valeur))) {
    const jours = Number(valeur)
    if (jours > 20000 && jours < 80000) {
      return new Date(Date.UTC(1899, 11, 30) + Math.floor(jours) * 86_400_000).toISOString().slice(0, 10)
    }
  }
  const texte = String(valeur).trim()
  let m = texte.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = texte.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (m) {
    const annee = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${annee}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return ''
}
