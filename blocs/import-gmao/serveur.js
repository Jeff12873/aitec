// Import des exports de GMAO (CSV, Excel, LibreOffice) vers les machines ou les interventions.
//
// Déroulé :
//   1. POST /api/import/lire     → le fichier est lu, on renvoie ses colonnes, un aperçu et une correspondance proposée
//   2. l'administrateur vérifie la correspondance « colonne du fichier → champ d'IASSITEC »
//   3. POST /api/import/valider  → les lignes sont créées ou mises à jour
// La correspondance validée est retenue : le prochain export du même logiciel sera reconnu tout seul.

import { db, transaction, reglageJson, modifierReglage } from '../../serveur/socle/base.js'
import { noterModification } from '../../serveur/socle/partage.js'
import { ErreurHttp } from '../../serveur/socle/http.js'
import { nouveauJeton } from '../../serveur/socle/securite.js'
import { lireTableur } from '../../serveur/socle/tableurs.js'
import { convertir, lireDate } from '../../serveur/socle/tables.js'
import { machines, indexerMachine } from '../parc/serveur.js'
import { interventions, indexerIntervention } from '../interventions/serveur.js'

// Les champs qu'on peut remplir, et les noms de colonnes qu'on reconnaît automatiquement
// (en minuscules, sans accents). Ajoutez ici les intitulés de votre GMAO.
export const CIBLES = {
  machines: {
    libelle: 'Machines (parc)',
    champs: [
      { nom: 'repere', libelle: 'Repère (code machine)', obligatoire: true, synonymes: ['repere', 'code machine', 'code equipement', 'equipement', 'code materiel', 'n equipement', 'numero equipement', 'code', 'asset', 'tag', 'machine'] },
      { nom: 'designation', libelle: 'Désignation', obligatoire: true, synonymes: ['designation', 'libelle', 'libelle equipement', 'description', 'denomination', 'intitule', 'nom'] },
      { nom: 'famille', libelle: 'Famille', synonymes: ['famille', 'categorie', 'type equipement', 'classe', 'type'] },
      { nom: 'marque', libelle: 'Marque', synonymes: ['marque', 'fabricant', 'constructeur'] },
      { nom: 'modele', libelle: 'Modèle', synonymes: ['modele', 'type constructeur', 'reference constructeur'] },
      { nom: 'numero_serie', libelle: 'N° de série', synonymes: ['numero de serie', 'n serie', 'no serie', 'serie', 'serial number', 'sn'] },
      { nom: 'emplacement', libelle: 'Emplacement', synonymes: ['emplacement', 'localisation', 'lieu', 'atelier', 'secteur', 'zone', 'batiment', 'site', 'ligne'] },
      { nom: 'mise_en_service', libelle: 'Mise en service', type: 'date', synonymes: ['mise en service', 'date mise en service', 'date mes', 'date installation', 'annee'] },
      { nom: 'etat', libelle: 'État', synonymes: ['etat', 'statut', 'status'] },
      { nom: 'notes', libelle: 'Notes', synonymes: ['notes', 'commentaire', 'commentaires', 'observations', 'remarques'] },
    ],
  },
  interventions: {
    libelle: 'Interventions (historique)',
    champs: [
      { nom: 'numero', libelle: 'N° (ordre de travail)', synonymes: ['numero', 'n ot', 'ot', 'numero ot', 'n bt', 'bon de travail', 'n intervention', 'work order', 'n', 'id'] },
      { nom: 'date', libelle: 'Date', type: 'date', obligatoire: true, synonymes: ['date', 'date intervention', 'date debut', 'date realisation', 'date ot', 'date de debut', 'date demande', 'debut'] },
      { nom: 'machine', libelle: 'Machine (repère)', synonymes: ['machine', 'repere', 'code machine', 'equipement', 'code equipement', 'materiel'] },
      { nom: 'type', libelle: 'Type', synonymes: ['type', 'type intervention', 'nature', 'type ot', 'categorie'] },
      { nom: 'description', libelle: 'Description', obligatoire: true, synonymes: ['description', 'travaux', 'travaux effectues', 'libelle', 'objet', 'compte rendu', 'commentaire', 'intitule'] },
      { nom: 'cause', libelle: 'Cause / symptôme', synonymes: ['cause', 'origine', 'defaut', 'panne', 'symptome', 'cause panne'] },
      { nom: 'intervenant', libelle: 'Intervenant', synonymes: ['intervenant', 'technicien', 'agent', 'realise par', 'intervenants', 'responsable'] },
      { nom: 'duree_h', libelle: 'Durée (heures)', type: 'nombre', synonymes: ['duree', 'duree h', 'temps passe', 'temps', 'heures', 'nb heures'] },
      { nom: 'statut', libelle: 'Statut', synonymes: ['statut', 'etat', 'status'] },
    ],
  },
}

