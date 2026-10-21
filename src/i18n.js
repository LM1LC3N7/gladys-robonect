// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature and state names, the status of
// the integration, the answers of the button and the command errors. None of
// them ever carries the user name or the password of the module.
// -----------------------------------------------------------------------------

import { FEATURES, MODE, STATUS } from './constants.js';

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** "45 s", "5 min", "2 h", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const FEATURE_NAMES = {
  [FEATURES.STATE]: both('Mower state', 'État de la tondeuse'),
  [FEATURES.DOCK]: both('Return to the base', 'Retour à la base'),
  [FEATURES.STATUS]: both('Status', 'Statut'),
  [FEATURES.STATUS_CODE]: both('Status code', 'Code de statut'),
  [FEATURES.MODE]: both('Mode', 'Mode'),
  [FEATURES.STOPPED]: both('Stopped (paused)', 'Arrêtée (pause)'),
  [FEATURES.BATTERY]: both('Battery', 'Batterie'),
  [FEATURES.CHARGING]: both('Charging', 'En charge'),
  [FEATURES.ERROR]: both('Error in progress', 'Erreur en cours'),
  [FEATURES.ERROR_CODE]: both('Error code', "Code d'erreur"),
  [FEATURES.ERROR_TEXT]: both('Error', 'Erreur'),
  [FEATURES.STATUS_DURATION]: both('Time in this status', 'Durée dans ce statut'),
  [FEATURES.MOWING_HOURS]: both('Mowing hours', 'Heures de tonte'),
  [FEATURES.DISTANCE]: both('Distance from the base', 'Distance de la base'),
  [FEATURES.BLADES]: both('Blade quality', 'Qualité des lames'),
  [FEATURES.WIFI]: both('Wi-Fi signal (dBm)', 'Signal Wi-Fi (dBm)'),
  [FEATURES.TEMPERATURE]: both('Temperature inside the mower', 'Température dans la tondeuse'),
  [FEATURES.HUMIDITY]: both('Humidity inside the mower', 'Humidité dans la tondeuse'),
  [FEATURES.NEXT_START]: both('Next start of the timer', 'Prochain départ du minuteur'),
  [FEATURES.CONNECTED]: both('Module reachable', 'Module joignable'),
  [FEATURES.START]: both('Start (lift the stop)', "Démarrer (lever l'arrêt)"),
  [FEATURES.PAUSE]: both('Pause (stop where it is)', 'Pause (arrêt sur place)'),
  [FEATURES.HOME]: both('Back to the base', 'Retour à la base'),
};

export const STATUS_NAMES = {
  [STATUS.DETECTING]: both('Detecting its status', 'Détection du statut'),
  [STATUS.PARKED]: both('Parked', 'Garée'),
  [STATUS.MOWING]: both('Mowing', 'Tond'),
  [STATUS.SEARCHING_BASE]: both('Looking for its base', 'Cherche sa base'),
  [STATUS.CHARGING]: both('Charging', 'En charge'),
  [STATUS.SEARCHING]: both('Searching', 'En recherche'),
  [STATUS.ERROR]: both('Error', 'Erreur'),
  [STATUS.LOOP_LOST]: both('Loop signal lost', 'Signal du câble perdu'),
  [STATUS.OFF]: both('Switched off', 'Éteinte'),
  [STATUS.SLEEPING]: both('Sleeping', 'En veille'),
  [STATUS.GARAGE_DOOR]: both('Waiting for the garage door', 'Attend la porte du garage'),
  [STATUS.OFFLINE_NO_BIND]: both(
    'Offline (module not bound to the mower)',
    'Hors ligne (module sans liaison avec la tondeuse)',
  ),
  [STATUS.UNKNOWN]: both('Unknown', 'Inconnu'),
};
export const UNKNOWN_STATUS = both('Unknown status', 'Statut inconnu');
export const OFFLINE = both('Module unreachable', 'Module injoignable');
export const PAUSED_SUFFIX = both('stopped', 'arrêtée');
export const NONE = both('None', 'Aucune');
export const NO_TIMER = both('No timer start planned', 'Aucun départ planifié');

export const MODE_NAMES = {
  [MODE.AUTO]: both('Auto (timer)', 'Auto (minuteur)'),
  [MODE.MANUAL]: both('Manual', 'Manuel'),
  [MODE.HOME]: both('Home (stays at the base)', 'Maison (reste à la base)'),
  [MODE.DEMO]: both('Demo', 'Démo'),
  [MODE.END_OF_DAY]: both('End of day', 'Fin de journée'),
  [MODE.JOB]: both('Mowing job', 'Tâche de tonte'),
};
export const UNKNOWN_MODE = both('Unknown mode', 'Mode inconnu');

