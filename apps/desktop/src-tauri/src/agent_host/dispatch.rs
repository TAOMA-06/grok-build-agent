//! Host JSON-RPC method dispatch table.

use super::*;
use crate::host_rpc::{self, HostRequest, HostResponse};
use serde_json::{json, Value};

pub(super) async fn dispatch(state: &HostState, request: HostRequest) -> HostResponse {
    let method = request.method.clone();
    let meta = request.meta.clone();
    let audit_params = request.params.clone();
    let private_request = request_targets_private_session(state, &request.params)
        || (method == "runtime.stop" && state.runtime.active_connection_is_private());
    if private_request
        && matches!(
            method.as_str(),
            "catalog.sessions.upsert"
                | "catalog.sessions.delete"
                | "catalog.sessions.saveDraft"
                | "catalog.sessions.saveUi"
                | "task.upsert"
                | "context.save"
            | "verification.save"
            | "events.appendCompat"
            | "events.platform.append"
            | "memory.upsert"
            | "memory.review"
            | "profile.save"
        )
    {
        return success(request.id, json!({}));
    }
    let _idempotency_guard = if host_rpc::is_write_method(&method) {
        match meta.as_ref() {
            Some(meta) => Some(
                acquire_idempotency_guard(&state.idempotency_locks, &meta.idempotency_key).await,
            ),
            None => None,
        }
    } else {
        None
    };
    if !private_request {
        if let Some(meta) = meta.as_ref() {
            match state.db.load_rpc_result(&meta.idempotency_key, &method) {
                Ok(Some(value)) => match serde_json::from_value(value) {
                    Ok(response) => return response,
                    Err(error) => return error_response(request.id, -32000, &error.to_string()),
                },
                Ok(None) => {}
                Err(error) => return error_response(request.id, -32000, &error.to_string()),
            }
        }
    }
    let id = request.id;
    let result: Result<Value, String> = match request.method.as_str() {
        "host.hello" | "host.health" => Ok(json!({
            "protocolVersion": host_rpc::HOST_RPC_VERSION,
            "pid": std::process::id(),
            "database": state.db.path(),
            "status": state.runtime.status(),
        })),
        "host.shutdown" => match state.runtime.stop_all().await {
            Ok(()) => {
                state.terminals.release_all().await;
                let _ = state.db.clear_session_policy_rules();
                let _ = state.db.mark_runtime_processes_stopped();
                state.private_task_roots.lock().clear();
                state.private_sessions.lock().clear();
                state.private_connections.lock().clear();
                state.private_terminals.lock().clear();
                state
                    .shutdown
                    .send(true)
                    .map(|_| json!({}))
                    .map_err(|_| "Agent Host shutdown receiver is unavailable".to_string())
            }
            Err(error) => Err(error.to_string()),
        },
        "doctor.status" => {
            let database = state.db.integrity_check().map(|_| "ok").unwrap_or("failed");
            Ok(json!({
                "host": "ok",
                "protocolVersion": host_rpc::HOST_RPC_VERSION,
                "pid": std::process::id(),
                "database": database,
                "databasePath": state.db.path(),
                "socket": socket_path().ok(),
                "runtime": state.runtime.status(),
                "strictNetworkIsolation": false,
                "pendingPermissions": state.db.list_permission_requests(true).map(|items| items.len()).unwrap_or(0),
                "blobBytes": state.blobs.disk_usage().unwrap_or(0),
            }))
        }
        "doctor.rebuildProjections" => state
            .db
            .rebuild_projections()
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "doctor.bundlePreview" => diagnostic_bundle(state).map(Value::String),
        "doctor.exportBundle" => diagnostic_bundle(state).and_then(|bundle| {
            write_export_file(
                request
                    .params
                    .get("destination")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "diagnostic export requires destination".to_string())?,
                bundle.as_bytes(),
            )
        }),
        "doctor.gcBlobs" => gc_blobs(state),
        "execution.get" => request
            .params
            .get("taskId")
            .and_then(Value::as_str)
            .filter(|task_id| !task_id.trim().is_empty())
            .ok_or_else(|| "execution.get requires taskId".to_string())
            .and_then(|task_id| {
                state
                    .db
                    .get_active_execution(task_id)
                    .map_err(|error| error.to_string())
                    .and_then(|value| {
                        serde_json::to_value(value).map_err(|error| error.to_string())
                    })
            }),
        "execution.events" => request
            .params
            .get("executionId")
            .and_then(Value::as_str)
            .filter(|execution_id| !execution_id.trim().is_empty())
            .ok_or_else(|| "execution.events requires executionId".to_string())
            .and_then(|execution_id| {
                state
                    .db
                    .list_execution_events(execution_id)
                    .map_err(|error| error.to_string())
                    .and_then(|value| {
                        serde_json::to_value(value).map_err(|error| error.to_string())
                    })
            }),
        "execution.intent" => request
            .params
            .get("idempotencyKey")
            .and_then(Value::as_str)
            .filter(|idempotency_key| !idempotency_key.trim().is_empty())
            .ok_or_else(|| "execution.intent requires idempotencyKey".to_string())
            .and_then(|idempotency_key| {
                state
                    .db
                    .get_execution_intent(idempotency_key)
                    .map_err(|error| error.to_string())
                    .and_then(|value| {
                        serde_json::to_value(value).map_err(|error| error.to_string())
                    })
            }),
        "execution.resume" => match serde_json::from_value::<ExecutionResumeRoute>(request.params)
        {
            Ok(route) => resume_execution(state, route).await,
            Err(error) => Err(error.to_string()),
        },
        "transcript.export" => export_transcript(state, &request.params),
        "runtime.status" => serde_json::to_value(state.runtime.status()).map_err(|e| e.to_string()),
        "runtime.snapshot" => {
            serde_json::to_value(state.runtime.snapshot()).map_err(|e| e.to_string())
        }
        "runtime.probe" => serde_json::to_value(crate::acp::probe_grok(
            request.params.get("grokPath").and_then(Value::as_str),
        )).map_err(|error| error.to_string()),
        "runtime.adapters.list" => {
            let settings = crate::config::load_settings().ok();
            let secondary = settings
                .as_ref()
                .map(|item| item.secondary_acp_path.as_str())
                .filter(|path| !path.trim().is_empty());
            serde_json::to_value(crate::adapter_registry::list_adapter_catalog(
                request.params.get("grokPath").and_then(Value::as_str)
                    .or_else(|| settings.as_ref().map(|item| item.grok_path.as_str()).filter(|path| !path.is_empty())),
                secondary,
            )).map_err(|error| error.to_string())
        },
        "runtime.health" => serde_json::to_value(crate::runtime::health(
            request.params.get("grokPath").and_then(Value::as_str),
        )).map_err(|error| error.to_string()),
        "runtime.models" => crate::cli_bridge::list_models(
            request.params.get("grokPath").and_then(Value::as_str),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "runtime.capabilities" => crate::cli_bridge::inspect_capabilities(
            request.params.get("grokPath").and_then(Value::as_str),
            request.params.get("workspaceRoot").and_then(Value::as_str),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "plugin.list" => crate::cli_bridge::list_plugins(
            request.params.get("grokPath").and_then(Value::as_str),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "plugin.install" => crate::cli_bridge::install_plugin(
            request.params.get("grokPath").and_then(Value::as_str),
            request.params.get("source").and_then(Value::as_str).unwrap_or_default(),
        ).map(Value::String).map_err(|error| error.to_string()),
        "plugin.uninstall" => crate::cli_bridge::uninstall_plugin(
            request.params.get("grokPath").and_then(Value::as_str),
            request.params.get("name").and_then(Value::as_str).unwrap_or_default(),
        ).map(Value::String).map_err(|error| error.to_string()),
        "plugin.setEnabled" => crate::cli_bridge::set_plugin_enabled(
            request.params.get("grokPath").and_then(Value::as_str),
            request.params.get("name").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        ).map(Value::String).map_err(|error| error.to_string()),
        "plugin.validate" => crate::cli_bridge::validate_plugin(
            request.params.get("grokPath").and_then(Value::as_str),
            request.params.get("path").and_then(Value::as_str).unwrap_or_default(),
        ).map(Value::String).map_err(|error| error.to_string()),
        "runtime.updateCheck" => crate::cli_bridge::check_update(
            request.params.get("grokPath").and_then(Value::as_str),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "runtime.update" => crate::cli_bridge::run_update(
            request.params.get("grokPath").and_then(Value::as_str),
        ).map(Value::String).map_err(|error| error.to_string()),
        "runtime.login" => crate::cli_bridge::run_login_oauth(
            request.params.get("grokPath").and_then(Value::as_str),
        ).map(Value::String).map_err(|error| error.to_string()),
        "runtime.logout" => crate::cli_bridge::run_logout(
            request.params.get("grokPath").and_then(Value::as_str),
        ).map(Value::String).map_err(|error| error.to_string()),
        "runtime.install" => crate::cli_bridge::install_cli_from_script(
            crate::cli_bridge::OFFICIAL_INSTALL_URL,
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "settings.load" => crate::config::load_settings()
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "settings.save" => serde_json::from_value::<crate::config::AppSettings>(
            request.params.get("settings").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|settings| crate::config::save_settings(&settings).map_err(|error| error.to_string()))
        .map(|_| {
            json!({})
        }),
        "jobs.list" => state
            .db
            .list_jobs(request.params.get("workspaceId").and_then(Value::as_str))
            .map_err(|error| error.to_string())
            .map(Value::Array),
        "jobs.upsert" => {
            let job_id = request
                .params
                .get("jobId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let workspace_id = request
                .params
                .get("workspaceId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if workspace_id.is_empty() {
                Err("workspaceId is required".into())
            } else {
                let kind = request
                    .params
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("agent_prompt");
                let schedule = request.params.get("schedule").and_then(Value::as_str);
                let state_name = request
                    .params
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or("active");
                let policy = request
                    .params
                    .get("policy")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let policy_json = serde_json::to_string(&policy).unwrap_or_else(|_| "{}".into());
                state
                    .db
                    .upsert_job(
                        &job_id,
                        workspace_id,
                        request.params.get("taskId").and_then(Value::as_str),
                        kind,
                        schedule,
                        state_name,
                        request.params.get("idempotencyKey").and_then(Value::as_str),
                        &policy_json,
                        request.params.get("nextRunAt").and_then(Value::as_str),
                    )
                    .map_err(|error| error.to_string())
            }
        }
        "jobs.cancel" => {
            let job_id = request
                .params
                .get("jobId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if job_id.is_empty() {
                Err("jobId is required".into())
            } else {
                state
                    .db
                    .cancel_job(job_id)
                    .map_err(|error| error.to_string())
                    .map(|changed| json!({ "cancelled": changed }))
            }
        },
        "secret.status" => serde_json::to_value(crate::secrets::status()).map_err(|error| error.to_string()),
        "secret.set" => {
            let key = request.params.get("apiKey").and_then(Value::as_str).unwrap_or_default();
            crate::secrets::set_api_key(key)
                .map_err(|error| error.to_string())
                .map(|_| {
                    crate::secrets::apply_api_key_to_env(key);
                    json!({})
                })
        }
        "secret.clear" => crate::secrets::delete_api_key()
            .map_err(|error| error.to_string())
            .map(|_| json!({})),
        "catalog.workspaces.list" => state
            .db
            .list_workspaces()
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "catalog.workspaces.upsert" => {
            let path = request.params.get("path").and_then(Value::as_str).unwrap_or_default();
            let name = request.params.get("name").and_then(Value::as_str);
            state
                .db
                .upsert_workspace(path, name)
                .map_err(|error| error.to_string())
                .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string()))
        }
        "catalog.workspaces.favorite" => {
            let id = request.params.get("id").and_then(Value::as_str).unwrap_or_default();
            let favorite = request
                .params
                .get("favorite")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            state
                .db
                .set_workspace_favorite(id, favorite)
                .map(|_| json!({}))
                .map_err(|error| error.to_string())
        }
        "catalog.sessions.list" => state
            .db
            .list_sessions(request.params.get("workspaceRoot").and_then(Value::as_str))
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "task.get" => state.db.get_task(
            request.params.get("taskId").and_then(Value::as_str).unwrap_or_default(),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "task.upsert" => serde_json::from_value::<crate::platform::TaskDefinition>(
            request.params.get("task").cloned().unwrap_or(Value::Null),
        ).map_err(|error| error.to_string())
          .and_then(|task| state.db.upsert_task(&task).map_err(|error| error.to_string()))
          .map(|_| json!({})),
        "context.save" => serde_json::from_value::<crate::platform::ContextManifest>(
            request.params.get("manifest").cloned().unwrap_or(Value::Null),
        ).map_err(|error| error.to_string())
          .and_then(|manifest| state.db.save_context_manifest(&manifest).map_err(|error| error.to_string()))
          .map(|_| json!({})),
        "context.list" => state.db.list_context_manifests(
            request.params.get("taskId").and_then(Value::as_str).unwrap_or_default(),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "verification.save" => serde_json::from_value::<crate::platform::VerificationResult>(
            request.params.get("result").cloned().unwrap_or(Value::Null),
        ).map_err(|error| error.to_string())
          .and_then(|result| {
              validate_manual_verification(&result)?;
              state.db.save_verification_result(&result).map_err(|error| error.to_string())
          })
          .map(|_| json!({})),
        "verification.run" => run_verification(state, &request.params, false).await,
        "verification.list" => state.db.list_verification_results(
            request.params.get("taskId").and_then(Value::as_str).unwrap_or_default(),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "memory.list" => state
            .db
            .list_memory_candidates(
                request.params.get("workspaceId").and_then(Value::as_str),
                request.params.get("state").and_then(Value::as_str),
            )
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "memory.upsert" => serde_json::from_value::<crate::platform::MemoryCandidate>(
            request.params.get("memory").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|memory| {
            if memory.content.trim().is_empty() {
                return Err("memory content is required".into());
            }
            state
                .db
                .upsert_memory_candidate(&memory)
                .map_err(|error| error.to_string())
        })
        .map(|_| json!({})),
        "memory.review" => {
            let memory_id = request
                .params
                .get("memoryId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if memory_id.is_empty() {
                Err("memoryId is required".into())
            } else {
                match request.params.get("state").and_then(Value::as_str) {
                    Some("accepted") | None => Ok(crate::platform::MemoryState::Accepted),
                    Some("rejected") => Ok(crate::platform::MemoryState::Rejected),
                    Some("candidate") => Ok(crate::platform::MemoryState::Candidate),
                    Some(other) => Err(format!("unknown memory state {other}")),
                }
                .and_then(|next| {
                    state
                        .db
                        .review_memory_candidate(memory_id, next, &crate::acp::iso_now())
                        .map_err(|error| error.to_string())
                        .map(|changed| json!({ "updated": changed }))
                })
            }
        }
        "profile.get" => {
            let workspace_id = request
                .params
                .get("workspaceId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if workspace_id.is_empty() {
                Err("workspaceId is required".into())
            } else {
                crate::workspace_ops::get_project_profile(workspace_id)
                    .map_err(|error| error.to_string())
                    .and_then(|value| {
                        serde_json::to_value(value).map_err(|error| error.to_string())
                    })
            }
        }
        "profile.save" => {
            let workspace_id = request
                .params
                .get("workspaceId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let content = request
                .params
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("");
            if workspace_id.is_empty() {
                Err("workspaceId is required".into())
            } else {
                crate::workspace_ops::save_project_profile(workspace_id, content)
                    .map_err(|error| error.to_string())
                    .and_then(|value| {
                        serde_json::to_value(value).map_err(|error| error.to_string())
                    })
            }
        }
        "task.completionGate" => state.db.completion_gate(
            request.params.get("taskId").and_then(Value::as_str).unwrap_or_default(),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "task.complete" => state.db.complete_task(
            request.params.get("taskId").and_then(Value::as_str).unwrap_or_default(),
        ).map_err(|error| error.to_string())
          .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "catalog.grokSessions.list" => crate::db::list_grok_session_dirs()
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "catalog.sessions.upsert" => serde_json::from_value::<crate::contracts::SessionSummary>(
            request.params.get("summary").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|summary| {
            state.db.upsert_session(&summary).map_err(|error| error.to_string())?;
            if state.db.get_task(&summary.session_id).map_err(|error| error.to_string())?.is_none() {
                state.db.upsert_task(&default_task_for_session(&summary)).map_err(|error| error.to_string())?;
            }
            Ok(())
        })
        .map(|_| json!({})),
        "catalog.sessions.get" => state
            .db
            .get_session(
                request.params.get("sessionId").and_then(Value::as_str).unwrap_or_default(),
            )
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "catalog.sessions.delete" => state
            .db
            .delete_session(
                request.params.get("sessionId").and_then(Value::as_str).unwrap_or_default(),
            )
            .map(|_| json!({}))
            .map_err(|error| error.to_string()),
        "catalog.sessions.saveDraft" => state
            .db
            .save_draft(
                request.params.get("sessionId").and_then(Value::as_str).unwrap_or_default(),
                request.params.get("draft").and_then(Value::as_str).unwrap_or_default(),
            )
            .map(|_| json!({}))
            .map_err(|error| error.to_string()),
        "catalog.sessions.saveUi" => serde_json::from_value::<crate::contracts::SessionUiState>(
            request.params.get("ui").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|ui| state.db.save_session_ui(&ui).map_err(|error| error.to_string()))
        .map(|_| json!({})),
        "catalog.sessions.loadUi" => state
            .db
            .load_session_ui(
                request.params.get("sessionId").and_then(Value::as_str).unwrap_or_default(),
            )
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "events.list" => state
            .db
            .list_events(
                request.params.get("sessionId").and_then(Value::as_str).unwrap_or_default(),
            )
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "events.appendCompat" => state
            .db
            .append_event(
                request.params.get("sessionId").and_then(Value::as_str).unwrap_or_default(),
                request.params.get("sequence").and_then(Value::as_u64).unwrap_or(0),
                request.params.get("timestamp").and_then(Value::as_str).unwrap_or_default(),
                request.params.get("kind").and_then(Value::as_str).unwrap_or_default(),
                request.params.get("payload").unwrap_or(&Value::Null),
            )
            .map(|_| json!({}))
            .map_err(|error| error.to_string()),
        "events.platform.list" => state
            .db
            .list_platform_events(
                request.params.get("taskId").and_then(Value::as_str).unwrap_or_default(),
                request.params.get("afterSequence").and_then(Value::as_u64),
                request.params.get("limit").and_then(Value::as_u64).unwrap_or(1_000) as usize,
            )
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "events.platform.append" => append_platform_event(state, request.params),
        "host.databasePath" => Ok(json!(state.db.path().to_string_lossy())),
        "workspace.tree" => crate::workspace_ops::tree(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("path").and_then(Value::as_str),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "workspace.search" => crate::workspace_ops::search(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("query").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "workspace.index.search" => crate::code_index::search_symbols(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("query").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "workspace.read" => crate::workspace_ops::read(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("path").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "terminal.create" => create_platform_terminal(state, &request.params).await,
        "terminal.list" => Ok(state.terminals.list(
            request.params.get("taskId").and_then(Value::as_str),
        )),
        "terminal.output" => state.terminals.output_page(
            request.params.get("terminalId").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize,
            request.params.get("limit").and_then(Value::as_u64).unwrap_or(64 * 1024) as usize,
        ).map_err(|error| error.to_string()),
        "terminal.input" => input_platform_terminal(state, &request.params).await,
        "terminal.resize" => state.terminals.resize(
            request.params.get("terminalId").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("columns").and_then(Value::as_u64).unwrap_or(80) as u16,
            request.params.get("rows").and_then(Value::as_u64).unwrap_or(24) as u16,
        ).map_err(|error| error.to_string()),
        "terminal.ports" => state.terminals.ports(
            request.params.get("terminalId").and_then(Value::as_str).unwrap_or_default(),
        ).map_err(|error| error.to_string()),
        "terminal.kill" => stop_platform_terminal(state, &request.params, false).await,
        "terminal.release" => stop_platform_terminal(state, &request.params, true).await,
        "attachment.inspect" => serde_json::from_value::<Vec<String>>(
            request.params.get("paths").cloned().unwrap_or(Value::Array(vec![])),
        )
        .map_err(|error| error.to_string())
        .and_then(|paths| crate::attachments::inspect_paths(paths).map_err(|error| error.to_string()))
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "attachment.prepare" => serde_json::from_value(request.params.get("files").cloned().unwrap_or(Value::Array(vec![])))
            .map_err(|error| error.to_string())
            .and_then(|files| crate::attachments::prepare(files).map_err(|error| error.to_string()))
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "git.review" => crate::git_ops::refresh_review(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "git.filePatch" => crate::git_ops::file_patch(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("path").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("staged").and_then(Value::as_bool).unwrap_or(false),
            256 * 1024,
        )
        .map(Value::String)
        .map_err(|error| error.to_string()),
        "git.fileAction" => serde_json::from_value::<crate::git_ops::GitFileActionRequest>(
            request.params.get("request").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|request| {
            let checkpoint = matches!(request.action, crate::git_ops::GitFileAction::Revert)
                .then(|| crate::git_ops::create_checkpoint(&request.workspace_root))
                .transpose()
                .map_err(|error| error.to_string())?;
            crate::git_ops::apply_file_action(&request).map_err(|error| error.to_string())?;
            serde_json::to_value(crate::git_ops::GitMutationResult { checkpoint })
                .map_err(|error| error.to_string())
        }),
        "git.hunkAction" => serde_json::from_value::<crate::git_ops::GitHunkActionRequest>(
            request.params.get("request").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|request| {
            let checkpoint = matches!(request.action, crate::git_ops::GitFileAction::Revert)
                .then(|| crate::git_ops::create_checkpoint(&request.workspace_root))
                .transpose()
                .map_err(|error| error.to_string())?;
            crate::git_ops::apply_hunk_action(&request).map_err(|error| error.to_string())?;
            serde_json::to_value(crate::git_ops::GitMutationResult { checkpoint })
                .map_err(|error| error.to_string())
        }),
        "git.commit" => serde_json::from_value::<crate::git_ops::GitCommitRequest>(
            request.params.get("request").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|request| crate::git_ops::commit(&request).map_err(|error| error.to_string()))
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "git.checkpoint.create" => crate::git_ops::create_checkpoint(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "git.checkpoint.preview" => crate::git_ops::checkpoint_restore_preview(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("checkpointId").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "git.checkpoint.restore" => crate::git_ops::restore_checkpoint(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
            request.params.get("checkpointId").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "worktree.list" => crate::git_ops::list_merged_worktrees(
            request.params.get("workspaceRoot").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "worktree.create" => serde_json::from_value::<crate::git_ops::WorktreeCreateRequest>(
            request.params.get("request").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|request| crate::git_ops::create_worktree(&request).map_err(|error| error.to_string()))
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "worktree.delete" => {
            let parsed = serde_json::from_value::<crate::git_ops::WorktreeDeleteRequest>(
                request.params.get("request").cloned().unwrap_or(Value::Null),
            );
            parsed
                .map_err(|error| error.to_string())
                .and_then(|worktree| crate::git_ops::delete_worktree(
                    &worktree,
                    request.params.get("mainWorkspace").and_then(Value::as_str).unwrap_or_default(),
                ).map_err(|error| error.to_string()))
                .map(|_| json!({}))
        }
        "worktree.deletePreview" => crate::git_ops::worktree_delete_preview(
            request.params.get("path").and_then(Value::as_str).unwrap_or_default(),
        )
        .map_err(|error| error.to_string()),
        "worktree.applyPreview" => serde_json::from_value::<crate::git_ops::WorktreeApplyRequest>(
            request.params.get("request").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|request| crate::git_ops::worktree_apply_preview(&request).map_err(|error| error.to_string()))
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "worktree.apply" => serde_json::from_value::<crate::git_ops::WorktreeApplyRequest>(
            request.params.get("request").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|request| crate::git_ops::apply_worktree_changes(&request).map_err(|error| error.to_string()))
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "mcp.list" => crate::cli_bridge::list_mcp_full(
            request.params.get("grokPath").and_then(Value::as_str),
            request.params.get("workspaceRoot").and_then(Value::as_str),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "mcp.upsert" => serde_json::from_value::<crate::contracts::McpServerInput>(
            request.params.get("input").cloned().unwrap_or(Value::Null),
        )
        .map_err(|error| error.to_string())
        .and_then(|input| crate::cli_bridge::upsert_mcp(
            request.params.get("grokPath").and_then(Value::as_str),
            &input,
        ).map_err(|error| error.to_string()))
        .map(Value::String),
        "mcp.remove" => {
            let scope = request.params.get("scope").cloned().map(serde_json::from_value).transpose();
            scope
                .map_err(|error| error.to_string())
                .and_then(|scope| crate::cli_bridge::remove_mcp(
                    request.params.get("grokPath").and_then(Value::as_str),
                    request.params.get("name").and_then(Value::as_str).unwrap_or_default(),
                    scope,
                    request.params.get("workspaceRoot").and_then(Value::as_str),
                ).map_err(|error| error.to_string()))
                .map(Value::String)
        }
        "mcp.doctor" => crate::cli_bridge::doctor_mcp(
            request.params.get("grokPath").and_then(Value::as_str),
            request.params.get("name").and_then(Value::as_str),
            request.params.get("workspaceRoot").and_then(Value::as_str),
        )
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "mcp.setEnabled" => {
            let enabled = request
                .params
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            crate::cli_bridge::set_mcp_enabled(
                request.params.get("grokPath").and_then(Value::as_str),
                request
                    .params
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                enabled,
                request.params.get("workspaceRoot").and_then(Value::as_str),
            )
            .map_err(|error| error.to_string())
            .map(Value::String)
        }
        "runtime.start" => match serde_json::from_value::<StartConfig>(request.params) {
            Ok(config) if matches!(config.sandbox, Some(crate::contracts::SandboxMode::Strict)) => {
                Err("Strict sandbox is unavailable because Grok cannot attest enforceable network isolation; use workspace sandbox".into())
            }
            Ok(config) => {
                let task_id = config
                    .task_id
                    .clone()
                    .unwrap_or_else(|| format!("legacy:{}", config.cwd));
                let execution_root = std::fs::canonicalize(&config.cwd)
                    .map_err(|error| format!("execution root is unavailable: {error}"));
                let execution_root = match execution_root {
                    Ok(root) => root,
                    Err(error) => return error_response(id, -32000, &error),
                };
                let private_chat = config.private_chat;
                if !private_chat && !config.cwd.trim().is_empty() {
                    if let Err(error) = state.db.upsert_workspace(&config.cwd, None) {
                        return error_response(id, -32000, &error.to_string());
                    }
                }
                let bus: SharedEventBus = Arc::new(HostEventBus {
                    db: state.db.clone(),
                    events: state.events.clone(),
                    pending_actions: state.pending_actions.clone(),
                    private_chat,
                });
                match state.runtime.start_with_bus(bus, config).await {
                    Ok(status) => {
                        if private_chat {
                            state
                                .private_task_roots
                                .lock()
                                .insert(task_id.clone(), execution_root);
                            if let Some(connection_id) = status.connection_id.as_deref() {
                                state
                                    .private_connections
                                    .lock()
                                    .insert(connection_id.to_string());
                            }
                            if let Some(session_id) = status.session_id.as_deref() {
                                state
                                    .private_sessions
                                    .lock()
                                    .insert(session_id.to_string(), task_id.clone());
                            }
                        } else {
                            let _ = state
                                .db
                                .record_runtime_snapshot(&state.runtime.persistent_snapshot());
                        }
                        serde_json::to_value(status).map_err(|error| error.to_string())
                    }
                    Err(error) => Err(error.to_string()),
                }
            }
            Err(error) => Err(error.to_string()),
        },
        "runtime.stop" => {
            let private_runtime = state.runtime.active_connection_is_private();
            state.runtime.stop().await.map(|_| {
                if !private_runtime {
                    let _ = state.db.clear_session_policy_rules();
                    let _ = state.db.mark_runtime_processes_stopped();
                }
                state.private_task_roots.lock().clear();
                state.private_sessions.lock().clear();
                state.private_connections.lock().clear();
                state.private_terminals.lock().clear();
                json!({})
            })
            .map_err(|e| e.to_string())
        }
        "session.prompt" => prompt(state, request.params).await,
        "session.cancel" => match serde_json::from_value::<SessionRoute>(request.params) {
            Ok(route) => {
                let result = state
                    .runtime
                    .cancel_session(&route.connection_id, &route.session_id)
                    .map_err(|e| e.to_string());
                if result.is_ok() {
                    if let Some(task_id) = private_task_for_session(state, &route.session_id) {
                        state.terminals.cancel_task(&task_id);
                        state.private_task_roots.lock().remove(&task_id);
                        state.private_sessions.lock().remove(&route.session_id);
                    } else if let Ok(Some(task_id)) = state.db.local_session_id(&route.session_id) {
                        let _ = state.db.cancel_execution_for_task(&task_id);
                        let _ = state.db.cancel_prepared_prompt_dispatches(&task_id);
                        fail_execution_waiters_for_task(state, &task_id, "prompt was cancelled");
                        state.terminals.cancel_task(&task_id);
                        let _ = state.db.mark_task_terminals_stopped(&task_id);
                        let _ = state
                            .db
                            .transition_task_state(&task_id, crate::platform::TaskState::Cancelled);
                    }
                }
                result.map(|_| json!({}))
            }
            Err(error) => Err(error.to_string()),
        },
        "session.setModel" => match serde_json::from_value::<ModelRoute>(request.params) {
            Ok(route) => state
                .runtime
                .set_session_model(&route.connection_id, &route.session_id, &route.model_id)
                .await
                .map(|model_state| {
                    if model_state.live_switch_supported {
                        crate::contracts::ModelSwitchResult::Switched { state: model_state }
                    } else {
                        crate::contracts::ModelSwitchResult::NewSessionRequired {
                            reason: "This Grok CLI cannot switch models in a live session.".into(),
                        }
                    }
                })
                .map_err(|error| error.to_string())
                .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
            Err(error) => Err(error.to_string()),
        },
        "session.setEffort" => match serde_json::from_value::<EffortRoute>(request.params) {
            Ok(route) => state
                .runtime
                .set_session_effort(&route.connection_id, &route.session_id, &route.effort)
                .await
                .map_err(|error| error.to_string())
                .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
            Err(error) => Err(error.to_string()),
        },
        "session.setMode" => match serde_json::from_value::<ModeRoute>(request.params) {
            Ok(route) => state
                .runtime
                .set_session_mode(&route.connection_id, &route.session_id, &route.mode)
                .await
                .map_err(|error| error.to_string())
                .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
            Err(error) => Err(error.to_string()),
        },
        "session.confirmMode" => match serde_json::from_value::<ModeRoute>(request.params) {
            Ok(route) => state
                .runtime
                .confirm_session_mode(&route.connection_id, &route.session_id, &route.mode)
                .map_err(|error| error.to_string())
                .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
            Err(error) => Err(error.to_string()),
        },
        "runtime.request" => match serde_json::from_value::<RuntimeRequest>(request.params) {
            Ok(route) => state
                .runtime
                .request(&route.method, route.params)
                .await
                .map_err(|error| error.to_string()),
            Err(error) => Err(error.to_string()),
        },
        "privacy.setCodingDataRetention" => {
            let privacy_mode_on = request
                .params
                .get("privacyMode")
                .or_else(|| request.params.get("codingDataPrivacy"))
                .and_then(|v| v.as_bool())
                .or_else(|| {
                    request
                        .params
                        .get("codingDataRetentionOptOut")
                        .and_then(|v| v.as_bool())
                })
                .unwrap_or(true);
            state
                .runtime
                .set_coding_data_privacy(privacy_mode_on)
                .await
                .map_err(|error| error.to_string())
        }
        "permission.decide" => match serde_json::from_value::<PermissionResponse>(request.params) {
            Ok(route) => {
                let request_id = route.id.clone();
                let decision = json!({ "result": route.result, "error": route.error });
                let decision_state = if decision.get("error").is_some_and(|value| !value.is_null()) {
                    "denied"
                } else {
                    "allowed_once"
                };
                if let Some(platform_id) = request_id
                    .as_str()
                    .filter(|request_id| request_id.starts_with("platform:"))
                {
                    let selected = decision
                        .pointer("/result/outcome/optionId")
                        .and_then(Value::as_str)
                        .or_else(|| {
                            decision
                                .pointer("/result/optionId")
                                .and_then(Value::as_str)
                        });
                    let allowed = matches!(
                        selected,
                        Some(
                            "platform:allow-once"
                                | "platform:allow-session"
                                | "platform:allow-project"
                        )
                    )
                        && decision.get("error").is_none_or(Value::is_null);
                    if !private_request {
                        if let Some(scope) = match selected {
                            Some("platform:allow-session") => Some("session"),
                            Some("platform:allow-project") => Some("project"),
                            _ => None,
                        } {
                            let stored = state
                                .db
                                .get_permission_request(&route.connection_id, &request_id)
                                .map_err(|error| error.to_string());
                            let action = stored.and_then(|stored| {
                                let raw = stored.ok_or_else(|| "permission request not found".to_string())?;
                                serde_json::from_value::<crate::platform::ActionRequest>(
                                    raw.action
                                        .pointer("/params/action")
                                        .cloned()
                                        .unwrap_or(Value::Null),
                                )
                                .map_err(|error| error.to_string())
                            });
                            if let Err(error) = action.and_then(|action| {
                                state
                                    .db
                                    .save_policy_rule(&action, scope)
                                    .map(|_| ())
                                    .map_err(|error| error.to_string())
                            }) {
                                return error_response(id, -32000, &error);
                            }
                        }
                    }
                    let sender = state.pending_actions.lock().remove(platform_id);
                    if let Some(sender) = sender {
                        let _ = sender.send(allowed);
                    } else {
                        return error_response(
                            id,
                            -32000,
                            "permission request is no longer pending",
                        );
                    }
                    if !private_request {
                        let _ = state.db.decide_permission_request(
                            &route.connection_id,
                            &request_id,
                            match selected {
                                Some("platform:allow-session") => "allowed_session",
                                Some("platform:allow-project") => "allowed_project",
                                _ if allowed => "allowed_once",
                                _ => "denied",
                            },
                            &decision,
                        );
                    }
                    return success(id, json!({}));
                }
                state
                    .runtime
                    .respond_to_request_on(
                        &route.connection_id,
                        route.id,
                        decision.get("result").cloned().filter(|value| !value.is_null()),
                        decision.get("error").cloned().filter(|value| !value.is_null()),
                    )
                    .await
                    .map_err(|error| error.to_string())
                    .and_then(|_| {
                        if private_request {
                            Ok(())
                        } else {
                            state
                                .db
                                .decide_permission_request(
                                    &route.connection_id,
                                    &request_id,
                                    decision_state,
                                    &decision,
                                )
                                .map(|_| ())
                                .map_err(|error| error.to_string())
                        }
                    })
                    .map(|_| json!({}))
            }
            Err(error) => Err(error.to_string()),
        },
        "permission.list" => state
            .db
            .list_permission_requests(
                request.params.get("pendingOnly").and_then(Value::as_bool).unwrap_or(false),
            )
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "permission.rule.list" => state
            .db
            .list_policy_rules(request.params.get("workspaceId").and_then(Value::as_str))
            .map_err(|error| error.to_string())
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "permission.rule.delete" => state
            .db
            .delete_policy_rule(
                request.params.get("ruleId").and_then(Value::as_str).unwrap_or_default(),
            )
            .map(|deleted| json!({ "deleted": deleted }))
            .map_err(|error| error.to_string()),
        _ => Err(format!("method not found: {}", request.method)),
    };
    let response = match result {
        Ok(value) => success(id, value),
        Err(error) => error_response(id, -32000, &crate::secrets::redact_secrets(&error)),
    };
    if !private_request && host_rpc::is_write_method(&method) {
        let workspace_id = audit_params
            .get("workspaceId")
            .or_else(|| audit_params.get("workspaceRoot"))
            .or_else(|| audit_params.pointer("/request/workspaceRoot"))
            .or_else(|| audit_params.pointer("/task/workspaceId"))
            .and_then(Value::as_str)
            .unwrap_or("platform")
            .to_string();
        let task_id = audit_params
            .get("taskId")
            .or_else(|| audit_params.pointer("/task/taskId"))
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let mut summary = crate::secrets::redact_secrets(&audit_params.to_string());
        summary.truncate(8 * 1024);
        let _ = state.db.record_audit(&crate::platform::AuditRecordInput {
            workspace_id,
            task_id,
            session_id: audit_params
                .get("sessionId")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            actor: "ui-broker".into(),
            action: method.clone(),
            decision: Some(
                if response.error.is_none() {
                    "allowed"
                } else {
                    "failed"
                }
                .into(),
            ),
            reason: response.error.as_ref().map(|error| error.message.clone()),
            redacted_summary: summary,
            event_id: None,
        });
    }
    if !private_request {
        if let Some(meta) = meta {
            if let Ok(value) = serde_json::to_value(&response) {
                let _ = state
                    .db
                    .store_rpc_result(&meta.idempotency_key, &method, &value);
            }
        }
    }
    response
}

