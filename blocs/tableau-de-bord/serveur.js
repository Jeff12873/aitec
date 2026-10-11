// Le tableau de bord : chiffres clés, graphiques et remarques de l'IA.

import { db, reglage } from '../../serveur/socle/base.js'
import { etatPartage } from '../../serveur/socle/partage.js'
import { discuter, iaInstallee } from '../../serveur/socle/ia.js'

export function routes(r) {
  r.get('/api/tableau-de-bord', () => ({
    tuiles: tuiles(),
    parMois: interventionsParMois(),
    parType: db()
      .prepare("SELECT type, count(*) AS nombre FROM interventions WHERE date >= date('now', '-12 months') GROUP BY type ORDER BY nombre DESC")
      .all(),
    machinesEnPanne: machinesLesPlusEnPanne(6),
    piecesACommander: db()
      .prepare('SELECT id, reference, designation, stock, seuil, unite FROM pieces WHERE seuil > 0 AND stock <= seuil ORDER BY (stock - seuil), reference LIMIT 8')
      .all(),
    dernieresInterventions: db()
      .prepare('SELECT i.id, i.date, i.type, i.description, m.repere FROM interventions i LEFT JOIN machines m ON m.id = i.machine_id ORDER BY i.date DESC, i.id DESC LIMIT 6')
      .all(),
    remarques: remarquesEnMemoire.version === etatPartage().version ? remarquesEnMemoire : null,
  }))

  // « Ce que l'IA remarque » : l'IA lit les chiffres et écrit quelques constats.
  // Rien n'est enregistré dans le fichier : chaque poste garde ses remarques en mémoire.
  r.post('/api/tableau-de-bord/remarques', async () => {
    if (!iaInstallee()) return { texte: "L'IA n'est pas installée sur ce poste.", date: new Date().toISOString() }
    const donnees = {
      chiffres: tuiles(),
      interventionsParMois: interventionsParMois(),
      machinesLesPlusEnPanne12Mois: machinesLesPlusEnPanne(10),
      machinesEnHausse: machinesEnHausse(),
      piecesACommander: db().prepare('SELECT reference, designation, stock, seuil FROM pieces WHERE seuil > 0 AND stock <= seuil LIMIT 20').all(),
      machinesSansDocument: db().prepare('SELECT repere, designation FROM machines WHERE id NOT IN (SELECT machine_id FROM documents WHERE machine_id IS NOT NULL) LIMIT 20').all(),
    }
    const texte = await discuter(
      [
        {
          role: 'system',
          content: `Tu es l'assistant d'un responsable de maintenance. À partir des données JSON fournies, écris 3 à 5 constats utiles, en français, sous forme de liste à puces courtes (une phrase chacune, avec les chiffres et les repères de machines).
Mets en avant ce qui demande une action : machines dont les pannes augmentent, pièces à commander, machines sans documentation, déséquilibre préventif/correctif. N'invente rien qui ne soit pas dans les données. Si les données sont presque vides, dis simplement ce qu'il faudrait importer.`,
        },
        { role: 'user', content: JSON.stringify(donnees) },
      ],
      { temperature: 0.2, maxMots: 600 },
    )
    remarquesEnMemoire = { texte, date: new Date().toISOString(), version: etatPartage().version }
    return remarquesEnMemoire
  })
}

let remarquesEnMemoire = { version: -1 }

function tuiles() {
  const compter = (sql) => db().prepare(sql).get().n
  return {
    machines: compter('SELECT count(*) AS n FROM machines'),
    machinesHorsService: compter("SELECT count(*) AS n FROM machines WHERE etat <> '' AND etat NOT LIKE 'En service%'"),
    pieces: compter('SELECT count(*) AS n FROM pieces'),
    piecesACommander: compter('SELECT count(*) AS n FROM pieces WHERE seuil > 0 AND stock <= seuil'),
    interventions30j: compter("SELECT count(*) AS n FROM interventions WHERE date >= date('now', '-30 days')"),
    interventions30jAvant: compter("SELECT count(*) AS n FROM interventions WHERE date >= date('now', '-60 days') AND date < date('now', '-30 days')"),
    interventions: compter('SELECT count(*) AS n FROM interventions'),
    documents: compter('SELECT count(*) AS n FROM documents'),
    documentsLus: compter("SELECT count(*) AS n FROM documents WHERE etat = 'lu'"),
  }
}

// Les 12 derniers mois, même ceux sans intervention.
function interventionsParMois() {
  const lignes = db()
    .prepare(
      `SELECT substr(date, 1, 7) AS mois,
              sum(type = 'Correctif') AS correctif, sum(type = 'Préventif') AS preventif,
              sum(type NOT IN ('Correctif', 'Préventif')) AS autre
       FROM interventions WHERE date >= date('now', 'start of month', '-11 months') GROUP BY mois`,
    )
    .all()
  const mois = []
  const aujourdhui = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - i, 1)
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const ligne = lignes.find((l) => l.mois === cle)
    mois.push({ mois: cle, correctif: ligne?.correctif || 0, preventif: ligne?.preventif || 0, autre: ligne?.autre || 0 })
  }
  return mois
}

function machinesLesPlusEnPanne(nombre) {
  return db()
    .prepare(
      `SELECT m.id, m.repere, m.designation, count(*) AS pannes
       FROM interventions i JOIN machines m ON m.id = i.machine_id
       WHERE i.type = 'Correctif' AND i.date >= date('now', '-12 months')
       GROUP BY m.id ORDER BY pannes DESC LIMIT ?`,
    )
    .all(nombre)
}

// Machines dont les pannes des 3 derniers mois dépassent leur moyenne des 9 mois d'avant.
function machinesEnHausse() {
  return db()
    .prepare(
      `SELECT m.repere, m.designation,
              sum(i.date >= date('now', '-3 months')) AS pannes_3_derniers_mois,
              round(sum(i.date < date('now', '-3 months')) / 3.0, 1) AS moyenne_par_trimestre_avant
       FROM interventions i JOIN machines m ON m.id = i.machine_id
       WHERE i.type = 'Correctif' AND i.date >= date('now', '-12 months')
       GROUP BY m.id HAVING pannes_3_derniers_mois > moyenne_par_trimestre_avant AND pannes_3_derniers_mois >= 2
       ORDER BY pannes_3_derniers_mois DESC LIMIT 10`,
    )
    .all()
}

// Résumé en une phrase, donné à l'assistant pour qu'il réponde aux questions de chiffres simples.
export function resumeChiffres() {
  const t = tuiles()
  const nom = reglage('nom_atelier', 'Atelier')
  return `Atelier « ${nom} » : ${t.machines} machines (${t.machinesHorsService} hors service), ${t.pieces} pièces de rechange dont ${t.piecesACommander} sous le seuil de commande, ${t.interventions} interventions enregistrées dont ${t.interventions30j} ces 30 derniers jours, ${t.documents} documents.`
}
