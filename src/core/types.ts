/**
 * CONTRAT du domaine « L'addition ».
 *
 * Tout module de `src/core/` est PUR : aucun import `@forge/*`, aucune I/O,
 * aucune horloge implicite (le « maintenant » est toujours un paramètre).
 * C'est ce qui rend la méthode testable et stable (exigence §18 « Stabilité »).
 *
 * Unités : le jour-personne (j-p). Par défaut 7 h par jour, 5 jours par
 * semaine (§9). Toutes les durées stockées sont des dates ISO 8601 UTC.
 */

/** Familles de coût du §9. C5 est un délai, jamais de l'effort. */
export type Family = 'C1' | 'C2' | 'C3' | 'C4' | 'C5';

/** Toutes les familles qui entrent dans l'addition (C5 en est exclue). */
export const BILLED_FAMILIES: readonly Family[] = ['C1', 'C2', 'C3', 'C4'];

/** Mode de rattachement d'un ticket à une zone (§8). */
export type ZoneMode = 'component' | 'compass' | 'service' | 'label';

/** Comment un ticket devient un « ticket de dette » (DT-01). */
export type DebtRuleKind = 'issueType' | 'label' | 'jql';

/** Catégories de statut Jira, normalisées. */
export type StatusCategory = 'todo' | 'inprogress' | 'done';

/** Classe de taille d'un ticket, utilisée pour la référence de la famille C3. */
export type SizeClass = 'xs' | 's' | 'm' | 'l' | 'xl' | 'unknown';

/** Base d'une attribution (§10). */
export type AttributionBasis = 'link' | 'confirmed' | 'inferred';

/** D'où vient le coût d'une preuve : temps saisi, ou calculé par la formule. */
export type CostMethod = 'logged' | 'computed' | 'approximated';

export interface DebtRule {
  kind: DebtRuleKind;
  /** Identifiant du type de ticket, nom d'étiquette, ou requête JQL. */
  value: string;
}

/** Réglages d'un projet (écran 6, table `settings`). */
export interface ProjectSettings {
  projectId: string;
  projectKey: string;
  debtRule: DebtRule;
  zoneMode: ZoneMode;
  /** Étiquette utilisée quand `zoneMode === 'label'`. */
  zoneLabelField?: string;
  hoursPerDay: number;
  daysPerWeek: number;
  /** Fenêtre d'analyse, 90 jours par défaut. */
  windowDays: number;
  /** Seuil de la dette morte, 180 jours par défaut. */
  deadDays: number;
  /** Coefficient d'occupation de la famille C3, 0,5 par défaut. */
  occupationCoefficient: number;
  /** Facteur de persistance du retour, 0,7 par défaut. */
  persistenceFactor: number;
  /** Nombre minimal de tickets de référence pour que C3 soit calculable. */
  minBaselineSample: number;
  /** Centile de rabotage des valeurs extrêmes. */
  clipPercentile: number;
  /** Plafond d'intervenants comptés sur un incident (C1). */
  maxIncidentPeople: number;
  /** Bonus d'un post-mortem lié, en j-p. */
  postMortemBonusJp: number;
  /** Seuil de pertinence en dessous duquel aucun rapprochement n'est proposé. */
  relevanceFloor: number;
  /** Seuil de coût d'une zone sans ticket de dette (dette fantôme). */
  phantomThresholdJp: number;
  /** Projets JSM dont les incidents alimentent les preuves. */
  jsmProjectKeys: string[];
  /** Correspondance zone → équipe, quand le graphe ne la donne pas. */
  teamByZone: Record<string, string>;
  /** Taux journalier en euros (DT-20, lot C). */
  dayRateEur?: number;
  /** Champ Jira portant les story points, vide si le projet n'estime pas en points. */
  storyPointField?: string;
  /** Vrai quand le jeu d'exemple est injecté (bandeau permanent). */
  demoData: boolean;
}

