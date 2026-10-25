// Résultats de la barre de recherche (en haut de l'écran).

import { h, vider, ic } from '/socle/ui.js'
import { api } from '/socle/api.js'

const ICONES = { document: 'document', machine: 'usine', intervention: 'cle', panne: 'historique' }

export default {
  chemin: 'recherche',
  titre: 'Recherche',
  icone: 'loupe',
  menu: false,
  aide: 'assistant',

  async afficher(zone, { query }) {
    const question = query.q || ''
    vider(zone, h('p', { class: 'discret curseur' }, 'Recherche'))
    const resultats = await api('/api/recherche?q=' + encodeURIComponent(question))
    vider(
      zone,
      h(
        'div',
        { class: 'entete-page' },
        h('div', {}, h('h1', {}, `Recherche : « ${question} »`), h('p', { class: 'sous-titre' }, `${resultats.length} passage${resultats.length > 1 ? 's' : ''} trouvé${resultats.length > 1 ? 's' : ''}, du plus pertinent au moins pertinent`)),
        h('a', { class: 'bouton principal', href: '#/assistant', onclick: () => sessionStorage.setItem('aitec-question', question) }, ic('etincelle', 16), 'Poser la question à l’IA'),
      ),
      resultats.length
        ? resultats.map((r) =>
            h(
              'a',
              { class: 'carte', href: r.lien, target: r.lien.startsWith('#') ? null : '_blank', style: { display: 'block', marginBottom: '12px', color: 'inherit', textDecoration: 'none' } },
              h('div', { class: 'actions', style: { marginBottom: '6px' } }, ic(ICONES[r.source], 16), h('b', {}, r.titre)),
              h('div', { class: 'texte-2', style: { whiteSpace: 'pre-wrap', fontSize: '14px', maxHeight: '7.5em', overflow: 'hidden' } }, r.texte),
            ),
          )
        : h('div', { class: 'vide' }, ic('loupe', 32), 'Rien trouvé. Essayez d’autres mots, ou posez la question à l’IA.'),
    )
  },
}
