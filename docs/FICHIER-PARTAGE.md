# Le fichier partagé `.datassitec`

Chaque agent a sa propre installation d'IASSITEC (dans son profil) ; toutes ouvrent le même fichier sur le
lecteur réseau. Code : `serveur/socle/partage.js`.

## Lecture

- On ne lit jamais directement le fichier du réseau : il est copié dans `cache/base.datassitec`
  (copie dans un fichier temporaire puis renommage, pour ne jamais ouvrir une copie incomplète).
- Toutes les 10 secondes, on compare la taille et la date du fichier partagé à celles de la dernière copie ;
  s'il a changé, on recopie et l'interface se recharge.
- Réseau coupé : on garde la dernière copie, en consultation, avec un avertissement.

## Écriture : le verrou

- Passer en mode administrateur crée `atelier.datassitec.verrou` à côté du fichier, en création
  **exclusive** (si deux postes essaient au même instant, un seul réussit). Il contient le nom de l'agent,
  le poste, l'heure, un jeton et l'heure du dernier signe de vie.
- Le poste qui a le verrou le rafraîchit toutes les minutes. Un verrou non rafraîchi depuis 10 minutes
  est considéré comme abandonné. Un agent peut aussi « reprendre la main » de force ; l'ancien poste
  s'en aperçoit à son rafraîchissement suivant et repasse en consultation.
- Un verrou laissé par la même installation (IASSITEC fermé brutalement) est repris sans question.
- Après 30 minutes sans modification, le mode administrateur se ferme tout seul.

## Écriture : la publication

- Les modifications sont faites dans la copie locale (ouverte en écriture seulement en mode administrateur).
- 3 secondes après la dernière modification (30 secondes au plus pendant un long calcul), la copie est
  envoyée sur le partage sous un nom temporaire (`atelier.datassitec.envoi-<poste>`), puis renommée
  d'un coup à la place du fichier. Sous Windows, si un autre poste est justement en train de le copier,
  on réessaie quelques fois.
- En cas d'échec (réseau), nouvel essai toutes les 30 secondes ; l'interface l'affiche.

## Sauvegardes

À chaque prise du verrou (une fois par heure au plus) : copie dans `IASSITEC-sauvegardes/`, à côté du
fichier ; les 5 dernières sont gardées.

## Limite

Quand le fichier change, chaque poste recopie le fichier entier. C'est instantané jusqu'à quelques
centaines de Mo ; avec des Go de documents, la mise à jour des postes devient plus lente.
