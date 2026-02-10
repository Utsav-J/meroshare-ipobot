import express from 'express';
import cors from 'cors';
import path from 'path';
import { loadAllCredentials, runMeroshareAutomation, type AutomationEvent } from './automation';

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
