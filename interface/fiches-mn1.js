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

// La machine d'une fiche : son repère AITEC (fiche gardée depuis l'analyse) ou son nom dans le classeur importé.
export const nomMachine = (f) => (f.repere ? `${f.repere}${f.designation ? ` — ${f.designation}` : ''}` : f.machine_nom || '')

// Les points à vérifier : un par ligne ; « Porte : » est un intertitre ; les « ☐ » sont retirés (on les remet).
export function points(texte) {
  return String(texte || '')
    .split('\n')
    .flatMap((ligne) => ligne.split(/☐/).map((x, i) => ({ x: x.trim(), coche: i > 0 || /^\s*☐/.test(ligne) })))
    .filter(({ x }) => x)
    .map(({ x, coche }) => (!coche && /:$/.test(x) ? { titre: x.replace(/\s*:$/, '') } : { point: x.replace(/^[-•]\s*/, '') }))
}

// Une fiche à l'écran : étiquette et zone, points à vérifier, fréquence préconisée (et le nombre de fiches qu'elle
// donne), panne évitée, ETH, machine. options.enPlus : boutons en bas ; un clic ailleurs ouvre l'impression.
export function carteFiche(f, { enPlus = null } = {}) {
  const quotidienne = f.frequence === 'Quotidienne'
  const ouvrir = () => imprimerFiches([f])
  const n = fichesPour(f.frequence)
  const liste = points(f.action)
  return h('div', { class: `geste-mn1 production${quotidienne ? ' trop-frequente' : ''}`, role: 'button', tabindex: '0', title: quotidienne ? TROP_FREQUENT : 'Ouvrir la fiche à imprimer (A5 paysage)',
    onclick: (ev) => !ev.target.closest('.enplus-mn1') && ouvrir(),
    onkeydown: (ev) => ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), ouvrir()) },
    h('div', { class: 'tete-geste' }, h('img', { src: LOGO_MN1, alt: '' }),
      f.etiquette ? h('span', { class: 'code-etiquette' }, f.etiquette) : h('span', { class: 'pour-mn1' }, 'Production'),
      h('span', { class: 'imprimer-geste' }, ic('document', 13), n ? `${n} fiche${n > 1 ? 's' : ''} / ${PERIODES[f.frequence][1]}` : 'Fiche')),
    f.zone ? h('div', { class: 'zone-mn1' }, f.zone) : null,
    liste.length > 1 || f.etiquette
      ? h('ul', { class: 'points-mn1' }, liste.slice(0, 6).map((p) => (p.titre ? h('li', { class: 'titre-point' }, p.titre) : h('li', {}, p.point))), liste.length > 6 ? h('li', { class: 'discret' }, `… ${liste.length - 6} de plus`) : null)
      : h('div', { class: 'action-mn1' }, f.action),
    h('div', { class: 'detail-mn1' }, h('b', {}, 'Fréquence préconisée'), f.frequence || 'à préciser'),
    quotidienne ? h('div', { class: 'alerte-mn1' }, ic('alerte', 14), TROP_FREQUENT) : null,
    f.evite ? h('div', { class: 'detail-mn1' }, h('b', {}, 'Évite'), f.evite) : null,
    h('div', { class: 'lieu-mn1' },
      f.eth ? h('span', {}, h('b', {}, 'ETH'), f.eth) : null,
      h('span', {}, h('b', {}, 'Machine'), nomMachine(f))),
    enPlus ? h('div', { class: 'enplus-mn1' }, enPlus) : null)
}

// Une seule fiche : toutes ses feuilles (5 pour un contrôle hebdomadaire, une par semaine du mois).
export const imprimerFiche = (f) => imprimerFiches([f])

