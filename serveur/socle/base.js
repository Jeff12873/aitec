// La base de données : le contenu d'un fichier .datassitec.
//
// Un fichier .datassitec est une base SQLite ordinaire (lisible avec n'importe quel outil SQLite).
// Description complète des tables : docs/DONNEES.md.
//
// IASSITEC ne travaille jamais directement sur le fichier du lecteur réseau, mais sur sa copie
// locale (voir partage.js). Ici, on ne s'occupe que d'ouvrir cette copie et de la lire / l'écrire.

import { DatabaseSync } from 'node:sqlite'

export const FORMAT = 1 // à augmenter si la structure change (et ajouter la migration dans migrer())

let connexion = null

export function ouvrirBase(chemin, { lectureSeule }) {
  fermerBase()
  connexion = new DatabaseSync(chemin, { readOnly: lectureSeule })
  connexion.exec('PRAGMA foreign_keys = ON')
  if (!lectureSeule) {
    // Mode « DELETE » : la base tient toujours en un seul fichier, qu'on peut copier sans risque.
    connexion.exec('PRAGMA journal_mode = DELETE')
    migrer(connexion)
  }
  return connexion
}

export function fermerBase() {
  connexion?.close()
  connexion = null
}

export function baseOuverte() {
  return connexion !== null
}

// La base ouverte. Lance une erreur claire si aucun fichier n'est ouvert.
export function db() {
  if (!connexion) throw Object.assign(new Error('Aucun fichier .datassitec ouvert'), { statut: 409 })
  return connexion
}

// Exécute plusieurs écritures d'un coup : tout ou rien.
// Une transaction peut en contenir une autre (on utilise alors un « point de sauvegarde » SQLite).
let profondeur = 0

export function transaction(travail) {
  const base = db()
  const point = `point${profondeur}`
  base.exec(profondeur === 0 ? 'BEGIN' : `SAVEPOINT ${point}`)
  profondeur++
  try {
    const resultat = travail(base)
    profondeur--
    base.exec(profondeur === 0 ? 'COMMIT' : `RELEASE ${point}`)
    return resultat
  } catch (erreur) {
    profondeur--
    base.exec(profondeur === 0 ? 'ROLLBACK' : `ROLLBACK TO ${point}; RELEASE ${point}`)
    throw erreur
  }
}

// ---------------------------------------------------------------- réglages communs

export function reglage(cle, defaut = null) {
  const ligne = db().prepare('SELECT valeur FROM reglages WHERE cle = ?').get(cle)
  return ligne ? ligne.valeur : defaut
}

export function reglageJson(cle, defaut = null) {
  const valeur = reglage(cle)
  return valeur ? JSON.parse(valeur) : defaut
}

export function modifierReglage(cle, valeur) {
  if (valeur !== null && typeof valeur === 'object' && !(valeur instanceof Uint8Array)) valeur = JSON.stringify(valeur)
  db().prepare('INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur').run(cle, valeur)
}

// ---------------------------------------------------------------- structure

function migrer(base) {
  base.exec(STRUCTURE)
  const format = Number(base.prepare("SELECT valeur FROM reglages WHERE cle = 'format'").get()?.valeur || 0)
  if (format > FORMAT) {
    throw new Error('Ce fichier a été créé par une version plus récente d’IASSITEC : mettez IASSITEC à jour.')
  }
  // Les futures migrations iront ici : if (format < 2) { … }
  base.prepare("INSERT OR REPLACE INTO reglages (cle, valeur) VALUES ('format', ?)").run(String(FORMAT))
}

