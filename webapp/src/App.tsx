import { useState, useEffect, useRef } from 'react';
import type { Account, AutomationEvent, ReportRow, IssueRow } from './types';

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = 'badge badge-gray';
  if (s === 'alloted' || s === 'verified') cls = 'badge badge-green';
  else if (s === 'not alloted') cls = 'badge badge-red';
  return <span className={cls}>{status}</span>;
}

/** Generic SSE reader — reads a fetch Response as an SSE stream and dispatches events */
function readSSEStream(
  res: Response,
  onEvent: (event: AutomationEvent) => void,
  onDone: () => void,
  onError: (msg: string) => void,
) {
  const reader = res.body?.getReader();
  if (!reader) {
    onError('No response body');
    onDone();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  (async () => {
    try {
      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: AutomationEvent = JSON.parse(line.slice(6));
              onEvent(event);
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }
    } catch (e: any) {
      onError(e.message);
    } finally {
      onDone();
    }
  })();
}

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [maxReports, setMaxReports] = useState(5);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // ── Apply modal state ───────────────────────────────────────────────────
  const [applyTarget, setApplyTarget] = useState<{ index: number; name: string } | null>(null);
  const [appliedKitta, setAppliedKitta] = useState('');
  const [transactionPIN, setTransactionPIN] = useState('');
  const [applyRunning, setApplyRunning] = useState(false);
  const [applyLogs, setApplyLogs] = useState<string[]>([]);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const applyLogRef = useRef<HTMLDivElement>(null);

  // Fetch accounts on mount
  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((data: Account[]) => {
        setAccounts(data);
        if (data.length > 0) setSelected(data[0].name);
      })
      .catch((e) => setError(`Failed to load accounts: ${e.message}`));
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (applyLogRef.current) applyLogRef.current.scrollTop = applyLogRef.current.scrollHeight;
  }, [applyLogs]);

  // ── Run automation (list issues + reports) ──────────────────────────────

  const handleRun = () => {
    if (!selected || running || applyRunning) return;

    setRunning(true);
    setLogs([]);
    setReports([]);
    setIssues([]);
    setError(null);
    setDone(false);
    setApplyTarget(null);

    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: selected, maxReports }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setError(body.error || `HTTP ${res.status}`);
        setRunning(false);
        return;
      }

      readSSEStream(
        res,
        (event) => {
          switch (event.type) {
            case 'log':
              setLogs((prev) => [...prev, event.message]);
              break;
            case 'issue':
              setIssues((prev) => [...prev, event.data]);
              break;
            case 'report':
              setReports((prev) => [...prev, event.data]);
              setLogs((prev) => [
                ...prev,
                `[${event.data.index}/${event.data.total}] ${event.data.name} — ${event.data.status}`,
              ]);
              break;
            case 'done':
              setDone(true);
              setLogs((prev) => [...prev, 'Automation complete.']);
              break;
            case 'error':
              setError(event.message);
              setLogs((prev) => [...prev, `ERROR: ${event.message}`]);
              break;
          }
        },
        () => setRunning(false),
        (msg) => setError(msg),
      );
    }).catch((e) => {
      setError(e.message);
      setRunning(false);
    });
  };

  // ── Apply for IPO ──────────────────────────────────────────────────────

  const openApplyModal = (index: number, name: string) => {
    setApplyTarget({ index, name });
    setAppliedKitta('');
    setTransactionPIN('');
    setApplyLogs([]);
    setApplySuccess(null);
    setApplyError(null);
  };

  const closeApplyModal = () => {
    if (applyRunning) return; // don't close while running
    setApplyTarget(null);
  };

  const handleApply = () => {
    if (!selected || !applyTarget || applyRunning || running) return;
    if (!appliedKitta || !transactionPIN) return;

    setApplyRunning(true);
    setApplyLogs([]);
    setApplySuccess(null);
    setApplyError(null);

    fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: selected,
        companyIndex: applyTarget.index,
        appliedKitta,
        transactionPIN,
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setApplyError(body.error || `HTTP ${res.status}`);
        setApplyRunning(false);
        return;
      }

      readSSEStream(
        res,
        (event) => {
          switch (event.type) {
            case 'log':
              setApplyLogs((prev) => [...prev, event.message]);
              break;
            case 'apply_success':
              setApplySuccess(event.message);
              setApplyLogs((prev) => [...prev, event.message]);
              break;
            case 'done':
              setApplyLogs((prev) => [...prev, 'Application process complete.']);
              break;
            case 'error':
              setApplyError(event.message);
              setApplyLogs((prev) => [...prev, `ERROR: ${event.message}`]);
              break;
          }
        },
        () => setApplyRunning(false),
        (msg) => {
          setApplyError(msg);
          setApplyRunning(false);
        },
      );
    }).catch((e) => {
      setApplyError(e.message);
      setApplyRunning(false);
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="header">
        <h1>Meroshare Automation</h1>
        <p className="subtitle">Login, check ASBA, and view application reports</p>
      </header>

      <div className="controls">
        <div className="control-group">
          <label htmlFor="account-select">Account</label>
          <select
            id="account-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={running || applyRunning}
          >
            {accounts.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.username})
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="max-reports">Max Reports</label>
          <input
            id="max-reports"
            type="number"
            min={1}
            max={100}
            value={maxReports}
            onChange={(e) => setMaxReports(Number(e.target.value))}
            disabled={running || applyRunning}
          />
        </div>

        <button className="run-btn" onClick={handleRun} disabled={running || applyRunning || !selected}>
          {running ? 'Running...' : 'Run Automation'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Log area */}
      <div className="section">
        <h2>Live Log</h2>
        <div className="log-area" ref={logRef}>
          {logs.length === 0 && <span className="log-placeholder">Logs will appear here...</span>}
          {logs.map((msg, i) => (
            <div key={i} className="log-line">{msg}</div>
          ))}
          {running && <div className="log-line log-spinner">Working...</div>}
        </div>
      </div>

      {/* Open issues */}
      {issues.length > 0 && (
        <div className="section">
          <h2>Open Issues (Apply for Issue)</h2>
          <table className="results-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Company</th>
                <th>Sub Group</th>
                <th>Type</th>
                <th>Share Group</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((iss, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{iss.name}</td>
                  <td>{iss.subGroup}</td>
                  <td><span className="badge badge-blue">{iss.shareType}</span></td>
                  <td>{iss.shareGroup}</td>
                  <td>
                    <button
                      className="apply-btn"
                      onClick={() => openApplyModal(i, iss.name)}
                      disabled={running || applyRunning}
                    >
                      Apply
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Apply Modal */}
      {applyTarget && (
        <div className="modal-overlay" onClick={closeApplyModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Apply for IPO</h2>
              <button className="modal-close" onClick={closeApplyModal} disabled={applyRunning}>&times;</button>
            </div>

            <div className="modal-body">
              <div className="modal-company">{applyTarget.name}</div>

              <div className="modal-form">
                <div className="control-group">
                  <label htmlFor="apply-kitta">Applied Kitta</label>
                  <input
                    id="apply-kitta"
                    type="number"
                    min={1}
                    placeholder="e.g. 10"
                    value={appliedKitta}
                    onChange={(e) => setAppliedKitta(e.target.value)}
                    disabled={applyRunning}
                  />
                </div>

                <div className="control-group">
                  <label htmlFor="apply-pin">Transaction PIN (4 digits)</label>
                  <input
                    id="apply-pin"
                    type="password"
                    maxLength={4}
                    placeholder="****"
                    value={transactionPIN}
                    onChange={(e) => setTransactionPIN(e.target.value)}
                    disabled={applyRunning}
                  />
                </div>

                <button
                  className="run-btn apply-submit-btn"
                  onClick={handleApply}
                  disabled={applyRunning || !appliedKitta || !transactionPIN || transactionPIN.length !== 4}
                >
                  {applyRunning ? 'Applying...' : 'Submit Application'}
                </button>
              </div>

              {applyError && <div className="error-banner">{applyError}</div>}
              {applySuccess && <div className="success-banner">{applySuccess}</div>}

              {applyLogs.length > 0 && (
                <div className="apply-log-section">
                  <h3>Progress</h3>
                  <div className="log-area apply-log-area" ref={applyLogRef}>
                    {applyLogs.map((msg, i) => (
                      <div key={i} className="log-line">{msg}</div>
                    ))}
                    {applyRunning && <div className="log-line log-spinner">Working...</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Application reports */}
      {reports.length > 0 && (
        <div className="section">
          <h2>Application Reports {done && `(${reports.length} of ${reports[0]?.total})`}</h2>
          <table className="results-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Company</th>
                <th>Type</th>
                <th>Status</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.index}>
                  <td>{r.index}</td>
                  <td>{r.name}</td>
                  <td><span className="badge badge-blue">{r.shareType}</span></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="remarks-cell">{r.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {done && reports.length === 0 && issues.length === 0 && (
        <div className="section">
          <p className="empty-msg">No results to display.</p>
        </div>
      )}
    </div>
  );
}