// Fichiers lus en attente de validation (gardés 1 heure en mémoire).
const enAttente = new Map()

export function routes(r) {
  r.get('/api/import/cibles', () =>
    Object.fromEntries(Object.entries(CIBLES).map(([cle, c]) => [cle, { libelle: c.libelle, champs: c.champs.map(({ nom, libelle, obligatoire }) => ({ nom, libelle, obligatoire: Boolean(obligatoire) })) }])),
  )

  r.post('/api/import/lire', async (ctx) => {
    ctx.exigerAdmin()
    const nom = decodeURIComponent(ctx.req.headers['x-nom'] || 'export.csv')
    let feuilles
    try {
      feuilles = lireTableur(nom, await ctx.octets()).filter((f) => f.lignes.length > 1)
    } catch (erreur) {
      throw new ErreurHttp(400, erreur.message)
    }
    if (!feuilles.length) throw new ErreurHttp(400, 'Aucune donnée trouvée dans ce fichier.')

    const jeton = nouveauJeton()
    enAttente.set(jeton, { nom, feuilles, depuis: Date.now() })
    for (const [cle, valeur] of enAttente) if (Date.now() - valeur.depuis > 3_600_000) enAttente.delete(cle)

    return {
      jeton,
      feuilles: feuilles.map((f) => {
        const colonnes = f.lignes[0].map((c, i) => c || `Colonne ${i + 1}`)
        const cible = devinerCible(colonnes)
        return {
          nom: f.feuille,
          colonnes,
          apercu: f.lignes.slice(1, 9),
          total: f.lignes.length - 1,
          cible,
          // une correspondance proposée pour chaque cible possible
          correspondances: Object.fromEntries(Object.keys(CIBLES).map((c) => [c, correspondanceRetenue(c, colonnes) || devinerCorrespondance(c, colonnes)])),
        }
      }),
    }
  })

  // { jeton, feuille (numéro), cible, correspondances: { champ: numéro de colonne }, mettreAJour }
  r.post('/api/import/valider', async (ctx) => {
    ctx.exigerAdmin()
    const { jeton, feuille = 0, cible, correspondances, mettreAJour = true } = await ctx.json()
    const fichier = enAttente.get(jeton)
    if (!fichier) throw new ErreurHttp(410, 'Le fichier a expiré : choisissez-le à nouveau.')
    if (!CIBLES[cible]) throw new ErreurHttp(400, 'Destination inconnue')
    for (const champ of CIBLES[cible].champs) {
      if (champ.obligatoire && (correspondances[champ.nom] === undefined || correspondances[champ.nom] === null || correspondances[champ.nom] === '')) {
        throw new ErreurHttp(400, `Indiquez la colonne qui correspond à « ${champ.libelle} ».`)
      }
    }

    const [entete, ...lignes] = fichier.feuilles[feuille].lignes
    const bilan = importer(cible, lignes, correspondances, mettreAJour)
    retenirCorrespondance(cible, entete, correspondances)
    enAttente.delete(jeton)
    noterModification()
    return bilan
  })
}

// ---------------------------------------------------------------- import

function importer(cible, lignes, correspondances, mettreAJour) {
  const bilan = { crees: 0, modifies: 0, ignores: 0, machinesCreees: 0, erreurs: [] }
  const aIndexer = { machine: new Set(), intervention: new Set() }

  transaction(() => {
    lignes.forEach((ligne, numero) => {
      const valeurs = {}
      for (const [champ, colonne] of Object.entries(correspondances)) {
        if (colonne === null || colonne === '' || colonne === undefined) continue
        valeurs[champ] = ligne[Number(colonne)] ?? ''
      }
      try {
        // Chaque ligne est importée entièrement ou pas du tout.
        transaction(() => {
          if (cible === 'machines') importerMachine(valeurs, mettreAJour, bilan, aIndexer)
          if (cible === 'interventions') importerIntervention(valeurs, mettreAJour, bilan, aIndexer)
        })
      } catch (erreur) {
        bilan.ignores++
        if (bilan.erreurs.length < 20) bilan.erreurs.push(`Ligne ${numero + 2} : ${erreur.message}`)
      }
    })
  })

  // Mise à jour de l'index de recherche (les vecteurs seront calculés ensuite, en arrière-plan).
  transaction(() => {
    for (const id of aIndexer.machine) indexerMachine(id)
    for (const id of aIndexer.intervention) indexerIntervention(id)
  })
  return bilan
}

