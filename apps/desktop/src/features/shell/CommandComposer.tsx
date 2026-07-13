import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Check,
  ChevronDown,
  FilePlus2,
  Flag,
  FileText,
  Gauge,
  Paperclip,
  Rocket,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore } from "../../store";
import {
  inferAttachmentMime,
  validateAttachments,
  effortOptionsForModel,
  resolveEffortForModel,
  formatTokenCount,
  emptyContextUsage,
} from "../../contracts";
import type {
  ComposerAttachment,
  SelectableModel,
  TaskMode,
  ModeSwitchResult,
} from "../../types";
import { t, translate } from "../../i18n";
import { buildCommandCatalog, parseSlashCommand } from "./commands";
import { STOP_ARM_MS } from "./composerTiming";

export { STOP_ARM_MS } from "./composerTiming";

/** OpenCode-style circular context meter: fill arc grows with usage %. */
function ContextUsageRing({
  percent,
  warn = false,
}: {
  percent: number;
  warn?: boolean;
}) {
  const size = 16;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg
      className={`gb-context-ring${warn ? " warn" : ""}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      <circle
        className="gb-context-ring-track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="gb-context-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export async function browserAttachment(file: File): Promise<ComposerAttachment> {
  const mimeType = inferAttachmentMime(file.name, file.type);
  if (!mimeType) throw new Error(translate("attachmentUnsupported", { name: file.name }));
  const image = mimeType.startsWith("image/");
  const binary = image || mimeType === "application/pdf";
  const dataBase64 = binary
    ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })
    : null;
  const textContent = binary ? null : await file.text();
  return {
    id: crypto.randomUUID(),
    source: "inline",
    kind: image ? "image" : "file",
    name: file.name,
    mimeType,
    dataBase64,
    textContent,
    sizeBytes: file.size,
  };
}

export function CommandComposer({
  models,
  busy,
  connecting,
  onSend,
  onCancel,
  onChooseModel,
  onChooseEffort,
  onChooseMode,
  onLocalCommand,
}: {
  models: SelectableModel[];
  busy: boolean;
  connecting: boolean;
  onSend: (text: string, attachments: ComposerAttachment[], mode: TaskMode) => Promise<void>;
  onCancel: () => Promise<void>;
  onChooseModel: (modelId: string) => Promise<void>;
  onChooseEffort: (effort: string) => Promise<void>;
  onChooseMode: (mode: TaskMode) => Promise<ModeSwitchResult>;
  onLocalCommand: (commandLine: string) => void | Promise<void>;
}) {
  const bridge = useDesktopBridge();
  const {
    activeSessionId,
    sessions,
    settings,
    effectiveDraftText,
    setEffectiveDraftText,
    effectiveAttachments,
    setEffectiveAttachments,
    effectiveModelId,
    effectiveReasoningEffort,
    effectiveMode,
  } = useAppStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandMenuRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef<number | null>(null);
  const submittingRef = useRef(false);
  /** Delay Stop so a double-click / IME Enter+click on Send cannot hit cancel. */
  const [stopArmed, setStopArmed] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [unknownCommandDraft, setUnknownCommandDraft] = useState<string | null>(null);
  const [dismissedCommandDraft, setDismissedCommandDraft] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const draft = effectiveDraftText();
  const attachments = effectiveAttachments();
  const modelId = effectiveModelId() || models.find((model) => model.isDefault)?.id || settings.model;
  const selectedModel = models.find((model) => model.id === modelId) ?? null;
  const effortOptions = effortOptionsForModel(selectedModel);
  const effortId =
    resolveEffortForModel(
      selectedModel,
      effectiveReasoningEffort() || settings.defaultReasoningEffort,
    ) ||
    effortOptions.find((option) => option.default)?.value ||
    effortOptions[0]?.value ||
    "";
  const mode = effectiveMode();
  const currentSession = activeSessionId ? sessions[activeSessionId] : null;
  const contextUsage = currentSession?.contextUsage ?? emptyContextUsage(selectedModel?.contextWindow);
  const usageWindow = contextUsage.windowTokens ?? selectedModel?.contextWindow ?? null;
  const usagePercent =
    contextUsage.usagePercent ??
    (contextUsage.usedTokens != null && usageWindow
      ? (contextUsage.usedTokens / usageWindow) * 100
      : null);
  const usageWarn =
    usagePercent != null &&
    usagePercent >= (selectedModel?.autoCompactThresholdPercent ?? 85);
  const hasContextUsage = contextUsage.usedTokens != null || usagePercent != null;
  const capabilitiesQuery = useQuery({
    queryKey: ["capabilities", settings.cliPathOverride || settings.grokPath, settings.cwd],
    queryFn: () => bridge.inspectCapabilities(
      settings.cliPathOverride || settings.grokPath || undefined,
      settings.cwd || null,
    ),
    staleTime: 30_000,
  });
  const commandQuery = draft.startsWith("/") ? draft.split(/\s/, 1)[0].toLowerCase() : "";
  const commands = useMemo(() => {
    const live = currentSession?.availableCommands ?? [];
    const catalog = buildCommandCatalog(live, capabilitiesQuery.data?.skills ?? []);
    return catalog.filter((item) =>
      [item.name, ...item.aliases].some((name) => name.includes(commandQuery)),
    );
  }, [capabilitiesQuery.data?.skills, commandQuery, currentSession?.availableCommands]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(220, Math.max(52, element.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    if (busy || connecting) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeSessionId, busy, connecting]);

  useEffect(() => {
    if (!(busy || connecting)) {
      setStopArmed(false);
      return;
    }
    const timer = window.setTimeout(() => setStopArmed(true), STOP_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [busy, connecting]);

  useEffect(() => {
    if (!launching) return;
    const timer = window.setTimeout(() => setLaunching(false), 420);
    return () => window.clearTimeout(timer);
  }, [launching]);

  useEffect(() => {
    const openModel = () => setModelOpen(true);
    const openEffort = () => setEffortOpen(true);
    const focusComposer = () => textareaRef.current?.focus();
    window.addEventListener("grok:open-model", openModel);
    window.addEventListener("grok:open-effort", openEffort);
    window.addEventListener("grok:focus-composer", focusComposer);
    return () => {
      window.removeEventListener("grok:open-model", openModel);
      window.removeEventListener("grok:open-effort", openEffort);
      window.removeEventListener("grok:focus-composer", focusComposer);
    };
  }, []);

  function acceptAttachments(next: ComposerAttachment[]) {
    const combined = [...attachments, ...next];
    const issue = validateAttachments(combined);
    if (issue) {
      const attachment = combined.find((item) => item.name === issue.fileName);
      const limit = attachment?.mimeType.startsWith("text/") ? "1 MB" : "10 MB";
      setAttachmentError(issue.code === "too_many_files"
        ? t.attachmentTooMany
        : issue.code === "total_too_large"
          ? t.attachmentsTooLarge
          : issue.code === "file_too_large"
            ? translate("attachmentTooLarge", { name: issue.fileName ?? "", limit })
            : translate("attachmentUnsupported", { name: issue.fileName ?? "" }));
      return;
    }
    setAttachmentError(null);
    setEffectiveAttachments(combined);
  }

  async function attachPaths() {
    const paths = await bridge.chooseFiles();
    if (!paths.length) return;
    try {
      acceptAttachments(await bridge.stageAttachments(paths));
    } catch (error) {
      setAttachmentError(String(error));
    }
  }

  async function attachBrowserFiles(files: File[]) {
    if (!files.length) return;
    try {
      const metadata = files.map((file) => ({
        id: file.name,
        source: "inline" as const,
        kind: file.type.startsWith("image/") ? ("image" as const) : ("file" as const),
        name: file.name,
        mimeType: inferAttachmentMime(file.name, file.type) ?? file.type,
        sizeBytes: file.size,
      }));
      const issue = validateAttachments([...attachments, ...metadata]);
      if (issue) {
        const file = metadata.find((item) => item.name === issue.fileName);
        const limit = file?.mimeType.startsWith("text/") ? "1 MB" : "10 MB";
        throw new Error(issue.code === "too_many_files"
          ? t.attachmentTooMany
          : issue.code === "total_too_large"
            ? t.attachmentsTooLarge
            : issue.code === "file_too_large"
              ? translate("attachmentTooLarge", { name: issue.fileName ?? "", limit })
              : translate("attachmentUnsupported", { name: issue.fileName ?? "" }));
      }
      acceptAttachments(await Promise.all(files.map(browserAttachment)));
    } catch (error) {
      setAttachmentError(String(error));
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    void attachBrowserFiles(Array.from(event.dataTransfer.files));
  }

  function handlePaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData.files);
    if (files.length) void attachBrowserFiles(files);
  }

  async function submit() {
    if (busy || connecting || submittingRef.current || (!draft.trim() && attachments.length === 0)) return;
    const catalog = buildCommandCatalog(
      currentSession?.availableCommands ?? [],
      capabilitiesQuery.data?.skills ?? [],
    );
    const parsed = parseSlashCommand(draft, catalog);
    if (draft.trim().startsWith("/") && !parsed) {
      setCommandError(t.unknownCommand.replace("{command}", draft.trim().split(/\s/, 1)[0]));
      setUnknownCommandDraft(draft);
      return;
    }
    if (parsed && !parsed.descriptor.available) {
      setCommandError(t.commandUnavailable);
      return;
    }
    setCommandError(null);
    setUnknownCommandDraft(null);
    submittingRef.current = true;
    setLaunching(true);
    try {
      if (parsed?.descriptor.name === "/agent") {
        const result = await onChooseMode("agent");
        if (result.kind === "unsupported") setCommandError(result.reason);
        else setEffectiveDraftText("");
        return;
      }
      if (parsed?.descriptor.name === "/plan") {
        if (parsed.args) await onSend(parsed.args, attachments, "plan");
        else {
          const result = await onChooseMode("plan");
          if (result.kind === "unsupported") setCommandError(result.reason);
          else setEffectiveDraftText("");
        }
        return;
      }
      if (parsed?.descriptor.name === "/goal") {
        if (parsed.args) await onSend(parsed.args, attachments, "goal");
        else {
          const result = await onChooseMode("goal");
          if (result.kind === "unsupported") setCommandError(result.reason);
          else setEffectiveDraftText("");
        }
        return;
      }
      if (parsed && parsed.descriptor.execution !== "acp") {
        await onLocalCommand(draft.trim());
        return;
      }
      await onSend(draft, attachments, mode);
    } finally {
      submittingRef.current = false;
    }
  }

  async function chooseMode(mode: TaskMode) {
    try {
      const result = await onChooseMode(mode);
      if (result.kind === "unsupported") setCommandError(result.reason);
      else setCommandError(null);
    } catch (error) {
      setCommandError(translate("modeSwitchFailed", { reason: String(error) }));
    }
  }

  return (
    <div className={`gb-composer${launching ? " is-launching" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      {attachments.length > 0 && (
        <div className="gb-attachments">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="gb-attachment">
              <FilePlus2 size={14} />
              <span>{attachment.name}</span>
              <button
                type="button"
                aria-label={translate("removeAttachmentNamed", { name: attachment.name })}
                onClick={() => setEffectiveAttachments(attachments.filter((item) => item.id !== attachment.id))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {(attachmentError || commandError) && (
        <div className="gb-composer-error" role="alert">
          <span>{attachmentError || commandError}</span>
          {unknownCommandDraft === draft && (
            <button type="button" onClick={() => {
              setCommandError(null);
              setUnknownCommandDraft(null);
              void onSend(draft, attachments, mode);
            }}>{t.sendAsMessage}</button>
          )}
        </div>
      )}

      <Popover.Root open={Boolean(commandQuery && commands.length && dismissedCommandDraft !== draft)} onOpenChange={(open) => { if (!open) setDismissedCommandDraft(draft); }}>
        <Popover.Anchor asChild>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setEffectiveDraftText(event.target.value);
              setDismissedCommandDraft(null);
              setUnknownCommandDraft(null);
              setCommandError(null);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
              // macOS Chinese/Japanese IMEs often fire compositionend before the
              // confirming Enter keydown. Guard long enough to absorb that same
              // physical keypress without blocking a deliberate second Enter.
              compositionEndedAtRef.current = performance.now();
            }}
            onPaste={handlePaste}
            placeholder={mode === "goal" ? t.goalPlaceholder : mode === "plan" ? t.planPlaceholder : t.agentPlaceholder}
            aria-label={t.messageGrok}
            onKeyDown={(event) => {
              const nativeEvent = event.nativeEvent as KeyboardEvent;
              const imeGuardMs = 300;
              const confirmingIme = composingRef.current
                || nativeEvent.isComposing
                || nativeEvent.keyCode === 229
                || (event.key === "Enter"
                  && compositionEndedAtRef.current != null
                  && performance.now() - compositionEndedAtRef.current < imeGuardMs);
              if (confirmingIme) return;
              if (event.key === "Escape" && commandQuery) {
                event.preventDefault();
                setDismissedCommandDraft(draft);
                return;
              }
              if (event.key === "ArrowDown" && commands.length) {
                event.preventDefault();
                commandMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
                return;
              }
              if (event.key === "PageUp" || event.key === "PageDown") {
                event.preventDefault();
                window.dispatchEvent(new CustomEvent<"up" | "down">("grok:scroll-transcript", {
                  detail: event.key === "PageUp" ? "up" : "down",
                }));
                return;
              }
              const submitKey = event.key === "Enter" && (
                event.metaKey || event.ctrlKey || (!settings.multilineMode && !event.shiftKey)
              );
              if (submitKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            ref={commandMenuRef}
            className="gb-command-menu"
            side="top"
            align="start"
            sideOffset={10}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <div className="gb-command-label">{t.slashCommands}</div>
            {commands.map((item) => (
              <button
                type="button"
                key={item.name}
                disabled={!item.available}
                onClick={() => setEffectiveDraftText(`${item.name}${item.inputHint ? " " : ""}`)}
              >
                <code>{item.name}</code>
                <span>
                  {item.source === "acp" || item.source === "skill"
                    ? item.descriptionKey
                    : t.commands[item.descriptionKey] ?? item.descriptionKey}
                  {item.inputHint && <small>{item.inputHint}</small>}
                </span>
                <i>{item.available ? item.source : t.unavailable}</i>
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div className="gb-composer-footer">
        <div className="gb-composer-tools">
          <div className="gb-composer-cluster actions">
            <button
              type="button"
              className="gb-icon-button composer attach"
              aria-label={t.attachFile}
              onClick={() => void attachPaths()}
            >
              <Paperclip size={15} strokeWidth={2} />
            </button>
            {(draft || attachments.length > 0) && (
              <button
                type="button"
                className="gb-icon-button composer"
                aria-label={t.clearDraft}
                onClick={() => {
                  setEffectiveDraftText("");
                  setEffectiveAttachments([]);
                }}
              >
                <X size={14} strokeWidth={2} />
              </button>
            )}
          </div>

          <div className="gb-composer-cluster selects" role="group" aria-label={t.messageGrok}>
            <DropdownMenu.Root open={modelOpen} onOpenChange={setModelOpen}>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="gb-composer-select model"
                  disabled={busy || connecting}
                >
                  <Bot size={13} strokeWidth={2} />
                  <span>{models.find((model) => model.id === modelId)?.name || modelId}</span>
                  <ChevronDown size={12} strokeWidth={2.25} className="gb-select-chevron" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="gb-dropdown" sideOffset={8} align="start">
                  <DropdownMenu.Label>{t.model}</DropdownMenu.Label>
                  <input
                    className="gb-model-search"
                    aria-label={t.searchModels}
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                    placeholder={t.modelSearch}
                  />
                  {models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(modelQuery.toLowerCase())).map((model) => (
                    <DropdownMenu.Item key={model.id} onSelect={() => void onChooseModel(model.id)}>
                      <span><strong>{model.name}</strong><small>{model.description}</small></span>
                      {model.id === modelId && <Check size={14} />}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            {effortOptions.length > 0 && (
              <DropdownMenu.Root open={effortOpen} onOpenChange={setEffortOpen}>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="gb-composer-select effort"
                    disabled={busy || connecting}
                    aria-label={t.reasoningEffort}
                    title={t.reasoningEffortHint}
                  >
                    <Gauge size={13} strokeWidth={2} />
                    <span>{effortOptions.find((option) => option.value === effortId)?.label || effortId}</span>
                    <ChevronDown size={12} strokeWidth={2.25} className="gb-select-chevron" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="gb-dropdown compact" sideOffset={8} align="start">
                    <DropdownMenu.Label>{t.reasoningEffort}</DropdownMenu.Label>
                    {effortOptions.map((option) => (
                      <DropdownMenu.Item
                        key={option.value}
                        onSelect={() => void onChooseEffort(option.value)}
                      >
                        <span>
                          <strong>{option.label}</strong>
                          {option.description && <small>{option.description}</small>}
                        </span>
                        {option.value === effortId && <Check size={14} />}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={`gb-composer-select mode ${mode}`}
                  disabled={busy || connecting}
                >
                  {mode === "goal" ? (
                    <Flag size={13} strokeWidth={2} />
                  ) : mode === "plan" ? (
                    <FileText size={13} strokeWidth={2} />
                  ) : (
                    <Zap size={13} strokeWidth={2} />
                  )}
                  <span>{mode === "goal" ? t.modeGoal : mode === "plan" ? t.modePlan : t.modeAgent}</span>
                  <ChevronDown size={12} strokeWidth={2.25} className="gb-select-chevron" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="gb-dropdown compact" sideOffset={8} align="start">
                  <DropdownMenu.Item onSelect={() => void chooseMode("agent")}>
                    <Zap size={15} /><span><strong>{t.modeAgent}</strong><small>{t.modeAgentHint}</small></span>{mode === "agent" && <Check size={14} />}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void chooseMode("plan")}>
                    <FileText size={15} /><span><strong>{t.modePlan}</strong><small>{t.modePlanHint}</small></span>{mode === "plan" && <Check size={14} />}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void chooseMode("goal")}>
                    <Flag size={15} /><span><strong>{t.modeGoal}</strong><small>{t.modeGoalHint}</small></span>{mode === "goal" && <Check size={14} />}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          <div className="gb-composer-cluster meta">
            <button
              type="button"
              className={`gb-context-meter${usageWarn ? " warn" : ""}${hasContextUsage ? " active" : ""}`}
              title={
                hasContextUsage
                  ? `${formatTokenCount(contextUsage.usedTokens)} / ${formatTokenCount(usageWindow)}${
                      usagePercent != null ? ` · ${Math.round(usagePercent)}%` : ""
                    }`
                  : t.contextUsageHint
              }
              aria-label={
                hasContextUsage && usagePercent != null
                  ? `${t.contextShort} ${Math.round(usagePercent)}%`
                  : t.contextShort
              }
              onClick={() => void onLocalCommand("/context")}
            >
              <ContextUsageRing percent={usagePercent ?? 0} warn={usageWarn} />
            </button>
          </div>
        </div>

        {stopArmed ? (
          <button type="button" className="gb-send stop" aria-label={t.stopGrok} onClick={() => void onCancel()}>
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className={`gb-send${draft.trim() || attachments.length > 0 ? " ready" : ""}`}
            aria-label={t.sendToGrok}
            disabled={busy || connecting || (!draft.trim() && attachments.length === 0)}
            onClick={() => void submit()}
          >
            <Rocket size={15} strokeWidth={2.15} />
          </button>
        )}
      </div>
    </div>
  );
}
