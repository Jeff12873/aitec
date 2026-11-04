// Le bouton « Assistant » à côté d'une requête de la GMAO : il ouvre l'assistant de requêtes de KTEC (table de
// départ, une colonne par champ attendu, conditions ; blocs ; SQL en mode expert) et remplit la zone de texte.
// Avec un KTEC d'avant 0.6 (sans assistant), le bouton le dit.

import { h, ic, notifier } from '/socle/ui.js'

export const CHAMPS = {
  machines: [
    { nom: 'repere', libelle: 'Repère', obligatoire: true, aide: 'le code de la machine dans la GMAO (unique)' },
    { nom: 'designation', libelle: 'Désignation', obligatoire: true },
    { nom: 'famille', libelle: 'Famille' },
    { nom: 'marque', libelle: 'Marque' },
    { nom: 'modele', libelle: 'Modèle' },
    { nom: 'numero_serie', libelle: 'Numéro de série' },
    { nom: 'emplacement', libelle: 'Emplacement' },
    { nom: 'mise_en_service', libelle: 'Mise en service', aide: 'une date' },
    { nom: 'etat', libelle: 'État', aide: '« En service »…' },
    { nom: 'notes', libelle: 'Notes' },
  ],
  interventions: [
    { nom: 'numero', libelle: 'Numéro', obligatoire: true, aide: 'le numéro de l’intervention (unique)' },
    { nom: 'date', libelle: 'Date', obligatoire: true },
    { nom: 'machine', libelle: 'Machine', obligatoire: true, aide: 'le repère (code) de la machine' },
    { nom: 'type', libelle: 'Type', obligatoire: true, aide: 'type de maintenance (dépannage, préventif…)' },
    { nom: 'description', libelle: 'Description', obligatoire: true, aide: 'le rapport d’intervention' },
    { nom: 'cause', libelle: 'Cause' },
    { nom: 'intervenant', libelle: 'Intervenant', aide: 'le nom de l’intervenant' },
    { nom: 'duree_h', libelle: 'Durée (h)' },
    { nom: 'statut', libelle: 'Statut' },
  ],
  demandes: [
    { nom: 'numero', libelle: 'Numéro', aide: 'le numéro de la demande' },
    { nom: 'date', libelle: 'Date', obligatoire: true },
    { nom: 'machine', libelle: 'Machine', obligatoire: true, aide: 'le repère (code) de la machine' },
    { nom: 'type', libelle: 'Type de demande', obligatoire: true },
    { nom: 'description', libelle: 'Description' },
    { nom: 'demandeur', libelle: 'Demandeur' },
    { nom: 'etat', libelle: 'État', aide: 'ouverte, close…' },
    { nom: 'arret', libelle: 'Machine à l’arrêt', aide: 'oui / non' },
    { nom: 'fi', libelle: 'FI de la demande', aide: 'le numéro de la FI faite de la demande (facultatif)' },
    { nom: 'fi_actif', libelle: 'État de la FI', aide: 'ACTIF de la FI : 1 vivante, 0 désactivée, 2 archivée (facultatif)' },
    { nom: 'ri', libelle: 'RI de la demande', aide: 'le numéro de la RI qui clôt la demande (facultatif)' },
    { nom: 'date_ri', libelle: 'Date de la RI', aide: 'facultatif' },
  ],
  // Les FI de niveau 1 (issues d'une demande, ou focus) : une ligne par FI et par équipement.
  fiN1: [
    { nom: 'numero', libelle: 'Numéro de la FI', obligatoire: true },
    { nom: 'titre', libelle: 'Titre' },
    { nom: 'date', libelle: 'Date de création', obligatoire: true },
    { nom: 'echeance', libelle: 'Échéance', aide: 'la date de début (ou limite) de la FI' },
    { nom: 'actif', libelle: 'État (ACTIF)', obligatoire: true, aide: '1 vivante, 0 désactivée, 2 archivée' },
    { nom: 'di', libelle: 'DI d’origine', aide: 'le numéro de la demande, vide pour une FI focus' },
    { nom: 'equipement', libelle: 'Équipement', aide: 'l’identifiant du nœud de l’arborescence (une ligne par équipement)' },
    { nom: 'ri', libelle: 'RI', aide: 'le numéro de la RI qui la clôt' },
    { nom: 'date_ri', libelle: 'Date de la RI' },
  ],
  // Les RI de niveau 1 : celles des FI issues d'une demande, et celles des FI focus.
  riN1: [
    { nom: 'numero', libelle: 'Numéro de la RI', obligatoire: true },
    { nom: 'date', libelle: 'Date de la RI', obligatoire: true },
    { nom: 'fi', libelle: 'FI', aide: 'le numéro de la FI' },
    { nom: 'di', libelle: 'DI', aide: 'le numéro de la demande' },
    { nom: 'date_di', libelle: 'Date de la DI' },
    { nom: 'machine', libelle: 'Machine', aide: 'le repère' },
    { nom: 'intervenant', libelle: 'Intervenant' },
    { nom: 'observation', libelle: 'Observation' },
  ],
  // Les RI exécutées par les conducteurs : une ligne par RI et par personne.
  riConducteurs: [
    { nom: 'numero', libelle: 'Numéro de la RI', obligatoire: true },
    { nom: 'date', libelle: 'Date de la RI', obligatoire: true },
    { nom: 'personne', libelle: 'Exécutant', obligatoire: true, aide: 'nom et prénom' },
    { nom: 'profil', libelle: 'Profil', aide: 'rattache la personne à son parc (réglé sur chaque parc)' },
    { nom: 'categorie', libelle: 'Catégorie', obligatoire: true, aide: '« 01.Libellé » : le numéro range les catégories' },
  ],
}

export function boutonAssistant(zone, { titre, champs, consigne = '' }) {
  return h('button', {
    class: 'petit',
    type: 'button',
    title: 'Construire la requête sans écrire de SQL',
    onclick: async () => {
      const module = await import('/socle/requeteur.js').catch(() => null)
      if (!module) return notifier('Mettez KTEC à jour pour avoir l’assistant de requêtes.', 'erreur')
      const sql = await module.ouvrirRequeteur({ titre, champs, sql: zone.value, consigne })
      if (sql !== null) {
        zone.value = sql
        zone.dispatchEvent(new Event('input'))
      }
    },
  }, ic('etincelle', 14), 'Assistant')
}
