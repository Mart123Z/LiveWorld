// Vocabulaires et constantes partagés (doivent rester alignés avec templates/INSTRUCTIONS_CLAUDE.md)
export const SCHEMA = 'liveworld.batch/v1';
export const BACKUP_SCHEMA = 'liveworld.backup/v1';

export const THEMES = [
  ['conflits-securite', 'Conflits & sécurité'],
  ['diplomatie', 'Diplomatie & géopolitique'],
  ['politique-interieure', 'Politique intérieure & élections'],
  ['banques-centrales', 'Banques centrales & taux'],
  ['macroeconomie', 'Macroéconomie & inflation'],
  ['marches', 'Marchés financiers'],
  ['energie', 'Énergie'],
  ['matieres-premieres', 'Matières premières & agriculture'],
  ['logistique-commerce', 'Logistique, commerce & sanctions'],
  ['tech-semis', 'Technologie & semi-conducteurs'],
  ['cyber', 'Cybersécurité'],
  ['catastrophes-climat', 'Catastrophes & climat'],
  ['sante', 'Santé'],
  ['social', 'Mouvements sociaux & société'],
];
export const THEME_LABEL = Object.fromEntries(THEMES);

export const SEV = { critical: 'Critique', high: 'Élevé', moderate: 'Modéré' };
export const SEV_RANK = { critical: 3, high: 2, moderate: 1 };
export const SEV_COLOR = { critical: '#ff3b2f', high: '#ff8a1f', moderate: '#2ec5d3' };
export const STATUS = { active: 'En cours', monitoring: 'Sous surveillance', resolved: 'Terminé' };
export const DIR = { bullish: ['Haussier', 'up'], bearish: ['Baissier', 'down'], volatile: ['Volatilité accrue', 'vol'] };
export const HORIZON = { days: 'jours', weeks: 'semaines', months: 'mois' };
export const CONF = { low: 'faible', medium: 'moyenne', high: 'forte' };

// Types de liens orientés from → to
export const LINK_TYPES = {
  causes: { label: 'cause', fwd: 'est une cause de', back: 'est causé par', causal: true },
  escalates: { label: 'escalade', fwd: 's’aggrave en', back: 'est l’aggravation de', causal: true },
  responds_to: { label: 'réaction', fwd: 'réagit à', back: 'suscite la réaction', causal: true },
  follows: { label: 'suite', fwd: 'fait suite à', back: 'a pour suite', causal: true },
  relates_to: { label: 'lié', fwd: 'est lié à', back: 'est lié à', causal: false },
};

export const ASSETS = [
  { k: 'SPX', n: 'S&P 500', dp: 0 },
  { k: 'CAC40', n: 'CAC 40', dp: 0 },
  { k: 'XAU', n: 'Or (XAU)', dp: 0 },
  { k: 'BRENT', n: 'Brent', dp: 2 },
  { k: 'EURUSD', n: 'EUR/USD', dp: 4 },
  { k: 'BTC', n: 'Bitcoin', dp: 0 },
  { k: 'US10Y', n: 'US 10 ans', dp: 2, bp: true, unit: ' %' },
];

// Places boursières : heures locales en minutes depuis minuit
export const EXCHANGES = [
  { n: 'NYSE / Nasdaq', tz: 'America/New_York', pre: [240, 570], s: [[570, 960]],
    hol: ['2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'],
    half: { '2026-11-27': 780, '2026-12-24': 780, '2027-11-26': 780 } },
  { n: 'Euronext Paris', tz: 'Europe/Paris', pre: [435, 540], s: [[540, 1050]],
    hol: ['2026-12-25', '2027-01-01', '2027-03-26', '2027-03-29', '2027-12-24', '2027-12-31'],
    half: { '2026-12-24': 845, '2026-12-31': 845 } },
  { n: 'LSE Londres', tz: 'Europe/London', pre: [470, 480], s: [[480, 990]],
    hol: ['2026-12-25', '2026-12-28', '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28'],
    half: { '2026-12-24': 750, '2026-12-31': 750 } },
  { n: 'TSE Tokyo', tz: 'Asia/Tokyo', pre: [480, 540], s: [[540, 690], [750, 930]],
    hol: ['2026-11-23', '2026-12-31', '2027-01-01', '2027-01-04', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05'], half: {} },
  { n: 'HKEX Hong Kong', tz: 'Asia/Hong_Kong', pre: [540, 570], s: [[570, 720], [780, 960]],
    hol: ['2026-12-25', '2027-01-01', '2027-02-08', '2027-02-09', '2027-02-10', '2027-03-26', '2027-03-29', '2027-04-05'],
    half: { '2026-12-24': 720, '2026-12-31': 720 } },
];

export const WINDOWS = [[1, '1 j'], [7, '7 j'], [30, '30 j'], [90, '90 j'], ['all', 'Tout']];

// Veille automatique : la tâche planifiée Claude dépose ses lots dans un dépôt GitHub PRIVÉ.
// Le site les lit via l'API GitHub avec un jeton en lecture seule, enregistré par l'Admin (Réglages → Veille automatique)
// dans Firestore (config/github), lisible uniquement par les comptes connectés.
export const INBOX = {
  owner: 'Mart123Z',
  repo: 'LiveWorld-data',
  branch: 'claude/liveworld-inbox',
  path: 'inbox/',
  schedule: 'chaque jour vers 6 h 30 (heure de Paris)',
  routinesUrl: 'https://claude.ai/code/routines',
};