/** The integration status, the button and the logs a user may read. */
export const T = {
  https: both(
    'HTTPS is not supported in this version: enter the address without https:// (the password then travels in clear on the local network), then save.',
    "HTTPS n'est pas pris en charge dans cette version : saisissez l'adresse sans https:// (le mot de passe passe alors en clair sur le réseau local), puis enregistrez.",
  ),
  noHost: both(
    'Enter the IP address of the Robonect module of your mower, its user name and password, then save.',
    "Saisissez l'adresse IP du module Robonect de votre tondeuse, son nom d'utilisateur et son mot de passe, puis enregistrez.",
  ),
  invalidHost: (typed) =>
    both(
      `"${typed}" is not an IP address nor a host name.`,
      `« ${typed} » n'est ni une adresse IP ni un nom d'hôte.`,
    ),
  hostCredentials: both(
    'The address holds a user name or a password (an "@"): enter the IP address (or host name) of the module only, then save.',
    "L'adresse contient un nom d'utilisateur ou un mot de passe (un « @ ») : saisissez seulement l'adresse IP (ou le nom d'hôte) du module, puis enregistrez.",
  ),
  authMissing: both(
    'Enter both the user name and the password of the module (or neither, if it has no login), then save.',
    "Saisissez à la fois le nom d'utilisateur et le mot de passe du module (ou aucun des deux s'il n'a pas de connexion), puis enregistrez.",
  ),
  badSecret: both(
    'The user name or the password holds characters that are not accepted (plain ASCII only, no ":" in the user name).',
    "Le nom d'utilisateur ou le mot de passe contient des caractères refusés (ASCII simple seulement, pas de « : » dans le nom d'utilisateur).",
  ),
  connecting: both('Reading the mower…', 'Lecture de la tondeuse…'),
  waiting: (wait) =>
    both(
      `Waiting for the next read (in ${wait.en}): the module is never read more often than the interval.`,
      `En attente de la prochaine lecture (dans ${wait.fr}) : le module n'est jamais lu plus souvent que l'intervalle.`,
    ),
  connected: (summary) => both(`Connected. ${summary.en}`, `Connecté. ${summary.fr}`),
  unreachable: (host, wait) =>
    both(
      `No answer from ${host} (next try in ${wait.en}). Check the address and that the module is on the Wi-Fi (it may be out of range in the garden).`,
      `Pas de réponse de ${host} (nouvel essai dans ${wait.fr}). Vérifiez l'adresse et que le module est sur le Wi-Fi (il peut être hors de portée dans le jardin).`,
    ),
  failing: (reason, wait) =>
    both(
      `The module answers with an error (${reason}): next try in ${wait.en}.`,
      `Le module répond par une erreur (${reason}) : nouvel essai dans ${wait.fr}.`,
    ),
  rateLimited: (wait) =>
    both(
      `The module asks to slow down (HTTP 429): pause of ${wait.en}.`,
      `Le module demande de ralentir (HTTP 429) : pause de ${wait.fr}.`,
    ),
  serverError: (wait) =>
    both(
      `The module answered with a server error (HTTP 5xx): pause of ${wait.en}.`,
      `Le module a répondu par une erreur serveur (HTTP 5xx) : pause de ${wait.fr}.`,
    ),
  refused: (wait) =>
    both(
      `The module refused the user name or the password: check them, then save. Next try in ${wait.en} (never sooner).`,
      `Le module a refusé le nom d'utilisateur ou le mot de passe : vérifiez-les, puis enregistrez. Nouvel essai dans ${wait.fr} (jamais plus tôt).`,
    ),
  noId: both(
    'The module answered without a valid id: the mower cannot be added.',
    'Le module a répondu sans identifiant valable : la tondeuse ne peut pas être ajoutée.',
  ),
  otherMower: (names) =>
    both(
      `Not read any more: ${names} (another module answers at this address, or it was removed).`,
      `Plus lue : ${names} (un autre module répond à cette adresse, ou elle a été retirée).`,
    ),
  lastRead: (ago) => both(`Last read ${ago.en} ago.`, `Dernière lecture il y a ${ago.fr}.`),
  noIdHelp: both(
    'If the mower never shows up, open an issue on the GitHub repository with the anonymized answer of http://<module>/json?cmd=status.',
    "Si la tondeuse n'apparaît jamais, ouvrez un ticket sur le dépôt GitHub avec la réponse anonymisée de http://<module>/json?cmd=status.",
  ),
};

