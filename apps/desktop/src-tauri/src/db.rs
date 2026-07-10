//! Local SQLite catalog: workspaces, sessions, drafts, UI state, event cache.

use crate::contracts::{
    SessionRunState, SessionSummary, SessionUiState, WorkspaceRecord,
};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

const EVENT_CACHE_LIMIT_PER_SESSION: usize = 200;

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

impl Database {
    pub fn open_default() -> Result<Self, DbError> {
        let path = default_db_path()?;
        Self::open_path(&path)
    }

    pub fn open_path(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
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
            ",
        )?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    // --- Workspaces -------------------------------------------------------

    pub fn upsert_workspace(&self, path: &str, name: Option<&str>) -> Result<WorkspaceRecord, DbError> {
        let path = path.trim();
        if path.is_empty() {
            return Err(DbError::Message("workspace path empty".into()));
        }
        let now = iso_now();
        let display = name
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
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
                always_approve, draft
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
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
                draft=excluded.draft",
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
        Ok(())
    }

    pub fn list_sessions(&self, workspace_root: Option<&str>) -> Result<Vec<SessionSummary>, DbError> {
        let conn = self.conn.lock();
        let mut out = Vec::new();
        if let Some(ws) = workspace_root {
            let mut stmt = conn.prepare(
                "SELECT session_id, connection_id, workspace_root, title, created_at, updated_at,
                        last_message_preview, run_state, remote_session_id, worktree_path, model,
                        always_approve, draft
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
                        always_approve, draft
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
                        always_approve, draft
                 FROM sessions WHERE session_id = ?1",
                params![session_id],
                map_session_row,
            )
            .optional()?;
        Ok(row)
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
        let collapsed_tool_ids: Vec<String> = serde_json::from_str(&collapsed_raw).unwrap_or_default();
        Ok(Some(SessionUiState {
            session_id: sid,
            scroll_top: scroll,
            draft,
            inspector_selection,
            collapsed_tool_ids,
        }))
    }

    // --- Event cache (bounded) --------------------------------------------

    pub fn append_event(
        &self,
        session_id: &str,
        sequence: u64,
        timestamp: &str,
        kind: &str,
        payload: &serde_json::Value,
    ) -> Result<(), DbError> {
        let conn = self.conn.lock();
        // Ensure session exists so FK does not fail for ephemeral caches.
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM sessions WHERE session_id = ?1",
                params![session_id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if !exists {
            return Ok(());
        }
        let payload_str = serde_json::to_string(payload)?;
        conn.execute(
            "INSERT INTO event_cache (session_id, sequence, timestamp, kind, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session_id, sequence as i64, timestamp, kind, payload_str],
        )?;
        // Trim old rows beyond limit.
        conn.execute(
            "DELETE FROM event_cache WHERE session_id = ?1 AND id NOT IN (
                SELECT id FROM event_cache WHERE session_id = ?1
                ORDER BY sequence DESC LIMIT ?2
             )",
            params![session_id, EVENT_CACHE_LIMIT_PER_SESSION as i64],
        )?;
        Ok(())
    }

    pub fn list_events(&self, session_id: &str) -> Result<Vec<CachedEvent>, DbError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT sequence, timestamp, kind, payload FROM event_cache
             WHERE session_id = ?1 ORDER BY sequence ASC",
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
    let home = std::env::var("HOME").map_err(|_| DbError::Message("HOME not set".into()))?;
    let dir = PathBuf::from(home).join(".grok").join("sessions");
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
    let home = std::env::var("HOME").map_err(|_| DbError::Message("HOME not set".into()))?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("GrokBuildDesktop")
        .join("catalog.sqlite"))
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
        always_approve: row.get::<_, i64>(11)? != 0,
        draft: row.get(12)?,
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
            model: Some("grok-build".into()),
            always_approve: false,
            draft: Some("draft text".into()),
        };
        db.upsert_session(&summary).unwrap();
        db.save_draft("s1", "updated draft").unwrap();
        let loaded = db.get_session("s1").unwrap().unwrap();
        assert_eq!(loaded.draft.as_deref(), Some("updated draft"));
        assert_eq!(db.list_sessions(Some("/tmp/proj")).unwrap().len(), 1);

        db.append_event(
            "s1",
            1,
            "t",
            "chunk",
            &serde_json::json!({"text": "a"}),
        )
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

        db.delete_session("s1").unwrap();
        assert!(db.get_session("s1").unwrap().is_none());
    }

    #[test]
    fn event_cache_trims_to_limit() {
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
            model: None,
            always_approve: false,
            draft: None,
        };
        db.upsert_session(&summary).unwrap();
        for i in 0..(EVENT_CACHE_LIMIT_PER_SESSION + 50) {
            db.append_event(
                "s2",
                i as u64,
                "t",
                "k",
                &serde_json::json!({"i": i}),
            )
            .unwrap();
        }
        let events = db.list_events("s2").unwrap();
        assert!(events.len() <= EVENT_CACHE_LIMIT_PER_SESSION);
    }
}
