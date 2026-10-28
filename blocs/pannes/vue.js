// Les pannes connues : pour chaque machine d'une ligne, les pannes qui reviennent, avec leurs causes et
// remèdes tirés des rapports d'intervention. L'administrateur lance l'analyse d'une ligne, relit et corrige
// les fiches ; une fiche relue est gardée quand on relance l'analyse.

import { h, vider, ic, essayer, confirmer, fenetre, notifier, dateFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { peutModifier, etat } from '/socle/etat.js'
import { menuDeroulant } from '../../interface/menu-deroulant.js'

let ligneChoisie = ''
let suivi = null // minuterie du suivi de l'analyse en cours

export default {
  chemin: 'pannes',
  titre: 'Pannes connues',
  icone: 'historique',
  menu: true,
  aide: 'assistant',

  async afficher(zone, { query }) {
    const [lignes, etatAnalyse] = await Promise.all([api('/api/pannes/lignes'), api('/api/pannes/analyse')])
    if (!ligneChoisie && !query.id) ligneChoisie = lignes[0]?.ligne || ''
    const donnees = await api(`/api/pannes?${query.id ? `id=${encodeURIComponent(query.id)}` : `ligne=${encodeURIComponent(ligneChoisie)}`}`)
    ligneChoisie = donnees.ligne

    const recherche = h('input', { type: 'search', placeholder: 'Filtrer : symptôme, cause, machine…' })
    const liste = h('div', { class: 'liste-pannes' })
    const dessinerListe = () => vider(liste, listePannes(donnees.fiches, recherche.value, query.id))
    recherche.addEventListener('input', dessinerListe)

    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Pannes connues'), h('p', { class: 'sous-titre' }, 'Les pannes qui reviennent, tirées des rapports d’intervention : symptôme, causes, remèdes')),
        h('div', { class: 'actions' },
          lignes.length > 1 ? menuDeroulant({ choix: lignes.map((l) => ({ valeur: l.ligne, libelle: l.ligne, nombre: l.nombre })), valeur: ligneChoisie, surChoix: (v) => { ligneChoisie = v; location.hash = '#/pannes' ; window.ktec.recharger() } }) : null,
          recherche)),
      !etat.partage?.autreAdmin ? carteAnalyse(etatAnalyse) : null, // une analyse se lance aussi en consultation
      donnees.fiches.length ? null : h('div', { class: 'carte vide' }, ic('historique', 32), lignes.length ? 'Aucune fiche sur cette ligne.' : 'Pas encore de pannes connues : un administrateur lance l’analyse d’une ligne ci-dessus.'),
      liste,
    )
    dessinerListe()
    if (query.id) setTimeout(() => liste.querySelector('.fiche-panne.visee')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
  },
}

// ---------------------------------------------------------------- analyse d'une ligne

function carteAnalyse(etatAnalyse) {
  const corps = h('div', { class: 'corps-analyse' })
  const carte = h('div', { class: 'carte carte-analyse' }, h('div', { class: 'carte-entete' }, h('h2', {}, ic('etincelle', 18), 'Analyser une ligne')), corps)

  async function dessiner(e) {
    clearTimeout(suivi)
    if (e.enCours) {
      const part = e.total ? Math.round((100 * e.fait) / e.total) : 0
      vider(corps,
        h('p', { class: 'texte-2' }, `${e.ligne} : ${e.total ? `${e.fait} / ${e.total} pannes résumées par l’IA` : 'regroupement des rapports…'}`),
        h('div', { class: 'barre-progression' }, h('div', { style: { width: `${part}%` } })),
        h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Pendant l’analyse, l’assistant répond plus lentement (l’IA est partagée).'),
        h('div', { class: 'actions' }, h('button', { class: 'discret', onclick: async () => dessiner(await api('/api/pannes/analyse/arreter', { methode: 'POST' })) }, ic('stop', 16), 'Arrêter')))
      suivi = setTimeout(async () => {
        if (!carte.isConnected) return
        const suite = await api('/api/pannes/analyse').catch(() => null)
        if (suite && !suite.enCours) { notifier(suite.erreur ? `Analyse impossible : ${suite.erreur}` : `${suite.fiches} pannes connues pour ${suite.ligne}`, suite.erreur ? 'erreur' : 'info'); ligneChoisie = suite.ligne; return window.ktec.recharger() }
        if (suite) dessiner(suite)
      }, 2000)
      return
    }
    const arbre = await api('/api/arborescence').catch(() => null)
    if (!arbre?.lignes?.length) return vider(corps, h('p', { class: 'texte-2' }, 'Pas d’arborescence : réglez sa requête dans PDRTEC › Paramètres et connectez-vous à la base de la GMAO.'))
    let choix = arbre.lignes.find((l) => l.libelle === ligneChoisie)?.id || arbre.lignes[0].id
    vider(corps,
      h('p', { class: 'texte-2' }, 'AITEC regroupe, machine par machine, les rapports qui décrivent le même symptôme (3 fois au moins), puis l’IA en tire les causes et les remèdes. Les fiches relues sont gardées ; les autres sont refaites.'),
      h('div', { class: 'actions' },
        menuDeroulant({ choix: arbre.lignes.map((l) => ({ valeur: l.id, libelle: l.libelle, nombre: l.machines.length })), valeur: choix, surChoix: (v) => (choix = v) }),
        h('button', { class: 'principal', onclick: async () => { const e = await essayer(() => api('/api/pannes/analyse', { methode: 'POST', corps: { ligne: choix } })); if (e) dessiner(e) } }, ic('etincelle', 16), 'Analyser')))
  }
  dessiner(etatAnalyse)
  return carte
}