// Les fiches à imprimer, A5 paysage, une feuille par fiche et par période. La feuille reprend la carte terrain :
// à gauche le recto (machine, zone, étiquette, points à vérifier), à droite le verso (date, exécutant, mode
// opératoire, résultat à cocher) et le bandeau « LIGNE - FICHE MAINTENANCE NIV 01 ».
export function imprimerFiches(fiches) {
  const e = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const aujourdhui = new Date().toLocaleDateString('fr-FR')
  const ligneCourte = (f) => String(f.ligne || '').replace(/\s*\(.*\)$/, '')
  const feuille = (f, numero, nombre) => {
    const [periode] = PERIODES[f.frequence] || ['']
    const machine = f.repere || f.machine_nom || ''
    const liste = points(f.action)
    return `<div class="feuille">
  <section class="recto">
    <div class="cases">
      <div class="case verte">${e(f.eth || machine)}</div>
      <div class="case claire">${e(machine)}${f.zone ? ` : ${e(f.zone)}` : ''}</div>
      <div class="case verte code">${e(f.etiquette || 'MN1')}</div>
    </div>
    <div class="points">
      ${f.frequence === 'Quotidienne' ? `<p class="alerte">${e(TROP_FREQUENT)}</p>` : ''}
      ${liste.map((p) => (p.titre ? `<p class="titre">${e(p.titre)} :</p>` : `<p class="point"><span>☐</span>${e(p.point)}</p>`)).join('')}
      ${f.evite ? `<p class="evite">Évite : ${e(f.evite)}</p>` : ''}
    </div>
  </section>
  <section class="verso">
    <div class="periode">${nombre > 1 ? `${e(periode)} ${numero} / ${nombre} · ` : ''}${e(f.frequence || 'Fréquence à préciser')}</div>
    <div class="date-mode">
      <div class="qui"><p>Date :</p><p>Exécutant :</p></div>
      <ol><li>Réaliser l’action indiquée.</li><li>Appliquer le correctif si cela est possible.</li><li>Cocher le résultat de l’inspection.</li><li>Renseigner la date et apposer votre nom.</li></ol>
    </div>
    <div class="resultats">
      <div><i></i><span>Pas d’anomalie</span></div>
      <div><i></i><span>Anomalie corrigée</span></div>
      <div><i></i><span>Anomalie non corrigée et DI faite</span></div>
    </div>
    <div class="bandeau"><img src="${LOGO_MN1}" alt=""><span>${e(ligneCourte(f) ? `${ligneCourte(f)} - ` : '')}FICHE MAINTENANCE NIV 01</span></div>
    <div class="pied">Éditée par AITEC le ${aujourdhui}${f.repere ? ` · ${e(f.repere)}` : ''}</div>
  </section>
</div>`
  }
  const feuilles = fiches.flatMap((f) => { const n = Math.max(1, fichesPour(f.frequence)); return Array.from({ length: n }, (_, i) => feuille(f, i + 1, n)) })
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiches maintenance niveau 1</title>
<style>
  @page { size: A5 landscape; margin: 6mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10pt/1.35 Cambria, Georgia, 'Times New Roman', serif; color: #111; background: #e9ecea; }
  .feuille { width: 210mm; height: 148mm; margin: 12px auto; padding: 6mm; background: #fff; box-shadow: 0 4px 20px rgba(0,0,0,.15); display: grid; grid-template-columns: 1.15fr 1fr; gap: 6mm; }
  section { display: flex; flex-direction: column; gap: 3mm; min-height: 0; }
  .cases { display: grid; grid-template-columns: 1fr 1.4fr .8fr; gap: 2mm; }
  .case { border: .45mm solid #111; display: flex; align-items: center; justify-content: center; text-align: center; font-weight: 700; padding: 1.5mm; min-height: 12mm; font-size: 9pt; line-height: 1.15; }
  .verte { background: #92d050; }
  .claire { background: #e2efda; font-size: 8pt; }
  .code { font-size: 17pt; }
  .points { flex: 1; border: .45mm solid #111; padding: 3mm 3.5mm; overflow: hidden; font-weight: 700; font-size: 9.5pt; }
  .points p { margin: 0 0 1.3mm; }
  .titre { text-decoration: underline; margin-top: 1.5mm !important; }
  .point { display: flex; gap: 1.8mm; }
  .point span { flex: none; }
  .evite { margin-top: 2.5mm !important; font-weight: 400; font-style: italic; color: #444; }
  .alerte { padding: 1.5mm 2mm; background: #fdecea; color: #a12a1a; font-family: system-ui, sans-serif; font-size: 8pt; }
  .periode { align-self: flex-end; font: 600 8pt system-ui, sans-serif; color: #1d5fbf; border: .3mm solid #1d5fbf; border-radius: 99px; padding: .8mm 3mm; }
  .date-mode { display: grid; grid-template-columns: .8fr 1.4fr; gap: 1.5mm; }
  .qui, .date-mode ol { border: .45mm solid #111; margin: 0; padding: 2mm 3mm; font-weight: 700; }
  .qui p { margin: 0 0 9mm; font-size: 11pt; text-align: center; }
  .date-mode ol { padding-left: 7mm; font-size: 8.5pt; }
  .resultats { display: flex; flex-direction: column; gap: 2mm; align-items: center; margin-top: 1mm; }
  .resultats div { display: flex; align-items: center; gap: 4mm; width: 82%; }
  .resultats i { width: 8mm; height: 7mm; border: .45mm solid #111; border-radius: 1.5mm; flex: none; }
  .resultats span { flex: 1; border: .35mm solid #111; text-align: center; font-weight: 700; padding: 1.2mm; font-size: 9pt; }
  .bandeau { margin-top: auto; background: #92d050; border: .45mm solid #111; display: flex; align-items: center; justify-content: center; gap: 3mm; padding: 1.5mm; font-weight: 700; font-size: 12pt; }
  .bandeau img { width: 9mm; height: 9mm; }
  .pied { font: 6.5pt system-ui, sans-serif; color: #888; text-align: right; }
  @media print { body { background: #fff; } .feuille { margin: 0; box-shadow: none; width: auto; height: 136mm; padding: 0; page-break-after: always; break-after: page; } .feuille:last-child { page-break-after: auto; break-after: auto; } }
</style></head><body>${feuilles.join('')}</body></html>`
  // L'aperçu par-dessus la page (pas de fenêtre surgissante, que les navigateurs bloquent souvent) ;
  // « Imprimer » imprime les feuilles seules.
  const cadre = h('iframe', { class: 'cadre-fiche', title: 'Fiches de niveau 1', srcdoc: page })
  const fermer = () => { voile.remove(); document.removeEventListener('keydown', surEchap) }
  const surEchap = (ev) => ev.key === 'Escape' && fermer()
  const nombre = feuilles.length
  const voile = h('div', { class: 'apercu-fiche', onmousedown: (ev) => ev.target === voile && fermer() },
    h('div', { class: 'outils-fiche' },
      h('span', {}, ic('document', 16), `${nombre} fiche${nombre > 1 ? 's' : ''} de niveau 1 — A5 paysage`),
      fiches.some((f) => f.frequence === 'Quotidienne') ? h('span', { class: 'alerte-mn1' }, ic('alerte', 14), 'Trop fréquent') : null,
      h('button', { class: 'principal', onclick: () => cadre.contentWindow?.print() }, ic('document', 15), nombre > 1 ? `Imprimer les ${nombre}` : 'Imprimer'),
      h('button', { class: 'discret icone-seule', title: 'Fermer (Échap)', onclick: fermer }, ic('x', 16))),
    cadre)
  document.body.append(voile)
  document.addEventListener('keydown', surEchap)
}

// Le cadre de la charge des opérateurs, par secteur (ligne) puis par ETH : chaque ETH tire parSemaine fiches par
// semaine (un secteur de 3 ETH en tire donc 3 × parSemaine). Fiches à tirer par mois / ce que l'ETH peut tirer.
export function carteCharge(fiches) {
  const parSecteur = new Map()
  for (const f of fiches) {
    const secteur = f.ligne || 'Sans secteur'
    if (!parSecteur.has(secteur)) parSecteur.set(secteur, new Map())
    const eths = parSecteur.get(secteur)
    const eth = f.eth || 'Sans ETH'
    eths.set(eth, [...(eths.get(eth) || []), f])
  }
  const ligneCharge = (titre, c, classe = '') => {
    const part = c.capacite ? Math.min(100, Math.round((100 * c.parMois) / c.capacite)) : 0
    return h('div', { class: `ligne-charge ${classe}${c.parMois > c.capacite ? ' depasse' : ''}` },
      h('span', { class: 'nom-charge' }, titre),
      h('div', { class: 'barre-charge' }, h('div', { style: { width: `${part}%` } })),
      h('span', { class: 'chiffres-charge' }, `${nombreFr(c.parMois, 1)} / ${nombreFr(c.capacite, 1)} par mois`))
  }
  const secteurs = [...parSecteur].map(([secteur, eths]) => {
    const parEth = [...eths].map(([eth, liste]) => ({ eth, c: charge(liste) }))
    const total = { parMois: parEth.reduce((s, x) => s + x.c.parMois, 0), capacite: parEth.reduce((s, x) => s + x.c.capacite, 0) }
    return { secteur, parEth, total }
  })
  const tout = charge(fiches)
  return h('div', { class: 'carte charge-mn1' },
    h('div', { class: 'tete-charge' },
      h('b', {}, 'Charge des opérateurs'),
      h('span', {}, `${parametres.parSemaine} fiches par semaine et par ETH (${nombreFr((parametres.parSemaine * 52) / 12, 1)} par mois)`)),
    secteurs.map(({ secteur, parEth, total }) => h('div', { class: 'secteur-charge' },
      ligneCharge(`${secteur} · ${parEth.length} ETH`, total, 'total'),
      parEth.map(({ eth, c }) => ligneCharge(eth, c, 'eth')))),
    secteurs.some(({ parEth }) => parEth.some(({ c }) => c.parMois > c.capacite)) ? h('div', { class: 'alerte-mn1' }, ic('alerte', 14), 'Un ETH a plus de fiches que ses opérateurs ne peuvent en tirer : espacer certains contrôles, ou en discuter avec le responsable de production.') : null,
    tout.tropFrequentes ? h('div', { class: 'alerte-mn1' }, ic('alerte', 14), `${tout.tropFrequentes} fiche${tout.tropFrequentes > 1 ? 's' : ''} quotidienne${tout.tropFrequentes > 1 ? 's' : ''} : ${TROP_FREQUENT}`) : null,
    tout.aPreciser ? h('div', { class: 'discret', style: { fontSize: '13px' } }, `${tout.aPreciser} fiche${tout.aPreciser > 1 ? 's' : ''} sans fréquence préconisée : à préciser (crayon).`) : null)
}
