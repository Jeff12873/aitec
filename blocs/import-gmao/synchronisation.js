// Synchronisation avec la base de la GMAO (connexion MySQL de KTEC) : le parc et les interventions d'AITEC
// sont tenus à jour directement depuis la base, sans export à refaire.
//
// Deux requêtes, rangées dans le fichier .ktec (réglage « requetes_mysql » d'AITEC) : chacune renvoie une ligne
// par machine ou par intervention, avec des colonnes nommées comme les champs d'AITEC :
//   machines      : repere, designation, famille, marque, modele, numero_serie, emplacement, mise_en_service, etat, notes
//   interventions : numero, date, machine (repère), type, description, cause, intervenant, duree_h, statut
// Seules les lignes nouvelles ou changées sont écrites (et réindexées pour la recherche).
// Automatique : tous les quarts d'heure, quand la connexion MySQL est ouverte et que ce poste peut modifier
// le fichier sans mot de passe (ou est en mode administrateur).

import crypto from 'node:crypto'
import { reglageJson, modifierReglage } from '../../lib/base.js'
import { ErreurHttp } from 'ktec/http.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { noterModification, exigerEcriture, etatPartage, motDePasseDefini } from 'ktec/partage.js'
import { journal } from 'ktec/installation.js'
import { CIBLES, importer, normaliser } from './serveur.js'

const PERIODE = 15 * 60_000
const LIGNES_MAX = 2_000_000
let enCours = null // promesse de la synchronisation en cours

// demandes : les demandes d'intervention, lues en direct par le tableau de bord de la maintenance de niveau 1
// (elles ne sont pas recopiées dans le fichier de connaissances).
export const requetes = () => ({ machines: '', interventions: '', demandes: '', ...reglageJson('requetes_mysql', {}) })

export function routes(r) {
  r.get('/api/gmao/synchronisation', (ctx) => ({
    requetes: (ctx.modeAdmin ?? true) ? requetes() : {},
    derniere: reglageJson('synchronisation', null),
    enCours: Boolean(enCours),
    connexion: etatConnexion().ouverte,
  }))

  r.post('/api/gmao/requetes', async (ctx) => {
    ctx.exigerAdmin()
    const { machines = '', interventions = '', demandes = requetes().demandes } = await ctx.json()
    for (const sql of [machines, interventions, demandes]) {
      if (sql.trim() && !/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*(select|with)\b/i.test(sql)) throw new ErreurHttp(400, 'Chaque requête doit être une lecture (SELECT).')
    }
    modifierReglage('requetes_mysql', { machines: machines.trim(), interventions: interventions.trim(), demandes: demandes.trim() })
    noterModification()
    return requetes()
  })

  r.post('/api/gmao/synchroniser', async (ctx) => {
    ctx.exigerAdmin()
    return synchroniser()
  })
}

