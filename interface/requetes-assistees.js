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
