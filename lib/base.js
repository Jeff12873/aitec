// Les données d'AITEC, rangées dans le fichier de connaissances .ktec commun (tables à part, voir STRUCTURE) :
//   reglages        → réglages d'AITEC (nom de l'atelier, glossaire, correspondances d'import, requêtes MySQL…)
//   machines        → le parc (synchronisé avec la base de la GMAO, ou importé d'un export)
//   interventions   → l'historique
//   documents       → les fichiers déposés (notices, schémas, plans…), images_pages : leurs pages dessinées
//   passages        → tout ce que l'IA peut retrouver (morceaux de documents, fiches), avec leur vecteur
//
// Le fichier partagé lui-même (copie locale, verrou, publication) est celui de KTEC : ktec/partage.js.

import { db as dbKtec, transaction, ajouterStructure, noterModification } from 'ktec/partage.js'
import { protegerTexte, lireTexteProtege } from 'ktec/ktec.js'

export { transaction, noterModification }
export const FORMAT = 2 // structure des tables d'AITEC (2 depuis IASSITEC : type de document, images des pages)

export function db() {
  return dbKtec()
}

// Le fichier .ktec est toujours ouvert dans KTEC (il est créé au besoin).
export function baseOuverte() {
  return true
}

// ---------------------------------------------------------------- réglages d'AITEC (table reglages)

export function reglage(cle, defaut = null) {
  const ligne = db().prepare('SELECT valeur FROM reglages WHERE cle = ?').get(cle)
  if (!ligne) return defaut
  // Configuration chiffrée (clé du site) : déchiffrée ici ; sans la bonne clé, la valeur par défaut.
  const valeur = typeof ligne.valeur === 'string' ? lireTexteProtege(ligne.valeur) : ligne.valeur
  return valeur === null ? defaut : valeur
}

export function reglageJson(cle, defaut = null) {
  const valeur = reglage(cle)
  return valeur ? JSON.parse(valeur) : defaut
}

export function modifierReglage(cle, valeur) {
  if (valeur !== null && typeof valeur === 'object' && !(valeur instanceof Uint8Array)) valeur = JSON.stringify(valeur)
  if (typeof valeur === 'string' && valeur) valeur = protegerTexte(valeur, cle)
  db().prepare('INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur').run(cle, valeur)
}

// ---------------------------------------------------------------- structure

ajouterStructure((base) => {
  base.exec(STRUCTURE)
  const format = Number(base.prepare("SELECT valeur FROM reglages WHERE cle = 'format'").get()?.valeur || 0)
  if (format > FORMAT) throw new Error('Ce fichier a été créé par une version plus récente d’AITEC : mettez AITEC à jour.')
  if (format && format < 2) {
    const colonnes = base.prepare('PRAGMA table_info(documents)').all().map((c) => c.name)
    if (!colonnes.includes('genre')) base.exec("ALTER TABLE documents ADD COLUMN genre TEXT NOT NULL DEFAULT 'document'")
  }
  // Colonnes ajoutées aux fiches de niveau 1 après leur création (AITEC 0.5.2).
  const colonnesMN1 = base.prepare('PRAGMA table_info(fiches_mn1)').all().map((c) => c.name)
  for (const [colonne, defaut] of [['etiquette', "''"], ['machine_nom', "''"], ['zone', "''"], ['origine', "'analyse'"], ['fi_gmao', "''"]]) {
    if (!colonnesMN1.includes(colonne)) base.exec(`ALTER TABLE fiches_mn1 ADD COLUMN ${colonne} TEXT NOT NULL DEFAULT ${defaut}`)
  }
  // AITEC 0.6 : le parc de la fiche, l'équipement de production de sa FI, l'origine de sa fréquence, l'archivage.
  for (const [colonne, type] of [['parc', "TEXT NOT NULL DEFAULT ''"], ['noeud', "TEXT NOT NULL DEFAULT ''"], ['machine_prod', 'INTEGER'], ['frequence_source', "TEXT NOT NULL DEFAULT ''"], ['archivee', 'INTEGER NOT NULL DEFAULT 0'], ['archivee_le', 'TEXT']]) {
    if (!colonnesMN1.includes(colonne)) base.exec(`ALTER TABLE fiches_mn1 ADD COLUMN ${colonne} ${type}`)
  }
  // Les futures migrations iront ici : if (format < 3) { … }
  base.prepare("INSERT OR REPLACE INTO reglages (cle, valeur) VALUES ('format', ?)").run(String(FORMAT))
})

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
  ajoute_par  TEXT NOT NULL DEFAULT '',
  genre       TEXT NOT NULL DEFAULT 'document' -- document | schema (électrique, pneumatique…) | plan (mécanique)
);

-- Images de pages de PDF, dessinées par le navigateur : folios de schémas et plans (gardés pour que l'IA
-- les regarde au moment des questions), et pages avec photos. « lu » = déjà analysée par l'IA.
CREATE TABLE IF NOT EXISTS images_pages (
  document_id  INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page         INTEGER NOT NULL,
  partie       TEXT NOT NULL,                -- page (page entière) | gauche | droite (moitiés, pour lire les petits repères)
  image        BLOB NOT NULL,                -- JPEG
  lu           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, page, partie)
);

