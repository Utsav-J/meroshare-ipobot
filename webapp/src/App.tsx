import { useState, useEffect, useRef, useCallback } from 'react';
import type { Account, AutomationEvent, ReportRow, IssueRow, AccountStatus, CredentialsMap } from './types';
import CredentialManager, { loadCredentials } from './CredentialManager';

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
  const [showHelp, setShowHelp] = useState(false);
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

  // ── Sync credentials from localStorage to server ──────────────────────────

  const syncCredentialsToServer = useCallback(async (creds: CredentialsMap) => {
    try {
      await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
    } catch {
      // Server might be down, credentials are still in localStorage
    }

    // Derive accounts list from the credentials map
    const accs: Account[] = Object.keys(creds).map((name) => ({
      name,
      username: creds[name].username,
      dpCode: creds[name].DP_CODE,
      tpin: creds[name].TPIN || '',
    }));
    setAccounts(accs);
    if (accs.length > 0 && !accs.find((a) => a.name === selected)) {
      setSelected(accs[0].name);
    }
  }, [selected]);

  const handleCredentialsChange = useCallback((creds: CredentialsMap) => {
    syncCredentialsToServer(creds);
  }, [syncCredentialsToServer]);

  // On mount: sync saved browser credentials to server, falling back to server file
  useEffect(() => {
    const browserCreds = loadCredentials();
    const hasBrowserCreds = Object.keys(browserCreds).length > 0;

    if (hasBrowserCreds) {
      // Browser has saved credentials — sync them to server
      syncCredentialsToServer(browserCreds);
    } else {
      // No browser credentials — fall back to server-side file
      fetch('/api/accounts')
        .then((r) => r.json())
        .then((data: Account[]) => {
          setAccounts(data);
          if (data.length > 0) setSelected(data[0].name);
        })
        .catch((e) => setError(`Failed to load accounts: ${e.message}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Pre-fill TPIN from the selected account's stored TPIN if available
    const selectedAccount = accounts.find((a) => a.name === selected);
    setTransactionPIN(selectedAccount?.tpin || '');
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
    // Pre-fill per-account TPINs from stored credentials
    const prefilledPINs: Record<string, string> = {};
    for (const a of accounts) {
      if (a.tpin) {
        prefilledPINs[a.name] = a.tpin;
      }
    }
    setBulkAccountPINs(prefilledPINs);
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
        <div className="header-top">
          <h1>Meroshare Automation</h1>
          <button className="help-btn" onClick={() => setShowHelp(true)} title="How to use this app">
            ?
          </button>
        </div>
        <p className="subtitle">Scan for open IPOs and apply across multiple accounts</p>
      </header>

      {/* Help Modal */}
      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal modal-wide help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>How to Use</h2>
              <button className="modal-close" onClick={() => setShowHelp(false)}>&times;</button>
            </div>
            <div className="modal-body help-body">
              <div className="help-section">
                <h3>1. Add Your Accounts</h3>
                <p>
                  Click <strong>"Manage Accounts"</strong> at the top to expand the accounts panel. You can add accounts
                  one-by-one using the <strong>"+ Add Account"</strong> button, or quickly import multiple accounts by
                  dropping a <code>.json</code> file in the drop zone.
                </p>
                <div className="help-note">
                  The JSON file should follow this format:
                  <code className="help-code-block">{`{
  "Dad": { "DP_CODE": "10700", "username": "00138869", "password": "***", "CRN": "142S4166" },
  "Mom": { "DP_CODE": "10700", "username": "00138873", "password": "***", "CRN": "13408572" }
}`}</code>
                </div>
                <p>
                  Your credentials are stored in your <strong>browser's local storage</strong> and are sent to the server
                  only when running automation. They are never uploaded or shared externally.
                </p>
              </div>

              <div className="help-section">
                <h3>2. Scan for Open IPOs</h3>
                <p>
                  Select any of your accounts from the dropdown and click <strong>"Scan for Applications"</strong>.
                  The system will log into Meroshare with that account and fetch all currently open IPO issues.
                </p>
                <p>
                  Each issue will show a <strong>status badge</strong>:
                </p>
                <ul className="help-list">
                  <li><span className="badge badge-green">Open</span> — You can apply for this IPO</li>
                  <li><span className="badge badge-yellow">Already Applied / Closed</span> — The apply button is not available on Meroshare (already applied, window closed, etc.)</li>
                </ul>
              </div>

              <div className="help-section">
                <h3>3. Apply for a Single Account</h3>
                <p>
                  Click <strong>"Apply"</strong> next to an open issue. Enter the number of kitta and your
                  <strong> Transaction PIN (TPIN)</strong>, then submit. The system will fill the Meroshare form
                  automatically for the selected account.
                </p>
              </div>

              <div className="help-section">
                <h3>4. Apply in Bulk</h3>
                <p>
                  Click <strong>"Apply in Bulk"</strong> to apply for the same IPO across multiple accounts at once.
                  Select which accounts to include, enter kitta and TPIN for each (or a default TPIN), and submit.
                  The system will process each account sequentially and show live status updates.
                </p>
              </div>

              <div className="help-section">
                <h3>Tips</h3>
                <ul className="help-list">
                  <li>Only one automation can run at a time — wait for the current one to finish before starting another.</li>
                  <li>The TPIN is <strong>never saved</strong> — you'll enter it fresh each time you apply, for security.</li>
                  <li>You can scan from any account — the open IPO list is the same across accounts.</li>
                  <li>The server needs to be running locally (<code>npm run server</code>) for the automation to work.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <CredentialManager onCredentialsChange={handleCredentialsChange} />

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
                {a.name} ({a.username}) — DP: {a.dpCode}
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
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((iss, i) => (
                <tr key={i} className={!iss.hasApplyButton ? 'issue-row-no-apply' : ''}>
                  <td>{i + 1}</td>
                  <td>{iss.name}</td>
                  <td>{iss.subGroup}</td>
                  <td><span className="badge badge-blue">{iss.shareType}</span></td>
                  <td>{iss.shareGroup}</td>
                  <td>
                    {iss.hasApplyButton ? (
                      <span className="badge badge-green">Open</span>
                    ) : (
                      <span className="badge badge-yellow" title="This issue is listed but has no Apply button on Meroshare. You may have already applied, or the application window may have closed.">Already Applied / Closed</span>
                    )}
                  </td>
                  <td className="action-cell">
                    {iss.hasApplyButton ? (
                      <>
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
                      </>
                    ) : (
                      <span className="issue-no-apply-hint">No action available</span>
                    )}
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
                {accounts.find((a) => a.name === selected)?.dpCode && (
                  <span> — DP: <strong>{accounts.find((a) => a.name === selected)?.dpCode}</strong></span>
                )}
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
                          <span className="bulk-account-dp">DP: {a.dpCode}</span>
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
