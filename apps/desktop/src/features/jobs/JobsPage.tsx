import { HostJobsPanel } from "../shell/HostJobsPanel";
import { t } from "../../i18n";

export function JobsPage() {
  return (
    <div className="wb-page">
      <header className="wb-page-header">
        <div>
          <h1>{t.hostJobs}</h1>
          <p>{t.hostJobsHint}</p>
        </div>
      </header>
      <div className="wb-page-body" style={{ maxWidth: 720 }}>
        <HostJobsPanel enabled />
      </div>
    </div>
  );
}