function enregistrerAvecCle(table, cle, valeurs, mettreAJour, bilan) {
  const existant = table.lireParCle(valeurs[cle])
  if (existant && !mettreAJour) {
    bilan.ignores++
    return null
  }
  const id = table.enregistrer(valeurs, existant?.id)
  existant ? bilan.modifies++ : bilan.crees++
  return id
}

function importerMachine(valeurs, mettreAJour, bilan, aIndexer) {
  if (!valeurs.repere) throw new Error('repère vide')
  if (!valeurs.designation) valeurs.designation = valeurs.repere
  const id = enregistrerAvecCle(machines, 'repere', valeurs, mettreAJour, bilan)
  if (id) aIndexer.machine.add(id)
}

function importerIntervention(valeurs, mettreAJour, bilan, aIndexer) {
  valeurs.date = lireDate(valeurs.date)
  if (!valeurs.date) throw new Error('date illisible')
  if (!valeurs.description) throw new Error('description vide')
  valeurs.machine_id = valeurs.machine ? trouverOuCreerMachine(String(valeurs.machine).trim(), bilan, aIndexer) : null
  valeurs.type = normaliserType(valeurs.type)
  if (!valeurs.numero) delete valeurs.numero

  let id
  if (valeurs.numero) {
    id = enregistrerAvecCle(interventions, 'numero', valeurs, mettreAJour, bilan)
  } else {
    // Sans numéro, on évite les doublons en comparant date + machine + description.
    const doublon = db()
      .prepare('SELECT id FROM interventions WHERE date = ? AND machine_id IS ? AND description = ?')
      .get(valeurs.date, valeurs.machine_id, convertir(valeurs.description, 'texte'))
    if (doublon) {
      bilan.ignores++
      return
    }
    id = interventions.enregistrer(valeurs)
    bilan.crees++
  }
  if (id) aIndexer.intervention.add(id)
}

function trouverOuCreerMachine(repere, bilan, aIndexer) {
  const existante = machines.lireParCle(repere)
  if (existante) return existante.id
  const id = machines.enregistrer({ repere, designation: repere })
  bilan.machinesCreees++
  aIndexer.machine.add(id)
  return id
}

// « CUR », « Curatif », « panne » → Correctif ; « PREV », « Systématique » → Préventif…
function normaliserType(type) {
  const t = normaliser(type || '')
  if (!t) return 'Correctif'
  if (/^(cur|corr|depan|panne|bris|urgen)/.test(t)) return 'Correctif'
  if (/^(prev|syst|cond|entretien|graiss|lubri)/.test(t)) return 'Préventif'
  if (/^(amel|modif|travaux neufs)/.test(t)) return 'Amélioration'
  if (/^(regl)/.test(t)) return 'Réglage'
  if (/^(control|verif|vgp|reglem|inspect)/.test(t)) return 'Contrôle réglementaire'
  return String(type).trim()
}

// ---------------------------------------------------------------- correspondance des colonnes

export function normaliser(texte) {
  return String(texte)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[°º]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function devinerCorrespondance(cible, colonnes) {
  const normalisees = colonnes.map(normaliser)
  const prises = new Set()
  const resultat = {}
  // 1er passage : noms identiques ; 2e passage : noms qui contiennent le synonyme.
  for (const passage of ['egal', 'contient']) {
    for (const champ of CIBLES[cible].champs) {
      if (resultat[champ.nom] !== undefined) continue
      for (const synonyme of champ.synonymes) {
        const index = normalisees.findIndex((col, i) => !prises.has(i) && (passage === 'egal' ? col === synonyme : synonyme.length > 2 && col.includes(synonyme)))
        if (index >= 0) {
          resultat[champ.nom] = index
          prises.add(index)
          break
        }
      }
    }
  }
  return resultat
}

// La cible dont les champs obligatoires sont le mieux reconnus.
function devinerCible(colonnes) {
  let meilleure = 'machines'
  let meilleurScore = -1
  for (const cible of Object.keys(CIBLES)) {
    const trouves = devinerCorrespondance(cible, colonnes)
    const obligatoires = CIBLES[cible].champs.filter((c) => c.obligatoire)
    const score = obligatoires.filter((c) => trouves[c.nom] !== undefined).length / obligatoires.length + Object.keys(trouves).length / 100
    if (score > meilleurScore) {
      meilleurScore = score
      meilleure = cible
    }
  }
  return meilleure
}

function signature(cible, colonnes) {
  return cible + '|' + colonnes.map(normaliser).join('|')
}

function correspondanceRetenue(cible, colonnes) {
  return reglageJson('imports', {})[signature(cible, colonnes)] || null
}

function retenirCorrespondance(cible, colonnes, correspondances) {
  const imports = reglageJson('imports', {})
  imports[signature(cible, colonnes)] = correspondances
  modifierReglage('imports', imports)
}
