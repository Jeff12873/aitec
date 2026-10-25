// Les fiches de maintenance de niveau 1, communes à la fiche d'analyse d'une machine et au menu « Maintenance
// de niveau 1 » : la fréquence préconisée (calendaire), l'affichage d'une fiche, sa version à imprimer (A5).
// Une fiche : { pour: 'Production' | 'Maintenance', action, frequence, evite, repere, designation, eth, ligne }

import { h, ic } from '/socle/ui.js'

export const LOGO_MN1 = new URL('mn1.webp', import.meta.url).href
export const FREQUENCES = ['Quotidienne', 'Hebdomadaire', 'Mensuelle', 'Trimestrielle', 'Semestrielle', 'Annuelle']

// Ce que l'IA a écrit (« hebdomadaire pendant les arrêts », « tous les 3 mois »…) ramené à une fréquence du
// calendrier ; « » si rien ne s'y rapporte (la fiche dira « à préciser »).
export function frequenceCalendaire(texte) {
  const t = String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/semest|6 mois|six mois/.test(t)) return 'Semestrielle'
  if (/trimest|3 mois|trois mois/.test(t)) return 'Trimestrielle'
  if (/annuel|par an|chaque annee|12 mois/.test(t)) return 'Annuelle'
  if (/mensuel|par mois|chaque mois|tous les mois/.test(t)) return 'Mensuelle'
  if (/hebdo|semaine/.test(t)) return 'Hebdomadaire'
  if (/quotid|jour|poste|equipe|demarrage/.test(t)) return 'Quotidienne'
  return ''
}

// Une fiche à l'écran : cible, geste, fréquence préconisée, panne évitée, ETH et machine.
// options.enPlus : éléments ajoutés en bas (boutons) ; un clic ailleurs sur la fiche ouvre la version à imprimer.
export function carteFiche(f, { enPlus = null } = {}) {
  const ouvrir = () => imprimerFiche(f)
  return h('div', { class: `geste-mn1 ${f.pour === 'Production' ? 'production' : 'maintenance'}`, role: 'button', tabindex: '0', title: 'Ouvrir la fiche à imprimer (A5 paysage)',
    onclick: (ev) => !ev.target.closest('.enplus-mn1') && ouvrir(),
    onkeydown: (ev) => ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), ouvrir()) },
    h('div', { class: 'tete-geste' }, h('img', { src: LOGO_MN1, alt: '' }), h('span', { class: 'pour-mn1' }, f.pour), h('span', { class: 'imprimer-geste' }, ic('document', 13), 'Fiche')),
    h('div', { class: 'action-mn1' }, f.action),
    h('div', { class: 'detail-mn1' }, h('b', {}, 'Fréquence préconisée'), f.frequence || 'à préciser'),
    f.evite ? h('div', { class: 'detail-mn1' }, h('b', {}, 'Évite'), f.evite) : null,
    h('div', { class: 'lieu-mn1' },
      f.eth ? h('span', {}, h('b', {}, 'ETH'), f.eth) : null,
      h('span', {}, h('b', {}, 'Machine'), `${f.repere}${f.designation ? ` — ${f.designation}` : ''}`)),
    enPlus ? h('div', { class: 'enplus-mn1' }, enPlus) : null)
}

