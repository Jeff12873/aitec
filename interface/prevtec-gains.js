// PREVTEC : les bonnes nouvelles d'abord. Le préventif retiré ou espacé, les heures rendues, le gain encore possible,
// le registre des décisions et les citations. Uniquement de vrais chiffres : rien à dire, rien d'affiché.

import { h, vider, dateFr, essayer, fenetre, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { modeAdmin } from '/socle/etat.js'

export const CITATIONS = {
  supprimer: { texte: 'Il semble que la perfection soit atteinte non quand il n’y a plus rien à ajouter, mais quand il n’y a plus rien à retrancher.', auteur: 'Antoine de Saint-Exupéry, Terre des hommes' },
  surMaintenance: { texte: 'Rien n’est plus inutile que de faire efficacement ce qui ne devrait pas être fait du tout.', auteur: 'Peter Drucker' },
}
export const citation = ({ texte, auteur }) => h('blockquote', { class: 'citation-prevtec' }, `« ${texte} »`, auteur ? h('cite', {}, auteur) : null)
export const heuresFr = (x) => `${Math.round(x).toLocaleString('fr-FR')} h`
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`

const phraseGains = (g) => {
  const faits = [g.retirees ? `${pluriel(g.retirees, 'visite')} ${g.retirees > 1 ? 'retirées' : 'retirée'}` : '', g.espacees ? `${pluriel(g.espacees, 'visite')} ${g.espacees > 1 ? 'espacées' : 'espacée'}` : ''].filter(Boolean).join(', ')
  return faits ? `${faits}${g.heures ? ` : ${heuresFr(g.heures)} par an rendues à l’équipe` : ''}.` : ''
}

// Toutes les lignes, en tête de l'étape 1.
export function bandeauGainsSite() {
  const zone = h('div')
  api('/api/mn1/gains').then((g) => {
    const texte = phraseGains(g)
    if (texte) vider(zone, h('div', { class: 'bandeau-gains' }, h('b', {}, 'Déjà gagné'), h('span', {}, texte)))
  }).catch(() => {})
  return zone
}

// Une ligne : ce qui va mieux, puis ce qu'on peut encore gagner.
export function bandeauGains(parc, plan) {
  const zone = h('div')
  const dessiner = (g) => {
    const faits = [
      plan?.ecart !== null && plan?.ecart <= -0.05 ? `Les pannes baissent de ${Math.round(-plan.ecart * 100)} % sur 12 mois.` : '',
      phraseGains(g),
      g.verifiees ? `${pluriel(g.verifiees, 'décision')} ${g.verifiees > 1 ? 'vérifiées' : 'vérifiée'} : aucune panne de plus.` : '',
    ].filter(Boolean)
    const possible = g.potentiel.visites ? `${pluriel(g.potentiel.visites, 'visite')} ne ${g.potentiel.visites > 1 ? 'trouvent' : 'trouve'} rien, sur des équipements sans panne${g.potentiel.heures ? ` : ${heuresFr(g.potentiel.heures)} par an à reprendre` : ''}.` : ''
    if (!faits.length && !possible && !g.decisions.length) return vider(zone)
    vider(zone, h('div', { class: 'bandeau-gains' },
      faits.length ? h('div', {}, h('b', {}, 'Bonnes nouvelles'), faits.map((x) => h('span', {}, x))) : null,
      possible ? h('div', {}, h('b', {}, 'Gain possible'), h('span', {}, possible)) : null,
      g.decisions.length ? h('button', { class: 'petit', onclick: () => ouvrirDecisions(parc, g, () => relire()) }, `Les décisions (${g.decisions.length})`) : null,
      g.phrase ? citation({ texte: g.phrase }) : null))
  }
  const relire = () => api(`/api/mn1/parcs/${encodeURIComponent(parc.id)}/gains`).then(dessiner).catch(() => {})
  relire()
  return zone
}

const ACTIONS = { supprimer: 'Retirée', espacer: 'Espacée', deplacer: 'Déplacée', creer: 'Créée' }

function texteBilan(b) {
  if ('attente' in b) return h('span', { class: 'discret' }, `Bilan dans ${b.attente} mois`)
  const bon = b.apres <= b.avant
  return h('span', { class: bon ? 'bilan-bon' : 'bilan-a-revoir' }, `${b.mois} mois : ${pluriel(b.apres, 'panne')} contre ${b.avant} avant${bon ? '' : ', à revoir'}`)
}

function ouvrirDecisions(parc, g, apres) {
  const admin = modeAdmin()
  const reactiver = async (x) => {
    const r = await essayer(() => api(`/api/mn1/decisions/${x.id}/reactiver`, { methode: 'POST', corps: {} }))
    if (!r) return
    if (!r.modifiees) return notifier(`La simulation ne modifierait rien pour ${r.numero} : vérifiez le SQL de réactivation.`, 'erreur')
    const ok = await fenetre({
      titre: `Remettre au plan : FI ${r.numero}`,
      contenu: h('p', {}, h('b', {}, x.titre), ` · simulation : ${pluriel(r.modifiees, 'ligne')} modifiée${r.modifiees > 1 ? 's' : ''} dans la GMAO.`),
      boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Réactiver dans la GMAO', classe: 'principal', action: async () => { await api(`/api/mn1/decisions/${x.id}/reactiver`, { methode: 'POST', corps: { valider: true } }); return true } }],
    })
    if (ok) { notifier('Visite remise au plan'); apres() }
  }
  fenetre({
    titre: `Décisions · ${parc.nom}`,
    large: true,
    contenu: h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {}, ['Date', 'Par', 'Équipement', 'Visite', 'Décision', 'Gain', 'Bilan', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, g.decisions.map((x) => h('tr', { class: x.annulee ? 'decision-annulee' : '' },
        h('td', {}, dateFr(x.le.slice(0, 10))), h('td', {}, x.qui), h('td', { class: 'mono' }, x.equipementRepere), h('td', {}, x.titre),
        h('td', {}, x.annulee ? 'Remise au plan' : `${ACTIONS[x.action]}${x.detail ? ` (${x.detail})` : ''}`),
        h('td', { class: 'nombre' }, x.heures ? `${heuresFr(x.heures)}/an` : '—'),
        h('td', {}, ['supprimer', 'espacer'].includes(x.action) && !x.annulee ? texteBilan(x.bilan) : '—'),
        h('td', {}, admin && x.action === 'supprimer' && !x.annulee ? h('button', { class: 'petit', onclick: () => reactiver(x) }, 'Réactiver') : null)))))),
    boutons: [{ texte: 'Fermer', classe: 'principal', valeur: true }],
  })
}
