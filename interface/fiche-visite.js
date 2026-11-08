// La fiche de visite : pour une visite trop générale (« visite générale de… »), ce sur quoi le mainteneur s'appuie.
// L'historique des pannes de ce qu'elle couvre, les points à regarder à cocher, et la place pour le compte rendu.
// Une feuille A4, recto-verso quand l'historique est long. Calcul : ficheDeVisite (blocs/mn1/demonstrateur.js).

import { h, ic, essayer, dateFr } from '/socle/ui.js'
import { api } from '/socle/api.js'

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`

const TENDANCE = { monte: 'en hausse', baisse: 'en baisse', nouvelle: 'nouvelle', stable: 'stable' }
const sensDe = (ev) => TENDANCE[ev] || ''

function pageDeLaFiche(f) {
  const v = f.visite
  const b = f.bilan
  const lieu = v.machineEntiere ? `${v.repere} ${v.designation} (machine entière)` : `${v.repere} ${v.designation}, sur ${f.machine.repere}`
  const synthese = [
    `<b>${pluriel(b.pannes, 'panne')}</b> sur les 12 derniers mois (${b.precedent} les 12 mois d'avant)`,
    b.heures !== null ? `<b>${b.heures} h</b> de dépannage sur ces 12 mois` : '',
    `<b>${pluriel(b.depuisVisite, 'panne')}</b> depuis la dernière visite, le ${dateFr(v.derniere)}`,
  ].filter(Boolean).map((x) => `<li>${x}</li>`).join('')
  const ou = f.ou.length ? `<p class="ou"><b>Où :</b> ${f.ou.map((o) => `${esc(o.repere)}${o.designation ? ` ${esc(o.designation)}` : ''} (${o.pannes})`).join(' · ')}</p>` : ''
  const case_ = '<td class="c"><i></i></td>'
  const points = f.points.length ? `<h2>Les points à regarder</h2>
    <p class="aide">Les pannes qui reviennent, de la plus fréquente à la moins fréquente, 12 derniers mois.</p>
    <table><thead><tr><th>Organe</th><th>Panne</th><th class="n">Nb</th><th>Tendance</th><th>Dernière réparation</th><th class="c">RAS</th><th class="c">À suivre</th><th class="c">À reprendre</th></tr></thead><tbody>
    ${f.points.map((p) => `<tr><td class="m">${esc(p.repere)}</td><td><b>${esc(p.symptome)}</b></td><td class="n">${p.nombre}</td><td>${sensDe(p.evolution)}</td><td>${dateFr(p.derniere)} : ${esc(p.reparation)}</td>${case_}${case_}${case_}</tr>`).join('')}
    </tbody></table>` : '<h2>Les points à regarder</h2><p class="aide">Aucune panne qui revient sur ce que couvre cette visite (3 rapports semblables au moins) : appuyez-vous sur les dernières pannes.</p>'
  const dernieres = f.dernieres.length ? `<h2>Les dernières pannes</h2>
    <table><thead><tr><th>Date</th><th>Organe</th><th>Panne</th><th>Ce qui a été fait</th><th class="n">Durée</th></tr></thead><tbody>
    ${f.dernieres.map((d) => `<tr class="${d.apresVisite ? 'apres' : ''}"><td class="m">${dateFr(d.date)}</td><td class="m">${esc(d.repere)}</td><td>${esc(d.symptome)}</td><td>${esc(d.reparation)}</td><td class="n">${d.duree === null ? '' : `${String(d.duree).replace('.', ',')} h`}</td></tr>`).join('')}
    </tbody></table>${f.dernieres.some((d) => d.apresVisite) ? '<p class="aide">En gras : les pannes survenues depuis la dernière visite.</p>' : ''}` : '<h2>Les dernières pannes</h2><p class="aide">Aucune panne sur les 12 derniers mois.</p>'
  const remarques = f.remarques.length ? `<h2>Déjà remarqué sur place</h2>
    <table><tbody>${f.remarques.map((r) => `<tr><td class="m">${dateFr(r.date)}</td><td class="m">${esc(r.repere)}</td><td class="m">${r.origine}</td><td>${esc(r.texte)}</td></tr>`).join('')}</tbody></table>` : ''
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiche de visite</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e9ecea; color: #111; font: 9.5pt system-ui, sans-serif; }
  .feuille { width: 190mm; margin: 6mm auto; padding: 8mm; background: #fff; }
  h1 { font-size: 15pt; margin: 0 0 1mm; }
  h2 { font-size: 11pt; margin: 5mm 0 1.5mm; border-bottom: .4mm solid #111; padding-bottom: .8mm; break-after: avoid; }
  .lieu { margin: 0; font-weight: 600; }
  .entete { display: flex; justify-content: space-between; gap: 6mm; }
  .remplir { flex: none; align-self: flex-start; width: 58mm; border: .3mm solid #111; padding: 2mm; line-height: 7mm; }
  ul { margin: 2mm 0 0; padding-left: 5mm; }
  .ou { margin: 2mm 0 0; }
  .aide { margin: 1mm 0; font-size: 8pt; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th { text-align: left; font-size: 7.5pt; border-bottom: .3mm solid #111; padding: 1mm; }
  td { border-bottom: .15mm solid #aaa; padding: 1mm; vertical-align: top; }
  tr { break-inside: avoid; }
  .m { white-space: nowrap; }
  .n { text-align: right; white-space: nowrap; }
  .c { text-align: center; width: 11mm; }
  .c i { display: inline-block; width: 4mm; height: 4mm; border: .3mm solid #111; }
  tr.apres td { font-weight: 700; }
  .compte-rendu { height: 34mm; border: .3mm solid #111; break-inside: avoid; }
  .pied { font-size: 7pt; color: #777; text-align: right; margin-top: 2mm; }
  @media print { body { background: #fff; } .feuille { width: auto; margin: 0; padding: 0; } }
</style></head><body><div class="feuille">
  <div class="entete"><div>
    <h1>${v.code ? `${esc(v.code)} · ` : ''}${esc(v.titre)}</h1>
    <p class="lieu">${esc(f.parc)} · ${esc(lieu)}</p>
    <ul>${synthese}</ul>${ou}
  </div><div class="remplir">Visite du :<br>Par :</div></div>
  ${points}${dernieres}${remarques}
  <h2>Compte rendu de la visite</h2><div class="compte-rendu"></div>
  <p class="pied">Fiche tirée de la GMAO le ${dateFr(new Date().toISOString().slice(0, 10))}</p>
</div></body></html>`
}

// L'aperçu par-dessus la page, comme les fiches de niveau 1 ; « Imprimer » imprime la feuille seule.
export async function ouvrirFicheVisite(base, g) {
  const f = await essayer(() => api(`${base}/visite?equipement=${g.pose}&titre=${encodeURIComponent(g.titre)}${g.dapresTitre ? `&organe=${g.equipement}` : ''}`))
  if (!f) return
  const cadre = h('iframe', { class: 'cadre-fiche', title: 'Fiche de visite', srcdoc: pageDeLaFiche(f) })
  const fermer = () => { voile.remove(); document.removeEventListener('keydown', surEchap) }
  const surEchap = (ev) => ev.key === 'Escape' && fermer()
  const voile = h('div', { class: 'apercu-fiche', onmousedown: (ev) => ev.target === voile && fermer() },
    h('div', { class: 'outils-fiche' },
      h('span', {}, ic('document', 16), `Fiche de visite — ${pluriel(f.bilan.pannes, 'panne')} sur 12 mois`),
      h('button', { class: 'principal', onclick: () => cadre.contentWindow?.print() }, ic('document', 15), 'Imprimer'),
      h('button', { class: 'discret icone-seule', title: 'Fermer (Échap)', onclick: fermer }, ic('x', 16))),
    cadre)
  document.body.append(voile)
  document.addEventListener('keydown', surEchap)
}