// Lance la synchronisation (une seule à la fois). Renvoie le bilan par cible.
export function synchroniser() {
  enCours ??= (async () => {
    try {
      const q = requetes()
      if (!q.machines && !q.interventions) throw new ErreurHttp(409, 'Aucune requête réglée : indiquez d’abord comment lire le parc et les interventions dans la base.')
      if (!etatConnexion().ouverte) throw new ErreurHttp(401, 'Connexion à la GMAO indisponible (réglée par l’administrateur).')
      const bilan = { date: new Date().toISOString() }
      const empreintes = reglageJson('synchronisation_empreintes', {})
      const nouvelles = {}
      // Le parc d'abord : les interventions s'y rattachent par le repère.
      for (const cible of ['machines', 'interventions']) {
        if (!q[cible]) continue
        const depart = Date.now()
        const resultat = await executerRequete(sansCommentaires(q[cible]), LIGNES_MAX)
        // Mêmes données que la dernière fois (empreinte) : rien à faire, et surtout pas de prise du verrou
        // (les autres postes verraient « X modifie le fichier » à chaque synchronisation).
        const empreinte = crypto.createHash('sha256').update(q[cible]).update(JSON.stringify(resultat.lignes)).digest('hex')
        if (empreintes[cible] === empreinte) {
          bilan[cible] = { lignes: resultat.lignes.length, crees: 0, modifies: 0, inchanges: resultat.lignes.length, ignores: 0, machinesCreees: 0, erreurs: [], dureeMs: Date.now() - depart, identique: true }
          continue
        }
        exigerEcriture()
        const correspondances = correspondancesParNom(cible, resultat.colonnes.map((c) => c.nom))
        // Une clé en double dans la base (même repère, même n° de RI) : la première ligne seulement, sinon les deux
        // s'écraseraient à chaque synchronisation (et le fichier serait republié pour rien).
        const colonneCle = correspondances[cible === 'machines' ? 'repere' : 'numero']
        const vues = new Set()
        const lignes = colonneCle === undefined ? resultat.lignes : resultat.lignes.filter((l) => {
          const cle = String(l[colonneCle] ?? '').trim().toLowerCase()
          if (!cle) return true
          if (vues.has(cle)) return false
          vues.add(cle)
          return true
        })
        const b = importer(cible, lignes, correspondances, true)
        nouvelles[cible] = empreinte
        bilan[cible] = { lignes: lignes.length, doublons: resultat.lignes.length - lignes.length, crees: b.crees, modifies: b.modifies, inchanges: b.inchanges, ignores: b.ignores, machinesCreees: b.machinesCreees, erreurs: b.erreurs.slice(0, 5), dureeMs: Date.now() - depart }
      }
      const change = ['machines', 'interventions'].some((c) => bilan[c] && (bilan[c].crees || bilan[c].modifies || bilan[c].machinesCreees))
      // Le bilan n'est enregistré (et le fichier republié) que si quelque chose a changé.
      if (change) {
        modifierReglage('synchronisation', bilan)
        modifierReglage('synchronisation_empreintes', { ...empreintes, ...nouvelles })
        noterModification()
      } else if (Object.keys(nouvelles).length && Object.entries(nouvelles).some(([c, e]) => empreintes[c] !== e)) {
        // Lu, sans changement, mais l'empreinte n'était pas encore retenue : on la retient (une seule fois).
        modifierReglage('synchronisation_empreintes', { ...empreintes, ...nouvelles })
        noterModification()
      }
      journal(`AITEC : synchronisation avec la GMAO ${JSON.stringify(Object.fromEntries(['machines', 'interventions'].filter((c) => bilan[c]).map((c) => [c, { crees: bilan[c].crees, modifies: bilan[c].modifies, inchanges: bilan[c].inchanges }])))}`)
      derniereAuto = Date.now()
      return bilan
    } finally {
      enCours = null
    }
  })()
  return enCours
}

// Les colonnes de la requête nommées comme les champs d'AITEC (« repere », « date »…), sans tenir compte
// de la casse ni des accents.
function correspondancesParNom(cible, colonnes) {
  const normalisees = colonnes.map((c) => normaliser(c).replace(/ /g, '_'))
  const resultat = {}
  for (const champ of CIBLES[cible].champs) {
    const index = normalisees.indexOf(champ.nom)
    if (index >= 0) resultat[champ.nom] = index
  }
  for (const champ of CIBLES[cible].champs) {
    if (champ.obligatoire && resultat[champ.nom] === undefined) throw new ErreurHttp(400, `La requête « ${CIBLES[cible].libelle} » doit avoir une colonne « ${champ.nom} ».`)
  }
  return resultat
}

// La requête sans ses commentaires (-- … et /* … */), qui peuvent contenir des « ; » refusés par le moteur.
function sansCommentaires(sql) {
  let sortie = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'") {
      const fin = sql.indexOf("'", i + 1)
      const j = fin < 0 ? sql.length : fin
      sortie += sql.slice(i, j + 1)
      i = j
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      sortie += '\n'
    } else if (c === '/' && sql[i + 1] === '*') {
      const fin = sql.indexOf('*/', i + 2)
      i = fin < 0 ? sql.length : fin + 1
      sortie += ' '
    } else sortie += c
  }
  return sortie.trim().replace(/;\s*$/, '')
}

// ---------------------------------------------------------------- automatique

let derniereAuto = 0
setInterval(() => {
  if (enCours || Date.now() - derniereAuto < PERIODE) return
  try {
    if (!etatConnexion().ouverte) return
    const p = etatPartage()
    // Sans mot de passe, la main est prise toute seule ; avec, seulement si ce poste est déjà administrateur.
    if (p.autreAdmin || (motDePasseDefini() && !p.admin)) return
    const q = requetes()
    if (!q.machines && !q.interventions) return
  } catch {
    return
  }
  derniereAuto = Date.now()
  synchroniser().catch((e) => journal(`AITEC : synchronisation automatique impossible : ${e.message}`))
}, 60_000).unref()
