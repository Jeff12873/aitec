// Mots de passe et jetons.
//
// Le mot de passe administrateur n'est jamais enregistré en clair : on garde seulement
// une empreinte « scrypt » (lente à calculer exprès, pour décourager les essais en série).

import crypto from 'node:crypto'

export function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex')
  const empreinte = crypto.scryptSync(motDePasse, sel, 32).toString('hex')
  return `scrypt$${sel}$${empreinte}`
}

export function verifierMotDePasse(motDePasse, enregistre) {
  const [methode, sel, empreinte] = String(enregistre || '').split('$')
  if (methode !== 'scrypt' || !sel || !empreinte) return false
  const calculee = crypto.scryptSync(motDePasse, sel, 32)
  return crypto.timingSafeEqual(calculee, Buffer.from(empreinte, 'hex'))
}

export function nouveauJeton() {
  return crypto.randomBytes(24).toString('hex')
}