-- Tout ce que l'IA peut retrouver : morceaux de documents et fiches (machines, pièces, interventions).
-- Pannes connues : les pannes qui reviennent sur une machine, tirées des rapports d'intervention
-- (symptôme, causes et remèdes rédigés par l'IA ; nombre de cas, dates et intervenants comptés dans la base).
CREATE TABLE IF NOT EXISTS pannes (
  id            INTEGER PRIMARY KEY,
  ligne         TEXT NOT NULL DEFAULT '',     -- ligne de l'arborescence (libellé)
  ensemble      TEXT NOT NULL DEFAULT '',     -- sous-ensemble (libellé)
  machine_id    INTEGER REFERENCES machines (id) ON DELETE CASCADE,
  symptome      TEXT NOT NULL DEFAULT '',
  causes        TEXT NOT NULL DEFAULT '[]',   -- JSON : [{ cause, remede, cas }]
  nombre        INTEGER NOT NULL DEFAULT 0,   -- nombre de rapports regroupés
  premiere      TEXT,                         -- AAAA-MM-JJ
  derniere      TEXT,
  intervenants  TEXT NOT NULL DEFAULT '',     -- « NOM, PRÉNOM (n), … », les plus fréquents d'abord
  exemples      TEXT NOT NULL DEFAULT '[]',   -- JSON : ids des interventions regroupées
  validee       INTEGER NOT NULL DEFAULT 0,   -- relue par un administrateur : gardée quand on relance l'analyse
  modifie_le    TEXT
);
CREATE INDEX IF NOT EXISTS pannes_machine ON pannes (machine_id);

-- Fiches de maintenance de niveau 1 (cartes terrain, faites par la production) : une fiche par étiquette
-- (zone d'une machine) avec ses points à vérifier, gardée depuis l'analyse d'une machine ou importée d'un classeur.
CREATE TABLE IF NOT EXISTS fiches_mn1 (
  id          INTEGER PRIMARY KEY,
  machine_id  INTEGER REFERENCES machines (id) ON DELETE CASCADE,  -- vide pour une fiche importée non rattachée
  pour        TEXT NOT NULL DEFAULT 'Production',
  etiquette   TEXT NOT NULL DEFAULT '',             -- code de la carte (A1, B2…)
  machine_nom TEXT NOT NULL DEFAULT '',             -- la machine telle qu'écrite dans le classeur importé
  zone        TEXT NOT NULL DEFAULT '',             -- la zone de la machine
  origine     TEXT NOT NULL DEFAULT 'analyse',      -- analyse | import
  fi_gmao     TEXT NOT NULL DEFAULT '',             -- numéro de la FI créée dans la GMAO pour cette fiche
  action      TEXT NOT NULL DEFAULT '',             -- les points à vérifier, un par ligne
  frequence   TEXT NOT NULL DEFAULT '',             -- Quotidienne, Hebdomadaire, Mensuelle, Trimestrielle, Semestrielle, Annuelle
  evite       TEXT NOT NULL DEFAULT '',
  ligne       TEXT NOT NULL DEFAULT '',             -- place de la machine dans l'arborescence, notée à la création
  eth         TEXT NOT NULL DEFAULT '',
  cree_le     TEXT,
  modifie_le  TEXT
);
CREATE INDEX IF NOT EXISTS fiches_mn1_machine ON fiches_mn1 (machine_id);

-- L'historique des fiches dans les FI de la GMAO : quelle fiche a porté quelle FI, de quand à quand
-- (début : 1re échéance de la FI, ou date du remplacement ; fin : remplacement ou suspension). Sert à l'avant / après.
CREATE TABLE IF NOT EXISTS fiches_mn1_fi (
  id        INTEGER PRIMARY KEY,
  fiche_id  INTEGER NOT NULL REFERENCES fiches_mn1 (id) ON DELETE CASCADE,
  numero    TEXT NOT NULL,                  -- numéro de la FI dans la GMAO
  debut     TEXT NOT NULL,                  -- AAAA-MM-JJ
  fin       TEXT,                           -- vide : en cours
  motif     TEXT NOT NULL DEFAULT ''        -- création, réactivation, remplacement, suspension
);
CREATE INDEX IF NOT EXISTS fiches_mn1_fi_fiche ON fiches_mn1_fi (fiche_id);

-- Les analyses de corrélation d'un parc (Pareto des pannes ↔ fiches et demandes), faites par l'IA.
CREATE TABLE IF NOT EXISTS mn1_analyses (
  parc       TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  signature  TEXT NOT NULL DEFAULT '',      -- l'état des pannes et des fiches analysées : différente = à refaire
  resultat   TEXT NOT NULL DEFAULT '{}'     -- JSON : voir blocs/mn1/correlation.js
);

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
