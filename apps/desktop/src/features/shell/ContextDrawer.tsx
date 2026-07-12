import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Clipboard,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitMerge,
  GitCommitHorizontal,
  RefreshCw,
  RotateCcw,
  ListPlus,
  Eye,
  ListChecks,
  Folder,
  TerminalSquare,
  Plus,
  Square,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore } from "../../store";
import type { SessionRuntime } from "../../store";
import type { GitCheckpoint, WorktreeApplyPreview } from "../../types";
import { t, translate } from "../../i18n";

function splitPatchHunks(patch: string): string[] {
  const lines = patch.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  if (firstHunk < 0) return [];
  const header = lines.slice(0, firstHunk);
  const hunks: string[][] = [];
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith("@@")) hunks.push([]);
    hunks[hunks.length - 1]?.push(line);
  }
  return hunks.map((hunk) => [...header, ...hunk].join("\n"));
}

export function ContextDrawer({
  session,
  onClose,
}: {
  session: SessionRuntime;
  onClose: () => void;
}) {
  const bridge = useDesktopBridge();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyPreview, setApplyPreview] = useState<WorktreeApplyPreview | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [taskGoal, setTaskGoal] = useState("");
  const [taskConstraints, setTaskConstraints] = useState("");
  const [taskAcceptance, setTaskAcceptance] = useState("");
  const [taskAllowedPaths, setTaskAllowedPaths] = useState("");
  const [taskVerification, setTaskVerification] = useState("");
  const [taskSaving, setTaskSaving] = useState(false);
  const [lastCheckpoint, setLastCheckpoint] = useState<GitCheckpoint | null>(null);
  const [explorerPath, setExplorerPath] = useState<string | null>(null);
  const [explorerSearch, setExplorerSearch] = useState("");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [verificationRunning, setVerificationRunning] = useState<string | null>(null);
  const [terminalTabs, setTerminalTabs] = useState<Array<{ id: string; title: string; output: string; offset: number; exitCode: number | null }>>([]);
  const [activeTerminal, setActiveTerminal] = useState<string | null>(null);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalPorts, setTerminalPorts] = useState<number[]>([]);
  const root = session.summary.executionRoot || session.summary.worktreePath || session.summary.workspaceRoot;
  const taskId = session.summary.sessionId;
  const reviewQuery = useQuery({
    queryKey: ["git-review", root],
    queryFn: () => bridge.gitReview(root),
  });
  const selectedFile = reviewQuery.data?.files.find((file) => file.path === selectedPath);
  const patchQuery = useQuery({
    queryKey: ["git-patch", root, selectedPath, selectedFile?.staged],
    queryFn: () => bridge.gitFilePatch(root, selectedPath!, Boolean(selectedFile?.staged)),
    enabled: Boolean(selectedPath),
  });
  const taskQuery = useQuery({ queryKey: ["task-definition", taskId], queryFn: () => bridge.getTask(taskId) });
  const contextQuery = useQuery({ queryKey: ["context-manifests", taskId], queryFn: () => bridge.listContextManifests(taskId) });
  const verificationQuery = useQuery({ queryKey: ["verification-results", taskId], queryFn: () => bridge.listVerificationResults(taskId) });
  const completionQuery = useQuery({
    queryKey: ["completion-gate", taskId],
    queryFn: () => bridge.taskCompletionGate(taskId),
    enabled: Boolean(taskQuery.data),
  });
  const treeQuery = useQuery({ queryKey: ["workspace-tree", root, explorerPath], queryFn: () => bridge.workspaceTree(root, explorerPath) });
  const searchQuery = useQuery({ queryKey: ["workspace-search", root, explorerSearch], queryFn: () => bridge.workspaceSearch(root, explorerSearch), enabled: explorerSearch.trim().length > 1 });
  const previewQuery = useQuery({ queryKey: ["workspace-preview", root, previewPath], queryFn: () => bridge.workspaceRead(root, previewPath!), enabled: Boolean(previewPath) });
  useEffect(() => {
    const task = taskQuery.data;
    if (!task) return;
    setTaskGoal(task.goal ?? "");
    setTaskConstraints(task.constraints.join("\n"));
    setTaskAcceptance(task.acceptance.join("\n"));
    setTaskAllowedPaths(task.allowedPaths.join("\n"));
    setTaskVerification(task.verificationCommands.join("\n"));
  }, [taskQuery.data]);
  useEffect(() => {
    void bridge.terminalList(taskId).then(async (terminals) => {
      const restored = await Promise.all(terminals.map(async (terminal, index) => {
        const page = await bridge.terminalOutput(terminal.terminalId, 0, 64 * 1024);
        return {
          id: terminal.terminalId,
          title: `Terminal ${index + 1}`,
          output: page.output,
          offset: page.nextOffset,
          exitCode: page.exitCode,
        };
      }));
      setTerminalTabs(restored);
      setActiveTerminal((current) => current ?? restored[0]?.id ?? null);
    }).catch((error) => setTerminalError(String(error)));
  }, [bridge, taskId]);
  useEffect(() => {
    if (!activeTerminal) return;
    const poll = window.setInterval(() => {
      const tab = terminalTabs.find((item) => item.id === activeTerminal);
      if (!tab || tab.exitCode !== null) return;
      void bridge.terminalOutput(tab.id, tab.offset, 64 * 1024).then((page) => {
        if (!page.output && page.exitCode === tab.exitCode) return;
        setTerminalTabs((items) => items.map((item) => item.id === tab.id ? {
          ...item,
          output: `${item.output}${page.output}`.slice(-4 * 1024 * 1024),
          offset: page.nextOffset,
          exitCode: page.exitCode,
        } : item));
      }).catch((error) => setTerminalError(String(error)));
    }, 500);
    return () => window.clearInterval(poll);
  }, [activeTerminal, bridge, terminalTabs]);
  useEffect(() => {
    if (!activeTerminal) {
      setTerminalPorts([]);
      return;
    }
    const refresh = () => void bridge.terminalPorts(activeTerminal).then(setTerminalPorts).catch(() => setTerminalPorts([]));
    refresh();
    const poll = window.setInterval(refresh, 3000);
    return () => window.clearInterval(poll);
  }, [activeTerminal, bridge]);

  const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
  async function saveTaskDefinition() {
    setTaskSaving(true);
    const now = new Date().toISOString();
    try {
      await bridge.upsertTask({
        taskId,
        workspaceId: session.summary.workspaceRoot,
        state: taskQuery.data?.state ?? "draft",
        goal: taskGoal.trim() || null,
        constraints: lines(taskConstraints),
        acceptance: lines(taskAcceptance),
        allowedPaths: lines(taskAllowedPaths),
        verificationCommands: lines(taskVerification),
        createdAt: taskQuery.data?.createdAt ?? now,
        updatedAt: now,
      });
      await taskQuery.refetch();
      await completionQuery.refetch();
    } finally {
      setTaskSaving(false);
    }
  }

  async function recordVerification(command: string, status: "not_run" | "blocked") {
    const summary = window.prompt("Reason", "")?.trim();
    if (!summary) return;
    await bridge.saveVerificationResult({
      verificationId: crypto.randomUUID(),
      taskId,
      turnId: "manual",
      command,
      status,
      summary,
      exitCode: null,
      createdAt: new Date().toISOString(),
    });
    await verificationQuery.refetch();
    await completionQuery.refetch();
  }

  async function executeVerification(command: string) {
    setVerificationRunning(command);
    try {
      await bridge.runVerification(taskId, root, command);
      await verificationQuery.refetch();
      await completionQuery.refetch();
    } finally {
      setVerificationRunning(null);
    }
  }

  async function createTerminal() {
    setTerminalError(null);
    try {
      const created = await bridge.terminalCreate(taskId, root, "/bin/zsh", ["-l"]);
      const tab = { id: created.terminalId, title: `Terminal ${terminalTabs.length + 1}`, output: "", offset: 0, exitCode: null };
      setTerminalTabs((items) => [...items, tab]);
      setActiveTerminal(tab.id);
      await bridge.terminalResize(tab.id, 100, 30);
    } catch (error) {
      setTerminalError(String(error));
    }
  }

  async function sendTerminalInput() {
    if (!activeTerminal || !terminalInput) return;
    await bridge.terminalInput(activeTerminal, `${terminalInput}\n`);
    setTerminalInput("");
  }

  async function closeTerminal(terminalId: string) {
    await bridge.terminalRelease(terminalId);
    setTerminalTabs((items) => items.filter((item) => item.id !== terminalId));
    setActiveTerminal((current) => current === terminalId ? terminalTabs.find((item) => item.id !== terminalId)?.id ?? null : current);
  }

  async function mutateFile(action: "stage" | "unstage" | "revert") {
    if (!selectedPath || gitBusy) return;
    if (action === "revert" && !window.confirm(t.revertFileConfirm)) return;
    setGitBusy(true);
    setGitError(null);
    try {
      const mutation = await bridge.gitFileAction(root, selectedPath, action);
      if (mutation.checkpoint) setLastCheckpoint(mutation.checkpoint);
      await reviewQuery.refetch();
      await patchQuery.refetch();
    } catch (error) {
      setGitError(`${t.gitActionFailed}: ${String(error)}`);
    } finally {
      setGitBusy(false);
    }
  }

  async function mutateHunk(patch: string, action: "stage" | "unstage" | "revert") {
    if (!selectedPath || gitBusy) return;
    if (action === "revert" && !window.confirm("Revert this hunk? A checkpoint will be created first.")) return;
    setGitBusy(true);
    setGitError(null);
    try {
      const mutation = await bridge.gitHunkAction(root, selectedPath, patch, action);
      if (mutation.checkpoint) setLastCheckpoint(mutation.checkpoint);
      await reviewQuery.refetch();
      await patchQuery.refetch();
    } catch (error) {
      setGitError(`${t.gitActionFailed}: ${String(error)}`);
    } finally {
      setGitBusy(false);
    }
  }

  async function commitStaged() {
    if (!commitMessage.trim() || gitBusy) return;
    setGitBusy(true);
    setGitError(null);
    try {
      await bridge.gitCommit(root, commitMessage);
      setCommitMessage("");
      setSelectedPath(null);
      await reviewQuery.refetch();
    } catch (error) {
      setGitError(`${t.gitActionFailed}: ${String(error)}`);
    } finally {
      setGitBusy(false);
    }
  }

  const applyRequest = session.summary.worktreePath && session.summary.baseCommit
    ? {
        mainWorkspace: session.summary.workspaceRoot,
        worktreePath: session.summary.worktreePath,
        baseCommit: session.summary.baseCommit,
      }
    : null;

  async function previewApply() {
    if (!applyRequest) return;
    setApplyError(null);
    setApplyPreview(null);
    setApplyOpen(true);
    try {
      setApplyPreview(await bridge.previewWorktreeApply(applyRequest));
    } catch (error) {
      setApplyError(String(error));
    }
  }

  async function confirmApply() {
    if (!applyRequest || !applyPreview?.ready || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await bridge.applyWorktreeChanges(applyRequest);
      const next = { ...session.summary, appliedAt: result.appliedAt };
      useAppStore.getState().updateSummary(session.summary.sessionId, next);
      await bridge.upsertSession(next);
      setApplyOpen(false);
    } catch (error) {
      setApplyError(String(error));
    } finally {
      setApplying(false);
    }
  }

  return (
    <aside className="gb-drawer">
      <div className="gb-drawer-head">
        <div><GitBranch size={15} /><span>{t.taskContext}</span></div>
        <button type="button" className="gb-icon-button" aria-label={t.closeDrawer} onClick={onClose}><X size={16} /></button>
      </div>
      <Tabs.Root className="gb-drawer-tabs" defaultValue="changes">
        <Tabs.List>
          <Tabs.Trigger value="changes"><FileCode2 size={14} /> {t.changes} <span>{reviewQuery.data?.files.length ?? 0}</span></Tabs.Trigger>
          <Tabs.Trigger value="activity"><Activity size={14} /> {t.tasks} <span>{session.tools.length}</span></Tabs.Trigger>
          <Tabs.Trigger value="context"><Eye size={14} /> Context <span>{contextQuery.data?.length ?? 0}</span></Tabs.Trigger>
          <Tabs.Trigger value="verification"><ListChecks size={14} /> Verify <span>{verificationQuery.data?.length ?? 0}</span></Tabs.Trigger>
          <Tabs.Trigger value="files"><Folder size={14} /> Files</Tabs.Trigger>
          <Tabs.Trigger value="terminal"><TerminalSquare size={14} /> Terminal <span>{terminalTabs.length}</span></Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="changes" className="gb-drawer-content">
          <div className="gb-drawer-toolbar">
            <span>{reviewQuery.data?.branch || t.workingTree}</span>
            <button type="button" className="gb-icon-button" aria-label={t.refreshChanges} onClick={() => void reviewQuery.refetch()}><RefreshCw size={14} /></button>
          </div>
          {reviewQuery.isLoading && <div className="gb-drawer-empty">{t.readingChanges}</div>}
          {reviewQuery.data?.state === "clean" && <div className="gb-drawer-empty">{t.noChanges}</div>}
          {reviewQuery.data?.files.map((file) => (
            <button
              type="button"
              key={`${file.path}-${file.staged}`}
              className={selectedPath === file.path ? "gb-file-row active" : "gb-file-row"}
              onClick={() => setSelectedPath(file.path)}
            >
              <span>{file.path}</span>
              <small><b>+{file.additions}</b><i>−{file.deletions}</i></small>
            </button>
          ))}
          {selectedPath && (
            <div className="gb-patch-panel">
              <div className="gb-patch-head">
                <span>{selectedPath}</span>
                <div>
                  <button type="button" className="gb-icon-button" disabled={gitBusy} title={selectedFile?.staged ? t.unstageFile : t.stageFile} aria-label={selectedFile?.staged ? t.unstageFile : t.stageFile} onClick={() => void mutateFile(selectedFile?.staged ? "unstage" : "stage")}><ListPlus size={13} /></button>
                  <button type="button" className="gb-icon-button" disabled={gitBusy || selectedFile?.status === "untracked"} title={t.revertFile} aria-label={t.revertFile} onClick={() => void mutateFile("revert")}><RotateCcw size={13} /></button>
                  <button type="button" className="gb-icon-button" title={t.copyPath} aria-label={t.copyPath} onClick={() => void bridge.copyText(selectedPath)}><Clipboard size={13} /></button>
                  <button type="button" className="gb-icon-button" title={t.openFile} aria-label={t.openFile} onClick={() => void bridge.openPath(`${root}/${selectedPath}`)}><ExternalLink size={13} /></button>
                </div>
              </div>
              <pre>{patchQuery.data || (patchQuery.isLoading ? t.loadingPatch : t.noPatch)}</pre>
              {splitPatchHunks(patchQuery.data || "").map((hunk, index) => <div className="gb-hunk-row" key={`${selectedPath}-${index}`}><span>Hunk {index + 1}</span><div><button type="button" disabled={gitBusy} onClick={() => void mutateHunk(hunk, selectedFile?.staged ? "unstage" : "stage")}>{selectedFile?.staged ? "Unstage hunk" : "Stage hunk"}</button><button type="button" disabled={gitBusy || selectedFile?.staged} onClick={() => void mutateHunk(hunk, "revert")}>Revert hunk</button><button type="button" onClick={() => {
                const range = hunk.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
                useAppStore.getState().setSessionDraft(session.summary.sessionId, `<review_feedback>\n${JSON.stringify({ workspaceRoot: root, path: selectedPath, hunkIndex: index, startLine: range ? Number(range[1]) : null, lineCount: range ? Number(range[2] || 1) : null, patch: hunk, note: "Review this hunk and address the feedback." }, null, 2)}\n</review_feedback>\n`);
                onClose();
              }}>Review hunk</button></div></div>)}
            </div>
          )}
          {gitError && <div className="gb-apply-status blocked"><span>{gitError}</span></div>}
          {lastCheckpoint && <div className="gb-apply-status ready"><strong>Checkpoint available</strong><span>{lastCheckpoint.checkpointId}</span><button type="button" className="gb-review-button" onClick={() => void bridge.gitCheckpointRestorePreview(root, lastCheckpoint.checkpointId).then(async (preview) => {
            if (!preview.ready) throw new Error(preview.reason || "Checkpoint cannot be restored");
            if (!window.confirm(`Restore checkpoint ${lastCheckpoint.checkpointId}?`)) return;
            await bridge.gitRestoreCheckpoint(root, lastCheckpoint.checkpointId);
            setLastCheckpoint(null);
            await reviewQuery.refetch();
          }).catch((error) => setGitError(String(error)))}>Preview and restore</button></div>}
          {reviewQuery.data?.files.some((file) => file.staged) && (
            <div className="gb-commit-row">
              <input aria-label={t.commitMessage} placeholder={t.commitMessage} value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
              <button type="button" className="gb-review-button" disabled={gitBusy || !commitMessage.trim()} onClick={() => void commitStaged()}><GitCommitHorizontal size={14} /> {t.commitChanges}</button>
            </div>
          )}
          {(reviewQuery.data?.files.length ?? 0) > 0 && (
            <div className="gb-drawer-actions">
              <button
                type="button"
                className="gb-review-button"
                onClick={() => {
                  useAppStore.getState().setSessionDraft(
                    session.summary.sessionId,
                    `<review_feedback>\n${JSON.stringify({
                      workspaceRoot: root,
                      paths: selectedPath ? [selectedPath] : reviewQuery.data?.files.map((file) => file.path) ?? [],
                      note: selectedPath ? translate("reviewFilePrompt", { path: selectedPath }) : t.reviewAllPrompt,
                      includePatch: true,
                    }, null, 2)}\n</review_feedback>\n`,
                  );
                  onClose();
                }}
              >
                {t.sendReviewRequest}
              </button>
              {applyRequest && (
                <button
                  type="button"
                  className="gb-apply-button"
                  disabled={Boolean(session.summary.appliedAt)}
                  onClick={() => void previewApply()}
                >
                  <GitMerge size={14} />
                  {session.summary.appliedAt ? t.appliedToProject : t.applyToProject}
                </button>
              )}
            </div>
          )}
        </Tabs.Content>
        <Tabs.Content value="activity" className="gb-drawer-content">
          {session.tools.length === 0 && <div className="gb-drawer-empty">{t.activityHint}</div>}
          {session.tools.map((tool) => (
            <div key={tool.id} className="gb-drawer-activity">
              <span className={`gb-status-dot ${tool.status === "completed" ? "idle" : "running"}`} />
              <div><strong>{tool.title}</strong><small>{tool.status}</small></div>
            </div>
          ))}
        </Tabs.Content>
        <Tabs.Content value="context" className="gb-drawer-content">
          <div className="gb-drawer-toolbar"><span>Task contract</span><button type="button" className="gb-icon-button" aria-label={t.refresh} onClick={() => void taskQuery.refetch()}><RefreshCw size={14} /></button></div>
          <div className="gb-task-contract">
            <label>Goal<textarea value={taskGoal} onChange={(event) => setTaskGoal(event.target.value)} /></label>
            <label>Constraints, one per line<textarea value={taskConstraints} onChange={(event) => setTaskConstraints(event.target.value)} /></label>
            <label>Acceptance criteria, one per line<textarea value={taskAcceptance} onChange={(event) => setTaskAcceptance(event.target.value)} /></label>
            <label>Allowed paths, one per line<textarea value={taskAllowedPaths} onChange={(event) => setTaskAllowedPaths(event.target.value)} /></label>
            <label>Verification commands, one per line<textarea value={taskVerification} onChange={(event) => setTaskVerification(event.target.value)} /></label>
            <button type="button" className="gb-review-button" disabled={taskSaving} onClick={() => void saveTaskDefinition()}>{taskSaving ? t.saving : t.saveChanges}</button>
          </div>
          <div className="gb-drawer-toolbar"><span>What the Agent saw</span><button type="button" className="gb-icon-button" aria-label={t.refresh} onClick={() => void contextQuery.refetch()}><RefreshCw size={14} /></button></div>
          {contextQuery.data?.length === 0 && <div className="gb-drawer-empty">No Context Manifest has been recorded for this task.</div>}
          {contextQuery.data?.flatMap((manifest) => manifest.entries.map((entry, index) => (
            <div className="gb-drawer-activity" key={`${manifest.manifestId}-${index}`}><span className={`gb-status-dot ${entry.trust === "trusted" ? "idle" : "running"}`} /><div><strong>{entry.kind}: {entry.source}</strong><small>{entry.trust} · ~{entry.tokenEstimate} tokens{entry.truncatedReason ? ` · ${entry.truncatedReason}` : ""}</small></div></div>
          )))}
        </Tabs.Content>
        <Tabs.Content value="verification" className="gb-drawer-content">
          <div className="gb-drawer-toolbar"><span>Completion gate</span><button type="button" className="gb-icon-button" aria-label={t.refresh} onClick={() => { void verificationQuery.refetch(); void completionQuery.refetch(); }}><RefreshCw size={14} /></button></div>
          {!taskQuery.data && <div className="gb-drawer-empty">Save the task contract to enable platform verification.</div>}
          {taskQuery.data?.verificationCommands.map((command) => <div className="gb-drawer-activity" key={command}><div><strong>{command}</strong><small>Required verification</small></div><div><button type="button" className="gb-review-button" disabled={verificationRunning !== null} onClick={() => void executeVerification(command)}>{verificationRunning === command ? "Running…" : "Run"}</button><button type="button" className="gb-icon-button" title="Not run" onClick={() => void recordVerification(command, "not_run")}>–</button><button type="button" className="gb-icon-button" title="Blocked" onClick={() => void recordVerification(command, "blocked")}>!</button></div></div>)}
          {completionQuery.data && <div className={completionQuery.data.ready ? "gb-apply-status ready" : "gb-apply-status blocked"}><strong>{completionQuery.data.ready ? "Ready to complete" : "Verification required"}</strong><span>{completionQuery.data.blockers.join(" · ") || "No unresolved platform blockers."}</span></div>}
          {completionQuery.data?.ready && taskQuery.data?.state === "verifying" && <button type="button" className="gb-review-button" onClick={() => void bridge.completeTask(taskId).then(() => { void taskQuery.refetch(); void completionQuery.refetch(); })}>Mark task completed</button>}
          {verificationQuery.data?.map((result) => <div className="gb-drawer-activity" key={result.verificationId}><span className={`gb-status-dot ${result.status === "passed" ? "idle" : "running"}`} /><div><strong>{result.command}</strong><small>{result.status}{result.summary ? ` · ${result.summary}` : ""}</small></div></div>)}
        </Tabs.Content>
        <Tabs.Content value="terminal" className="gb-drawer-content">
          <div className="gb-drawer-toolbar"><span>Task terminals</span><button type="button" className="gb-icon-button" aria-label="New terminal" onClick={() => void createTerminal()}><Plus size={14} /></button></div>
          <div className="gb-terminal-tabs">
            {terminalTabs.map((tab) => <button type="button" key={tab.id} className={activeTerminal === tab.id ? "active" : ""} onClick={() => setActiveTerminal(tab.id)}>{tab.title}{tab.exitCode !== null ? ` (${tab.exitCode})` : ""}</button>)}
          </div>
          {terminalTabs.length === 0 && <div className="gb-drawer-empty">Create a terminal bound to this task and worktree.</div>}
          {terminalTabs.find((tab) => tab.id === activeTerminal) && <div className="gb-terminal-panel">
            {terminalPorts.length > 0 && <div className="gb-terminal-ports">Listening: {terminalPorts.map((port) => <span key={port}>localhost:{port}</span>)} <button type="button" onClick={() => activeTerminal && void bridge.terminalKill(activeTerminal)}>Stop service</button></div>}
            <pre aria-live="polite">{terminalTabs.find((tab) => tab.id === activeTerminal)?.output || "Starting terminal…"}</pre>
            <form onSubmit={(event) => { event.preventDefault(); void sendTerminalInput(); }}><input aria-label="Terminal input" value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} autoComplete="off" /><button type="submit">Send</button><button type="button" aria-label="Stop terminal" onClick={() => activeTerminal && void bridge.terminalKill(activeTerminal)}><Square size={12} /></button><button type="button" onClick={() => activeTerminal && void closeTerminal(activeTerminal)}>Close</button></form>
          </div>}
          {terminalError && <div className="gb-apply-status blocked"><span>{terminalError}</span></div>}
        </Tabs.Content>
        <Tabs.Content value="files" className="gb-drawer-content">
          <div className="gb-drawer-toolbar"><button type="button" className="gb-icon-button" disabled={!explorerPath} title="Parent directory" aria-label="Parent directory" onClick={() => setExplorerPath(explorerPath?.split("/").slice(0, -1).join("/") || null)}>↑</button><span>{explorerPath || "."}</span><button type="button" className="gb-icon-button" aria-label={t.refresh} onClick={() => void treeQuery.refetch()}><RefreshCw size={14} /></button></div>
          <label className="gb-explorer-search"><Search size={13} /><input value={explorerSearch} placeholder="Search names and content" onChange={(event) => setExplorerSearch(event.target.value)} /></label>
          {(searchQuery.data ?? treeQuery.data)?.map((entry) => <button type="button" className="gb-file-row" key={entry.path} onClick={() => entry.directory ? setExplorerPath(entry.path) : setPreviewPath(entry.path)}><span>{entry.directory ? "▸ " : ""}{entry.path}</span><small>{entry.size ?? ""}</small></button>)}
          {previewPath && <div className="gb-patch-panel"><div className="gb-patch-head"><span>{previewPath}</span><button type="button" className="gb-icon-button" aria-label="Close preview" onClick={() => setPreviewPath(null)}><X size={13} /></button></div>{previewQuery.data?.binary ? <div className="gb-drawer-empty">Binary file · {previewQuery.data.size} bytes</div> : <pre>{previewQuery.data?.content}{previewQuery.data?.truncated ? "\n… [preview truncated]" : ""}</pre>}</div>}
        </Tabs.Content>
      </Tabs.Root>
      <Dialog.Root open={applyOpen} onOpenChange={setApplyOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="gb-dialog-overlay" />
          <Dialog.Content className="gb-confirm-dialog">
            <Dialog.Title>{t.applyChangesTitle}</Dialog.Title>
            <Dialog.Description>{t.applyChangesDescription}</Dialog.Description>
            {!applyPreview && !applyError && <div className="gb-apply-status">{t.dryRun}</div>}
            {applyPreview && (
              <div className={applyPreview.ready ? "gb-apply-status ready" : "gb-apply-status blocked"}>
                <strong>{applyPreview.ready ? t.preflightPassed : t.cannotApply}</strong>
                <span>{applyPreview.ready
                  ? translate("filesReady", { count: applyPreview.files.length })
                  : applyPreview.reason}</span>
              </div>
            )}
            {applyError && <div className="gb-apply-status blocked"><strong>{t.preflightFailed}</strong><span>{applyError}</span></div>}
            <div className="gb-confirm-actions">
              <Dialog.Close asChild><button type="button" className="gb-button">{t.cancel}</button></Dialog.Close>
              <button type="button" className="gb-button primary" disabled={!applyPreview?.ready || applying} onClick={() => void confirmApply()}>
                {applying ? t.applying : t.applyChanges}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  );
}
