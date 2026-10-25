// Les fiches de maintenance de niveau 1, communes à la fiche d'analyse d'une machine et au menu « Maintenance
// de niveau 1 ». Elles sont toujours pour la production : les opérateurs en tirent un nombre fixe par semaine.
// Une fiche : { action, frequence, evite, repere, designation, eth, ligne }
//
// Paramètres (le rouage du menu) : { parSemaine, fiches: { Hebdomadaire: 5, Mensuelle: 1, … } }
//   fiches[fréquence] = le nombre de fiches à imprimer pour une période (hebdomadaire : une par semaine du mois,
//   soit 5 ; mensuelle : 1 par mois ; trimestrielle : 1 par trimestre…). Quotidienne : trop fréquent pour une
//   fiche, à voir avec le responsable de production ou en focus maintenance.

import { h, ic, nombreFr } from '/socle/ui.js'

export const LOGO_MN1 = new URL('mn1.webp', import.meta.url).href
export const FREQUENCES = ['Quotidienne', 'Hebdomadaire', 'Mensuelle', 'Trimestrielle', 'Semestrielle', 'Annuelle']
// La période que couvrent les fiches imprimées d'une fréquence, et sa part d'un mois (pour la charge).
const PERIODES = { Hebdomadaire: ['Semaine', 'mois', 1], Mensuelle: ['Mois', 'mois', 1], Trimestrielle: ['Trimestre', 'trimestre', 1 / 3], Semestrielle: ['Semestre', 'semestre', 1 / 6], Annuelle: ['Année', 'an', 1 / 12] }
export const TROP_FREQUENT = 'Trop fréquent pour une fiche de niveau 1 : à voir avec le responsable de production, ou à traiter en focus maintenance.'

let parametres = { parSemaine: 2, fiches: { Hebdomadaire: 5, Mensuelle: 1, Trimestrielle: 1, Semestrielle: 1, Annuelle: 1 } }
export const definirParametres = (p) => { if (p) parametres = { parSemaine: p.parSemaine, fiches: { ...parametres.fiches, ...p.fiches } } }
export const lireParametres = () => parametres

// Ce que l'IA a écrit (« hebdomadaire pendant les arrêts », « tous les 3 mois »…) ramené à une fréquence du
// calendrier ; « » si rien ne s'y rapporte (la fiche dira « à préciser »).
export function frequenceCalendaire(texte) {
  const t = String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/semest|6 mois|six mois/.test(t)) return 'Semestrielle'
  if (/trimest|3 mois|trois mois/.test(t)) return 'Trimestrielle'
  if (/annuel|par an|chaque annee|12 mois/.test(t)) return 'Annuelle'
  if (/mensuel|par mois|chaque mois|tous les mois/.test(t)) return 'Mensuelle'
  if (/hebdo|semaine/.test(t)) return 'Hebdomadaire'
  if (/quotid|jour|poste|equipe|demarrage/.test(t)) return 'Quotidienne'
  return ''
}

// Le nombre de fiches à imprimer pour une fréquence (0 : pas de fiche, quotidienne ou à préciser).
export const fichesPour = (frequence) => (PERIODES[frequence] ? parametres.fiches[frequence] || 1 : 0)

// La charge des opérateurs : les fiches à tirer par mois, et ce qu'ils peuvent tirer (parSemaine × 52 / 12).
export function charge(fiches) {
  const parMois = fiches.reduce((s, f) => s + (PERIODES[f.frequence] ? fichesPour(f.frequence) * PERIODES[f.frequence][2] : 0), 0)
  return {
    parMois: Math.round(parMois * 10) / 10,
    capacite: Math.round(((parametres.parSemaine * 52) / 12) * 10) / 10,
    tropFrequentes: fiches.filter((f) => f.frequence === 'Quotidienne').length,
    aPreciser: fiches.filter((f) => !f.frequence).length,
  }
}