// La fiche de niveau 1 à imprimer : A5 paysage, sobre, avec le logo, la machine, le geste et un tableau de
// contrôle à remplir à la main (date, poste, nom, conforme, observations, visa).
export function imprimerFiche(f) {
  const e = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const aujourdhui = new Date().toLocaleDateString('fr-FR')
  const ligne = (libelle, valeur) => (valeur ? `<tr><th>${libelle}</th><td>${e(valeur)}</td></tr>` : '')
  const controles = Array.from({ length: 6 }, () => '<tr><td></td><td></td><td></td><td class="case">☐ Oui&nbsp;&nbsp;☐ Non</td><td></td><td></td></tr>').join('')
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>MN1 — ${e(f.repere)} — ${e(f.action).slice(0, 60)}</title>
<style>
  @page { size: A5 landscape; margin: 7mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 9.5pt/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1b1f1d; background: #e9ecea; }
  .feuille { width: 210mm; height: 148mm; margin: 12px auto; padding: 7mm; background: #fff; box-shadow: 0 4px 20px rgba(0,0,0,.15); display: flex; flex-direction: column; gap: 3.2mm; }
  header { display: flex; align-items: center; gap: 4mm; border-bottom: 1.2mm solid #d4d01c; padding-bottom: 2.5mm; }
  header img { width: 15mm; height: 15mm; }
  header h1 { margin: 0; font-size: 14pt; letter-spacing: .02em; }
  header p { margin: 0; color: #5d6662; font-size: 8.5pt; }
  .pour { margin-left: auto; padding: 1.2mm 3mm; border-radius: 99px; font-weight: 700; font-size: 8.5pt; letter-spacing: .06em; text-transform: uppercase; border: .3mm solid currentColor; color: ${f.pour === 'Production' ? '#1d5fbf' : '#7a7400'}; }
  .haut { display: grid; grid-template-columns: 1fr 1.25fr; gap: 4mm; }
  table { width: 100%; border-collapse: collapse; }
  .infos th { text-align: left; width: 31mm; color: #5d6662; font-weight: 600; padding: .8mm 0; vertical-align: top; }
  .infos td { padding: .8mm 0; font-weight: 600; }
  .geste { border: .35mm solid #c9cec9; border-left: 1.2mm solid #d4d01c; border-radius: 2mm; padding: 2.5mm 3mm; }
  .geste h2, .controle h2 { margin: 0 0 1.2mm; font-size: 7.5pt; letter-spacing: .08em; text-transform: uppercase; color: #5d6662; }
  .geste p { margin: 0; font-size: 11pt; font-weight: 600; }
  .controle { flex: 1; display: flex; flex-direction: column; }
  .controle table { flex: 1; }
  .controle th { font-size: 7.5pt; text-align: left; color: #5d6662; border-bottom: .35mm solid #9aa29d; padding: .8mm 1.5mm; }
  .controle td { border-bottom: .2mm solid #c9cec9; border-right: .2mm solid #e1e5e2; height: 6.3mm; padding: 0 1.5mm; font-size: 8pt; }
  .controle td:last-child { border-right: 0; }
  .case { white-space: nowrap; color: #5d6662; }
  footer { display: flex; justify-content: space-between; font-size: 7pt; color: #8a938e; }
  @media print { body { background: #fff; } .feuille { margin: 0; box-shadow: none; width: auto; height: auto; min-height: 134mm; padding: 0; } }
</style></head><body>
<div class="feuille">
  <header>
    <img src="${LOGO_MN1}" alt="MN1">
    <div><h1>Maintenance de niveau 1</h1><p>Fiche de contrôle</p></div>
    <span class="pour">${e(f.pour)}</span>
  </header>
  <div class="haut">
    <table class="infos">
      ${ligne('Machine', `${f.repere}${f.designation ? ` — ${f.designation}` : ''}`)}
      ${ligne('ETH', f.eth)}
      ${ligne('Ligne', f.ligne)}
      ${ligne('Fréquence préconisée', f.frequence)}
    </table>
    <div class="geste"><h2>Geste à réaliser</h2><p>${e(f.action)}</p>${f.evite ? `<h2 style="margin-top:2mm">Panne évitée</h2><div>${e(f.evite)}</div>` : ''}</div>
  </div>
  <div class="controle">
    <h2>Informations de contrôle</h2>
    <table><thead><tr><th style="width:20mm">Date</th><th style="width:22mm">Heure / poste</th><th style="width:34mm">Nom</th><th style="width:28mm">Conforme</th><th>Observations</th><th style="width:18mm">Visa</th></tr></thead><tbody>${controles}</tbody></table>
  </div>
  <footer><span>Éditée par AITEC le ${aujourdhui}, d’après l’analyse de la machine</span><span>${e(f.repere)}</span></footer>
</div></body></html>`
  // L'aperçu par-dessus la page (pas de fenêtre surgissante, que les navigateurs bloquent souvent) ;
  // « Imprimer » imprime la feuille seule.
  const cadre = h('iframe', { class: 'cadre-fiche', title: 'Fiche de niveau 1', srcdoc: page })
  const fermer = () => { voile.remove(); document.removeEventListener('keydown', surEchap) }
  const surEchap = (ev) => ev.key === 'Escape' && fermer()
  const voile = h('div', { class: 'apercu-fiche', onmousedown: (ev) => ev.target === voile && fermer() },
    h('div', { class: 'outils-fiche' },
      h('span', {}, ic('document', 16), 'Fiche de niveau 1 — A5 paysage'),
      h('button', { class: 'principal', onclick: () => cadre.contentWindow?.print() }, ic('document', 15), 'Imprimer'),
      h('button', { class: 'discret icone-seule', title: 'Fermer (Échap)', onclick: fermer }, ic('x', 16))),
    cadre)
  document.body.append(voile)
  document.addEventListener('keydown', surEchap)
}

