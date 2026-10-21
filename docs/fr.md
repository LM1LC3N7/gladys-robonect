# Robonect pour Gladys

Cette intégration affiche dans Gladys une **tondeuse robot équipée d'un module
Robonect** (Husqvarna Automower, Gardena, Flymo, McCulloch), par l'API JSON
locale du module, sans cloud. **Jamais testé avec un vrai appareil.** Sans
lien avec Robonect, Husqvarna, Gardena ni Flymo.

> **Ce n'est pas l'intégration gladys-automower.** gladys-automower passe par
> le cloud Husqvarna (compte Husqvarna, robots Automower connectés). Celle-ci
> parle directement au module Robonect, une carte ajoutée dans la tondeuse,
> sur votre réseau local. Si votre tondeuse n'a pas de module Robonect, elle
> ne vous servira pas.

## Ce que vous obtenez

Une tondeuse dans l'onglet Découverte, avec :

- **État de la tondeuse** (carte « aspirateur robot » de Gladys : tond, en
  pause, retourne à la base, en charge, à la base, erreur, arrêtée) et un
  bouton **Retour à la base** sur cette carte ;
- **Statut** en texte (« Tond », « En charge », « Tond (arrêtée) »…), code de
  statut, **mode** (Auto, Manuel, Maison, Fin de journée…), arrêtée (pause) ;
- **batterie**, en charge ;
- **erreur en cours**, code et texte de l'erreur ;
- durée dans le statut, **heures de tonte**, distance de la base, qualité des
  lames, signal Wi-Fi (dBm), température et humidité dans la tondeuse,
  prochain départ du minuteur, module joignable ;
- trois boutons : **Pause** (arrêt sur place), **Retour à la base** et
  **Démarrer** (lever l'arrêt).

## Configuration

1. Donnez au module Robonect une **adresse IP fixe** dans votre box.
2. Dans Gladys, ouvrez l'intégration Robonect et saisissez l'adresse IP du
   module, son **nom d'utilisateur** et son **mot de passe** (ceux de son
   interface web). Laissez les deux vides seulement si le module n'a pas de
   connexion.
3. Enregistrez, puis ajoutez la tondeuse depuis l'onglet **Découverte**.

Le mot de passe est gardé par Gladys dans sa base, jamais réaffiché, envoyé
seulement au module. Il passe **en clair** (authentification HTTP Basic, en
HTTP) sur votre réseau local : c'est ainsi que le module fonctionne. Il n'est
jamais écrit dans les journaux ni dans `/data`.

Le module est lu toutes les 60 s (réglable de 30 s à 1 h), **jamais plus
souvent**, même après un redémarrage de l'intégration, une reconnexion à
Gladys, le bouton « Tester la connexion » ou un scan de la Découverte. Seule
la commande `status`, qui ne réveille pas un module en veille, est envoyée
pour ces lectures.

## Les commandes

- **Pause** (arrêt sur place, la commande `stop` de Robonect) et **Retour à
  la base** (mode « Maison ») sont **toujours disponibles** : jamais
  bloquées par l'option, par un démarrage en cours, par une pause de
  l'intégration (HTTP 429 ou 5xx) ni par des identifiants refusés, et
  possibles juste après un redémarrage, avant la première lecture. Elles
  annulent un démarrage pas encore parti.
- **Démarrer** est **désactivé par défaut**. Activez « Autoriser le démarrage
  depuis Gladys » pour l'utiliser. Il lève l'arrêt de la tondeuse, qui tond
  alors **selon son mode** (en Auto : selon son minuteur ; en Maison : elle
  reste à la base). Avant de partir, l'intégration relit l'état de la
  tondeuse et refuse si le module ne répond pas assez vite, si une valeur
  manque, si un autre module répond à cette adresse, si la tondeuse n'est pas
  arrêtée (rien à lever : réponse en échec, rien n'est envoyé), ou si son
  statut n'est pas l'un de ceux-ci : garée, tond (arrêtée), cherche sa base,
  en charge, en recherche, en veille, attend la porte du garage. Tout autre
  statut (erreur, éteinte, hors ligne, inconnu…) refuse. **Vérifiez que personne, enfant ou animal, n'est
  sur la pelouse.**
- Aucune commande n'est un interrupteur : un « tout allumer / tout éteindre »
  (assistants vocaux, scènes) ne peut pas démarrer la tondeuse.
- Si le module ne répond pas à temps, la réponse est « Commande envoyée, sans
  confirmation » : vérifiez l'état quelques secondes plus tard. Une pause
  envoyée alors qu'un démarrage pouvait encore arriver est renvoyée si la
  tondeuse repart (deux fois au plus, dans les deux minutes).
- Retour à la base change le mode ; si la tondeuse était en pause (arrêtée),
  il est possible qu'elle reste sur place tant que l'arrêt n'est pas levé :
  comportement à vérifier sur un vrai module.

## En cas de problème

- « Pas de réponse » : vérifiez l'adresse, et que le module est sur le Wi-Fi
  (il peut être hors de portée au fond du jardin). Nouveaux essais espacés de
  1 à 15 minutes.
- « Identifiants refusés » : corrigez le nom d'utilisateur ou le mot de passe
  et enregistrez. Sinon, nouvel essai après 15 min, 1 h, puis toutes les 6 h,
  même après un redémarrage.
- **La tondeuse n'apparaît pas dans la Découverte** (« sans identifiant
  valable ») : l'intégration identifie le module par le champ `id` de sa
  réponse `status` (les « : » et « - » sont retirés, par exemple pour une
  adresse MAC), sinon par le numéro de série de `cmd=version` (réessayé
  après 15 min, 1 h, puis toutes les 6 h s'il est illisible, ou par le
  bouton « Tester la connexion »).
  Si cela ne suffit pas, ouvrez un ticket sur le dépôt GitHub avec la réponse
  anonymisée de `http://<module>/json?cmd=status`.
- `https://` dans l'adresse est refusé : cette version parle seulement HTTP
  (le mot de passe passe en clair sur le réseau local), saisissez l'adresse
  sans `https://`.
- « Plus lue » : un autre module répond à cette adresse (adresse IP
  réattribuée), ou la tondeuse a été retirée.

## Limites

- Une seule tondeuse par intégration ; HTTP seulement (pas de HTTPS).
- Pas de minuteurs, de choix du mode, de GPS ni de MQTT dans cette version.
- Jamais testé avec un vrai appareil : les champs viennent de la bibliothèque
  aiorobonect et de l'intégration Robonect de Home Assistant.
