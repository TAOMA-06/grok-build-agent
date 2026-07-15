//! Local SQLite event store and materialized catalog.

use crate::contracts::{
    PermissionPolicy, SandboxMode, SessionEventEnvelope, SessionRunState, SessionSummary,
    SessionUiState, TaskMode, WorkspaceRecord,
};
use crate::platform::{
    AuditRecordInput, CompletionGate, ContextManifest, DispatchState, PlatformEvent,
    ProjectionRebuildReport, PromptDispatch, TaskDefinition, TaskState, VerificationResult,
    VerificationStatus,
};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("invalid state transition: {0}")]
    InvalidTransition(String),
}

impl Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPermissionRequest {
    pub request_id: String,
    pub task_id: String,
    pub session_id: String,
    pub action: serde_json::Value,
    pub state: String,
    pub deadline: String,
    pub decision: Option<serde_json::Value>,
    pub created_at: String,
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPolicyRule {
    pub rule_id: String,
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub scope: String,
    pub action: crate::platform::ActionRequest,
    pub created_at: String,
}

impl Database {
    pub fn open_default() -> Result<Self, DbError> {
        let path = default_db_path()?;
        Self::open_path(&path)
    }

    pub fn open_path(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        backup_legacy_database(path)?;
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY,
              path TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              last_opened_at TEXT NOT NULL,
              favorite INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS sessions (
              session_id TEXT PRIMARY KEY,
              connection_id TEXT,
              workspace_root TEXT NOT NULL,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_message_preview TEXT,
              run_state TEXT NOT NULL,
              remote_session_id TEXT,
              worktree_path TEXT,
              execution_root TEXT,
              base_commit TEXT,
              mode TEXT NOT NULL DEFAULT 'agent',
              permission_policy TEXT NOT NULL DEFAULT 'workspace_edit',
              sandbox TEXT NOT NULL DEFAULT 'workspace',
              archived INTEGER NOT NULL DEFAULT 0,
              attention_required INTEGER NOT NULL DEFAULT 0,
              applied_at TEXT,
              model TEXT,
              always_approve INTEGER NOT NULL DEFAULT 0,
              draft TEXT
            );

            CREATE TABLE IF NOT EXISTS session_ui (
              session_id TEXT PRIMARY KEY,
              scroll_top REAL NOT NULL DEFAULT 0,
              draft TEXT NOT NULL DEFAULT '',
              inspector_json TEXT,
              collapsed_tool_ids TEXT NOT NULL DEFAULT '[]',
              FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS event_cache (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              timestamp TEXT NOT NULL,
              kind TEXT NOT NULL,
              payload TEXT NOT NULL,
              FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_event_session
              ON event_cache(session_id, sequence);

            CREATE TABLE IF NOT EXISTS tasks (
              task_id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              state TEXT NOT NULL,
              goal TEXT,
              constraints_json TEXT NOT NULL DEFAULT '[]',
              acceptance_json TEXT NOT NULL DEFAULT '[]',
              allowed_paths_json TEXT NOT NULL DEFAULT '[]',
              verification_commands_json TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS turns (
              turn_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              ordinal INTEGER NOT NULL,
              state TEXT NOT NULL,
              started_at TEXT NOT NULL,
              finished_at TEXT,
              UNIQUE(task_id, ordinal)
            );

            CREATE TABLE IF NOT EXISTS platform_events (
              event_id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              turn_id TEXT,
              runtime_id TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              timestamp TEXT NOT NULL,
              kind TEXT NOT NULL,
              schema_version INTEGER NOT NULL,
              payload TEXT NOT NULL,
              causation_id TEXT,
              correlation_id TEXT NOT NULL,
              dedupe_key TEXT UNIQUE,
              legacy_partial_history INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_platform_events_task_sequence
              ON platform_events(task_id, sequence, event_id);
            CREATE INDEX IF NOT EXISTS idx_platform_events_session_time
              ON platform_events(session_id, timestamp, event_id);
            CREATE INDEX IF NOT EXISTS idx_platform_events_correlation
              ON platform_events(correlation_id);

            CREATE TABLE IF NOT EXISTS projection_checkpoints (
              projection_name TEXT PRIMARY KEY,
              last_event_id TEXT NOT NULL,
              last_rowid INTEGER NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entity_projections (
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              state_json TEXT NOT NULL,
              last_event_rowid INTEGER NOT NULL,
              PRIMARY KEY(entity_type, entity_id)
            );

            CREATE TABLE IF NOT EXISTS prompt_dispatches (
              dispatch_id TEXT PRIMARY KEY,
              idempotency_key TEXT NOT NULL UNIQUE,
              workspace_id TEXT NOT NULL,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              turn_id TEXT NOT NULL,
              runtime_id TEXT NOT NULL,
              state TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              acknowledged_at TEXT,
              error_summary TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_dispatch_task ON prompt_dispatches(task_id, created_at);

            CREATE TABLE IF NOT EXISTS rpc_results (
              idempotency_key TEXT PRIMARY KEY,
              method TEXT NOT NULL,
              response_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tool_calls (
              tool_call_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              turn_id TEXT,
              runtime_id TEXT NOT NULL,
              tool_name TEXT NOT NULL,
              state TEXT NOT NULL,
              request_event_id TEXT NOT NULL,
              result_event_id TEXT
            );

            CREATE TABLE IF NOT EXISTS permission_requests (
              request_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              action_json TEXT NOT NULL,
              state TEXT NOT NULL,
              deadline TEXT NOT NULL,
              decision_json TEXT,
              created_at TEXT NOT NULL,
              decided_at TEXT
            );

            CREATE TABLE IF NOT EXISTS policy_rules (
              rule_id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              session_id TEXT,
              scope TEXT NOT NULL,
              action_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_policy_rules_workspace
              ON policy_rules(workspace_id, session_id);

            CREATE TABLE IF NOT EXISTS artifacts (
              artifact_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              turn_id TEXT,
              kind TEXT NOT NULL,
              blob_digest TEXT NOT NULL,
              title TEXT NOT NULL,
              metadata_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS blobs (
              digest TEXT PRIMARY KEY,
              size INTEGER NOT NULL,
              media_type TEXT NOT NULL,
              ref_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              last_accessed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS runtime_processes (
              runtime_id TEXT PRIMARY KEY,
              adapter_id TEXT NOT NULL,
              connection_id TEXT,
              pid INTEGER,
              state TEXT NOT NULL,
              executable TEXT NOT NULL,
              version TEXT,
              capabilities_json TEXT NOT NULL DEFAULT '{}',
              started_at TEXT NOT NULL,
              heartbeat_at TEXT,
              stopped_at TEXT
            );

            CREATE TABLE IF NOT EXISTS terminal_processes (
              terminal_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              pid INTEGER NOT NULL,
              executable TEXT NOT NULL,
              state TEXT NOT NULL,
              started_at TEXT NOT NULL,
              stopped_at TEXT
            );

            CREATE TABLE IF NOT EXISTS worktree_records (
              worktree_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL,
              path TEXT NOT NULL UNIQUE,
              base_commit TEXT,
              state TEXT NOT NULL,
              created_at TEXT NOT NULL,
              removed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS jobs (
              job_id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              task_id TEXT,
              kind TEXT NOT NULL,
              schedule TEXT,
              state TEXT NOT NULL,
              idempotency_key TEXT UNIQUE,
              policy_json TEXT NOT NULL DEFAULT '{}',
              next_run_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_records (
              audit_id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              task_id TEXT,
              session_id TEXT,
              actor TEXT NOT NULL,
              action TEXT NOT NULL,
              decision TEXT,
              reason TEXT,
              redacted_summary TEXT NOT NULL,
              event_id TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_audit_workspace_time
              ON audit_records(workspace_id, created_at);

            CREATE TABLE IF NOT EXISTS context_manifests (
              manifest_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              turn_id TEXT NOT NULL,
              token_budget INTEGER NOT NULL,
              entries_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS verification_results (
              verification_id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              turn_id TEXT NOT NULL,
              command TEXT NOT NULL,
              status TEXT NOT NULL,
              summary TEXT,
              exit_code INTEGER,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS memory_candidates (
              memory_id TEXT PRIMARY KEY,
              workspace_id TEXT,
              kind TEXT NOT NULL,
              content TEXT NOT NULL,
              source_event_id TEXT NOT NULL,
              confidence REAL NOT NULL,
              state TEXT NOT NULL DEFAULT 'candidate',
              created_at TEXT NOT NULL,
              reviewed_at TEXT
            );
            ",
        )?;
        ensure_session_column(&conn, "execution_root", "TEXT")?;
        ensure_session_column(&conn, "base_commit", "TEXT")?;
        ensure_session_column(&conn, "mode", "TEXT NOT NULL DEFAULT 'agent'")?;
        ensure_session_column(
            &conn,
            "permission_policy",
            "TEXT NOT NULL DEFAULT 'workspace_edit'",
        )?;
        ensure_session_column(&conn, "sandbox", "TEXT NOT NULL DEFAULT 'workspace'")?;
        ensure_session_column(&conn, "archived", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_session_column(&conn, "attention_required", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_session_column(&conn, "applied_at", "TEXT")?;
        migrate_legacy_event_cache(&conn)?;
        conn.pragma_update(None, "user_version", 4)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn integrity_check(&self) -> Result<(), DbError> {
        let result: String = self
            .conn
            .lock()
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if result != "ok" {
            return Err(DbError::Message(format!(
                "database integrity check failed: {result}"
            )));
        }
        Ok(())
    }

    pub fn record_runtime_snapshot(
        &self,
        snapshot: &crate::contracts::RuntimeSnapshot,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock();
        for runtime in &snapshot.connections {
            conn.execute(
                "INSERT INTO runtime_processes (runtime_id, adapter_id, connection_id, pid,
                 state, executable, version, capabilities_json, started_at, heartbeat_at, stopped_at)
                 VALUES (?1,'grok-acp',?1,?2,?3,?4,NULL,?5,?6,?6,NULL)
                 ON CONFLICT(runtime_id) DO UPDATE SET pid=excluded.pid, state=excluded.state,
                 executable=excluded.executable, capabilities_json=excluded.capabilities_json,
                 heartbeat_at=excluded.heartbeat_at, stopped_at=NULL",
                params![
                    runtime.connection_id,
                    runtime.pid.map(i64::from),
                    format!("{:?}", runtime.state).to_ascii_lowercase(),
                    runtime.grok_path.as_deref().unwrap_or("grok"),
                    serde_json::to_string(&runtime.capabilities)?,
                    runtime.started_at.as_deref().unwrap_or(&snapshot.updated_at),
                ],
            )?;
        }
        Ok(())
    }

    pub fn reconcile_orphan_runtime_processes(&self) -> Result<usize, DbError> {
        let candidates = {
            let conn = self.conn.lock();
            let mut statement = conn.prepare(
                "SELECT runtime_id, pid, executable FROM runtime_processes
                 WHERE pid IS NOT NULL AND stopped_at IS NULL",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            out
        };
        let mut reconciled = 0;
        for (runtime_id, pid, executable) in candidates {
            #[cfg(unix)]
            {
                let command = std::process::Command::new("ps")
                    .args(["-p", &pid.to_string(), "-o", "command="])
                    .output()
                    .ok()
                    .filter(|output| output.status.success())
                    .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
                    .unwrap_or_default();
                let expected = Path::new(&executable)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("grok");
                if !command.is_empty() && command.contains(expected) && expected.contains("grok") {
                    unsafe {
                        libc::kill(-(pid as i32), libc::SIGKILL);
                        libc::kill(pid as i32, libc::SIGKILL);
                    }
                }
            }
            self.conn.lock().execute(
                "UPDATE runtime_processes SET state='interrupted', stopped_at=?1 WHERE runtime_id=?2",
                params![iso_now(), runtime_id],
            )?;
            reconciled += 1;
        }
        Ok(reconciled)
    }

    /// A freshly started Host has no in-memory ACP connections. Session rows
    /// left in an active state therefore describe work interrupted by the
    /// previous Host, not work that is still running. Preserve the remote
    /// session id for an explicit retry, but clear the dead connection and make
    /// the interruption visible instead of showing a permanent ghost spinner.
    pub fn reconcile_interrupted_sessions(&self) -> Result<usize, DbError> {
        Ok(self.conn.lock().execute(
            "UPDATE sessions
             SET run_state = 'error', connection_id = NULL,
                 attention_required = 1, updated_at = ?1
             WHERE run_state IN ('streaming', 'awaiting_permission', 'awaiting_plan')",
            params![iso_now()],
        )?)
    }

    pub fn mark_runtime_processes_stopped(&self) -> Result<usize, DbError> {
        Ok(self.conn.lock().execute(
            "UPDATE runtime_processes SET state='stopped', stopped_at=?1
             WHERE stopped_at IS NULL",
            params![iso_now()],
        )?)
    }

    pub fn record_terminal_process(
        &self,
        terminal_id: &str,
        task_id: &str,
        pid: u32,
        executable: &str,
    ) -> Result<(), DbError> {
        self.conn.lock().execute(
            "INSERT INTO terminal_processes
             (terminal_id, task_id, pid, executable, state, started_at, stopped_at)
             VALUES (?1,?2,?3,?4,'running',?5,NULL)
             ON CONFLICT(terminal_id) DO UPDATE SET pid=excluded.pid,
             executable=excluded.executable,state='running',stopped_at=NULL",
            params![terminal_id, task_id, i64::from(pid), executable, iso_now()],
        )?;
        Ok(())
    }

    pub fn mark_terminal_stopped(&self, terminal_id: &str) -> Result<(), DbError> {
        self.conn.lock().execute(
            "UPDATE terminal_processes SET state='stopped', stopped_at=?1 WHERE terminal_id=?2",
            params![iso_now(), terminal_id],
        )?;
        Ok(())
    }

    pub fn mark_task_terminals_stopped(&self, task_id: &str) -> Result<usize, DbError> {
        Ok(self.conn.lock().execute(
            "UPDATE terminal_processes SET state='stopped', stopped_at=?1
             WHERE task_id=?2 AND stopped_at IS NULL",
            params![iso_now(), task_id],
        )?)
    }

    pub fn reconcile_orphan_terminal_processes(&self) -> Result<usize, DbError> {
        let candidates = {
            let conn = self.conn.lock();
            let mut statement = conn.prepare(
                "SELECT terminal_id, pid, executable FROM terminal_processes
                 WHERE stopped_at IS NULL",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for (terminal_id, pid, executable) in &candidates {
            #[cfg(unix)]
            {
                let command = std::process::Command::new("ps")
                    .args(["-p", &pid.to_string(), "-o", "command="])
                    .output()
                    .ok()
                    .filter(|output| output.status.success())
                    .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
                    .unwrap_or_default();
                let expected = Path::new(executable)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                if !expected.is_empty() && command.contains(expected) {
                    unsafe {
                        libc::kill(-(*pid as i32), libc::SIGKILL);
                        libc::kill(*pid as i32, libc::SIGKILL);
                    }
                }
            }
            self.conn.lock().execute(
                "UPDATE terminal_processes SET state='interrupted', stopped_at=?1 WHERE terminal_id=?2",
                params![iso_now(), terminal_id],
            )?;
        }
        Ok(candidates.len())
    }

    pub fn unreferenced_blob_digests(&self) -> Result<Vec<String>, DbError> {
        let conn = self.conn.lock();
        let mut statement = conn.prepare("SELECT digest FROM blobs WHERE ref_count <= 0")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn remove_blob_record(&self, digest: &str) -> Result<(), DbError> {
        self.conn.lock().execute(
            "DELETE FROM blobs WHERE digest = ?1 AND ref_count <= 0",
            params![digest],
        )?;
        Ok(())
    }

    // --- Workspaces -------------------------------------------------------

    pub fn upsert_workspace(
        &self,
        path: &str,
        name: Option<&str>,
    ) -> Result<WorkspaceRecord, DbError> {
        let path = path.trim();
        if path.is_empty() {
            return Err(DbError::Message("workspace path empty".into()));
        }
        let now = iso_now();
        let display = name.map(|s| s.to_string()).unwrap_or_else(|| {
            Path::new(path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(path)
                .to_string()
        });

        let conn = self.conn.lock();
        if let Some(existing) = conn
            .query_row(
                "SELECT id, path, name, last_opened_at, favorite FROM workspaces WHERE path = ?1",
                params![path],
                |row| {
                    Ok(WorkspaceRecord {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        name: row.get(2)?,
                        last_opened_at: row.get(3)?,
                        favorite: row.get::<_, i64>(4)? != 0,
                    })
                },
            )
            .optional()?
        {
            conn.execute(
                "UPDATE workspaces SET last_opened_at = ?1, name = ?2 WHERE id = ?3",
                params![now, display, existing.id],
            )?;
            return Ok(WorkspaceRecord {
                last_opened_at: now,
                name: display,
                ..existing
            });
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO workspaces (id, path, name, last_opened_at, favorite)
             VALUES (?1, ?2, ?3, ?4, 0)",
            params![id, path, display, now],
        )?;
        Ok(WorkspaceRecord {
            id,
            path: path.to_string(),
            name: display,
            last_opened_at: now,
            favorite: false,
        })
    }

    pub fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, DbError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, path, name, last_opened_at, favorite
             FROM workspaces ORDER BY last_opened_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                last_opened_at: row.get(3)?,
                favorite: row.get::<_, i64>(4)? != 0,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn set_workspace_favorite(&self, id: &str, favorite: bool) -> Result<(), DbError> {
        self.conn.lock().execute(
            "UPDATE workspaces SET favorite = ?1 WHERE id = ?2",
            params![if favorite { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    // --- Sessions ---------------------------------------------------------

    pub fn upsert_session(&self, summary: &SessionSummary) -> Result<(), DbError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sessions (
                session_id, connection_id, workspace_root, title, created_at, updated_at,
                last_message_preview, run_state, remote_session_id, worktree_path, model,
                always_approve, draft, execution_root, base_commit, mode, permission_policy,
                sandbox, archived, attention_required, applied_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)
             ON CONFLICT(session_id) DO UPDATE SET
                connection_id=excluded.connection_id,
                workspace_root=excluded.workspace_root,
                title=excluded.title,
                updated_at=excluded.updated_at,
                last_message_preview=excluded.last_message_preview,
                run_state=excluded.run_state,
                remote_session_id=excluded.remote_session_id,
                worktree_path=excluded.worktree_path,
                model=excluded.model,
                always_approve=excluded.always_approve,
                draft=excluded.draft,
                execution_root=excluded.execution_root,
                base_commit=excluded.base_commit,
                mode=excluded.mode,
                permission_policy=excluded.permission_policy,
                sandbox=excluded.sandbox,
                archived=excluded.archived,
                attention_required=excluded.attention_required,
                applied_at=excluded.applied_at",
            params![
                summary.session_id,
                summary.connection_id,
                summary.workspace_root,
                summary.title,
                summary.created_at,
                summary.updated_at,
                summary.last_message_preview,
                run_state_str(&summary.run_state),
                summary.remote_session_id,
                summary.worktree_path,
                summary.model,
                if summary.always_approve { 1 } else { 0 },
                summary.draft,
                summary.execution_root,
                summary.base_commit,
                task_mode_str(summary.mode),
                permission_policy_str(summary.permission_policy),
                sandbox_str(summary.sandbox),
                if summary.archived { 1 } else { 0 },
                if summary.attention_required { 1 } else { 0 },
                summary.applied_at,
            ],
        )?;
        // Ensure UI row exists.
        conn.execute(
            "INSERT OR IGNORE INTO session_ui (session_id, scroll_top, draft, collapsed_tool_ids)
             VALUES (?1, 0, ?2, '[]')",
            params![
                summary.session_id,
                summary.draft.clone().unwrap_or_default()
            ],
        )?;
        conn.execute(
            "INSERT INTO tasks (task_id, workspace_id, state, created_at, updated_at)
             VALUES (
               ?1,
               COALESCE((SELECT id FROM workspaces WHERE path = ?2), ?2),
               ?3, ?4, ?5
             )
             ON CONFLICT(task_id) DO UPDATE SET
               workspace_id=excluded.workspace_id,
               state=excluded.state,
               updated_at=excluded.updated_at",
            params![
                summary.session_id,
                summary.workspace_root,
                task_state_from_run(&summary.run_state),
                summary.created_at,
                summary.updated_at,
            ],
        )?;
        let workspace_id = conn
            .query_row(
                "SELECT id FROM workspaces WHERE path = ?1",
                params![summary.workspace_root],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| summary.workspace_root.clone());
        append_projection_snapshot(
            &conn,
            "session_snapshot",
            &workspace_id,
            &summary.session_id,
            &summary.session_id,
            &serde_json::to_value(summary)?,
            &format!("session:{}:{}", summary.session_id, summary.updated_at),
        )?;
        Ok(())
    }

    pub fn list_sessions(
        &self,
        workspace_root: Option<&str>,
    ) -> Result<Vec<SessionSummary>, DbError> {
        let conn = self.conn.lock();
        let mut out = Vec::new();
        if let Some(ws) = workspace_root {
            let mut stmt = conn.prepare(
                "SELECT session_id, connection_id, workspace_root, title, created_at, updated_at,
                        last_message_preview, run_state, remote_session_id, worktree_path, model,
                        always_approve, draft, execution_root, base_commit, mode, permission_policy,
                        sandbox, archived, attention_required, applied_at
                 FROM sessions WHERE workspace_root = ?1 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![ws], map_session_row)?;
            for r in rows {
                out.push(r?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT session_id, connection_id, workspace_root, title, created_at, updated_at,
                        last_message_preview, run_state, remote_session_id, worktree_path, model,
                        always_approve, draft, execution_root, base_commit, mode, permission_policy,
                        sandbox, archived, attention_required, applied_at
                 FROM sessions ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([], map_session_row)?;
            for r in rows {
                out.push(r?);
            }
        }
        Ok(out)
    }

    pub fn get_session(&self, session_id: &str) -> Result<Option<SessionSummary>, DbError> {
        let conn = self.conn.lock();
        let row = conn
            .query_row(
                "SELECT session_id, connection_id, workspace_root, title, created_at, updated_at,
                        last_message_preview, run_state, remote_session_id, worktree_path, model,
                        always_approve, draft, execution_root, base_commit, mode, permission_policy,
                        sandbox, archived, attention_required, applied_at
                 FROM sessions WHERE session_id = ?1",
                params![session_id],
                map_session_row,
            )
            .optional()?;
        Ok(row)
    }

    pub fn local_session_id(&self, session_id: &str) -> Result<Option<String>, DbError> {
        Ok(self
            .conn
            .lock()
            .query_row(
                "SELECT session_id FROM sessions WHERE session_id = ?1 OR remote_session_id = ?1
                 ORDER BY CASE WHEN remote_session_id = ?1 THEN 0 ELSE 1 END LIMIT 1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM event_cache WHERE session_id = ?1",
            params![session_id],
        )?;
        conn.execute(
            "DELETE FROM session_ui WHERE session_id = ?1",
            params![session_id],
        )?;
        conn.execute(
            "DELETE FROM sessions WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    pub fn save_draft(&self, session_id: &str, draft: &str) -> Result<(), DbError> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE sessions SET draft = ?1, updated_at = ?2 WHERE session_id = ?3",
            params![draft, iso_now(), session_id],
        )?;
        conn.execute(
            "INSERT INTO session_ui (session_id, scroll_top, draft, collapsed_tool_ids)
             VALUES (?1, 0, ?2, '[]')
             ON CONFLICT(session_id) DO UPDATE SET draft = excluded.draft",
            params![session_id, draft],
        )?;
        Ok(())
    }

    pub fn save_session_ui(&self, ui: &SessionUiState) -> Result<(), DbError> {
        let inspector = ui
            .inspector_selection
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let collapsed = serde_json::to_string(&ui.collapsed_tool_ids)?;
        self.conn.lock().execute(
            "INSERT INTO session_ui (session_id, scroll_top, draft, inspector_json, collapsed_tool_ids)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(session_id) DO UPDATE SET
               scroll_top=excluded.scroll_top,
               draft=excluded.draft,
               inspector_json=excluded.inspector_json,
               collapsed_tool_ids=excluded.collapsed_tool_ids",
            params![
                ui.session_id,
                ui.scroll_top,
                ui.draft,
                inspector,
                collapsed
            ],
        )?;
        // Keep sessions.draft in sync.
        self.conn.lock().execute(
            "UPDATE sessions SET draft = ?1, updated_at = ?2 WHERE session_id = ?3",
            params![ui.draft, iso_now(), ui.session_id],
        )?;
        Ok(())
    }

    pub fn load_session_ui(&self, session_id: &str) -> Result<Option<SessionUiState>, DbError> {
        let conn = self.conn.lock();
        let row = conn
            .query_row(
                "SELECT session_id, scroll_top, draft, inspector_json, collapsed_tool_ids
                 FROM session_ui WHERE session_id = ?1",
                params![session_id],
                |row| {
                    let inspector_json: Option<String> = row.get(3)?;
                    let collapsed_raw: String = row.get(4)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, String>(2)?,
                        inspector_json,
                        collapsed_raw,
                    ))
                },
            )
            .optional()?;
        let Some((sid, scroll, draft, inspector_json, collapsed_raw)) = row else {
            return Ok(None);
        };
        let inspector_selection = match inspector_json {
            Some(s) if !s.is_empty() => serde_json::from_str(&s)?,
            _ => None,
        };
        let collapsed_tool_ids: Vec<String> =
            serde_json::from_str(&collapsed_raw).unwrap_or_default();
        Ok(Some(SessionUiState {
            session_id: sid,
            scroll_top: scroll,
            draft,
            inspector_selection,
            collapsed_tool_ids,
        }))
    }

    // --- Immutable event store -------------------------------------------

    pub fn append_event(
        &self,
        session_id: &str,
        sequence: u64,
        timestamp: &str,
        kind: &str,
        payload: &serde_json::Value,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock();
        let attribution = conn
            .query_row(
                "SELECT COALESCE((SELECT id FROM workspaces WHERE path = sessions.workspace_root),
                                 sessions.workspace_root),
                        COALESCE(connection_id, 'runtime:legacy')
                 FROM sessions WHERE session_id = ?1",
                params![session_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((workspace_id, runtime_id)) = attribution else {
            return Err(DbError::Message(format!(
                "cannot append event for unknown session {session_id}"
            )));
        };
        let event = PlatformEvent {
            event_id: Uuid::new_v4().to_string(),
            workspace_id,
            task_id: session_id.to_string(),
            session_id: session_id.to_string(),
            turn_id: None,
            runtime_id,
            sequence,
            timestamp: timestamp.to_string(),
            kind: kind.to_string(),
            schema_version: crate::platform::EVENT_SCHEMA_VERSION,
            payload: payload.clone(),
            causation_id: None,
            correlation_id: session_id.to_string(),
            dedupe_key: Some(format!("compat:{session_id}:{sequence}")),
        };
        insert_platform_event(&conn, &event, false)
    }

    pub fn list_events(&self, session_id: &str) -> Result<Vec<CachedEvent>, DbError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT sequence, timestamp, kind, payload FROM platform_events
             WHERE session_id = ?1 AND kind NOT LIKE '%_snapshot'
             ORDER BY timestamp ASC, sequence ASC, rowid ASC",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let (seq, ts, kind, payload_raw) = r?;
            let payload: serde_json::Value =
                serde_json::from_str(&payload_raw).unwrap_or(serde_json::Value::Null);
            out.push(CachedEvent {
                session_id: session_id.to_string(),
                sequence: seq as u64,
                timestamp: ts,
                kind,
                payload,
            });
        }
        Ok(out)
    }

    pub fn append_platform_event(&self, event: &PlatformEvent) -> Result<(), DbError> {
        event
            .validate()
            .map_err(|error| DbError::Message(error.to_string()))?;
        insert_platform_event(&self.conn.lock(), event, false)
    }

    pub fn append_runtime_envelope(
        &self,
        envelope: &SessionEventEnvelope,
    ) -> Result<bool, DbError> {
        let Some(remote_session_id) = envelope.session_id.as_deref() else {
            return Ok(false);
        };
        let attribution = self
            .conn
            .lock()
            .query_row(
                "SELECT s.session_id,
                        COALESCE((SELECT id FROM workspaces WHERE path = s.workspace_root),
                                 s.workspace_root)
                 FROM sessions s
                 WHERE s.session_id = ?1 OR s.remote_session_id = ?1
                 ORDER BY CASE WHEN s.remote_session_id = ?1 THEN 0 ELSE 1 END LIMIT 1",
                params![remote_session_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((local_session_id, workspace_id)) = attribution else {
            return Ok(false);
        };
        let event = PlatformEvent {
            event_id: Uuid::new_v4().to_string(),
            workspace_id,
            task_id: local_session_id.clone(),
            session_id: local_session_id.clone(),
            turn_id: None,
            runtime_id: envelope.connection_id.clone(),
            sequence: envelope.sequence,
            timestamp: envelope.timestamp.clone(),
            kind: envelope.kind.clone(),
            schema_version: crate::platform::EVENT_SCHEMA_VERSION,
            payload: envelope.payload.clone(),
            causation_id: None,
            correlation_id: local_session_id,
            dedupe_key: Some(format!(
                "runtime:{}:{}:{}:{}",
                envelope.connection_id, remote_session_id, envelope.sequence, envelope.kind
            )),
        };
        self.append_platform_event(&event)?;
        Ok(true)
    }

    pub fn platform_event_rowid_by_dedupe_key(
        &self,
        dedupe_key: &str,
    ) -> Result<Option<i64>, DbError> {
        Ok(self
            .conn
            .lock()
            .query_row(
                "SELECT rowid FROM platform_events WHERE dedupe_key = ?1",
                params![dedupe_key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn replay_platform_events(
        &self,
        after_rowid: i64,
        limit: usize,
    ) -> Result<Vec<(i64, PlatformEvent)>, DbError> {
        let limit = limit.clamp(1, 10_000) as i64;
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT rowid, event_id, workspace_id, task_id, session_id, turn_id, runtime_id,
                    sequence, timestamp, kind, schema_version, payload, causation_id,
                    correlation_id, dedupe_key
             FROM platform_events WHERE rowid > ?1 ORDER BY rowid ASC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![after_rowid.max(0), limit], |row| {
            let rowid = row.get(0)?;
            let event = map_platform_event_row_offset(row, 1)?;
            Ok((rowid, event))
        })?;
        let mut events = Vec::new();
        for event in rows {
            events.push(event?);
        }
        Ok(events)
    }

    pub fn append_turn_snapshot(
        &self,
        workspace_id: &str,
        task_id: &str,
        session_id: &str,
        runtime_id: &str,
        turn_id: &str,
        state: &str,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock();
        let payload = serde_json::json!({
            "turnId": turn_id,
            "taskId": task_id,
            "sessionId": session_id,
            "runtimeId": runtime_id,
            "state": state,
        });
        append_projection_snapshot(
            &conn,
            "turn_snapshot",
            workspace_id,
            task_id,
            session_id,
            &payload,
            &format!("turn:{turn_id}:{state}"),
        )
    }

    pub fn rebuild_projections(&self) -> Result<ProjectionRebuildReport, DbError> {
        for session in self.list_sessions(None)? {
            self.upsert_session(&session)?;
        }
        let task_ids = {
            let conn = self.conn.lock();
            let mut statement = conn.prepare("SELECT task_id FROM tasks ORDER BY task_id")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            let mut ids = Vec::new();
            for row in rows {
                ids.push(row?);
            }
            ids
        };
        for task_id in task_ids {
            if let Some(task) = self.get_task(&task_id)? {
                self.upsert_task(&task)?;
            }
        }
        let mut conn = self.conn.lock();
        let transaction = conn.transaction()?;
        transaction.execute_batch(
            "DROP TABLE IF EXISTS projection_rebuild;
             CREATE TEMP TABLE projection_rebuild (
               entity_type TEXT NOT NULL,
               entity_id TEXT NOT NULL,
               state_json TEXT NOT NULL,
               last_event_rowid INTEGER NOT NULL,
               PRIMARY KEY(entity_type, entity_id)
             );",
        )?;
        let mut processed = 0_u64;
        let mut last_rowid = 0_i64;
        {
            let mut statement = transaction.prepare(
                "SELECT rowid, kind, payload, session_id, task_id FROM platform_events
                 ORDER BY rowid ASC",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?;
            for row in rows {
                let (rowid, kind, payload_raw, session_id, task_id) = row?;
                processed += 1;
                last_rowid = rowid;
                let payload: serde_json::Value = serde_json::from_str(&payload_raw)?;
                let projection = match kind.as_str() {
                    "session_snapshot" => {
                        serde_json::from_value::<SessionSummary>(payload.clone())?;
                        Some(("session", session_id, payload))
                    }
                    "task_snapshot" => {
                        serde_json::from_value::<TaskDefinition>(payload.clone())?;
                        Some(("task", task_id, payload))
                    }
                    "turn_snapshot" => payload
                        .get("turnId")
                        .and_then(serde_json::Value::as_str)
                        .map(|id| ("turn", id.to_string(), payload.clone())),
                    "permission" => payload.get("id").map(|id| {
                        (
                            "permission",
                            format!("{}:{id}", session_id),
                            payload.clone(),
                        )
                    }),
                    "session_update" => tool_projection(&payload),
                    _ => None,
                };
                if let Some((entity_type, entity_id, state)) = projection {
                    transaction.execute(
                        "INSERT INTO projection_rebuild (
                           entity_type, entity_id, state_json, last_event_rowid
                         ) VALUES (?1,?2,?3,?4)
                         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                           state_json=excluded.state_json,
                           last_event_rowid=excluded.last_event_rowid",
                        params![entity_type, entity_id, state.to_string(), rowid],
                    )?;
                }
            }
        }
        let projected_entities: i64 =
            transaction.query_row("SELECT COUNT(*) FROM projection_rebuild", [], |row| {
                row.get(0)
            })?;
        transaction.execute_batch(
            "DELETE FROM entity_projections;
             INSERT INTO entity_projections (entity_type, entity_id, state_json, last_event_rowid)
             SELECT entity_type, entity_id, state_json, last_event_rowid FROM projection_rebuild;
             DROP TABLE projection_rebuild;",
        )?;
        transaction.execute(
            "INSERT INTO projection_checkpoints (projection_name, last_event_id, last_rowid, updated_at)
             VALUES ('entity_projections', COALESCE((SELECT event_id FROM platform_events WHERE rowid = ?1), ''), ?1, ?2)
             ON CONFLICT(projection_name) DO UPDATE SET last_event_id=excluded.last_event_id,
             last_rowid=excluded.last_rowid, updated_at=excluded.updated_at",
            params![last_rowid, iso_now()],
        )?;
        transaction.commit()?;
        Ok(ProjectionRebuildReport {
            processed_events: processed,
            projected_entities: projected_entities.max(0) as u64,
            last_rowid,
            rebuilt_at: iso_now(),
        })
    }

    pub fn load_rpc_result(
        &self,
        idempotency_key: &str,
        method: &str,
    ) -> Result<Option<serde_json::Value>, DbError> {
        let stored = self
            .conn
            .lock()
            .query_row(
                "SELECT method, response_json FROM rpc_results WHERE idempotency_key = ?1",
                params![idempotency_key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        match stored {
            None => Ok(None),
            Some((stored_method, _)) if stored_method != method => Err(DbError::Message(
                "idempotency key was already used for a different RPC method".into(),
            )),
            Some((_, response)) => Ok(Some(serde_json::from_str(&response)?)),
        }
    }

    pub fn store_rpc_result(
        &self,
        idempotency_key: &str,
        method: &str,
        response: &serde_json::Value,
    ) -> Result<(), DbError> {
        self.conn.lock().execute(
            "INSERT INTO rpc_results (idempotency_key, method, response_json, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(idempotency_key) DO NOTHING",
            params![idempotency_key, method, response.to_string(), iso_now()],
        )?;
        Ok(())
    }

    pub fn record_audit(&self, record: &AuditRecordInput) -> Result<String, DbError> {
        let audit_id = Uuid::new_v4().to_string();
        self.conn.lock().execute(
            "INSERT INTO audit_records (
                audit_id, workspace_id, task_id, session_id, actor, action, decision,
                reason, redacted_summary, event_id, created_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                audit_id,
                record.workspace_id,
                record.task_id,
                record.session_id,
                record.actor,
                record.action,
                record.decision,
                record.reason,
                record.redacted_summary,
                record.event_id,
                iso_now(),
            ],
        )?;
        Ok(audit_id)
    }

    pub fn recent_audit_summaries(&self, limit: usize) -> Result<Vec<serde_json::Value>, DbError> {
        let conn = self.conn.lock();
        let mut statement = conn.prepare(
            "SELECT actor, action, decision, reason, redacted_summary, created_at
             FROM audit_records ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit.clamp(1, 200) as i64], |row| {
            Ok(serde_json::json!({
                "actor": row.get::<_, String>(0)?,
                "action": row.get::<_, String>(1)?,
                "decision": row.get::<_, Option<String>>(2)?,
                "reason": row.get::<_, Option<String>>(3)?,
                "summary": row.get::<_, String>(4)?,
                "createdAt": row.get::<_, String>(5)?,
            }))
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn persist_permission_request(
        &self,
        connection_id: &str,
        session_id: &str,
        raw: &serde_json::Value,
    ) -> Result<String, DbError> {
        let local_session_id = self
            .conn
            .lock()
            .query_row(
                "SELECT session_id FROM sessions WHERE session_id = ?1 OR remote_session_id = ?1
                 ORDER BY CASE WHEN remote_session_id = ?1 THEN 0 ELSE 1 END LIMIT 1",
                params![session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| session_id.to_string());
        let runtime_id = raw.get("id").cloned().unwrap_or(serde_json::Value::Null);
        let request_id = format!("{connection_id}:{}", runtime_id);
        let deadline = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            + 300_000)
            .to_string();
        self.conn.lock().execute(
            "INSERT OR IGNORE INTO permission_requests (
                request_id, task_id, session_id, action_json, state, deadline,
                decision_json, created_at, decided_at
             ) VALUES (?1,?2,?3,?4,'pending',?5,NULL,?6,NULL)",
            params![
                request_id,
                local_session_id,
                local_session_id,
                raw.to_string(),
                deadline,
                iso_now()
            ],
        )?;
        Ok(request_id)
    }

    pub fn decide_permission_request(
        &self,
        connection_id: &str,
        runtime_request_id: &serde_json::Value,
        state: &str,
        decision: &serde_json::Value,
    ) -> Result<bool, DbError> {
        let request_id = format!("{connection_id}:{}", runtime_request_id);
        let changed = self.conn.lock().execute(
            "UPDATE permission_requests SET state = ?1, decision_json = ?2, decided_at = ?3
             WHERE request_id = ?4 AND state = 'pending'",
            params![state, decision.to_string(), iso_now(), request_id],
        )?;
        Ok(changed > 0)
    }

    pub fn get_permission_request(
        &self,
        connection_id: &str,
        runtime_request_id: &serde_json::Value,
    ) -> Result<Option<StoredPermissionRequest>, DbError> {
        let request_id = format!("{connection_id}:{}", runtime_request_id);
        self.list_permission_requests(false).map(|requests| {
            requests
                .into_iter()
                .find(|request| request.request_id == request_id)
        })
    }

    pub fn save_policy_rule(
        &self,
        action: &crate::platform::ActionRequest,
        scope: &str,
    ) -> Result<String, DbError> {
        if !matches!(scope, "session" | "project") {
            return Err(DbError::Message("invalid policy rule scope".into()));
        }
        if matches!(action.risk, crate::platform::RiskLevel::Critical) {
            return Err(DbError::Message(
                "critical actions cannot receive persistent approval".into(),
            ));
        }
        let rule_id = Uuid::new_v4().to_string();
        self.conn.lock().execute(
            "INSERT INTO policy_rules (rule_id, workspace_id, session_id, scope, action_json, created_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                rule_id,
                action.workspace_id,
                (scope == "session").then_some(action.session_id.as_str()),
                scope,
                serde_json::to_string(action)?,
                iso_now(),
            ],
        )?;
        Ok(rule_id)
    }

    pub fn policy_rule_allows(
        &self,
        action: &crate::platform::ActionRequest,
    ) -> Result<bool, DbError> {
        if matches!(action.risk, crate::platform::RiskLevel::Critical) {
            return Ok(false);
        }
        let conn = self.conn.lock();
        let mut statement = conn.prepare(
            "SELECT action_json FROM policy_rules WHERE workspace_id = ?1
             AND (session_id IS NULL OR session_id = ?2) ORDER BY session_id DESC",
        )?;
        let rows = statement.query_map(params![action.workspace_id, action.session_id], |row| {
            row.get::<_, String>(0)
        })?;
        for row in rows {
            let stored: crate::platform::ActionRequest = serde_json::from_str(&row?)?;
            if stored.tool == action.tool
                && stored.effect == action.effect
                && stored.argv == action.argv
                && stored.paths == action.paths
                && stored.network_targets == action.network_targets
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn list_policy_rules(
        &self,
        workspace_id: Option<&str>,
    ) -> Result<Vec<StoredPolicyRule>, DbError> {
        let conn = self.conn.lock();
        let mut statement = conn.prepare(
            "SELECT rule_id, workspace_id, session_id, scope, action_json, created_at
             FROM policy_rules WHERE (?1 IS NULL OR workspace_id = ?1) ORDER BY created_at DESC",
        )?;
        let rows = statement.query_map(params![workspace_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;
        let mut rules = Vec::new();
        for row in rows {
            let (rule_id, workspace_id, session_id, scope, action, created_at) = row?;
            rules.push(StoredPolicyRule {
                rule_id,
                workspace_id,
                session_id,
                scope,
                action: serde_json::from_str(&action)?,
                created_at,
            });
        }
        Ok(rules)
    }

    pub fn delete_policy_rule(&self, rule_id: &str) -> Result<bool, DbError> {
        Ok(self.conn.lock().execute(
            "DELETE FROM policy_rules WHERE rule_id = ?1",
            params![rule_id],
        )? > 0)
    }

    pub fn clear_session_policy_rules(&self) -> Result<usize, DbError> {
        Ok(self
            .conn
            .lock()
            .execute("DELETE FROM policy_rules WHERE scope = 'session'", [])?)
    }

    pub fn interrupt_pending_permissions(&self) -> Result<usize, DbError> {
        Ok(self.conn.lock().execute(
            "UPDATE permission_requests SET state = 'interrupted', decided_at = ?1,
             decision_json = '{\"reason\":\"Agent Host restarted\"}' WHERE state = 'pending'",
            params![iso_now()],
        )?)
    }

    pub fn list_permission_requests(
        &self,
        pending_only: bool,
    ) -> Result<Vec<StoredPermissionRequest>, DbError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT request_id, task_id, session_id, action_json, state, deadline,
                    decision_json, created_at, decided_at FROM permission_requests
             WHERE (?1 = 0 OR state = 'pending') ORDER BY created_at DESC LIMIT 1000",
        )?;
        let rows = stmt.query_map(params![pending_only as i64], |row| {
            let action: String = row.get(3)?;
            let decision: Option<String> = row.get(6)?;
            Ok(StoredPermissionRequest {
                request_id: row.get(0)?,
                task_id: row.get(1)?,
                session_id: row.get(2)?,
                action: serde_json::from_str(&action).unwrap_or(serde_json::Value::Null),
                state: row.get(4)?,
                deadline: row.get(5)?,
                decision: decision.and_then(|value| serde_json::from_str(&value).ok()),
                created_at: row.get(7)?,
                decided_at: row.get(8)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn expire_due_permissions(
        &self,
        now_millis: u128,
    ) -> Result<Vec<StoredPermissionRequest>, DbError> {
        let due = self
            .list_permission_requests(true)?
            .into_iter()
            .filter(|request| request.deadline.parse::<u128>().unwrap_or(0) <= now_millis)
            .collect::<Vec<_>>();
        let conn = self.conn.lock();
        for request in &due {
            conn.execute(
                "UPDATE permission_requests SET state = 'expired', decided_at = ?1,
                 decision_json = '{\"reason\":\"Permission request expired\"}'
                 WHERE request_id = ?2 AND state = 'pending'",
                params![iso_now(), request.request_id],
            )?;
        }
        Ok(due)
    }

    pub fn list_platform_events(
        &self,
        task_id: &str,
        after_sequence: Option<u64>,
        limit: usize,
    ) -> Result<Vec<PlatformEvent>, DbError> {
        let limit = limit.clamp(1, 10_000) as i64;
        let after = after_sequence.unwrap_or(0) as i64;
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT event_id, workspace_id, task_id, session_id, turn_id, runtime_id,
                    sequence, timestamp, kind, schema_version, payload, causation_id,
                    correlation_id, dedupe_key
             FROM platform_events
             WHERE task_id = ?1 AND sequence > ?2
             ORDER BY sequence ASC, rowid ASC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![task_id, after, limit], map_platform_event_row)?;
        let mut events = Vec::new();
        for event in rows {
            events.push(event?);
        }
        Ok(events)
    }

    pub fn upsert_task(&self, task: &TaskDefinition) -> Result<(), DbError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO tasks (task_id, workspace_id, state, goal, constraints_json,
             acceptance_json, allowed_paths_json, verification_commands_json, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
             ON CONFLICT(task_id) DO UPDATE SET workspace_id=excluded.workspace_id,
             state=excluded.state, goal=excluded.goal, constraints_json=excluded.constraints_json,
             acceptance_json=excluded.acceptance_json, allowed_paths_json=excluded.allowed_paths_json,
             verification_commands_json=excluded.verification_commands_json,
             updated_at=excluded.updated_at",
            params![
                task.task_id,
                task.workspace_id,
                task_state_str(task.state),
                task.goal,
                serde_json::to_string(&task.constraints)?,
                serde_json::to_string(&task.acceptance)?,
                serde_json::to_string(&task.allowed_paths)?,
                serde_json::to_string(&task.verification_commands)?,
                task.created_at,
                task.updated_at,
            ],
        )?;
        append_projection_snapshot(
            &conn,
            "task_snapshot",
            &task.workspace_id,
            &task.task_id,
            &task.task_id,
            &serde_json::to_value(task)?,
            &format!("task:{}:{}", task.task_id, task.updated_at),
        )?;
        Ok(())
    }

    pub fn get_task(&self, task_id: &str) -> Result<Option<TaskDefinition>, DbError> {
        let raw = self
            .conn
            .lock()
            .query_row(
                "SELECT task_id, workspace_id, state, goal, constraints_json, acceptance_json,
             allowed_paths_json, verification_commands_json, created_at, updated_at
             FROM tasks WHERE task_id = ?1",
                params![task_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            task_id,
            workspace_id,
            state,
            goal,
            constraints,
            acceptance,
            allowed_paths,
            verification_commands,
            created_at,
            updated_at,
        )) = raw
        else {
            return Ok(None);
        };
        Ok(Some(TaskDefinition {
            task_id,
            workspace_id,
            state: parse_task_state(&state)?,
            goal,
            constraints: serde_json::from_str(&constraints)?,
            acceptance: serde_json::from_str(&acceptance)?,
            allowed_paths: serde_json::from_str(&allowed_paths)?,
            verification_commands: serde_json::from_str(&verification_commands)?,
            created_at,
            updated_at,
        }))
    }

    pub fn transition_task_state(&self, task_id: &str, state: TaskState) -> Result<(), DbError> {
        let mut task = self
            .get_task(task_id)?
            .ok_or_else(|| DbError::Message("unknown task".into()))?;
        if matches!(task.state, TaskState::Completed | TaskState::Cancelled) && task.state != state
        {
            return Err(DbError::InvalidTransition(format!(
                "task {} is terminal",
                task.task_id
            )));
        }
        task.state = state;
        task.updated_at = iso_now();
        self.upsert_task(&task)
    }

    pub fn complete_task(&self, task_id: &str) -> Result<CompletionGate, DbError> {
        let gate = self.completion_gate(task_id)?;
        if !gate.ready {
            return Ok(gate);
        }
        self.transition_task_state(task_id, TaskState::Completed)?;
        Ok(gate)
    }

    pub fn save_context_manifest(&self, manifest: &ContextManifest) -> Result<(), DbError> {
        self.conn.lock().execute(
            "INSERT INTO context_manifests (manifest_id, task_id, turn_id, token_budget,
             entries_json, created_at) VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(manifest_id) DO NOTHING",
            params![
                manifest.manifest_id,
                manifest.task_id,
                manifest.turn_id,
                manifest.token_budget as i64,
                serde_json::to_string(&manifest.entries)?,
                manifest.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_context_manifests(&self, task_id: &str) -> Result<Vec<ContextManifest>, DbError> {
        let conn = self.conn.lock();
        let mut statement = conn.prepare(
            "SELECT manifest_id, task_id, turn_id, token_budget, entries_json, created_at
             FROM context_manifests WHERE task_id = ?1 ORDER BY created_at DESC, rowid DESC",
        )?;
        let rows = statement.query_map(params![task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (manifest_id, task_id, turn_id, budget, entries, created_at) = row?;
            out.push(ContextManifest {
                manifest_id,
                task_id,
                turn_id,
                token_budget: budget.max(0) as u64,
                entries: serde_json::from_str(&entries)?,
                created_at,
            });
        }
        Ok(out)
    }

    pub fn save_verification_result(&self, result: &VerificationResult) -> Result<(), DbError> {
        self.conn.lock().execute(
            "INSERT INTO verification_results (verification_id, task_id, turn_id, command,
             status, summary, exit_code, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(verification_id) DO NOTHING",
            params![
                result.verification_id,
                result.task_id,
                result.turn_id,
                result.command,
                verification_status_str(result.status),
                result.summary,
                result.exit_code,
                result.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_verification_results(
        &self,
        task_id: &str,
    ) -> Result<Vec<VerificationResult>, DbError> {
        let conn = self.conn.lock();
        let mut statement = conn.prepare(
            "SELECT verification_id, task_id, turn_id, command, status, summary, exit_code,
             created_at FROM verification_results WHERE task_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = statement.query_map(params![task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<i32>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (
                verification_id,
                task_id,
                turn_id,
                command,
                status,
                summary,
                exit_code,
                created_at,
            ) = row?;
            out.push(VerificationResult {
                verification_id,
                task_id,
                turn_id,
                command,
                status: parse_verification_status(&status)?,
                summary,
                exit_code,
                created_at,
            });
        }
        Ok(out)
    }

    pub fn completion_gate(&self, task_id: &str) -> Result<CompletionGate, DbError> {
        let task = self
            .get_task(task_id)?
            .ok_or_else(|| DbError::Message("unknown task".into()))?;
        let verification = self.list_verification_results(task_id)?;
        let mut blockers = Vec::new();
        for command in &task.verification_commands {
            match verification
                .iter()
                .rev()
                .find(|result| &result.command == command)
            {
                None => blockers.push(format!("verification not recorded: {command}")),
                Some(result) if matches!(result.status, VerificationStatus::Failed) => {
                    blockers.push(format!("verification failed: {command}"));
                }
                Some(result)
                    if matches!(
                        result.status,
                        VerificationStatus::NotRun | VerificationStatus::Blocked
                    ) && result
                        .summary
                        .as_deref()
                        .unwrap_or_default()
                        .trim()
                        .is_empty() =>
                {
                    blockers.push(format!("verification reason missing: {command}"));
                }
                Some(_) => {}
            }
        }
        let conn = self.conn.lock();
        let pending_permissions: i64 = conn.query_row(
            "SELECT COUNT(*) FROM permission_requests WHERE task_id = ?1 AND state = 'pending'",
            params![task_id],
            |row| row.get(0),
        )?;
        if pending_permissions > 0 {
            blockers.push("unresolved permission requests".into());
        }
        let unknown_dispatches: i64 = conn.query_row(
            "SELECT COUNT(*) FROM prompt_dispatches WHERE task_id = ?1 AND state = 'delivery_unknown'",
            params![task_id],
            |row| row.get(0),
        )?;
        if unknown_dispatches > 0 {
            blockers.push("prompt delivery is unknown".into());
        }
        Ok(CompletionGate {
            ready: blockers.is_empty(),
            blockers,
            verification,
        })
    }

    pub fn begin_prompt_dispatch(
        &self,
        dispatch: &PromptDispatch,
    ) -> Result<PromptDispatch, DbError> {
        validate_dispatch(dispatch)?;
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR IGNORE INTO prompt_dispatches (
                dispatch_id, idempotency_key, workspace_id, task_id, session_id, turn_id,
                runtime_id, state, created_at, updated_at, acknowledged_at, error_summary
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                dispatch.dispatch_id,
                dispatch.idempotency_key,
                dispatch.workspace_id,
                dispatch.task_id,
                dispatch.session_id,
                dispatch.turn_id,
                dispatch.runtime_id,
                dispatch_state_str(dispatch.state),
                dispatch.created_at,
                dispatch.updated_at,
                dispatch.acknowledged_at,
                dispatch.error_summary,
            ],
        )?;
        get_dispatch_by_key(&conn, &dispatch.idempotency_key)?
            .ok_or_else(|| DbError::Message("prompt dispatch was not persisted".into()))
    }

    pub fn prepare_prompt_dispatch(
        &self,
        task_id: &str,
        remote_session_id: &str,
        runtime_id: &str,
        turn_id: &str,
        idempotency_key: &str,
    ) -> Result<PromptDispatch, DbError> {
        let attribution = self
            .conn
            .lock()
            .query_row(
                "SELECT COALESCE((SELECT id FROM workspaces WHERE path = sessions.workspace_root),
                                 sessions.workspace_root), session_id
                 FROM sessions WHERE session_id = ?1 OR remote_session_id = ?2
                 ORDER BY CASE WHEN session_id = ?1 THEN 0 ELSE 1 END LIMIT 1",
                params![task_id, remote_session_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((workspace_id, local_session_id)) = attribution else {
            return Err(DbError::Message(format!(
                "cannot dispatch prompt for unknown task {task_id}"
            )));
        };
        let now = iso_now();
        self.begin_prompt_dispatch(&PromptDispatch {
            dispatch_id: Uuid::new_v4().to_string(),
            idempotency_key: idempotency_key.to_string(),
            workspace_id,
            task_id: task_id.to_string(),
            session_id: local_session_id,
            turn_id: turn_id.to_string(),
            runtime_id: runtime_id.to_string(),
            state: DispatchState::Prepared,
            created_at: now.clone(),
            updated_at: now,
            acknowledged_at: None,
            error_summary: None,
        })
    }

    pub fn transition_prompt_dispatch(
        &self,
        idempotency_key: &str,
        next: DispatchState,
        error_summary: Option<&str>,
    ) -> Result<PromptDispatch, DbError> {
        let conn = self.conn.lock();
        let current = get_dispatch_by_key(&conn, idempotency_key)?
            .ok_or_else(|| DbError::Message("prompt dispatch not found".into()))?;
        if !valid_dispatch_transition(current.state, next) {
            return Err(DbError::InvalidTransition(format!(
                "{} -> {}",
                dispatch_state_str(current.state),
                dispatch_state_str(next)
            )));
        }
        let now = iso_now();
        let acknowledged = matches!(next, DispatchState::Acknowledged).then_some(now.clone());
        conn.execute(
            "UPDATE prompt_dispatches
             SET state = ?1, updated_at = ?2,
                 acknowledged_at = COALESCE(?3, acknowledged_at), error_summary = ?4
             WHERE idempotency_key = ?5",
            params![
                dispatch_state_str(next),
                now,
                acknowledged,
                error_summary,
                idempotency_key
            ],
        )?;
        get_dispatch_by_key(&conn, idempotency_key)?
            .ok_or_else(|| DbError::Message("prompt dispatch disappeared".into()))
    }

    pub fn mark_inflight_dispatches_unknown(&self) -> Result<usize, DbError> {
        let now = iso_now();
        let changed = self.conn.lock().execute(
            "UPDATE prompt_dispatches SET state = 'delivery_unknown', updated_at = ?1,
                    error_summary = COALESCE(error_summary, 'Host stopped before runtime acknowledgement')
             WHERE state = 'sending'",
            params![now],
        )?;
        Ok(changed)
    }

    pub fn register_blob(
        &self,
        blob: &crate::blob_store::BlobRef,
        reference_delta: i64,
    ) -> Result<(), DbError> {
        let now = iso_now();
        self.conn.lock().execute(
            "INSERT INTO blobs (digest, size, media_type, ref_count, created_at, last_accessed_at)
             VALUES (?1, ?2, ?3, MAX(?4, 0), ?5, ?5)
             ON CONFLICT(digest) DO UPDATE SET
               ref_count = MAX(0, blobs.ref_count + ?4),
               last_accessed_at = ?5",
            params![
                blob.digest,
                blob.size as i64,
                blob.media_type,
                reference_delta,
                now
            ],
        )?;
        Ok(())
    }
}

fn insert_platform_event(
    conn: &Connection,
    event: &PlatformEvent,
    legacy_partial_history: bool,
) -> Result<(), DbError> {
    let payload = serde_json::to_string(&event.payload)?;
    conn.execute(
        "INSERT OR IGNORE INTO platform_events (
            event_id, workspace_id, task_id, session_id, turn_id, runtime_id, sequence,
            timestamp, kind, schema_version, payload, causation_id, correlation_id,
            dedupe_key, legacy_partial_history
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            event.event_id,
            event.workspace_id,
            event.task_id,
            event.session_id,
            event.turn_id,
            event.runtime_id,
            event.sequence as i64,
            event.timestamp,
            event.kind,
            event.schema_version as i64,
            payload,
            event.causation_id,
            event.correlation_id,
            event.dedupe_key,
            if legacy_partial_history { 1 } else { 0 },
        ],
    )?;
    Ok(())
}

fn append_projection_snapshot(
    conn: &Connection,
    kind: &str,
    workspace_id: &str,
    task_id: &str,
    session_id: &str,
    payload: &serde_json::Value,
    dedupe_key: &str,
) -> Result<(), DbError> {
    let sequence: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM platform_events WHERE task_id = ?1",
        params![task_id],
        |row| row.get(0),
    )?;
    let event = PlatformEvent {
        event_id: Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
        task_id: task_id.to_string(),
        session_id: session_id.to_string(),
        turn_id: None,
        runtime_id: "platform:host".into(),
        sequence: sequence.max(1) as u64,
        timestamp: iso_now(),
        kind: kind.into(),
        schema_version: crate::platform::EVENT_SCHEMA_VERSION,
        payload: payload.clone(),
        causation_id: None,
        correlation_id: task_id.to_string(),
        dedupe_key: Some(dedupe_key.to_string()),
    };
    insert_platform_event(conn, &event, false)
}

fn tool_projection(
    payload: &serde_json::Value,
) -> Option<(&'static str, String, serde_json::Value)> {
    let update = payload.get("update").unwrap_or(payload);
    let kind = update
        .get("sessionUpdate")
        .or_else(|| update.get("session_update"))
        .and_then(serde_json::Value::as_str)?;
    if !matches!(kind, "tool_call" | "tool_call_update") {
        return None;
    }
    let tool_call_id = update
        .get("toolCallId")
        .or_else(|| update.get("tool_call_id"))
        .and_then(serde_json::Value::as_str)?;
    Some(("tool_call", tool_call_id.to_string(), update.clone()))
}

fn map_platform_event_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlatformEvent> {
    map_platform_event_row_offset(row, 0)
}

fn map_platform_event_row_offset(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<PlatformEvent> {
    let payload_raw: String = row.get(offset + 10)?;
    let payload = serde_json::from_str(&payload_raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            offset + 10,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(PlatformEvent {
        event_id: row.get(offset)?,
        workspace_id: row.get(offset + 1)?,
        task_id: row.get(offset + 2)?,
        session_id: row.get(offset + 3)?,
        turn_id: row.get(offset + 4)?,
        runtime_id: row.get(offset + 5)?,
        sequence: row.get::<_, i64>(offset + 6)? as u64,
        timestamp: row.get(offset + 7)?,
        kind: row.get(offset + 8)?,
        schema_version: row.get::<_, i64>(offset + 9)? as u32,
        payload,
        causation_id: row.get(offset + 11)?,
        correlation_id: row.get(offset + 12)?,
        dedupe_key: row.get(offset + 13)?,
    })
}

fn validate_dispatch(dispatch: &PromptDispatch) -> Result<(), DbError> {
    for (name, value) in [
        ("dispatchId", dispatch.dispatch_id.as_str()),
        ("idempotencyKey", dispatch.idempotency_key.as_str()),
        ("workspaceId", dispatch.workspace_id.as_str()),
        ("taskId", dispatch.task_id.as_str()),
        ("sessionId", dispatch.session_id.as_str()),
        ("turnId", dispatch.turn_id.as_str()),
        ("runtimeId", dispatch.runtime_id.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(DbError::Message(format!("{name} must not be empty")));
        }
    }
    if !matches!(dispatch.state, DispatchState::Prepared) {
        return Err(DbError::Message(
            "new prompt dispatch must start in prepared state".into(),
        ));
    }
    Ok(())
}

fn dispatch_state_str(state: DispatchState) -> &'static str {
    match state {
        DispatchState::Prepared => "prepared",
        DispatchState::Sending => "sending",
        DispatchState::Acknowledged => "acknowledged",
        DispatchState::DeliveryUnknown => "delivery_unknown",
        DispatchState::Failed => "failed",
        DispatchState::Cancelled => "cancelled",
    }
}

fn task_state_str(state: TaskState) -> &'static str {
    match state {
        TaskState::Draft => "draft",
        TaskState::Preparing => "preparing",
        TaskState::Running => "running",
        TaskState::AwaitingInput => "awaiting_input",
        TaskState::AwaitingPermission => "awaiting_permission",
        TaskState::DeliveryUnknown => "delivery_unknown",
        TaskState::Verifying => "verifying",
        TaskState::Completed => "completed",
        TaskState::Failed => "failed",
        TaskState::Cancelled => "cancelled",
    }
}

fn parse_task_state(value: &str) -> Result<TaskState, DbError> {
    match value {
        "draft" => Ok(TaskState::Draft),
        "preparing" => Ok(TaskState::Preparing),
        "running" => Ok(TaskState::Running),
        "awaiting_input" => Ok(TaskState::AwaitingInput),
        "awaiting_permission" => Ok(TaskState::AwaitingPermission),
        "delivery_unknown" => Ok(TaskState::DeliveryUnknown),
        "verifying" => Ok(TaskState::Verifying),
        "completed" => Ok(TaskState::Completed),
        "failed" => Ok(TaskState::Failed),
        "cancelled" => Ok(TaskState::Cancelled),
        other => Err(DbError::Message(format!("unknown task state {other}"))),
    }
}

fn verification_status_str(status: VerificationStatus) -> &'static str {
    match status {
        VerificationStatus::Passed => "passed",
        VerificationStatus::Failed => "failed",
        VerificationStatus::NotRun => "not_run",
        VerificationStatus::Blocked => "blocked",
    }
}

fn parse_verification_status(value: &str) -> Result<VerificationStatus, DbError> {
    match value {
        "passed" => Ok(VerificationStatus::Passed),
        "failed" => Ok(VerificationStatus::Failed),
        "not_run" => Ok(VerificationStatus::NotRun),
        "blocked" => Ok(VerificationStatus::Blocked),
        other => Err(DbError::Message(format!(
            "unknown verification status {other}"
        ))),
    }
}

fn parse_dispatch_state(value: &str) -> Result<DispatchState, DbError> {
    match value {
        "prepared" => Ok(DispatchState::Prepared),
        "sending" => Ok(DispatchState::Sending),
        "acknowledged" => Ok(DispatchState::Acknowledged),
        "delivery_unknown" => Ok(DispatchState::DeliveryUnknown),
        "failed" => Ok(DispatchState::Failed),
        "cancelled" => Ok(DispatchState::Cancelled),
        other => Err(DbError::Message(format!(
            "unknown prompt dispatch state {other}"
        ))),
    }
}

fn valid_dispatch_transition(current: DispatchState, next: DispatchState) -> bool {
    if current == next {
        return true;
    }
    matches!(
        (current, next),
        (DispatchState::Prepared, DispatchState::Sending)
            | (DispatchState::Prepared, DispatchState::Cancelled)
            | (DispatchState::Sending, DispatchState::Acknowledged)
            | (DispatchState::Sending, DispatchState::DeliveryUnknown)
            | (DispatchState::Sending, DispatchState::Failed)
            | (DispatchState::Sending, DispatchState::Cancelled)
            | (DispatchState::DeliveryUnknown, DispatchState::Sending)
            | (DispatchState::DeliveryUnknown, DispatchState::Cancelled)
            | (DispatchState::Failed, DispatchState::Sending)
    )
}

fn get_dispatch_by_key(
    conn: &Connection,
    idempotency_key: &str,
) -> Result<Option<PromptDispatch>, DbError> {
    let raw = conn
        .query_row(
            "SELECT dispatch_id, idempotency_key, workspace_id, task_id, session_id,
                    turn_id, runtime_id, state, created_at, updated_at, acknowledged_at,
                    error_summary
             FROM prompt_dispatches WHERE idempotency_key = ?1",
            params![idempotency_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                ))
            },
        )
        .optional()?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    Ok(Some(PromptDispatch {
        dispatch_id: raw.0,
        idempotency_key: raw.1,
        workspace_id: raw.2,
        task_id: raw.3,
        session_id: raw.4,
        turn_id: raw.5,
        runtime_id: raw.6,
        state: parse_dispatch_state(&raw.7)?,
        created_at: raw.8,
        updated_at: raw.9,
        acknowledged_at: raw.10,
        error_summary: raw.11,
    }))
}

fn backup_legacy_database(path: &Path) -> Result<(), DbError> {
    if !path.exists() {
        return Ok(());
    }
    let legacy = Connection::open(path)?;
    let version: i64 = legacy.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 0 || version >= 4 {
        return Ok(());
    }
    legacy.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
    drop(legacy);
    let backup = path.with_extension(format!("v{version}.backup.sqlite3"));
    if !backup.exists() {
        std::fs::copy(path, backup)?;
    }
    Ok(())
}

fn migrate_legacy_event_cache(conn: &Connection) -> Result<(), DbError> {
    let now = iso_now();
    conn.execute(
        "INSERT OR IGNORE INTO tasks (
            task_id, workspace_id, state, created_at, updated_at
         )
         SELECT s.session_id,
                COALESCE((SELECT id FROM workspaces WHERE path = s.workspace_root), s.workspace_root),
                CASE s.run_state
                  WHEN 'streaming' THEN 'running'
                  WHEN 'awaiting_permission' THEN 'awaiting_permission'
                  WHEN 'error' THEN 'failed'
                  WHEN 'cancelled' THEN 'cancelled'
                  WHEN 'ended' THEN 'completed'
                  ELSE 'draft'
                END,
                s.created_at, s.updated_at
         FROM sessions s",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO platform_events (
            event_id, workspace_id, task_id, session_id, runtime_id, sequence, timestamp,
            kind, schema_version, payload, correlation_id, dedupe_key, legacy_partial_history
         )
         SELECT 'legacy-event-cache:' || e.id,
                COALESCE((SELECT id FROM workspaces WHERE path = s.workspace_root), s.workspace_root),
                e.session_id, e.session_id, COALESCE(s.connection_id, 'runtime:legacy'),
                e.sequence, e.timestamp, e.kind, 1, e.payload, e.session_id,
                'legacy-event-cache:' || e.id, 1
         FROM event_cache e JOIN sessions s ON s.session_id = e.session_id",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO projection_checkpoints (
            projection_name, last_event_id, last_rowid, updated_at
         ) VALUES ('legacy-cache-import', 'migration-v4', 0, ?1)",
        params![now],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedEvent {
    pub session_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokSessionHint {
    pub path: String,
    pub name: String,
    pub modified_at: Option<String>,
}

/// List entries under ~/.grok/sessions for recovery / load hints (not full ACP load).
pub fn list_grok_session_dirs() -> Result<Vec<GrokSessionHint>, DbError> {
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME");
    let dir = home
        .map(PathBuf::from)
        .ok_or_else(|| DbError::Message("user home directory is not available".into()))?
        .join(".grok")
        .join("sessions");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let modified_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let d = t
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                format!("{d}")
            });
        out.push(GrokSessionHint {
            path: path.to_string_lossy().into(),
            name,
            modified_at,
        });
    }
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

fn default_db_path() -> Result<PathBuf, DbError> {
    let root = crate::config::config_dir_path().map_err(|e| DbError::Message(e.to_string()))?;
    Ok(PathBuf::from(root).join("catalog.sqlite"))
}

fn ensure_session_column(
    conn: &Connection,
    name: &str,
    declaration: &str,
) -> Result<(), rusqlite::Error> {
    let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|column| column == name) {
        conn.execute_batch(&format!(
            "ALTER TABLE sessions ADD COLUMN {name} {declaration}"
        ))?;
    }
    Ok(())
}

fn iso_now() -> String {
    crate::acp::iso_now()
}

fn run_state_str(s: &SessionRunState) -> &'static str {
    match s {
        SessionRunState::Idle => "idle",
        SessionRunState::Streaming => "streaming",
        SessionRunState::AwaitingPermission => "awaiting_permission",
        SessionRunState::AwaitingPlan => "awaiting_plan",
        SessionRunState::Cancelled => "cancelled",
        SessionRunState::Error => "error",
        SessionRunState::Ended => "ended",
    }
}

fn task_state_from_run(s: &SessionRunState) -> &'static str {
    match s {
        SessionRunState::Idle => "draft",
        SessionRunState::Streaming => "running",
        SessionRunState::AwaitingPermission => "awaiting_permission",
        SessionRunState::AwaitingPlan => "awaiting_input",
        SessionRunState::Cancelled => "cancelled",
        SessionRunState::Error => "failed",
        SessionRunState::Ended => "completed",
    }
}

fn parse_run_state(s: &str) -> SessionRunState {
    match s {
        "streaming" => SessionRunState::Streaming,
        "awaiting_permission" => SessionRunState::AwaitingPermission,
        "awaiting_plan" => SessionRunState::AwaitingPlan,
        "cancelled" => SessionRunState::Cancelled,
        "error" => SessionRunState::Error,
        "ended" => SessionRunState::Ended,
        _ => SessionRunState::Idle,
    }
}

fn task_mode_str(mode: TaskMode) -> &'static str {
    match mode {
        TaskMode::Agent => "agent",
        TaskMode::Plan => "plan",
        TaskMode::Goal => "goal",
    }
}

fn parse_task_mode(value: &str) -> TaskMode {
    match value {
        "plan" => TaskMode::Plan,
        "goal" => TaskMode::Goal,
        _ => TaskMode::Agent,
    }
}

fn permission_policy_str(policy: PermissionPolicy) -> &'static str {
    match policy {
        PermissionPolicy::WorkspaceEdit => "workspace_edit",
        PermissionPolicy::AskAll => "ask_all",
        PermissionPolicy::FullAuto => "full_auto",
    }
}

fn parse_permission_policy(value: &str) -> PermissionPolicy {
    match value {
        "ask_all" => PermissionPolicy::AskAll,
        "full_auto" => PermissionPolicy::FullAuto,
        _ => PermissionPolicy::WorkspaceEdit,
    }
}

fn sandbox_str(sandbox: SandboxMode) -> &'static str {
    match sandbox {
        SandboxMode::None => "none",
        SandboxMode::Workspace => "workspace",
        SandboxMode::Strict => "strict",
    }
}

fn parse_sandbox(value: &str) -> SandboxMode {
    match value {
        "none" => SandboxMode::None,
        "strict" => SandboxMode::Strict,
        _ => SandboxMode::Workspace,
    }
}

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionSummary> {
    let run: String = row.get(7)?;
    Ok(SessionSummary {
        session_id: row.get(0)?,
        connection_id: row.get(1)?,
        workspace_root: row.get(2)?,
        title: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        last_message_preview: row.get(6)?,
        run_state: parse_run_state(&run),
        remote_session_id: row.get(8)?,
        worktree_path: row.get(9)?,
        model: row.get(10)?,
        reasoning_effort: None,
        always_approve: row.get::<_, i64>(11)? != 0,
        draft: row.get(12)?,
        execution_root: row.get(13)?,
        base_commit: row.get(14)?,
        mode: parse_task_mode(&row.get::<_, String>(15)?),
        permission_policy: parse_permission_policy(&row.get::<_, String>(16)?),
        sandbox: parse_sandbox(&row.get::<_, String>(17)?),
        archived: row.get::<_, i64>(18)? != 0,
        attention_required: row.get::<_, i64>(19)? != 0,
        applied_at: row.get(20)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::SessionRunState;

    fn temp_db() -> Database {
        let path = std::env::temp_dir().join(format!(
            "gbd-db-{}-{}.sqlite",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = std::fs::remove_file(&path);
        Database::open_path(&path).unwrap()
    }

    #[test]
    fn workspace_and_session_roundtrip() {
        let db = temp_db();
        let ws = db.upsert_workspace("/tmp/proj", Some("proj")).unwrap();
        assert_eq!(ws.name, "proj");
        let list = db.list_workspaces().unwrap();
        assert_eq!(list.len(), 1);

        let summary = SessionSummary {
            session_id: "s1".into(),
            connection_id: Some("c1".into()),
            workspace_root: "/tmp/proj".into(),
            title: "Hello".into(),
            created_at: "t0".into(),
            updated_at: "t1".into(),
            last_message_preview: Some("hi".into()),
            run_state: SessionRunState::Idle,
            remote_session_id: None,
            worktree_path: None,
            execution_root: Some("/tmp/proj".into()),
            base_commit: None,
            mode: TaskMode::Plan,
            permission_policy: PermissionPolicy::WorkspaceEdit,
            sandbox: SandboxMode::Workspace,
            archived: false,
            attention_required: false,
            applied_at: None,
            model: Some("grok-build".into()),
            reasoning_effort: None,
            always_approve: false,
            draft: Some("draft text".into()),
        };
        db.upsert_session(&summary).unwrap();
        db.save_draft("s1", "updated draft").unwrap();
        let loaded = db.get_session("s1").unwrap().unwrap();
        assert_eq!(loaded.draft.as_deref(), Some("updated draft"));
        assert_eq!(loaded.mode, TaskMode::Plan);
        assert_eq!(loaded.permission_policy, PermissionPolicy::WorkspaceEdit);
        let schema_version: i64 = db
            .conn
            .lock()
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(schema_version, 4);
        assert_eq!(db.list_sessions(Some("/tmp/proj")).unwrap().len(), 1);

        db.append_event("s1", 1, "t", "chunk", &serde_json::json!({"text": "a"}))
            .unwrap();
        assert_eq!(db.list_events("s1").unwrap().len(), 1);

        let ui = SessionUiState {
            session_id: "s1".into(),
            scroll_top: 42.0,
            draft: "ui draft".into(),
            inspector_selection: None,
            collapsed_tool_ids: vec!["tool-1".into()],
        };
        db.save_session_ui(&ui).unwrap();
        let loaded_ui = db.load_session_ui("s1").unwrap().unwrap();
        assert_eq!(loaded_ui.scroll_top, 42.0);
        assert_eq!(loaded_ui.collapsed_tool_ids, vec!["tool-1".to_string()]);

        let interrupted = SessionSummary {
            run_state: SessionRunState::Streaming,
            attention_required: false,
            ..loaded
        };
        db.upsert_session(&interrupted).unwrap();
        assert_eq!(db.reconcile_interrupted_sessions().unwrap(), 1);
        let recovered = db.get_session("s1").unwrap().unwrap();
        assert_eq!(recovered.run_state, SessionRunState::Error);
        assert!(recovered.attention_required);
        assert!(recovered.connection_id.is_none());

        db.delete_session("s1").unwrap();
        assert!(db.get_session("s1").unwrap().is_none());
    }

    #[test]
    fn event_store_is_append_only_and_deduplicates_compat_events() {
        let db = temp_db();
        let summary = SessionSummary {
            session_id: "s2".into(),
            connection_id: None,
            workspace_root: "/w".into(),
            title: "t".into(),
            created_at: "t0".into(),
            updated_at: "t0".into(),
            last_message_preview: None,
            run_state: SessionRunState::Idle,
            remote_session_id: None,
            worktree_path: None,
            execution_root: Some("/w".into()),
            base_commit: None,
            mode: TaskMode::Agent,
            permission_policy: PermissionPolicy::WorkspaceEdit,
            sandbox: SandboxMode::Workspace,
            archived: false,
            attention_required: false,
            applied_at: None,
            model: None,
            reasoning_effort: None,
            always_approve: false,
            draft: None,
        };
        db.upsert_session(&summary).unwrap();
        for i in 0..250 {
            db.append_event("s2", i as u64, "t", "k", &serde_json::json!({"i": i}))
                .unwrap();
        }
        db.append_event("s2", 249, "t", "k", &serde_json::json!({"i": 249}))
            .unwrap();
        let events = db.list_events("s2").unwrap();
        assert_eq!(events.len(), 250);
        assert_eq!(events.first().unwrap().sequence, 0);
        assert_eq!(events.last().unwrap().sequence, 249);
        let replay = db.replay_platform_events(0, 1_000).unwrap();
        assert_eq!(replay.len(), 251);
        let cursor = replay[100].0;
        let remainder = db.replay_platform_events(cursor, 1_000).unwrap();
        assert_eq!(remainder.len(), 150);
        assert!(remainder.iter().all(|(rowid, _)| *rowid > cursor));
    }

    #[test]
    fn rpc_results_are_persistent_and_method_scoped() {
        let db = temp_db();
        db.store_rpc_result(
            "key-1",
            "catalog.sessions.upsert",
            &serde_json::json!({"ok": true}),
        )
        .unwrap();
        assert_eq!(
            db.load_rpc_result("key-1", "catalog.sessions.upsert")
                .unwrap(),
            Some(serde_json::json!({"ok": true}))
        );
        db.store_rpc_result(
            "key-1",
            "catalog.sessions.upsert",
            &serde_json::json!({"ok": false}),
        )
        .unwrap();
        assert_eq!(
            db.load_rpc_result("key-1", "catalog.sessions.upsert")
                .unwrap(),
            Some(serde_json::json!({"ok": true}))
        );
        assert!(db.load_rpc_result("key-1", "git.commit").is_err());
    }

    #[test]
    fn projection_rebuild_is_atomic_and_replays_snapshots_and_tools() {
        let db = temp_db();
        db.upsert_workspace("/projection", Some("projection"))
            .unwrap();
        let summary = SessionSummary {
            session_id: "projection-task".into(),
            connection_id: Some("runtime-1".into()),
            workspace_root: "/projection".into(),
            title: "Projection".into(),
            created_at: "t0".into(),
            updated_at: "t1".into(),
            last_message_preview: None,
            run_state: SessionRunState::Streaming,
            remote_session_id: Some("remote-projection".into()),
            worktree_path: None,
            execution_root: Some("/projection".into()),
            base_commit: None,
            mode: TaskMode::Agent,
            permission_policy: PermissionPolicy::WorkspaceEdit,
            sandbox: SandboxMode::Workspace,
            archived: false,
            attention_required: false,
            applied_at: None,
            model: None,
            reasoning_effort: None,
            always_approve: false,
            draft: None,
        };
        db.upsert_session(&summary).unwrap();
        db.upsert_task(&TaskDefinition {
            task_id: summary.session_id.clone(),
            workspace_id: "/projection".into(),
            state: TaskState::Running,
            goal: Some("project state".into()),
            constraints: vec![],
            acceptance: vec![],
            allowed_paths: vec![],
            verification_commands: vec![],
            created_at: "t0".into(),
            updated_at: "t1".into(),
        })
        .unwrap();
        db.append_platform_event(&PlatformEvent {
            event_id: "tool-event".into(),
            workspace_id: "/projection".into(),
            task_id: summary.session_id.clone(),
            session_id: summary.session_id.clone(),
            turn_id: Some("turn-1".into()),
            runtime_id: "runtime-1".into(),
            sequence: 20,
            timestamp: "t2".into(),
            kind: "session_update".into(),
            schema_version: crate::platform::EVENT_SCHEMA_VERSION,
            payload: serde_json::json!({"update":{"sessionUpdate":"tool_call","toolCallId":"tool-1","status":"running"}}),
            causation_id: None,
            correlation_id: "projection-task".into(),
            dedupe_key: Some("tool-event".into()),
        }).unwrap();
        let report = db.rebuild_projections().unwrap();
        assert!(report.projected_entities >= 3);
        let before: i64 = db
            .conn
            .lock()
            .query_row("SELECT COUNT(*) FROM entity_projections", [], |row| {
                row.get(0)
            })
            .unwrap();
        db.append_platform_event(&PlatformEvent {
            event_id: "bad-snapshot".into(),
            workspace_id: "/projection".into(),
            task_id: summary.session_id.clone(),
            session_id: summary.session_id,
            turn_id: None,
            runtime_id: "platform:host".into(),
            sequence: 21,
            timestamp: "t3".into(),
            kind: "session_snapshot".into(),
            schema_version: crate::platform::EVENT_SCHEMA_VERSION,
            payload: serde_json::json!({"invalid": true}),
            causation_id: None,
            correlation_id: "projection-task".into(),
            dedupe_key: Some("bad-snapshot".into()),
        })
        .unwrap();
        assert!(db.rebuild_projections().is_err());
        let after: i64 = db
            .conn
            .lock()
            .query_row("SELECT COUNT(*) FROM entity_projections", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn policy_rules_are_exact_and_cannot_persist_critical_approval() {
        let db = temp_db();
        let mut action = crate::platform::ActionRequest {
            request_id: "permission-1".into(),
            actor: "runtime:grok-acp".into(),
            workspace_id: "/workspace".into(),
            task_id: "task-1".into(),
            session_id: "task-1".into(),
            tool: "terminal.create".into(),
            effect: crate::platform::ActionEffect::Network,
            argv: vec!["curl".into(), "https://example.com".into()],
            paths: vec![],
            network_targets: vec!["example.com".into()],
            secret_refs: vec![],
            risk: crate::platform::RiskLevel::High,
            deadline: "future".into(),
            metadata: Default::default(),
        };
        db.save_policy_rule(&action, "project").unwrap();
        assert!(db.policy_rule_allows(&action).unwrap());
        action.argv.push("--upload-file".into());
        assert!(!db.policy_rule_allows(&action).unwrap());
        action.risk = crate::platform::RiskLevel::Critical;
        assert!(db.save_policy_rule(&action, "project").is_err());
    }

    #[test]
    fn completion_gate_requires_structured_verification() {
        let db = temp_db();
        db.upsert_task(&TaskDefinition {
            task_id: "verify-task".into(),
            workspace_id: "/workspace".into(),
            state: TaskState::Verifying,
            goal: None,
            constraints: vec![],
            acceptance: vec![],
            allowed_paths: vec![],
            verification_commands: vec!["cargo test".into()],
            created_at: "t0".into(),
            updated_at: "t0".into(),
        })
        .unwrap();
        assert!(!db.completion_gate("verify-task").unwrap().ready);
        db.save_verification_result(&VerificationResult {
            verification_id: "verification-1".into(),
            task_id: "verify-task".into(),
            turn_id: "turn-1".into(),
            command: "cargo test".into(),
            status: VerificationStatus::Passed,
            summary: Some("passed".into()),
            exit_code: Some(0),
            created_at: "t1".into(),
        })
        .unwrap();
        assert!(db.completion_gate("verify-task").unwrap().ready);
        db.complete_task("verify-task").unwrap();
        assert_eq!(
            db.get_task("verify-task").unwrap().unwrap().state,
            TaskState::Completed
        );
    }

    #[test]
    fn prompt_dispatch_requires_explicit_resolution_after_uncertain_delivery() {
        let db = temp_db();
        db.upsert_workspace("/w", Some("w")).unwrap();
        let summary = SessionSummary {
            session_id: "task-1".into(),
            connection_id: Some("runtime-1".into()),
            workspace_root: "/w".into(),
            title: "t".into(),
            created_at: "t0".into(),
            updated_at: "t0".into(),
            last_message_preview: None,
            run_state: SessionRunState::Idle,
            remote_session_id: Some("remote-1".into()),
            worktree_path: None,
            execution_root: Some("/w".into()),
            base_commit: None,
            mode: TaskMode::Agent,
            permission_policy: PermissionPolicy::WorkspaceEdit,
            sandbox: SandboxMode::Workspace,
            archived: false,
            attention_required: false,
            applied_at: None,
            model: None,
            reasoning_effort: None,
            always_approve: false,
            draft: None,
        };
        db.upsert_session(&summary).unwrap();
        let prepared = db
            .prepare_prompt_dispatch(
                "task-1",
                "remote-1",
                "runtime-1",
                "turn-1",
                "dispatch-key-1",
            )
            .unwrap();
        assert_eq!(prepared.state, DispatchState::Prepared);
        db.transition_prompt_dispatch("dispatch-key-1", DispatchState::Sending, None)
            .unwrap();
        db.mark_inflight_dispatches_unknown().unwrap();
        let existing = db
            .prepare_prompt_dispatch(
                "task-1",
                "remote-1",
                "runtime-1",
                "turn-1",
                "dispatch-key-1",
            )
            .unwrap();
        assert_eq!(existing.dispatch_id, prepared.dispatch_id);
        assert_eq!(existing.state, DispatchState::DeliveryUnknown);
        db.transition_prompt_dispatch("dispatch-key-1", DispatchState::Sending, None)
            .unwrap();
        db.transition_prompt_dispatch("dispatch-key-1", DispatchState::Acknowledged, None)
            .unwrap();
        assert!(db
            .transition_prompt_dispatch("dispatch-key-1", DispatchState::Sending, None)
            .is_err());
    }

    #[test]
    fn v3_upgrade_creates_backup_and_marks_partial_history() {
        let path = std::env::temp_dir().join(format!("gbd-v3-{}.sqlite", Uuid::new_v4()));
        let legacy = Connection::open(&path).unwrap();
        legacy
            .execute_batch(
                "CREATE TABLE workspaces (
                   id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                   last_opened_at TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE TABLE sessions (
                   session_id TEXT PRIMARY KEY, connection_id TEXT, workspace_root TEXT NOT NULL,
                   title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                   last_message_preview TEXT, run_state TEXT NOT NULL, remote_session_id TEXT,
                   worktree_path TEXT, model TEXT, always_approve INTEGER NOT NULL DEFAULT 0,
                   draft TEXT
                 );
                 CREATE TABLE event_cache (
                   id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                   sequence INTEGER NOT NULL, timestamp TEXT NOT NULL, kind TEXT NOT NULL,
                   payload TEXT NOT NULL
                 );
                 INSERT INTO workspaces VALUES ('w1', '/legacy', 'legacy', 't0', 0);
                 INSERT INTO sessions (
                   session_id, connection_id, workspace_root, created_at, updated_at, run_state
                 ) VALUES ('s1', 'r1', '/legacy', 't0', 't0', 'idle');
                 INSERT INTO event_cache (session_id, sequence, timestamp, kind, payload)
                 VALUES ('s1', 1, 't0', 'assistant', '{\"text\":\"legacy\"}');
                 PRAGMA user_version = 3;",
            )
            .unwrap();
        drop(legacy);

        let db = Database::open_path(&path).unwrap();
        assert!(path.with_extension("v3.backup.sqlite3").exists());
        let events = db.list_platform_events("s1", None, 10).unwrap();
        assert_eq!(events.len(), 1);
        let partial: i64 = db
            .conn
            .lock()
            .query_row(
                "SELECT legacy_partial_history FROM platform_events WHERE event_id = ?1",
                params![events[0].event_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(partial, 1);
    }
}
