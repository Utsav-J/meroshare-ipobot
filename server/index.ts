import express from 'express';
import cors from 'cors';
import path from 'path';
import { loadAllCredentials, runMeroshareAutomation, scanForIssues, applyForIPO, bulkApplyForIPO, type AutomationEvent } from './automation';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ── State ────────────────────────────────────────────────────────────────────

let running = false;

// ── API Routes ───────────────────────────────────────────────────────────────

/** List account names (no passwords exposed) */
app.get('/api/accounts', (_req, res) => {
  try {
    const creds = loadAllCredentials();
    const accounts = Object.keys(creds).map((name) => ({
      name,
      username: creds[name].username,
    }));
    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Run automation for a given account — returns SSE stream */
app.post('/api/run', (req, res) => {
  if (running) {
    res.status(409).json({ error: 'An automation is already running. Please wait.' });
    return;
  }

  const { account, maxReports = 5 } = req.body;
  if (!account) {
    res.status(400).json({ error: 'Missing "account" in request body' });
    return;
  }

  const creds = loadAllCredentials();
  const cred = creds[account];
  if (!cred) {
    res.status(404).json({ error: `Account "${account}" not found` });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  running = true;

  const sendEvent = (event: AutomationEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Run automation in background
  runMeroshareAutomation(account, cred, maxReports, sendEvent).finally(() => {
    running = false;
    res.end();
  });

  // If client disconnects, we still let automation finish gracefully
  req.on('close', () => {
    // Automation will complete on its own; we just note the disconnect
    console.log('[SSE] Client disconnected');
  });
});

/** Scan for open issues only (no reports) — returns SSE stream */
app.post('/api/scan', (req, res) => {
  if (running) {
    res.status(409).json({ error: 'An automation is already running. Please wait.' });
    return;
  }

  const { account } = req.body;
  if (!account) {
    res.status(400).json({ error: 'Missing "account" in request body' });
    return;
  }

  const creds = loadAllCredentials();
  const cred = creds[account];
  if (!cred) {
    res.status(404).json({ error: `Account "${account}" not found` });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  running = true;

  const sendEvent = (event: AutomationEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  scanForIssues(account, cred, sendEvent).finally(() => {
    running = false;
    res.end();
  });

  req.on('close', () => {
    console.log('[SSE] Client disconnected (scan)');
  });
});

/** Apply for a specific IPO — returns SSE stream */
app.post('/api/apply', (req, res) => {
  if (running) {
    res.status(409).json({ error: 'An automation is already running. Please wait.' });
    return;
  }

  const { account, companyIndex, appliedKitta, transactionPIN } = req.body;
  if (!account) {
    res.status(400).json({ error: 'Missing "account" in request body' });
    return;
  }
  if (companyIndex === undefined || companyIndex === null) {
    res.status(400).json({ error: 'Missing "companyIndex" in request body' });
    return;
  }
  if (!appliedKitta) {
    res.status(400).json({ error: 'Missing "appliedKitta" in request body' });
    return;
  }
  if (!transactionPIN) {
    res.status(400).json({ error: 'Missing "transactionPIN" in request body' });
    return;
  }

  const creds = loadAllCredentials();
  const cred = creds[account];
  if (!cred) {
    res.status(404).json({ error: `Account "${account}" not found` });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  running = true;

  const sendEvent = (event: AutomationEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  applyForIPO(account, cred, companyIndex, appliedKitta, transactionPIN, sendEvent).finally(() => {
    running = false;
    res.end();
  });

  req.on('close', () => {
    console.log('[SSE] Client disconnected (apply)');
  });
});

/** Bulk apply for a specific IPO across multiple accounts — returns SSE stream */
app.post('/api/bulk-apply', (req, res) => {
  if (running) {
    res.status(409).json({ error: 'An automation is already running. Please wait.' });
    return;
  }

  const { accounts: accountNames, companyName, appliedKitta, transactionPIN, accountPINs = {} } = req.body;
  if (!Array.isArray(accountNames) || accountNames.length === 0) {
    res.status(400).json({ error: 'Missing or empty "accounts" array in request body' });
    return;
  }
  if (!companyName) {
    res.status(400).json({ error: 'Missing "companyName" in request body' });
    return;
  }
  if (!appliedKitta) {
    res.status(400).json({ error: 'Missing "appliedKitta" in request body' });
    return;
  }
  if (!transactionPIN) {
    res.status(400).json({ error: 'Missing "transactionPIN" in request body' });
    return;
  }

  const creds = loadAllCredentials();

  // Validate all accounts exist before starting
  const entries: { name: string; cred: any }[] = [];
  for (const name of accountNames) {
    const cred = creds[name];
    if (!cred) {
      res.status(404).json({ error: `Account "${name}" not found` });
      return;
    }
    entries.push({ name, cred });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  running = true;

  const sendEvent = (event: AutomationEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  bulkApplyForIPO(entries, companyName, appliedKitta, transactionPIN, accountPINs, sendEvent).finally(() => {
    running = false;
    res.end();
  });

  req.on('close', () => {
    console.log('[SSE] Client disconnected (bulk-apply)');
  });
});

/** Check if automation is currently running */
app.get('/api/status', (_req, res) => {
  res.json({ running });
});

// ── Serve static webapp build (production) ───────────────────────────────────

const webappDist = path.resolve(__dirname, '..', 'webapp', 'dist');
app.use(express.static(webappDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(webappDist, 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
