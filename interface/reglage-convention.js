// Administration › Lignes : « Comment reconnaître les préventifs ». Le code en tête du titre des visites (« P2M-… »)
// dit le niveau (1re lettre), la ligne (2e) et le type (3e). Le niveau et les types se règlent une fois pour le site
// (cet encadré) ; la lettre de chaque ligne se règle dans sa carte. Un préventif sans code reconnu ne compte pas dans
// le plan de maintenance de PREVTEC. Tout est gardé dans le fichier de connaissances (blocs/mn1/visites.js).

import { h, vider, ic, essayer, notifier, nombreFr } from '/socle/ui.js'
import { api } from '/socle/api.js'

// apres : redessiner l'écran des lignes (le compte des préventifs reconnus change).
export function encadreConvention(apercu, apres) {
  const c = apercu.convention
  const lignesNiveau = Object.entries(c.niveaux).map(([lettre, niveau]) => ({ lettre, niveau }))
  if (!lignesNiveau.length) lignesNiveau.push({ lettre: '', niveau: 1 }, { lettre: '', niveau: 2 })
  const lignesType = Object.entries(c.types).map(([lettre, t]) => ({ lettre, nom: t.nom, jamaisEspacer: t.jamaisEspacer }))
  if (!lignesType.length) lignesType.push({ lettre: '', nom: '', jamaisEspacer: false })
  const corpsNiveaux = h('tbody')
  const corpsTypes = h('tbody')
  const lettre = (objet) => h('input', { type: 'text', value: objet.lettre, maxlength: 1, class: 'lettre-code', placeholder: '?', oninput: (e) => (objet.lettre = e.target.value.toUpperCase()) })
  const dessinerNiveaux = () => vider(corpsNiveaux, lignesNiveau.map((x) => h('tr', {},
    h('td', {}, lettre(x)),
    h('td', {}, h('select', { class: 'fin', onchange: (e) => (x.niveau = Number(e.target.value)) }, [[1, 'Niveau 1 — fait par la production'], [2, 'Niveau 2 — fait par la maintenance']].map(([v, t]) => h('option', { value: v, selected: x.niveau === v }, t)))))))
  const dessinerTypes = () => vider(corpsTypes, lignesType.map((x) => h('tr', {},
    h('td', {}, lettre(x)),
    h('td', {}, h('input', { type: 'text', value: x.nom, maxlength: 40, placeholder: 'ex. Sécurité / réglementaire', oninput: (e) => (x.nom = e.target.value) })),
    h('td', {}, h('label', { class: 'coche-convention', title: 'PREVTEC ne proposera jamais d’espacer une visite de ce type (sécurité, réglementaire…)' }, h('input', { type: 'checkbox', checked: x.jamaisEspacer, onchange: (e) => (x.jamaisEspacer = e.target.checked) }), 'jamais espacer')),
    h('td', {}, h('button', { class: 'discret icone-seule petit', title: 'Retirer', onclick: () => { lignesType.splice(lignesType.indexOf(x), 1); dessinerTypes() } }, ic('x', 13))))))
  dessinerNiveaux()
  dessinerTypes()
  const enregistrer = async () => {
    const niveaux = Object.fromEntries(lignesNiveau.filter((x) => x.lettre).map((x) => [x.lettre, x.niveau]))
    const types = Object.fromEntries(lignesType.filter((x) => x.lettre).map((x) => [x.lettre, { nom: x.nom.trim(), jamaisEspacer: x.jamaisEspacer }]))
    if (await essayer(() => api('/api/mn1/convention', { methode: 'POST', corps: { niveaux, types } }), 'Convention enregistrée')) apres()
  }
  const total = apercu.parcs.reduce((s, p) => s + p.total, 0)
  const reconnus = apercu.parcs.reduce((s, p) => s + p.reconnus, 0)
  return h('div', { class: 'carte carte-convention' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('cle', 18), 'Comment reconnaître les préventifs'),
      apercu.reglee ? h('span', { class: 'discret' }, `${nombreFr(reconnus)} préventifs reconnus sur ${nombreFr(total)} (12 mois)`) : h('span', { class: 'etiquette orange' }, 'pas encore réglé : tout le préventif compte')),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Le titre des visites commence par un code de 3 caractères et un tiret, par exemple « P2M-Contrôle des courroies… » : la 1re lettre dit le niveau, la 2e la ligne (réglée dans la carte de chaque ligne, ci-dessous), la 3e le type. Un préventif sans code reconnu ne compte pas dans le plan de maintenance.'),
    h('div', { class: 'grille grille-2', style: { gap: '16px' } },
      h('div', {}, h('h3', { class: 'titre-convention' }, '1re lettre : le niveau'),
        h('table', { class: 'tableau tableau-convention' }, corpsNiveaux),
        h('button', { class: 'petit discret', onclick: () => { lignesNiveau.push({ lettre: '', niveau: 2 }); dessinerNiveaux() } }, ic('plus', 13), 'Une lettre')),
      h('div', {}, h('h3', { class: 'titre-convention' }, '3e lettre : le type'),
        h('table', { class: 'tableau tableau-convention' }, corpsTypes),
        h('button', { class: 'petit discret', onclick: () => { lignesType.push({ lettre: '', nom: '', jamaisEspacer: false }); dessinerTypes() } }, ic('plus', 13), 'Un type'))),
    apercu.reglee && apercu.exemples.length ? h('details', { class: 'exemples-convention' }, h('summary', {}, 'Exemples de titres non reconnus'), h('ul', {}, apercu.exemples.map((x) => h('li', { class: 'mono petit-texte' }, x)))) : null,
    h('div', { class: 'actions', style: { marginTop: '12px' } }, h('button', { class: 'principal', onclick: enregistrer }, 'Enregistrer')))
}

// La ligne « Code des préventifs » de la carte d'une ligne : sa lettre, et ce qu'elle reconnaît.
export function lettreDeLaLigne(parc, apercu, apres) {
  const a = apercu.parcs.find((p) => p.id === parc.id)
  const champ = h('input', { type: 'text', value: a?.lettres || '', maxlength: 4, class: 'lettre-code', placeholder: '?', title: 'La 2e lettre du code des visites de cette ligne (une ou plusieurs)' })
  champ.addEventListener('change', async () => {
    if (await essayer(() => api('/api/mn1/convention/lettre', { methode: 'POST', corps: { parc: parc.id, lettres: champ.value } }))) {
      notifier('Lettre de la ligne enregistrée')
      apres()
    }
  })
  const doublon = a?.lettres && apercu.parcs.some((p) => p.id !== parc.id && p.lettres && [...a.lettres].some((l) => p.lettres.includes(l)))
  return h('div', { class: 'code-ligne' },
    h('span', { class: 'titre-code-ligne' }, 'Code des préventifs'),
    h('span', { class: 'discret' }, 'lettre de ligne'), champ,
    a && apercu.reglee ? h('span', { class: 'discret petit-texte' }, `${nombreFr(a.reconnus)} / ${nombreFr(a.total)} préventifs reconnus${a.autreLigne ? `, dont ${nombreFr(a.autreLigne)} codés pour une autre ligne` : ''}`) : null,
    doublon ? h('span', { class: 'etiquette orange' }, 'lettre déjà prise par une autre ligne') : null)
}
