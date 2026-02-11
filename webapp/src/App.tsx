import { useState, useEffect, useRef } from 'react';
import type { Account, AutomationEvent, ReportRow, IssueRow, AccountStatus } from './types';

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = 'badge badge-gray';
  if (s === 'alloted' || s === 'verified') cls = 'badge badge-green';
  else if (s === 'not alloted') cls = 'badge badge-red';
  return <span className={cls}>{status}</span>;
}

function AccountStatusBadge({ status }: { status: AccountStatus['status'] }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: 'badge badge-gray', label: 'Pending' },
    running: { cls: 'badge badge-blue', label: 'Running' },
    already_applied: { cls: 'badge badge-yellow', label: 'Already Applied' },
    success: { cls: 'badge badge-green', label: 'Success' },
    error: { cls: 'badge badge-red', label: 'Error' },
    login_failed: { cls: 'badge badge-red', label: 'Login Failed' },
  };
  const entry = map[status] || map.pending;
  return <span className={entry.cls}>{entry.label}</span>;
}

/** Generic SSE reader */
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
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // ── Single-apply modal state ─────────────────────────────────────────────
  const [applyTarget, setApplyTarget] = useState<{ index: number; name: string } | null>(null);
  const [appliedKitta, setAppliedKitta] = useState('');
  const [transactionPIN, setTransactionPIN] = useState('');
  const [applyRunning, setApplyRunning] = useState(false);
  const [applyLogs, setApplyLogs] = useState<string[]>([]);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const applyLogRef = useRef<HTMLDivElement>(null);

  // ── Bulk-apply modal state ───────────────────────────────────────────────
  const [bulkTarget, setBulkTarget] = useState<{ name: string } | null>(null);
  const [bulkSelectedAccounts, setBulkSelectedAccounts] = useState<string[]>([]);
  const [bulkKitta, setBulkKitta] = useState('');
  const [bulkPIN, setBulkPIN] = useState('');
  const [bulkAccountPINs, setBulkAccountPINs] = useState<Record<string, string>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkLogs, setBulkLogs] = useState<string[]>([]);
  const [bulkStatuses, setBulkStatuses] = useState<AccountStatus[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkDone, setBulkDone] = useState(false);
  const bulkLogRef = useRef<HTMLDivElement>(null);

  const anyRunning = running || applyRunning || bulkRunning;

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

  useEffect(() => {
    if (bulkLogRef.current) bulkLogRef.current.scrollTop = bulkLogRef.current.scrollHeight;
  }, [bulkLogs]);

  // ── Scan for open issues ────────────────────────────────────────────────

  const handleScan = () => {
    if (!selected || anyRunning) return;

    setRunning(true);
    setLogs([]);
    setReports([]);
    setIssues([]);
    setError(null);
    setDone(false);
    setApplyTarget(null);
    setBulkTarget(null);

    fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: selected }),
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
            case 'done':
              setDone(true);
              setLogs((prev) => [...prev, 'Scan complete.']);
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

  // ── Single apply ────────────────────────────────────────────────────────

  const openApplyModal = (index: number, name: string) => {
    setApplyTarget({ index, name });
    setAppliedKitta('');
    setTransactionPIN('');
    setApplyLogs([]);
    setApplySuccess(null);
    setApplyError(null);
  };

  const closeApplyModal = () => {
    if (applyRunning) return;
    setApplyTarget(null);
  };

  const handleApply = () => {
    if (!selected || !applyTarget || anyRunning) return;
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

  // ── Bulk apply ──────────────────────────────────────────────────────────

  const openBulkModal = (companyName: string) => {
    setBulkTarget({ name: companyName });
    setBulkSelectedAccounts(accounts.map((a) => a.name)); // select all by default
    setBulkKitta('');
    setBulkPIN('');
    setBulkAccountPINs({});
    setBulkLogs([]);
    setBulkStatuses([]);
    setBulkError(null);
    setBulkDone(false);
  };

  const closeBulkModal = () => {
    if (bulkRunning) return;
    setBulkTarget(null);
  };

  const toggleBulkAccount = (name: string) => {
    setBulkSelectedAccounts((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const toggleAllAccounts = () => {
    if (bulkSelectedAccounts.length === accounts.length) {
      setBulkSelectedAccounts([]);
    } else {
      setBulkSelectedAccounts(accounts.map((a) => a.name));
    }
  };

  // Check if every selected account has a PIN (either per-account or global)
  const allAccountsHavePIN = bulkSelectedAccounts.every(
    (name) => (bulkAccountPINs[name] && bulkAccountPINs[name].length === 4) || (bulkPIN && bulkPIN.length === 4),
  );

  const handleBulkApply = () => {
    if (!bulkTarget || anyRunning) return;
    if (bulkSelectedAccounts.length === 0 || !bulkKitta || !allAccountsHavePIN) return;

    setBulkRunning(true);
    setBulkLogs([]);
    setBulkError(null);
    setBulkDone(false);
    setBulkStatuses(
      bulkSelectedAccounts.map((name) => ({ account: name, status: 'pending' as const, message: 'Waiting...' })),
    );

    // Only send per-account PINs that are actually filled (4 digits)
    const filledAccountPINs: Record<string, string> = {};
    for (const name of bulkSelectedAccounts) {
      if (bulkAccountPINs[name] && bulkAccountPINs[name].length === 4) {
        filledAccountPINs[name] = bulkAccountPINs[name];
      }
    }

    fetch('/api/bulk-apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accounts: bulkSelectedAccounts,
        companyName: bulkTarget.name,
        appliedKitta: bulkKitta,
        transactionPIN: bulkPIN,
        accountPINs: filledAccountPINs,
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setBulkError(body.error || `HTTP ${res.status}`);
        setBulkRunning(false);
        return;
      }

      readSSEStream(
        res,
        (event) => {
          switch (event.type) {
            case 'log':
              setBulkLogs((prev) => [...prev, event.message]);
              break;
            case 'account_status':
              setBulkStatuses((prev) => {
                const existing = prev.findIndex((s) => s.account === event.data.account);
                if (existing >= 0) {
                  const updated = [...prev];
                  updated[existing] = event.data;
                  return updated;
                }
                return [...prev, event.data];
              });
              setBulkLogs((prev) => [
                ...prev,
                `[${event.data.account}] ${event.data.status}: ${event.data.message}`,
              ]);
              break;
            case 'done':
              setBulkDone(true);
              setBulkLogs((prev) => [...prev, 'Bulk apply complete.']);
              break;
            case 'error':
              setBulkError(event.message);
              setBulkLogs((prev) => [...prev, `ERROR: ${event.message}`]);
              break;
          }
        },
        () => setBulkRunning(false),
        (msg) => {
          setBulkError(msg);
          setBulkRunning(false);
        },
      );
    }).catch((e) => {
      setBulkError(e.message);
      setBulkRunning(false);
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="header">
        <h1>Meroshare Automation</h1>
        <p className="subtitle">Scan for open IPOs and apply across multiple accounts</p>
      </header>

      <div className="controls">
        <div className="control-group">
          <label htmlFor="account-select">Account (for scanning)</label>
          <select
            id="account-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={anyRunning}
          >
            {accounts.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.username})
              </option>
            ))}
          </select>
        </div>

        <button className="run-btn" onClick={handleScan} disabled={anyRunning || !selected}>
          {running ? 'Scanning...' : 'Scan for Applications'}
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
                <th>Actions</th>
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
                  <td className="action-cell">
                    <button
                      className="apply-btn"
                      onClick={() => openApplyModal(i, iss.name)}
                      disabled={anyRunning}
                    >
                      Apply
                    </button>
                    <button
                      className="bulk-apply-btn"
                      onClick={() => openBulkModal(iss.name)}
                      disabled={anyRunning}
                    >
                      Apply in Bulk
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Single Apply Modal */}
      {applyTarget && (
        <div className="modal-overlay" onClick={closeApplyModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Apply for IPO</h2>
              <button className="modal-close" onClick={closeApplyModal} disabled={applyRunning}>&times;</button>
            </div>

            <div className="modal-body">
              <div className="modal-company">{applyTarget.name}</div>
              <div className="modal-account-info">
                Applying as: <strong>{selected}</strong>
              </div>

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

      {/* Bulk Apply Modal */}
      {bulkTarget && (
        <div className="modal-overlay" onClick={closeBulkModal}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Apply in Bulk</h2>
              <button className="modal-close" onClick={closeBulkModal} disabled={bulkRunning}>&times;</button>
            </div>

            <div className="modal-body">
              <div className="modal-company">{bulkTarget.name}</div>

              {/* Account selection */}
              <div className="bulk-accounts-section">
                <div className="bulk-accounts-header">
                  <h3>Select Accounts</h3>
                  <button className="toggle-all-btn" onClick={toggleAllAccounts} disabled={bulkRunning}>
                    {bulkSelectedAccounts.length === accounts.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="bulk-accounts-list">
                  {accounts.map((a) => {
                    const statusEntry = bulkStatuses.find((s) => s.account === a.name);
                    return (
                      <div key={a.name} className={`bulk-account-item ${statusEntry ? 'has-status' : ''}`}>
                        <label className="bulk-account-left">
                          <input
                            type="checkbox"
                            checked={bulkSelectedAccounts.includes(a.name)}
                            onChange={() => toggleBulkAccount(a.name)}
                            disabled={bulkRunning}
                          />
                          <span className="bulk-account-name">{a.name}</span>
                          <span className="bulk-account-username">({a.username})</span>
                        </label>
                        <input
                          type="password"
                          className="bulk-account-pin"
                          maxLength={4}
                          placeholder="PIN"
                          value={bulkAccountPINs[a.name] || ''}
                          onChange={(e) =>
                            setBulkAccountPINs((prev) => ({ ...prev, [a.name]: e.target.value }))
                          }
                          disabled={bulkRunning || !bulkSelectedAccounts.includes(a.name)}
                          title="Per-account TPIN (optional, overrides default)"
                        />
                        {statusEntry && (
                          <span className="bulk-account-status">
                            <AccountStatusBadge status={statusEntry.status} />
                            <span className="bulk-account-msg">{statusEntry.message}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="modal-form">
                <div className="control-group">
                  <label htmlFor="bulk-kitta">Applied Kitta (for all accounts)</label>
                  <input
                    id="bulk-kitta"
                    type="number"
                    min={1}
                    placeholder="e.g. 10"
                    value={bulkKitta}
                    onChange={(e) => setBulkKitta(e.target.value)}
                    disabled={bulkRunning}
                  />
                </div>

                <div className="control-group">
                  <label htmlFor="bulk-pin">Default Transaction PIN (4 digits, used when per-account PIN is empty)</label>
                  <input
                    id="bulk-pin"
                    type="password"
                    maxLength={4}
                    placeholder="****"
                    value={bulkPIN}
                    onChange={(e) => setBulkPIN(e.target.value)}
                    disabled={bulkRunning}
                  />
                </div>

                <button
                  className="run-btn apply-submit-btn"
                  onClick={handleBulkApply}
                  disabled={bulkRunning || bulkSelectedAccounts.length === 0 || !bulkKitta || !allAccountsHavePIN}
                >
                  {bulkRunning
                    ? `Applying (${bulkStatuses.filter((s) => s.status !== 'pending' && s.status !== 'running').length}/${bulkSelectedAccounts.length})...`
                    : `Apply for ${bulkSelectedAccounts.length} Account${bulkSelectedAccounts.length !== 1 ? 's' : ''}`}
                </button>
              </div>

              {bulkError && <div className="error-banner">{bulkError}</div>}

              {/* Per-account status summary */}
              {bulkStatuses.length > 0 && bulkDone && (
                <div className="bulk-summary">
                  <h3>Results</h3>
                  <table className="results-table bulk-results-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Status</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkStatuses.map((s) => (
                        <tr key={s.account}>
                          <td>{s.account}</td>
                          <td><AccountStatusBadge status={s.status} /></td>
                          <td className="remarks-cell">{s.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {bulkLogs.length > 0 && (
                <div className="apply-log-section">
                  <h3>Progress Log</h3>
                  <div className="log-area apply-log-area" ref={bulkLogRef}>
                    {bulkLogs.map((msg, i) => (
                      <div key={i} className="log-line">{msg}</div>
                    ))}
                    {bulkRunning && <div className="log-line log-spinner">Working...</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Application reports (from full automation run) */}
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
          <p className="empty-msg">No open issues found. Try scanning again later.</p>
        </div>
      )}
    </div>
  );
}
