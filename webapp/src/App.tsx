import { useState, useEffect, useRef } from 'react';
import type { Account, AutomationEvent, ReportRow, IssueRow } from './types';

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = 'badge badge-gray';
  if (s === 'alloted' || s === 'verified') cls = 'badge badge-green';
  else if (s === 'not alloted') cls = 'badge badge-red';
  return <span className={cls}>{status}</span>;
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
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const handleRun = () => {
    if (!selected || running) return;

    // Reset state
    setRunning(true);
    setLogs([]);
    setReports([]);
    setIssues([]);
    setError(null);
    setDone(false);

    // POST to /api/run and read SSE stream
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

      const reader = res.body?.getReader();
      if (!reader) {
        setError('No response body');
        setRunning(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: AutomationEvent = JSON.parse(line.slice(6));
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
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }

      setRunning(false);
    }).catch((e) => {
      setError(e.message);
      setRunning(false);
    });
  };

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
            disabled={running}
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
            disabled={running}
          />
        </div>

        <button className="run-btn" onClick={handleRun} disabled={running || !selected}>
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
                </tr>
              ))}
            </tbody>
          </table>
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