const STRUCTURE = `
CREATE TABLE IF NOT EXISTS reglages (
  cle    TEXT PRIMARY KEY,
  valeur
);

CREATE TABLE IF NOT EXISTS machines (
  id              INTEGER PRIMARY KEY,
  repere          TEXT NOT NULL UNIQUE,      -- code de la machine (celui de la GMAO)
  designation     TEXT NOT NULL DEFAULT '',
  famille         TEXT NOT NULL DEFAULT '',
  marque          TEXT NOT NULL DEFAULT '',
  modele          TEXT NOT NULL DEFAULT '',
  numero_serie    TEXT NOT NULL DEFAULT '',
  emplacement     TEXT NOT NULL DEFAULT '',
  mise_en_service TEXT NOT NULL DEFAULT '',  -- date AAAA-MM-JJ
  etat            TEXT NOT NULL DEFAULT 'En service',
  notes           TEXT NOT NULL DEFAULT '',
  modifie_le      TEXT
);

CREATE TABLE IF NOT EXISTS pieces (
  id           INTEGER PRIMARY KEY,
  reference    TEXT NOT NULL UNIQUE,
  designation  TEXT NOT NULL DEFAULT '',
  fabricant    TEXT NOT NULL DEFAULT '',
  fournisseur  TEXT NOT NULL DEFAULT '',
  stock        REAL NOT NULL DEFAULT 0,
  seuil        REAL NOT NULL DEFAULT 0,      -- en dessous : à commander
  unite        TEXT NOT NULL DEFAULT 'pce',
  emplacement  TEXT NOT NULL DEFAULT '',
  prix         REAL,
  notes        TEXT NOT NULL DEFAULT '',
  modifie_le   TEXT
);

-- Quelles pièces vont sur quelles machines
CREATE TABLE IF NOT EXISTS pieces_machines (
  piece_id    INTEGER NOT NULL REFERENCES pieces (id) ON DELETE CASCADE,
  machine_id  INTEGER NOT NULL REFERENCES machines (id) ON DELETE CASCADE,
  PRIMARY KEY (piece_id, machine_id)
);

CREATE TABLE IF NOT EXISTS interventions (
  id           INTEGER PRIMARY KEY,
  numero       TEXT UNIQUE,                  -- numéro de l'ordre de travail dans la GMAO (facultatif)
  date         TEXT NOT NULL DEFAULT '',     -- AAAA-MM-JJ
  machine_id   INTEGER REFERENCES machines (id) ON DELETE SET NULL,
  type         TEXT NOT NULL DEFAULT 'Correctif',
  description  TEXT NOT NULL DEFAULT '',
  cause        TEXT NOT NULL DEFAULT '',
  intervenant  TEXT NOT NULL DEFAULT '',
  duree_h      REAL,
  statut       TEXT NOT NULL DEFAULT 'Terminée',
  modifie_le   TEXT
);
CREATE INDEX IF NOT EXISTS interventions_machine ON interventions (machine_id);
CREATE INDEX IF NOT EXISTS interventions_date ON interventions (date);

CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY,
  nom         TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT '',      -- type MIME
  taille      INTEGER NOT NULL DEFAULT 0,
  contenu     BLOB,
  empreinte   TEXT,                          -- SHA-256, pour repérer les doublons
  machine_id  INTEGER REFERENCES machines (id) ON DELETE SET NULL,
  etat        TEXT NOT NULL DEFAULT 'a-lire', -- a-lire | lu | piece-jointe | erreur
  message     TEXT NOT NULL DEFAULT '',
  pages       INTEGER,
  ajoute_le   TEXT,
  ajoute_par  TEXT NOT NULL DEFAULT ''
);

-- Tout ce que l'IA peut retrouver : morceaux de documents et fiches (machines, pièces, interventions).
CREATE TABLE IF NOT EXISTS passages (
  id          INTEGER PRIMARY KEY,
  source      TEXT NOT NULL,                 -- document | machine | piece | intervention
  source_id   INTEGER NOT NULL,
  machine_id  INTEGER,                       -- machine concernée (pour filtrer les recherches)
  page        INTEGER,
  texte       TEXT NOT NULL,
  vecteur     BLOB                           -- pour la recherche par le sens (vide = pas encore calculé)
);
CREATE INDEX IF NOT EXISTS passages_source ON passages (source, source_id);
CREATE INDEX IF NOT EXISTS passages_sans_vecteur ON passages (id) WHERE vecteur IS NULL;

-- Recherche par mots-clés, sans tenir compte des accents
CREATE VIRTUAL TABLE IF NOT EXISTS passages_mots USING fts5 (
  texte, content = 'passages', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS passages_ajout AFTER INSERT ON passages BEGIN
  INSERT INTO passages_mots (rowid, texte) VALUES (new.id, new.texte);
END;
CREATE TRIGGER IF NOT EXISTS passages_suppression AFTER DELETE ON passages BEGIN
  INSERT INTO passages_mots (passages_mots, rowid, texte) VALUES ('delete', old.id, old.texte);
END;
CREATE TRIGGER IF NOT EXISTS passages_modification AFTER UPDATE OF texte ON passages BEGIN
  INSERT INTO passages_mots (passages_mots, rowid, texte) VALUES ('delete', old.id, old.texte);
  INSERT INTO passages_mots (rowid, texte) VALUES (new.id, new.texte);
END;
`
