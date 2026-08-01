import {
  describeError,
  type DescribedError,
  type UserErrorCategory,
} from "../../contracts";
import { t } from "../../i18n";

export type FailureGuidance = {
  title: string;
  cause: string;
  recovery: string;
};

export function guidanceForError(category: UserErrorCategory | undefined): FailureGuidance {
  switch (category) {
    case "network":
      return {
        title: t.errorNetworkTitle,
        cause: t.errorNetworkCause,
        recovery: t.errorNetworkRecovery,
      };
    case "permission":
      return {
        title: t.errorPermissionTitle,
        cause: t.errorPermissionCause,
        recovery: t.errorPermissionRecovery,
      };
    case "workspace":
      return {
        title: t.errorWorkspaceTitle,
        cause: t.errorWorkspaceCause,
        recovery: t.errorWorkspaceRecovery,
      };
    case "runtime":
      return {
        title: t.errorRuntimeTitle,
        cause: t.errorRuntimeCause,
        recovery: t.errorRuntimeRecovery,
      };
    case "protocol":
      return {
        title: t.errorProtocolTitle,
        cause: t.errorProtocolCause,
        recovery: t.errorProtocolRecovery,
      };
    case "timeout":
      return {
        title: t.errorTimeoutTitle,
        cause: t.errorTimeoutCause,
        recovery: t.errorTimeoutRecovery,
      };
    case "cancelled":
      return {
        title: t.errorCancelledTitle,
        cause: t.errorCancelledCause,
        recovery: t.errorCancelledRecovery,
      };
    default:
      return {
        title: t.errorUnknownTitle,
        cause: t.errorUnknownCause,
        recovery: t.errorUnknownRecovery,
      };
  }
}

/** A compact, copyable version for the immutable system timeline. */
export function formatFailureForTimeline(failure: DescribedError): string {
  const guidance = guidanceForError(failure.category);
  return [
    guidance.title,
    `${t.errorTechnicalDetail}: ${failure.message}`,
    `${t.errorWhy}: ${guidance.cause}`,
    `${t.errorWhatToDo}: ${guidance.recovery}`,
  ].join("\n");
}

export function presentError(error: unknown): DescribedError {
  return describeError(error);
}