/** Un ticket, réduit à ce dont le calcul a besoin (table `issue_fact`). */
export interface IssueFact {
  issueId: string;
  key: string;
  projectId: string;
  projectKey: string;
  type: string;
  /** Bug au sens Jira (famille C2). */
  isBug: boolean;
  /** Incident JSM (famille C1). */
  isIncident: boolean;
  /** Ticket de dette désigné par la règle du projet. */
  isDebt: boolean;
  /** Zones du ticket, déjà résolues (§8) ; vide = « non classé ». */
  zones: string[];
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  size: SizeClass;
  /** Estimation du ticket convertie en j-p, si elle existe. */
  estimateJp: number | null;
  /** Temps saisi sur le ticket, en secondes. */
  loggedSeconds: number | null;
  labels: string[];
  components: string[];
  /** Services affectés d'un incident JSM. */
  affectedServices: string[];
  /** Un post-mortem est lié à l'incident. */
  hasPostMortem: boolean;
  /** Nombre d'intervenants distincts (assignés + commentateurs). */
  participants: number;
  /** Story points, si le projet estime en points (§11 : conversion par vélocité). */
  storyPoints?: number | null;
  /** Vrai quand l'historique a été tronqué par la pagination bornée (C41). */
  historyTruncated?: boolean;
  /** Le lecteur a le droit d'ouvrir ce ticket (vie privée §18). */
  visible: boolean;
  summary: string;
  description?: string;
}

/** Un lien Jira entre deux tickets, réduit au nécessaire. */
export interface IssueLink {
  fromIssueId: string;
  toIssueId: string;
  toKey: string;
  /** Type de lien Jira (« blocks », « relates to », « caused by »…). */
  type: string;
}

/** Un séjour d'un ticket dans une catégorie de statut (table `status_span`). */
export interface StatusSpan {
  issueId: string;
  category: StatusCategory;
  startedAt: string;
  endedAt: string | null;
}

/** Détail d'une preuve, affiché au clic (exigence de transparence §18). */
export interface EvidenceDetail {
  /** Durée retenue, en jours ouvrés. */
  durationDays: number;
  /** Méthode retenue pour ce coût. */
  method: CostMethod;
  /** Texte de la formule, avec ses valeurs, affiché tel quel. */
  formula: string;
  /** Valeurs d'entrée de la formule (intervenants, référence, centile…). */
  inputs: Record<string, number | string | boolean | null>;
  /** Nom lisible de la famille. */
  familyLabel: string;
  /** Titre du ticket source, si le lecteur peut l'ouvrir. */
  sourceSummary?: string;
}

/** Une preuve : un fait daté qui a coûté du temps sur une zone (§4). */
export interface Evidence {
  id: string;
  zone: string;
  family: Family;
  sourceIssueId: string;
  sourceKey: string;
  occurredAt: string;
  /** Coût en j-p. Pour C5 c'est un délai en jours, jamais dans l'addition. */
  costJp: number;
  method: CostMethod;
  /** C3 avec moins de références que le minimum : pas de chiffre. */
  insufficient?: boolean;
  visible: boolean;
  detail: EvidenceDetail;
}

/** Part d'une preuve imputée à un ticket de dette (§10). */
export interface Attribution {
  evidenceId: string;
  debtIssueId: string;
  /** Part de 0 à 1 ; la somme par preuve ne dépasse jamais 1. */
  share: number;
  basis: AttributionBasis;
  /** Score de pertinence 0-1 ; 1 pour un lien ou une confirmation. */
  relevance: number;
  /** Justification en une phrase, affichée à l'utilisateur. */
  rationale: string;
}

/** Rejet d'un rapprochement : la preuve n'est plus proposée (§7.4). */
export interface Rejection {
  evidenceId: string;
  debtIssueId: string;
  rejectedBy: string;
  at: string;
}

/** Score de pertinence rendu par le modèle, mis en cache (§18). */
export interface RelevanceScore {
  evidenceId: string;
  debtIssueId: string;
  relevance: number;
  rationale: string;
  /** Empreinte des textes comparés : sert de clé de cache. */
  fingerprint: string;
}

/** Ventilation d'une famille dans une addition. */
export interface FamilyTotal {
  lowJp: number;
  highJp: number;
  evidenceCount: number;
  /** Vrai quand la famille ne peut pas être chiffrée (C3 sans référence). */
  insufficient: boolean;
}

/** L'addition d'un ticket de dette (DT-06, table `debt_bill`). */
export interface DebtBill {
  debtIssueId: string;
  key: string;
  computedAt: string;
  lowJp: number;
  highJp: number;
  byFamily: Record<Family, FamilyTotal>;
  /** Preuves rattachées, triées par coût décroissant. */
  evidenceIds: string[];
  /** Nombre de preuves comptées mais masquées pour ce lecteur. */
  hiddenCount: number;
  /** Remboursement estimé en j-p, null si non chiffré. */
  repaymentJp: number | null;
  /** Coût évitable sur deux trimestres, null si pas d'addition basse. */
  avoidableJp: number | null;
  roiLow: number | null;
  roiHigh: number | null;
  paybackDays: number | null;
  /**
   * Motif d'absence d'addition, quand il y en a un (§19 cas 2 : une dette sans
   * zone n'a pas d'addition, elle demande un rattachement).
   */
  blockedReason?: 'no-zone' | null;
}

