// L'étiquette d'une vignette (le code de la carte) : ligne-ETH-numéro, par exemple « L2-ROUE-4827 ». Le numéro
// est tiré au hasard une fois pour toutes ; la ligne et l'ETH suivent la fiche (réaffectée, elle change de
// préfixe mais garde son numéro). Le code d'un classeur importé reste dans « code_import ».

import crypto from 'node:crypto'
import { db, noterModification } from '../../lib/base.js'
import { exigerEcriture } from 'ktec/partage.js'
import { placeDe } from '../analyse/serveur.js'

// « R.L2 (ROUE L2) » → « R.L2 » : le code avant la parenthèse, en capitales, sans espaces.
const code = (v) => String(v || '').split(' (')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9.]+/g, '')
const NUMERO = /(?:^|-)(\d{4})$/ // une fiche sans ligne ni ETH n'a que son numéro

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
    const fiches = db().prepare('SELECT id, ligne, eth, etiquette FROM fiches_mn1').all()
    const pris = new Set(fiches.map((f) => NUMERO.exec(f.etiquette)?.[1]).filter(Boolean))
    const changer = db().prepare('UPDATE fiches_mn1 SET etiquette = ? WHERE id = ?')
    let changees = 0
    for (const f of fiches) {
      let numero = NUMERO.exec(f.etiquette)?.[1]
      if (!numero) {
        do numero = String(crypto.randomInt(1000, 10000))
        while (pris.has(numero) && pris.size < 9000)
        pris.add(numero)
      }
      const voulue = etiquette(f.ligne, f.eth, numero)
      if (voulue !== f.etiquette) { changer.run(voulue, f.id); changees++ }
    }
    if (changees) noterModification()
  } catch {
    // fichier en lecture seule : on garde les étiquettes telles quelles
  }
}