// ---------------------------------------------------------------- liste

function listePannes(fiches, filtre, viseeId) {
  const mots = filtre.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const garder = (f) => !mots.length || mots.every((m) => [f.repere, f.designation, f.symptome, ...f.causes.flatMap((c) => [c.cause, c.remede])].join(' ').toLowerCase().includes(m))
  const visibles = fiches.filter(garder)
  if (!visibles.length && fiches.length) return h('p', { class: 'discret' }, 'Aucune panne ne correspond au filtre.')

  // Sous-ensemble › machine › fiches
  const parEnsemble = new Map()
  for (const f of visibles) {
    const ensemble = parEnsemble.get(f.ensemble) || parEnsemble.set(f.ensemble, new Map()).get(f.ensemble)
    ;(ensemble.get(f.machine_id) || ensemble.set(f.machine_id, []).get(f.machine_id)).push(f)
  }
  return [...parEnsemble].map(([ensemble, machines]) => h('section', { class: 'ensemble-pannes' },
    h('h2', {}, ensemble || 'Sans sous-ensemble', h('span', { class: 'discret' }, ` · ${[...machines.values()].flat().length} pannes`)),
    [...machines.values()].map((liste) => h('div', { class: 'carte machine-pannes' },
      h('div', { class: 'titre-machine-pannes' }, h('a', { href: `#/parc/${liste[0].machine_id}` }, h('b', { class: 'mono' }, liste[0].repere)), liste[0].designation ? h('span', { class: 'texte-2' }, ` — ${liste[0].designation}`) : null),
      liste.map((f) => fichePanne(f, String(f.id) === String(viseeId)))))))
}

function fichePanne(f, visee) {
  const rapports = h('div', { class: 'rapports-panne', hidden: true })
  const voirRapports = async () => {
    if (!rapports.hidden) return (rapports.hidden = true)
    const liste = await essayer(() => api(`/api/pannes/${f.id}/rapports`))
    if (!liste) return
    vider(rapports, liste.map((r) => h('a', { href: `#/interventions/${r.id}` }, h('b', {}, dateFr(r.date)), ` · ${r.numero || ''} · `, h('span', { class: 'intervenant' }, r.intervenant || '?'), h('span', { class: 'texte-3' }, ` — ${r.description}`))))
    rapports.hidden = false
  }
  return h('div', { class: `fiche-panne${visee ? ' visee' : ''}` },
    h('div', { class: 'symptome-panne' },
      h('div', { class: 'texte-symptome' }, f.symptome, f.validee ? h('span', { class: 'etiquette violet', title: 'Relue par un administrateur : gardée quand on relance l’analyse' }, ic('coche', 12), 'relue') : null),
      h('div', { class: 'meta-panne' }, `${f.nombre} cas · ${f.premiere === f.derniere ? `le ${dateFr(f.derniere)}` : `du ${dateFr(f.premiere)} au ${dateFr(f.derniere)}`}`),
      f.intervenants ? h('div', { class: 'meta-panne' }, ic('personne', 12), f.intervenants) : null,
      h('div', { class: 'actions-panne' },
        h('button', { class: 'discret petit', onclick: voirRapports }, ic('document', 14), 'Rapports'),
        peutModifier() ? h('button', { class: 'discret petit icone-seule', title: 'Corriger la fiche', onclick: () => corrigerFiche(f) }, ic('crayon', 14)) : null,
        peutModifier() ? h('button', { class: 'discret petit icone-seule', title: 'Supprimer la fiche', onclick: async () => { if (await confirmer('Supprimer cette fiche de panne ?', { danger: true, texte: 'Supprimer' }) && await essayer(() => api(`/api/pannes/${f.id}`, { methode: 'DELETE' }))) window.ktec.recharger() } }, ic('poubelle', 14)) : null)),
    h('div', { class: 'causes-panne' },
      f.causes.map((c) => h('div', { class: 'cause-panne' },
        h('div', {}, h('span', { class: 'libelle-panne' }, 'Cause'), c.cause),
        h('div', {}, h('span', { class: 'libelle-panne' }, 'Remède'), c.remede),
        h('div', { class: 'cas-panne' }, `${c.cas} cas`)))),
    rapports)
}

// Corriger une fiche : le symptôme, puis une cause par ligne « cause | remède | nombre de cas ».
async function corrigerFiche(f) {
  const symptome = h('input', { type: 'text', value: f.symptome })
  const causes = h('textarea', { rows: 5, class: 'mono' }, f.causes.map((c) => `${c.cause} | ${c.remede} | ${c.cas}`).join('\n'))
  const relue = h('input', { type: 'checkbox', checked: true })
  const enregistree = await fenetre({
    titre: `Panne connue — ${f.repere}`,
    large: true,
    contenu: h('div', {},
      h('label', { class: 'champ' }, h('span', {}, 'Symptôme'), symptome),
      h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, 'Causes : une par ligne, « cause | remède | nombre de cas »'), causes),
      h('label', { class: 'case-relue' }, relue, h('span', {}, 'Fiche relue (gardée telle quelle quand on relance l’analyse)'))),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      {
        texte: 'Enregistrer',
        classe: 'principal',
        action: async () => {
          const lignes = causes.value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((l) => l[0] || l[1])
          await api(`/api/pannes/${f.id}`, { methode: 'POST', corps: { symptome: symptome.value, causes: lignes.map(([cause, remede, cas]) => ({ cause, remede, cas: Number(cas) || 1 })), validee: relue.checked } })
          return true
        },
      },
    ],
  })
  if (enregistree) {
    notifier('Fiche enregistrée')
    window.ktec.recharger()
  }
}