/** Ligne de classement (DT-07). */
export interface RankedDebt {
  debtIssueId: string;
  key: string;
  summary: string;
  zone: string;
  lowJp: number;
  highJp: number;
  repaymentJp: number | null;
  roiLow: number | null;
  roiHigh: number | null;
  paybackDays: number | null;
}

/** Coût d'une zone (table `zone_week` agrégée). */
export interface ZoneCost {
  zone: string;
  projectKey: string;
  totalJp: number;
  byFamily: Record<Family, number>;
  /** Coût par semaine ISO, du plus ancien au plus récent. */
  weeklyJp: number[];
  /** Part du coût portée par des tickets sans zone. */
  unclassifiedShare: number;
  team?: string;
  /** Familles non chiffrables pour cette zone (§9 C3 : moins de 5 références). */
  insufficientByFamily?: Partial<Record<Family, boolean>>;
}

/** Zone coûteuse sans aucun ticket de dette (DT-08). */
export interface PhantomDebt {
  zone: string;
  totalJp: number;
  byFamily: Record<Family, number>;
  /** Les preuves qui justifient le brouillon, les plus coûteuses d'abord. */
  topEvidenceIds: string[];
}

/** Ticket de dette sans preuve depuis N jours (DT-09). */
export interface DeadDebt {
  debtIssueId: string;
  key: string;
  summary: string;
  zone: string;
  daysWithoutEvidence: number;
  lastEvidenceAt: string | null;
}

/** Référence de la famille C3 (table `baseline`). */
export interface Baseline {
  issueType: string;
  sizeClass: SizeClass;
  medianDays: number;
  sampleSize: number;
  computedAt: string;
}

/** Bulletin de remboursement (§11, table `repayment`). */
export interface Repayment {
  debtIssueId: string;
  key: string;
  zone: string;
  closedAt: string;
  /** Coût hebdomadaire moyen de la zone avant le travail, en j-p. */
  beforeRate: number;
  /** Coût hebdomadaire moyen après la clôture, en j-p. */
  afterRate: number;
  /** Semaines observées de part et d'autre. */
  weeksBefore: number;
  weeksAfter: number;
  /** Limites affichées avec le bulletin : jamais une preuve de causalité. */
  caveats: string[];
  publishedAt: string | null;
}

/** Qualité des données, affichée dans l'onglet Méthode (§14). */
export interface DataQuality {
  issuesTotal: number;
  issuesWithoutZone: number;
  unclassifiedShare: number;
  /** Familles déclarées « données insuffisantes », par zone. */
  insufficientFamilies: Array<{ zone: string; family: Family }>;
  /** Part des coûts venant d'un temps saisi plutôt que d'un calcul. */
  loggedShare: number;
  /** Tickets dont l'historique de statuts manque. */
  approximatedIssues: number;
  /** Part de chaque méthode de calcul, en pourcentage (§19 cas 7). */
  methodShares?: { logged: number; computed: number; approximated: number };
  /** Au moins un ticket a son historique de statuts tronqué (C41) : durées sur base partielle. */
  historyTruncated?: boolean;
  /** Le budget de score s'est arrêté avant la fin des couples (C44) : pertinences manquantes. */
  scoresTruncated?: boolean;
}

/** État de l'initialisation (DT-12), pour la barre de progression. */
export interface BootstrapProgress {
  projectId: string;
  total: number;
  done: number;
  failed: number;
  startedAt: string;
  updatedAt: string;
  finished: boolean;
  /** Motif du dernier échec, null tant que tout va (item B26 : pas de rejeu muet). */
  error?: string | null;
  /** Nombre de rejeux du lot courant, pour borner la file (item B26). */
  attempts?: number;
}

/** Contexte de calcul : tout ce qu'une famille reçoit, jamais d'I/O. */
export interface CostContext {
  settings: ProjectSettings;
  /** Instant de référence du calcul (injecté, jamais `Date.now()` implicite). */
  now: string;
  /** Baselines par `type:sizeClass`. */
  baselines: Map<string, Baseline>;
  /** Durées par statut, indexées par identifiant de ticket. */
  spansByIssue: Map<string, StatusSpan[]>;
  /** Vélocité de l'équipe en points/semaine ; null si non mesurable (§11). */
  velocityPointsPerWeek?: number | null;
}