// Une fiche à l'écran : geste, fréquence préconisée (et le nombre de fiches qu'elle donne), panne évitée, ETH,
// machine. options.enPlus : éléments ajoutés en bas (boutons) ; un clic ailleurs ouvre la version à imprimer.
export function carteFiche(f, { enPlus = null } = {}) {
  const quotidienne = f.frequence === 'Quotidienne'
  const ouvrir = () => imprimerFiche(f)
  const n = fichesPour(f.frequence)
  return h('div', { class: `geste-mn1 production${quotidienne ? ' trop-frequente' : ''}`, role: 'button', tabindex: '0', title: quotidienne ? TROP_FREQUENT : 'Ouvrir les fiches à imprimer (A5 paysage)',
    onclick: (ev) => !ev.target.closest('.enplus-mn1') && ouvrir(),
    onkeydown: (ev) => ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), ouvrir()) },
    h('div', { class: 'tete-geste' }, h('img', { src: LOGO_MN1, alt: '' }), h('span', { class: 'pour-mn1' }, 'Production'),
      h('span', { class: 'imprimer-geste' }, ic('document', 13), n ? `${n} fiche${n > 1 ? 's' : ''} / ${PERIODES[f.frequence][1]}` : 'Fiche')),
    h('div', { class: 'action-mn1' }, f.action),
    h('div', { class: 'detail-mn1' }, h('b', {}, 'Fréquence préconisée'), f.frequence || 'à préciser'),
    quotidienne ? h('div', { class: 'alerte-mn1' }, ic('alerte', 14), TROP_FREQUENT) : null,
    f.evite ? h('div', { class: 'detail-mn1' }, h('b', {}, 'Évite'), f.evite) : null,
    h('div', { class: 'lieu-mn1' },
      f.eth ? h('span', {}, h('b', {}, 'ETH'), f.eth) : null,
      h('span', {}, h('b', {}, 'Machine'), `${f.repere}${f.designation ? ` — ${f.designation}` : ''}`)),
    enPlus ? h('div', { class: 'enplus-mn1' }, enPlus) : null)
}

