/**
 * DDL de la couche Forge SQL (§16).
 *
 * Contraintes de la plateforme (§17) :
 * - Forge SQL ne supporte pas les clés étrangères : les liens entre tables sont
 *   portés par des colonnes `*_id` et des index, jamais par un `FOREIGN KEY`.
 * - Une seule instruction par requête : `SCHEMA_STATEMENTS` est donc un tableau
 *   d'instructions complètes, sans point-virgule, exécutées une par une par
 *   `ensureSchema()`.
 * - `CREATE TABLE IF NOT EXISTS` rend l'initialisation rejouable : un second
 *   passage ne casse rien, et `ensureSchema()` tolère malgré tout l'erreur
 *   « table déjà là ».
 *
 * Les colonnes de filtre utilisées par les écrans (projet, zone, ticket de
 * dette, semaine) sont indexées. Les dates sont des `DATETIME(3)` en UTC ; les
 * structures variables (listes, ventilations, détails de preuve) sont du JSON.
 */

/** Les onze tables du §16, dans l'ordre de création. */
export const TABLE_NAMES = [
  'issue_fact',
  'status_span',
  'evidence',
  'attribution',
  'rejection',
  'debt_bill',
  'zone_week',
  'baseline',
  'repayment',
  'settings',
  'bootstrap_progress',
] as const;

/** Nom d'une table du schéma. */
export type TableName = (typeof TABLE_NAMES)[number];

/** Options communes à toutes les tables : InnoDB, UTF-8, comparaison binaire. */
const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