/** The errors a command answers to Gladys. */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  startDisabled: both(
    'Starting is disabled: turn on "Allow the start from Gladys" in the configuration of the integration. "Pause" and "Back to the base" stay available.',
    "Le démarrage est désactivé : activez « Autoriser le démarrage depuis Gladys » dans la configuration de l'intégration. « Pause » et « Retour à la base » restent disponibles.",
  ),
  unknownMower: both(
    'This mower is not read by the integration (address changed, another module, or not answering).',
    "Cette tondeuse n'est pas lue par l'intégration (adresse changée, autre module, ou sans réponse).",
  ),
  otherModule: both(
    'Another Robonect module answers at this address: command not sent.',
    'Un autre module Robonect répond à cette adresse : commande non envoyée.',
  ),
  badButton: both('A button only accepts the value 1.', "Un bouton n'accepte que la valeur 1."),
  notReadYet: both(
    'The mower has not been read since the integration started: only "Pause" and "Back to the base" are accepted until the first read. Not sent.',
    "La tondeuse n'a pas encore été lue depuis le démarrage de l'intégration : seuls « Pause » et « Retour à la base » sont acceptés avant la première lecture. Non envoyée.",
  ),
  paused: (wait) =>
    both(
      `The module asked to slow down: the start is paused for ${wait.en} ("Pause" and "Back to the base" stay available). Not sent.`,
      `Le module a demandé de ralentir : le démarrage est en pause pendant ${wait.fr} (« Pause » et « Retour à la base » restent disponibles). Non envoyée.`,
    ),
  serverPaused: (wait) =>
    both(
      `The module answered with a server error: the start is paused for ${wait.en} ("Pause" and "Back to the base" stay available). Not sent.`,
      `Le module a répondu par une erreur serveur : le démarrage est en pause pendant ${wait.fr} (« Pause » et « Retour à la base » restent disponibles). Non envoyée.`,
    ),
  blocked: both(
    'The module refused the user name or the password: the start is not sent ("Pause" and "Back to the base" are still tried).',
    "Le module a refusé le nom d'utilisateur ou le mot de passe : le démarrage n'est pas envoyé (« Pause » et « Retour à la base » sont quand même essayés).",
  ),
  stillRunning: both(
    'Another start of this mower is still running: not sent.',
    'Un autre démarrage de cette tondeuse est encore en cours : non envoyé.',
  ),
  protectMeanwhile: both(
    'A pause or a return to the base arrived meanwhile: the start is not sent.',
    "Une pause ou un retour à la base est arrivé entre-temps : le démarrage n'est pas envoyé.",
  ),
  tooSlow: both(
    'The module answered too slowly to send the start in time: not sent.',
    'Le module a répondu trop lentement pour envoyer le démarrage à temps : non envoyé.',
  ),
  unknownState: (reason) =>
    both(
      `The state of the mower could not be read just before (${reason}): start not sent.`,
      `L'état de la tondeuse n'a pas pu être relu juste avant (${reason}) : démarrage non envoyé.`,
    ),
  missing: both(
    'The module did not give the state the start needs (status, stop flag, battery): not sent.',
    "Le module n'a pas donné l'état dont le démarrage a besoin (statut, arrêt, batterie) : non envoyé.",
  ),
  notStopped: (mode) =>
    both(
      `The mower is not stopped: nothing to lift (mode ${mode.en}; it follows that mode). Nothing sent.`,
      `La tondeuse n'est pas arrêtée : rien à lever (mode ${mode.fr} ; elle suit ce mode). Rien n'est envoyé.`,
    ),
  cannotStart: (status) =>
    both(
      `The mower reports "${status.en}": the start is not sent.`,
      `La tondeuse signale « ${status.fr} » : le démarrage n'est pas envoyé.`,
    ),
  notSent: (reason) =>
    both(
      `The module could not be reached (${reason}): command not sent.`,
      `Le module n'a pas pu être joint (${reason}) : commande non envoyée.`,
    ),
  refused: (reason) =>
    both(
      `The module refused the command (${reason}).`,
      `Le module a refusé la commande (${reason}).`,
    ),
  sentUnconfirmed: (reason) =>
    both(
      `Command sent, without confirmation (${reason}): check the state of the mower in a few seconds.`,
      `Commande envoyée, sans confirmation (${reason}) : vérifiez l'état de la tondeuse dans quelques secondes.`,
    ),
};

/** The text of the status: "Mowing", "Mowing (stopped)". */
export function statusText(mower) {
  const name = STATUS_NAMES[mower.code] ?? UNKNOWN_STATUS;
  return mower.stopped === true && mower.code !== STATUS.PARKED
    ? both(`${name.en} (${PAUSED_SUFFIX.en})`, `${name.fr} (${PAUSED_SUFFIX.fr})`)
    : name;
}

/** The one-line summary: "Robonect Robi: Charging, battery 85 %, mode Auto (timer)." */
export function summaryOf(mower) {
  const status = statusText(mower);
  const mode = MODE_NAMES[mower.mode];
  const en = [status.en];
  const fr = [status.fr];
  if (mower.battery !== undefined) {
    en.push(`battery ${mower.battery} %`);
    fr.push(`batterie ${mower.battery} %`);
  }
  if (mode) {
    en.push(`mode ${mode.en}`);
    fr.push(`mode ${mode.fr}`);
  }
  const name = mower.name ?? 'Robonect';
  return both(`${name}: ${en.join(', ')}.`, `${name} : ${fr.join(', ')}.`);
}
