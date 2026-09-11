CREATE UNIQUE INDEX validation_sessions_evidence_identity_idx
ON validation_sessions(project_id, id, evidence_digest);

CREATE TABLE validation_reviews (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  evidence_digest TEXT NOT NULL CHECK (length(evidence_digest) = 64),
  state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING', 'APPROVED', 'NEEDS_CHANGE', 'REJECTED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, session_id),
  FOREIGN KEY(project_id, session_id, evidence_digest)
    REFERENCES validation_sessions(project_id, id, evidence_digest) ON DELETE CASCADE
);

CREATE TRIGGER validation_reviews_evidence_immutable
BEFORE UPDATE OF project_id, session_id, evidence_digest, created_at ON validation_reviews
BEGIN
  SELECT RAISE(ABORT, 'Validation Review evidence binding is immutable');
END;

CREATE TABLE validation_review_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  evidence_digest TEXT NOT NULL CHECK (length(evidence_digest) = 64),
  expected_review_revision INTEGER NOT NULL CHECK (expected_review_revision >= 1),
  resulting_review_revision INTEGER NOT NULL CHECK (resulting_review_revision >= 2),
  reviewer_session_id TEXT NOT NULL CHECK (length(reviewer_session_id) BETWEEN 1 AND 200),
  decided_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, session_id, resulting_review_revision),
  FOREIGN KEY(project_id, session_id)
    REFERENCES validation_reviews(project_id, session_id) ON DELETE CASCADE
);

CREATE TABLE validation_review_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  review_revision INTEGER NOT NULL CHECK (review_revision >= 2),
  expectation_local_id TEXT
    CHECK (expectation_local_id IS NULL OR
      (expectation_local_id = trim(expectation_local_id) AND length(expectation_local_id) BETWEEN 1 AND 128)),
  decision TEXT NOT NULL CHECK (decision IN (
    'CONFIRM_EXPECTATION', 'CORRECT_EXPECTATION', 'IMPLEMENTATION_DEFECT',
    'ENVIRONMENT_ISSUE', 'MORE_EVIDENCE_REQUIRED', 'REJECT_TEST'
  )),
  explanation TEXT NOT NULL DEFAULT '' CHECK (length(explanation) <= 4000),
  reviewer_session_id TEXT NOT NULL CHECK (length(reviewer_session_id) BETWEEN 1 AND 200),
  batch_id TEXT,
  decided_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, session_id)
    REFERENCES validation_reviews(project_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, batch_id)
    REFERENCES validation_review_batches(project_id, id) ON DELETE RESTRICT,
  CHECK ((decision = 'REJECT_TEST' AND expectation_local_id IS NULL)
    OR (decision <> 'REJECT_TEST' AND expectation_local_id IS NOT NULL))
);

CREATE INDEX validation_review_decisions_session_revision_idx
ON validation_review_decisions(project_id, session_id, review_revision, id);

CREATE TABLE validation_review_batch_members (
  project_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  expectation_local_id TEXT NOT NULL
    CHECK (expectation_local_id = trim(expectation_local_id) AND length(expectation_local_id) BETWEEN 1 AND 128),
  decision_id TEXT NOT NULL,
  PRIMARY KEY(project_id, batch_id, expectation_local_id),
  UNIQUE(project_id, decision_id),
  FOREIGN KEY(project_id, batch_id)
    REFERENCES validation_review_batches(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, decision_id)
    REFERENCES validation_review_decisions(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE validated_asset_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('TEST_CASE', 'TEST_SUITE')),
  asset_id TEXT NOT NULL,
  asset_revision INTEGER NOT NULL CHECK (asset_revision >= 1),
  draft_local_id TEXT
    CHECK (draft_local_id IS NULL OR
      (draft_local_id = trim(draft_local_id) AND length(draft_local_id) BETWEEN 1 AND 128)),
  session_id TEXT NOT NULL,
  evidence_version INTEGER NOT NULL CHECK (evidence_version >= 1),
  review_revision INTEGER NOT NULL CHECK (review_revision >= 2),
  verified_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, asset_kind, asset_id, asset_revision),
  FOREIGN KEY(project_id, session_id)
    REFERENCES validation_reviews(project_id, session_id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, session_id, evidence_version)
    REFERENCES validation_evidence_versions(project_id, session_id, version) ON DELETE RESTRICT
);

CREATE TRIGGER validated_asset_links_exact_revision
BEFORE INSERT ON validated_asset_links
WHEN NOT EXISTS (
  SELECT 1
  FROM validation_sessions session
  JOIN validation_reviews review
    ON review.project_id = session.project_id AND review.session_id = session.id
  WHERE session.project_id = NEW.project_id
    AND session.id = NEW.session_id
    AND session.phase = 'COMPLETED'
    AND review.state = 'APPROVED'
    AND review.revision = NEW.review_revision
    AND session.evidence_version = NEW.evidence_version
    AND (
      (session.source_kind = 'TEST_CASE' AND NEW.asset_kind = 'TEST_CASE'
        AND session.source_id = NEW.asset_id AND session.source_revision = NEW.asset_revision
        AND NEW.draft_local_id IS NULL)
      OR
      (session.source_kind = 'TEST_SUITE' AND NEW.asset_kind = 'TEST_SUITE'
        AND session.source_id = NEW.asset_id AND session.source_revision = NEW.asset_revision
        AND NEW.draft_local_id IS NULL)
      OR
      (session.source_kind = 'DRAFT' AND NEW.draft_local_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM authoring_draft_asset_mappings mapping
        WHERE mapping.project_id = NEW.project_id
          AND mapping.draft_id = session.source_id
          AND mapping.draft_local_id = NEW.draft_local_id
          AND mapping.asset_kind = NEW.asset_kind
          AND mapping.formal_asset_id = NEW.asset_id
          AND mapping.formal_revision = NEW.asset_revision
      ))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Validated asset link must match the approved source revision');
END;

CREATE TRIGGER validation_review_decisions_immutable
BEFORE UPDATE ON validation_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'Validation Review decision is immutable');
END;

CREATE TRIGGER validation_review_decisions_append_only
BEFORE DELETE ON validation_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'Validation Review decision is append-only');
END;

CREATE TRIGGER validation_review_batches_immutable
BEFORE UPDATE ON validation_review_batches
BEGIN
  SELECT RAISE(ABORT, 'Validation Review batch is immutable');
END;

CREATE TRIGGER validation_review_batches_append_only
BEFORE DELETE ON validation_review_batches
BEGIN
  SELECT RAISE(ABORT, 'Validation Review batch is append-only');
END;

CREATE TRIGGER validation_review_batch_members_immutable
BEFORE UPDATE ON validation_review_batch_members
BEGIN
  SELECT RAISE(ABORT, 'Validation Review batch membership is immutable');
END;

CREATE TRIGGER validation_review_batch_members_append_only
BEFORE DELETE ON validation_review_batch_members
BEGIN
  SELECT RAISE(ABORT, 'Validation Review batch membership is append-only');
END;

CREATE TRIGGER validated_asset_links_immutable
BEFORE UPDATE ON validated_asset_links
BEGIN
  SELECT RAISE(ABORT, 'Validated asset link is immutable');
END;

CREATE TRIGGER validated_asset_links_append_only
BEFORE DELETE ON validated_asset_links
BEGIN
  SELECT RAISE(ABORT, 'Validated asset link is append-only');
END;
