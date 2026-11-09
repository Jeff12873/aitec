// L'étiquette d'une vignette (le code de la carte) : ligne-ETH-mois et lettre, par exemple « L2-ROUE-2611A » pour la
// première fiche de cet ETH en novembre 2026. Le numéro est donné une fois pour toutes ; la ligne et l'ETH suivent la
// fiche (réaffectée, elle change de préfixe et ne change de lettre que si la sienne est déjà prise). Les anciennes
// étiquettes à 4 chiffres sont gardées. Le code d'un classeur importé reste dans « code_import ».

import { db, noterModification } from '../../lib/base.js'
import { exigerEcriture } from 'ktec/partage.js'
import { placeDe } from '../analyse/serveur.js'

// « R.L2 (ROUE L2) » → « R.L2 » : le code avant la parenthèse, en capitales, sans espaces.
const code = (v) => String(v || '').split(' (')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9.]+/g, '')
const NUMERO = /(?:^|-)(\d{4}[A-Z]{0,2})$/ // une fiche sans ligne ni ETH n'a que son numéro

// A, B… Z, AA, AB…
const lettre = (i) => (i < 26 ? String.fromCharCode(65 + i) : lettre(Math.floor(i / 26) - 1) + lettre(i % 26))
const moisDe = (date) => { const d = date || new Date().toISOString(); return d.slice(2, 4) + d.slice(5, 7) }

export function etiquette(ligne, eth, numero) {
  return [code(ligne), code(eth), numero].filter(Boolean).join('-')
}

// Rattrape les fiches créées sans ligne ni ETH, d'après la place de leur machine dans l'arborescence : une seule fois,
// car elles sont ensuite complètes. Machine introuvable, ou fichier pris par un autre poste : elles attendent.
export async function completerLigneEtEth() {
  try {
    const manquantes = db().prepare("SELECT id, machine_id FROM fiches_mn1 WHERE machine_id IS NOT NULL AND ligne = '' AND eth = ''").all()
    if (!manquantes.length) return
    const places = (await Promise.all(manquantes.map(async (f) => [f.id, await placeDe(f.machine_id)]))).filter(([, place]) => place)
    if (!places.length) return
    exigerEcriture({ pourTous: true })
    const changer = db().prepare('UPDATE fiches_mn1 SET ligne = ?, eth = ? WHERE id = ?')
    for (const [id, place] of places) changer.run(place.ligne, place.eth, id)
    noterModification()
  } catch {
    // on réessaiera à la prochaine lecture
  }
}

// Remet chaque étiquette au format, sans toucher à celles qui y sont déjà. Appelée avant chaque lecture des
// fiches : simple et sans oubli, quelle que soit la route qui a créé ou déplacé une fiche.
export function recalerEtiquettes() {
  try {
    const fiches = db().prepare('SELECT id, ligne, eth, etiquette, cree_le FROM fiches_mn1 ORDER BY id').all()
    const prises = new Set(fiches.map((f) => f.etiquette))
    const changer = db().prepare('UPDATE fiches_mn1 SET etiquette = ? WHERE id = ?')
    let changees = 0
    for (const f of fiches) {
      const numero = NUMERO.exec(f.etiquette)?.[1]
      let voulue = numero ? etiquette(f.ligne, f.eth, numero) : ''
      if (!numero || (voulue !== f.etiquette && prises.has(voulue) && /[A-Z]$/.test(numero))) {
        const mois = numero ? numero.slice(0, 4) : moisDe(f.cree_le)
        let i = 0
        do voulue = etiquette(f.ligne, f.eth, `${mois}${lettre(i++)}`)
        while (prises.has(voulue))
      }
      if (voulue !== f.etiquette) {
        prises.delete(f.etiquette)
        prises.add(voulue)
        changer.run(voulue, f.id)
        changees++
      }
    }
    if (changees) noterModification()
  } catch {
    // fichier en lecture seule : on garde les étiquettes telles quelles
  }
}