/** DDL complet, une instruction par entrée (§17). */
export const SCHEMA_STATEMENTS: string[] = [
  // Les faits d'un ticket : tout ce que le calcul consomme, rien de plus.
  `CREATE TABLE IF NOT EXISTS issue_fact (
    issue_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    project_key VARCHAR(64) NOT NULL,
    issue_key VARCHAR(64) NOT NULL,
    issue_type VARCHAR(128) NOT NULL,
    is_bug TINYINT(1) NOT NULL DEFAULT 0,
    is_incident TINYINT(1) NOT NULL DEFAULT 0,
    is_debt TINYINT(1) NOT NULL DEFAULT 0,
    zones JSON NULL,
    created_at DATETIME(3) NOT NULL,
    resolved_at DATETIME(3) NULL,
    closed_at DATETIME(3) NULL,
    size VARCHAR(16) NOT NULL DEFAULT 'unknown',
    estimate_jp DOUBLE NULL,
    logged_seconds BIGINT NULL,
    labels JSON NULL,
    components JSON NULL,
    affected_services JSON NULL,
    has_post_mortem TINYINT(1) NOT NULL DEFAULT 0,
    participants INT NOT NULL DEFAULT 0,
    visible TINYINT(1) NOT NULL DEFAULT 1,
    summary VARCHAR(512) NOT NULL DEFAULT '',
    description MEDIUMTEXT NULL,
    PRIMARY KEY (issue_id),
    KEY idx_issue_fact_project (project_id, is_debt),
    KEY idx_issue_fact_created (project_id, created_at),
    KEY idx_issue_fact_key (issue_key)
  ) ${TABLE_OPTIONS}`,

  // Séjours d'un ticket dans une catégorie de statut (DT-03).
  `CREATE TABLE IF NOT EXISTS status_span (
    issue_id VARCHAR(64) NOT NULL,
    category VARCHAR(16) NOT NULL,
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    PRIMARY KEY (issue_id, started_at),
    KEY idx_status_span_category (issue_id, category)
  ) ${TABLE_OPTIONS}`,

  // Une preuve : un fait daté qui a coûté du temps sur une zone (§4).
  `CREATE TABLE IF NOT EXISTS evidence (
    evidence_id VARCHAR(128) NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    zone VARCHAR(255) NOT NULL,
    family VARCHAR(8) NOT NULL,
    source_issue_id VARCHAR(64) NOT NULL,
    source_key VARCHAR(64) NOT NULL,
    occurred_at DATETIME(3) NOT NULL,
    cost_jp DOUBLE NOT NULL DEFAULT 0,
    method VARCHAR(16) NOT NULL DEFAULT 'computed',
    insufficient TINYINT(1) NOT NULL DEFAULT 0,
    visible TINYINT(1) NOT NULL DEFAULT 1,
    detail JSON NULL,
    PRIMARY KEY (evidence_id),
    KEY idx_evidence_project_zone (project_id, zone),
    KEY idx_evidence_project_occurred (project_id, occurred_at),
    KEY idx_evidence_source (project_id, source_issue_id)
  ) ${TABLE_OPTIONS}`,

  // Part d'une preuve imputée à un ticket de dette (§10).
  `CREATE TABLE IF NOT EXISTS attribution (
    evidence_id VARCHAR(128) NOT NULL,
    debt_issue_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    share DOUBLE NOT NULL DEFAULT 0,
    basis VARCHAR(16) NOT NULL DEFAULT 'inferred',
    relevance DOUBLE NOT NULL DEFAULT 0,
    rationale VARCHAR(1024) NOT NULL DEFAULT '',
    PRIMARY KEY (evidence_id, debt_issue_id),
    KEY idx_attribution_debt (debt_issue_id),
    KEY idx_attribution_project (project_id)
  ) ${TABLE_OPTIONS}`,

  // Rejet d'un rapprochement : la preuve n'est plus proposée (§7.4).
  `CREATE TABLE IF NOT EXISTS rejection (
    evidence_id VARCHAR(128) NOT NULL,
    debt_issue_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    rejected_by VARCHAR(128) NOT NULL,
    rejected_at DATETIME(3) NOT NULL,
    PRIMARY KEY (evidence_id, debt_issue_id),
    KEY idx_rejection_debt (debt_issue_id),
    KEY idx_rejection_project (project_id)
  ) ${TABLE_OPTIONS}`,

  // L'addition d'un ticket de dette (DT-06), recalculée puis remplacée.
  `CREATE TABLE IF NOT EXISTS debt_bill (
    debt_issue_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    issue_key VARCHAR(64) NOT NULL,
    computed_at DATETIME(3) NOT NULL,
    low_jp DOUBLE NOT NULL DEFAULT 0,
    high_jp DOUBLE NOT NULL DEFAULT 0,
    by_family JSON NULL,
    evidence_ids JSON NULL,
    hidden_count INT NOT NULL DEFAULT 0,
    repayment_jp DOUBLE NULL,
    avoidable_jp DOUBLE NULL,
    roi_low DOUBLE NULL,
    roi_high DOUBLE NULL,
    payback_days DOUBLE NULL,
    PRIMARY KEY (debt_issue_id),
    KEY idx_debt_bill_project (project_id, low_jp)
  ) ${TABLE_OPTIONS}`,

  // Coût d'une zone pour une semaine ISO : la brique des courbes et du brouillon.
  `CREATE TABLE IF NOT EXISTS zone_week (
    project_id VARCHAR(64) NOT NULL,
    zone VARCHAR(255) NOT NULL,
    week VARCHAR(10) NOT NULL,
    cost_jp DOUBLE NOT NULL DEFAULT 0,
    by_family JSON NULL,
    team VARCHAR(255) NULL,
    PRIMARY KEY (project_id, zone, week),
    KEY idx_zone_week_project_week (project_id, week)
  ) ${TABLE_OPTIONS}`,

  // Référence de la famille C3 : médiane par type et classe de taille.
  `CREATE TABLE IF NOT EXISTS baseline (
    project_id VARCHAR(64) NOT NULL,
    issue_type VARCHAR(128) NOT NULL,
    size_class VARCHAR(16) NOT NULL,
    median_days DOUBLE NOT NULL DEFAULT 0,
    sample_size INT NOT NULL DEFAULT 0,
    computed_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_id, issue_type, size_class)
  ) ${TABLE_OPTIONS}`,

  // Bulletin de remboursement avant/après (§11).
  `CREATE TABLE IF NOT EXISTS repayment (
    debt_issue_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    issue_key VARCHAR(64) NOT NULL,
    zone VARCHAR(255) NOT NULL,
    closed_at DATETIME(3) NOT NULL,
    before_rate DOUBLE NOT NULL DEFAULT 0,
    after_rate DOUBLE NOT NULL DEFAULT 0,
    weeks_before INT NOT NULL DEFAULT 0,
    weeks_after INT NOT NULL DEFAULT 0,
    caveats JSON NULL,
    published_at DATETIME(3) NULL,
    PRIMARY KEY (debt_issue_id),
    KEY idx_repayment_project_zone (project_id, zone)
  ) ${TABLE_OPTIONS}`,

  // Réglages d'un projet (écran 6) : une ligne par projet.
  `CREATE TABLE IF NOT EXISTS settings (
    project_id VARCHAR(64) NOT NULL,
    project_key VARCHAR(64) NOT NULL,
    debt_rule JSON NULL,
    zone_mode VARCHAR(16) NOT NULL DEFAULT 'component',
    zone_label_field VARCHAR(128) NULL,
    hours_per_day DOUBLE NOT NULL DEFAULT 7,
    days_per_week INT NOT NULL DEFAULT 5,
    window_days INT NOT NULL DEFAULT 90,
    dead_days INT NOT NULL DEFAULT 180,
    occupation_coefficient DOUBLE NOT NULL DEFAULT 0.5,
    persistence_factor DOUBLE NOT NULL DEFAULT 0.7,
    min_baseline_sample INT NOT NULL DEFAULT 5,
    clip_percentile DOUBLE NOT NULL DEFAULT 95,
    max_incident_people INT NOT NULL DEFAULT 6,
    post_mortem_bonus_jp DOUBLE NOT NULL DEFAULT 0.5,
    relevance_floor DOUBLE NOT NULL DEFAULT 0.3,
    phantom_threshold_jp DOUBLE NOT NULL DEFAULT 10,
    jsm_project_keys JSON NULL,
    team_by_zone JSON NULL,
    day_rate_eur DOUBLE NULL,
    demo_data TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id)
  ) ${TABLE_OPTIONS}`,

  // Progression de l'initialisation (DT-12), lue par la barre de progression.
  `CREATE TABLE IF NOT EXISTS bootstrap_progress (
    project_id VARCHAR(64) NOT NULL,
    total INT NOT NULL DEFAULT 0,
    done INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    started_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    finished TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id)
  ) ${TABLE_OPTIONS}`,
];
