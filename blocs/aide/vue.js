// L'aide intégrée. Chaque page est un simple fichier HTML dans interface/aide/,
// modifiable avec n'importe quel éditeur de texte. Le sommaire est la liste PAGES ci-dessous.

import { h, vider } from '/socle/ui.js'

const PAGES = [
  ['premiers-pas', 'Premiers pas'],
  ['assistant', 'Poser une question à l’IA'],
  ['tableau-de-bord', 'Tableau de bord'],
  ['maintenance-niveau-1', 'Maintenance de niveau 1'],
  ['documents', 'Documents et formats lus'],
  ['import-gmao', 'Importer un export GMAO'],
  ['administration', 'Mode administrateur'],
  ['fichier-partage', 'Le fichier partagé'],
  ['sauvegardes', 'Sauvegardes'],
  ['installation', 'Installation sur un poste'],
  ['erreurs-ia', 'L’IA s’est trompée'],
  ['depannage', 'Dépannage'],
]

export default {
  chemin: 'aide',
  titre: 'Aide',
  icone: 'aide',
  menu: false,
  aide: 'premiers-pas',

  async afficher(zone, { id }) {
    const page = PAGES.find(([cle]) => cle === id)?.[0] || 'premiers-pas'
    const texte = h('article', { class: 'aide-texte carte' })
    vider(
      zone,
      h(
        'div',
        { class: 'aide-page' },
        h('nav', { class: 'aide-sommaire carte', style: { padding: '10px' } }, PAGES.map(([cle, titre]) => h('a', { href: `#/aide/${cle}`, class: cle === page ? 'actif' : '' }, titre))),
        texte,
      ),
    )
    const reponse = await fetch(new URL(`../../interface/aide/${page}.html`, import.meta.url))
    texte.innerHTML = reponse.ok ? await reponse.text() : '<p>Page d’aide introuvable.</p>'
    window.scrollTo(0, 0)
  },
}
