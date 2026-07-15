//! Mock end-to-end journey coverage (T14) without a real Grok account.

#[cfg(test)]
mod tests {
    use crate::acp::{
        handlers_is_permission_for_test, NoopEventBus, RuntimePool, SharedEventBus, StartConfig,
    };
    use crate::cli_bridge::{install_cli_from_script, OFFICIAL_INSTALL_URL};
    use crate::contracts::{
        GitRepoState, ModeSwitchResult, SandboxMode, SessionRunState, SessionSummary,
    };
    use crate::db::Database;
    use crate::git_ops::{refresh_review, WorktreeCreateRequest};
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::Duration;

    fn mock_agent() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/mock_acp_agent.py")
    }

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "gbd-e2e-{}-{}-{}",
            name,
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn start_cfg(cwd: &std::path::Path, mock: &std::path::Path) -> StartConfig {
        StartConfig {
            task_id: Some("e2e-task".into()),
            grok_path: Some(mock.to_string_lossy().into()),
            model: None,
            reasoning_effort: None,
            always_approve: false,
            cwd: cwd.to_string_lossy().into(),
            rules: None,
            agent_profile: None,
            use_harness: false,
            sandbox: Some(SandboxMode::None),
            privacy_mode: crate::platform::PrivacyMode::Strict,
            power_profile: None,
            resume_session_id: None,
            private_chat: false,
        }
    }

    #[tokio::test]
    async fn journey_session_prompt_and_catalog() {
        let mock = mock_agent();
        let ws = temp_dir("session");
        let db_path = ws.join("catalog.sqlite");
        let db = Database::open_path(&db_path).unwrap();
        let ws_rec = db
            .upsert_workspace(ws.to_str().unwrap(), Some("e2e"))
            .unwrap();
        assert_eq!(ws_rec.name, "e2e");

        let pool = RuntimePool::new();
        let bus: SharedEventBus = Arc::new(NoopEventBus);
        let st = pool
            .start_with_bus(bus, start_cfg(&ws, &mock))
            .await
            .expect("start");
        assert!(st.running);
        let conn = st.connection_id.clone().unwrap();
        let sess = st.session_id.clone().unwrap();
        assert!(st
            .available_commands
            .iter()
            .any(|command| command.name == "goal"));
        let mode = pool
            .set_session_mode(&conn, &sess, "plan")
            .await
            .expect("set plan mode");
        match mode {
            ModeSwitchResult::Switched { state } => {
                assert_eq!(state.current_mode, "plan");
                assert!(state.live_switch_supported);
            }
            other => panic!("expected live Plan switch, got {other:?}"),
        }

        let summary = SessionSummary {
            session_id: "local-e2e".into(),
            connection_id: Some(conn.clone()),
            workspace_root: ws.to_string_lossy().into(),
            title: "E2E".into(),
            created_at: "t0".into(),
            updated_at: "t0".into(),
            last_message_preview: None,
            run_state: SessionRunState::Streaming,
            remote_session_id: Some(sess.clone()),
            worktree_path: None,
            execution_root: Some(ws.to_string_lossy().into()),
            base_commit: None,
            mode: crate::contracts::TaskMode::Agent,
            permission_policy: crate::contracts::PermissionPolicy::WorkspaceEdit,
            sandbox: crate::contracts::SandboxMode::Workspace,
            archived: false,
            attention_required: false,
            applied_at: None,
            model: Some("grok-build".into()),
            reasoning_effort: None,
            always_approve: false,
            draft: Some("hello draft".into()),
        };
        db.upsert_session(&summary).unwrap();
        db.save_draft("local-e2e", "updated").unwrap();

        let result = pool
            .prompt_session(&conn, &sess, "build feature")
            .await
            .unwrap();
        assert_eq!(
            result.get("echoSessionId").and_then(|v| v.as_str()),
            Some(sess.as_str())
        );

        let resumed = pool
            .start_with_bus(
                Arc::new(NoopEventBus),
                StartConfig {
                    resume_session_id: Some(sess.clone()),
                    ..start_cfg(&ws, &mock)
                },
            )
            .await
            .unwrap();
        assert_eq!(resumed.session_id.as_deref(), Some(sess.as_str()));
        pool.cancel_session(&conn, &sess).unwrap();

        assert!(handlers_is_permission_for_test(
            "session/request_permission"
        ));
        assert!(!handlers_is_permission_for_test("fs/read_text_file"));

        pool.stop_all().await.unwrap();
        assert_eq!(
            db.get_session("local-e2e")
                .unwrap()
                .unwrap()
                .draft
                .as_deref(),
            Some("updated")
        );
    }

    #[tokio::test]
    async fn journey_agent_crash_clears_pending() {
        let mock = mock_agent();
        let ws = temp_dir("crash");
        let pool = RuntimePool::new();
        let bus: SharedEventBus = Arc::new(NoopEventBus);
        let st = pool
            .start_with_bus(bus, start_cfg(&ws, &mock))
            .await
            .unwrap();
        let conn = st.connection_id.unwrap();
        let hang = pool.request_on(&conn, "mock/hang", json!({}), Duration::from_secs(5));
        tokio::time::sleep(Duration::from_millis(30)).await;
        let _ = pool
            .request_on(&conn, "mock/exit", json!({}), Duration::from_secs(2))
            .await;
        assert!(hang.await.is_err());
        pool.stop_all().await.unwrap();
    }

    #[test]
    fn journey_git_diff_and_worktree() {
        let repo = temp_dir("git");
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&repo)
            .status()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "e2e@example.com"])
            .current_dir(&repo)
            .status()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "E2E"])
            .current_dir(&repo)
            .status()
            .unwrap();
        std::fs::write(repo.join("f.txt"), "one").unwrap();
        std::process::Command::new("git")
            .args(["add", "f.txt"])
            .current_dir(&repo)
            .status()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo)
            .status()
            .unwrap();

        let clean = refresh_review(repo.to_str().unwrap()).unwrap();
        assert_eq!(clean.state, GitRepoState::Clean);

        std::fs::write(repo.join("f.txt"), "two").unwrap();
        let dirty = refresh_review(repo.to_str().unwrap()).unwrap();
        assert_eq!(dirty.state, GitRepoState::Dirty);

        let wt = repo.join("linked-wt");
        let created = crate::git_ops::create_worktree(&WorktreeCreateRequest {
            workspace_root: repo.to_string_lossy().into(),
            r#ref: Some("HEAD".into()),
            path: Some(wt.to_string_lossy().into()),
            branch: Some("e2e-wt".into()),
            private_chat: false,
            dirty_policy: "clean_head".into(),
        })
        .unwrap();
        assert!(PathBuf::from(&created.path).exists());
    }

    #[test]
    fn journey_install_rejects_bad_url_and_cancel() {
        let cancel = Arc::new(AtomicBool::new(false));
        assert!(install_cli_from_script("https://example.com/x.sh", cancel).is_err());
        let cancel = Arc::new(AtomicBool::new(true));
        assert!(install_cli_from_script(OFFICIAL_INSTALL_URL, cancel).is_err());
    }
}