// Les fiches de niveau 1 à imprimer : A5 paysage, une page par fiche (5 pour un contrôle hebdomadaire : une par
// semaine du mois), sobres, avec le logo, la machine, le geste et un cadre de contrôle à remplir à la main.
export function imprimerFiche(f) {
  const e = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const quotidienne = f.frequence === 'Quotidienne'
  const nombre = Math.max(1, fichesPour(f.frequence))
  const [periode] = PERIODES[f.frequence] || ['Période']
  const aujourdhui = new Date().toLocaleDateString('fr-FR')
  const ligne = (libelle, valeur) => (valeur ? `<tr><th>${libelle}</th><td>${e(valeur)}</td></tr>` : '')
  const feuille = (numero) => `<div class="feuille">
  <header>
    <img src="${LOGO_MN1}" alt="MN1">
    <div><h1>Maintenance de niveau 1</h1><p>Fiche de contrôle · Production</p></div>
    <span class="numero">${nombre > 1 ? `${e(periode)} ${numero} / ${nombre}` : e(periode)}</span>
  </header>
  ${quotidienne ? `<div class="alerte">${e(TROP_FREQUENT)}</div>` : ''}
  <div class="haut">
    <table class="infos">
      ${ligne('Machine', `${f.repere}${f.designation ? ` — ${f.designation}` : ''}`)}
      ${ligne('ETH', f.eth)}
      ${ligne('Ligne', f.ligne)}
      ${ligne('Fréquence préconisée', f.frequence || 'à préciser')}
    </table>
    <div class="geste"><h2>Geste à réaliser</h2><p>${e(f.action)}</p>${f.evite ? `<h2 style="margin-top:2mm">Panne évitée</h2><div>${e(f.evite)}</div>` : ''}</div>
  </div>
  <div class="controle">
    <h2>Contrôle réalisé</h2>
    <div class="champs">
      <div><span>Date</span></div><div><span>Heure / poste</span></div><div><span>Nom de l’opérateur</span></div>
      <div class="conforme"><span>Conforme</span><b>☐ Oui</b><b>☐ Non</b></div>
    </div>
    <div class="obs"><span>Observations / anomalie constatée</span></div>
    <div class="champs bas"><div><span>Signalé à (si non conforme)</span></div><div><span>Visa du responsable</span></div></div>
  </div>
  <footer><span>Éditée par AITEC le ${aujourdhui}, d’après l’analyse de la machine</span><span>${e(f.repere)}</span></footer>
</div>`
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>MN1 — ${e(f.repere)} — ${e(f.action).slice(0, 60)}</title>
<style>
  @page { size: A5 landscape; margin: 7mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 9.5pt/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1b1f1d; background: #e9ecea; }
  .feuille { width: 210mm; height: 148mm; margin: 12px auto; padding: 7mm; background: #fff; box-shadow: 0 4px 20px rgba(0,0,0,.15); display: flex; flex-direction: column; gap: 3mm; }
  header { display: flex; align-items: center; gap: 4mm; border-bottom: 1.2mm solid #d4d01c; padding-bottom: 2.5mm; }
  header img { width: 15mm; height: 15mm; }
  header h1 { margin: 0; font-size: 14pt; letter-spacing: .02em; }
  header p { margin: 0; color: #5d6662; font-size: 8.5pt; }
  .numero { margin-left: auto; padding: 1.2mm 3mm; border-radius: 99px; font-weight: 700; font-size: 9pt; border: .3mm solid #1d5fbf; color: #1d5fbf; white-space: nowrap; }
  .alerte { padding: 2mm 3mm; border-radius: 2mm; background: #fdecea; color: #a12a1a; font-weight: 600; font-size: 8.5pt; }
  .haut { display: grid; grid-template-columns: 1fr 1.25fr; gap: 4mm; }
  table { width: 100%; border-collapse: collapse; }
  .infos th { text-align: left; width: 31mm; color: #5d6662; font-weight: 600; padding: .8mm 0; vertical-align: top; }
  .infos td { padding: .8mm 0; font-weight: 600; }
  .geste { border: .35mm solid #c9cec9; border-left: 1.2mm solid #d4d01c; border-radius: 2mm; padding: 2.5mm 3mm; }
  h2 { margin: 0 0 1.2mm; font-size: 7.5pt; letter-spacing: .08em; text-transform: uppercase; color: #5d6662; }
  .geste p { margin: 0; font-size: 11pt; font-weight: 600; }
  .controle { flex: 1; display: flex; flex-direction: column; gap: 2mm; }
  .champs { display: grid; grid-template-columns: 24mm 28mm 1fr 44mm; gap: 2mm; }
  .champs.bas { grid-template-columns: 1fr 1fr; }
  .champs > div, .obs { border: .3mm solid #9aa29d; border-radius: 1.5mm; min-height: 11mm; padding: 1mm 2mm; position: relative; }
  .champs span, .obs span { font-size: 6.8pt; color: #5d6662; text-transform: uppercase; letter-spacing: .05em; }
  .conforme { display: flex; align-items: center; gap: 3mm; }
  .conforme span { position: absolute; top: 1mm; left: 2mm; }
  .conforme b { margin-top: 3mm; font-size: 10pt; font-weight: 600; }
  .obs { flex: 1; min-height: 14mm; }
  footer { display: flex; justify-content: space-between; font-size: 7pt; color: #8a938e; }
  @media print { body { background: #fff; } .feuille { margin: 0; box-shadow: none; width: auto; height: 134mm; padding: 0; page-break-after: always; break-after: page; } .feuille:last-child { page-break-after: auto; break-after: auto; } }
</style></head><body>${Array.from({ length: nombre }, (_, i) => feuille(i + 1)).join('')}</body></html>`
  // L'aperçu par-dessus la page (pas de fenêtre surgissante, que les navigateurs bloquent souvent) ;
  // « Imprimer » imprime les feuilles seules.
  const cadre = h('iframe', { class: 'cadre-fiche', title: 'Fiches de niveau 1', srcdoc: page })
  const fermer = () => { voile.remove(); document.removeEventListener('keydown', surEchap) }
  const surEchap = (ev) => ev.key === 'Escape' && fermer()
  const voile = h('div', { class: 'apercu-fiche', onmousedown: (ev) => ev.target === voile && fermer() },
    h('div', { class: 'outils-fiche' },
      h('span', {}, ic('document', 16), `${nombre} fiche${nombre > 1 ? 's' : ''} de niveau 1 — A5 paysage`),
      quotidienne ? h('span', { class: 'alerte-mn1' }, ic('alerte', 14), 'Trop fréquent') : null,
      h('button', { class: 'principal', onclick: () => cadre.contentWindow?.print() }, ic('document', 15), nombre > 1 ? `Imprimer les ${nombre}` : 'Imprimer'),
      h('button', { class: 'discret icone-seule', title: 'Fermer (Échap)', onclick: fermer }, ic('x', 16))),
    cadre)
  document.body.append(voile)
  document.addEventListener('keydown', surEchap)
}

// Le cadre de la charge des opérateurs (menu « Maintenance de niveau 1 »).
export function carteCharge(fiches) {
  const c = charge(fiches)
  const part = c.capacite ? Math.min(100, Math.round((100 * c.parMois) / c.capacite)) : 0
  const depasse = c.parMois > c.capacite
  return h('div', { class: `carte charge-mn1${depasse ? ' depasse' : ''}` },
    h('div', { class: 'tete-charge' },
      h('b', {}, 'Charge des opérateurs'),
      h('span', {}, `${nombreFr(c.parMois, 1)} fiche${c.parMois > 1 ? 's' : ''} par mois pour ${nombreFr(c.capacite, 1)} possibles (${parametres.parSemaine} par semaine)`)),
    h('div', { class: 'barre-charge' }, h('div', { style: { width: `${part}%` } })),
    depasse ? h('div', { class: 'alerte-mn1' }, ic('alerte', 14), 'Plus de fiches que les opérateurs ne peuvent en tirer : espacer certains contrôles, ou en discuter avec le responsable de production.') : null,
    c.tropFrequentes ? h('div', { class: 'alerte-mn1' }, ic('alerte', 14), `${c.tropFrequentes} fiche${c.tropFrequentes > 1 ? 's' : ''} quotidienne${c.tropFrequentes > 1 ? 's' : ''} : ${TROP_FREQUENT}`) : null,
    c.aPreciser ? h('div', { class: 'discret', style: { fontSize: '13px' } }, `${c.aPreciser} fiche${c.aPreciser > 1 ? 's' : ''} sans fréquence préconisée : à préciser (crayon).`) : null)
}
