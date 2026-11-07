// L'import d'un classeur de fiches de contrôle dans la maintenance de niveau 1.

import { h, ic, essayer, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { FREQUENCES } from './fiches-mn1.js'

// Import d'un classeur de fiches de contrôle (une ligne par point à vérifier : ligne, ETH, machine, zone, action,
// étiquette) : les fiches sont créées, ou mises à jour si l'étiquette a déjà été importée.
export function boutonImport() {
  const frequence = h('select', { class: 'fin' }, FREQUENCES.filter((f) => f !== 'Quotidienne').map((f) => h('option', { value: f, selected: f === 'Mensuelle' }, f)))
  const choix = h('input', { type: 'file', accept: '.xlsx,.xls,.ods,.csv', style: { display: 'none' } })
  choix.onchange = async () => {
    const fichier = choix.files[0]
    if (!fichier) return
    const r = await essayer(() => api(`/api/mn1/import?frequence=${encodeURIComponent(frequence.value)}`, { methode: 'POST', fichier, entetes: { 'X-Nom': encodeURIComponent(fichier.name) } }))
    if (r) {
      notifier(`${r.total} fiches lues : ${r.creees} nouvelles, ${r.modifiees} mises à jour`)
      window.ktec.recharger()
    }
  }
  return h('div', { class: 'barre-import-mn1' },
    h('button', { onclick: () => choix.click() }, ic('telecharger', 16), 'Importer un classeur de fiches'),
    h('label', { class: 'discret' }, 'fréquence des fiches importées ', frequence),
    choix)
}
