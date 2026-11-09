// L'étiquette d'une vignette (le code de la carte) : ligne-ETH-numéro, par exemple « L2-ROUE-2611A » pour la première
// fiche de la ligne créée en novembre 2026, puis 2611B, 2611C… Le numéro est donné une fois pour toutes ; la ligne et
// l'ETH suivent la fiche (changée de ligne, elle ne change de lettre que si la sienne y est déjà prise). Le code d'un
// classeur importé reste dans « code_import ».

import { db, reglage, modifierReglage, noterModification } from '../../lib/base.js'
import { exigerEcriture } from 'ktec/partage.js'
import { placeDe } from '../analyse/serveur.js'

// « R.L2 (ROUE L2) » → « R.L2 » : le code avant la parenthèse, en capitales, sans espaces.
const code = (v) => String(v || '').split(' (')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9.]+/g, '')
const NUMERO = /(?:^|-)(\d{4}[A-Z]{0,2})$/ // une fiche sans ligne ni ETH n'a que son numéro

// La forme courte, celle des classeurs : ligne « L2 (Ligne L2) » → « L2 », ETH « R.L2 (ROUE L2) » → « ROUE ».
const ligneCourte = (ligne) => String(ligne || '').split(' (')[0].trim()
function ethCourt(eth, ligne) {
  const dedans = /\((.+)\)/.exec(String(eth || ''))?.[1]
  if (!dedans) return String(eth || '').trim()
  const fin = ` ${ligneCourte(ligne)}`.toUpperCase()
  return (dedans.toUpperCase().endsWith(fin) ? dedans.slice(0, -fin.length) : dedans).trim()
}

export function etiquette(ligne, eth, numero) {
  return [code(ligne), code(eth), numero].filter(Boolean).join('-')
}

// A, B… Z, AA, AB…
const lettre = (i) => (i < 26 ? String.fromCharCode(65 + i) : lettre(Math.floor(i / 26) - 1) + lettre(i % 26))
const moisDe = (date) => { const d = date || new Date().toISOString(); return d.slice(2, 4) + d.slice(5, 7) }
const cleNumero = (ligne, numero) => `${code(ligne)}|${numero}`
function nouveauNumero(ligne, mois, pris) {
  let numero
  for (let i = 0; ; i++) {
    numero = `${mois}${lettre(i)}`
    if (!pris.has(cleNumero(ligne, numero))) break
  }
  pris.add(cleNumero(ligne, numero))
  return numero
}

// Le numéro de l'étiquette, null si elle n'en a pas encore.
export const numeroEtiquette = (e) => NUMERO.exec(String(e || ''))?.[1] ?? null

// Le code GMAO d'une FI créée depuis cette fiche (20 caractères au plus) : FI-MN1-L2-2611A ; null sans ligne ou sans lettre.
export function codeFi(f) {
  const numero = numeroEtiquette(f.etiquette)
  return code(f.ligne) && /[A-Z]$/.test(numero || '') ? `FI-MN1-${code(f.ligne)}-${numero}` : null
}

// Une seule fois par fichier : les fiches créées sans ligne ni ETH sont complétées d'après leur machine, puis toutes les
// étiquettes reçoivent le numéro du mois de création de leur fiche. Fichier pris par un autre poste : on réessaiera.
export async function mettreAuStandard() {
  try {
    const manquantes = db().prepare("SELECT id, machine_id FROM fiches_mn1 WHERE machine_id IS NOT NULL AND ligne = '' AND eth = ''").all()
    const places = (await Promise.all(manquantes.map(async (f) => [f.id, await placeDe(f.machine_id)]))).filter(([, place]) => place)
    const renumeroter = !reglage('etiquettes_standard') && db().prepare('SELECT 1 FROM fiches_mn1 LIMIT 1').get()
    if (!places.length && !renumeroter) return
    exigerEcriture({ pourTous: true })
    const completer = db().prepare('UPDATE fiches_mn1 SET ligne = ?, eth = ? WHERE id = ?')
    for (const [id, place] of places) completer.run(place.ligne, place.eth, id)
    if (renumeroter) {
      const pris = new Set()
      const changer = db().prepare('UPDATE fiches_mn1 SET etiquette = ? WHERE id = ?')
      for (const f of db().prepare('SELECT id, ligne, cree_le, modifie_le FROM fiches_mn1 ORDER BY cree_le, id').all()) changer.run(nouveauNumero(f.ligne, moisDe(f.cree_le || f.modifie_le), pris), f.id)
      modifierReglage('etiquettes_standard', '1')
    }
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
    const pris = new Set()
    const changer = db().prepare('UPDATE fiches_mn1 SET ligne = ?, eth = ?, etiquette = ? WHERE id = ?')
    let changees = 0
    for (const f of fiches) {
      const actuel = numeroEtiquette(f.etiquette)
      const libre = actuel && !pris.has(cleNumero(f.ligne, actuel))
      const numero = libre ? actuel : nouveauNumero(f.ligne, actuel ? actuel.slice(0, 4) : moisDe(f.cree_le), pris)
      pris.add(cleNumero(f.ligne, numero))
      const [ligne, eth] = [ligneCourte(f.ligne), ethCourt(f.eth, f.ligne)]
      const voulue = etiquette(ligne, eth, numero)
      if (voulue !== f.etiquette || ligne !== f.ligne || eth !== f.eth) { changer.run(ligne, eth, voulue, f.id); changees++ }
    }
    if (changees) noterModification()
  } catch {
    // fichier en lecture seule : on garde les étiquettes telles quelles
  }
}
