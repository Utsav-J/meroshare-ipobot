# Meroshare Autofill

A web-based automation tool for [Meroshare](https://meroshare.cdsc.com.np/) that streamlines IPO applications and tracks application reports. Built with a React frontend and an Express + Playwright backend.

## Features

- **Multi-account support** -- manage multiple Meroshare accounts from one dashboard
- **Automated login** -- handles DP selection, credential entry, and session management
- **IPO listing** -- view all currently open issues in the "Apply for Issue" tab
- **One-click IPO application** -- apply for an IPO by entering only the kitta amount and transaction PIN; the tool auto-fills bank, account, branch, CRN, and declaration fields
- **Application reports** -- view status and remarks for past applications
- **Live progress** -- real-time Server-Sent Events (SSE) stream logs to the UI as automation runs

## Tech Stack

| Layer      | Technology                            |
| ---------- | ------------------------------------- |
| Frontend   | React 19, Vite 6, TypeScript          |
| Backend    | Express 4, Node.js, tsx               |
| Automation | Playwright (Chromium)                 |
| CI         | GitHub Actions                        |

## Project Structure

```
meroshare_autofill/
├── server/
│   ├── index.ts            # Express API server (SSE endpoints)
│   └── automation.ts       # Playwright automation logic
├── webapp/
│   └── src/
│       ├── App.tsx          # React UI
│       ├── App.css          # Styles
│       └── types.ts         # Shared TypeScript types
├── tests/
│   ├── apply-ipo.spec.ts   # E2E test for IPO application flow
│   ├── login.spec.ts       # Login and ASBA navigation tests
│   └── ...
├── .env.example
├── credentials.example.json
├── playwright.config.ts
└── package.json
```

## Setup

### Prerequisites

- Node.js (LTS recommended)
- npm

### Installation

```bash
# Install root dependencies
npm install

# Install webapp dependencies
cd webapp && npm install && cd ..

# Install Playwright browsers
npx playwright install
```

### Configuration

1. **Environment variables** -- copy the example and set the Meroshare URL:

```bash
cp .env.example .env
```

Edit `.env`:

```
BASE_URL="https://meroshare.cdsc.com.np/"
```

2. **Credentials** -- copy the example and fill in your account details:

```bash
cp credentials.example.json credentials.json
```

Edit `credentials.json` with your Meroshare username, password, and CRN for each account. For multi-account automation, also create `all_credentials.json` in the same format.

> **Important:** Never commit `credentials.json`, `all_credentials.json`, or `.env` to version control. They are already listed in `.gitignore`.

## Usage

### Development

Run the backend server and frontend dev server concurrently:

```bash
npm run dev
```

This starts:
- Backend API at `http://localhost:3000`
- Frontend dev server at `http://localhost:5173` (proxies `/api` to the backend)

Open `http://localhost:5173` in your browser.

### Production Build

```bash
npm run build:webapp
npm run server
```

The Express server serves the built webapp from `webapp/dist` at `http://localhost:3000`.

### Running Tests

```bash
# Run all Playwright tests
npm test

# Run a specific test file
npx playwright test tests/apply-ipo.spec.ts

# Run in headed mode (visible browser)
npx playwright test tests/apply-ipo.spec.ts --headed
```

## API Endpoints

| Method | Path             | Description                                    |
| ------ | ---------------- | ---------------------------------------------- |
| GET    | `/api/accounts`  | List account names and usernames (no secrets)  |
| GET    | `/api/status`    | Check if an automation is currently running    |
| POST   | `/api/run`       | Run the list automation (SSE stream)           |
| POST   | `/api/apply`     | Apply for a specific IPO (SSE stream)          |

### POST `/api/run`

```json
{ "account": "AccountName", "maxReports": 5 }
```

### POST `/api/apply`

```json
{
  "account": "AccountName",
  "companyIndex": 0,
  "appliedKitta": "10",
  "transactionPIN": "****"
}
```

## How It Works

1. The backend launches a headless Chromium browser via Playwright
2. It navigates to Meroshare, resolves the Depository Participant, and logs in
3. For listing: it scrapes open issues and application reports from the My ASBA page
4. For applying: it fills the IPO form (bank, account, kitta, CRN), checks the declaration, enters the transaction PIN, and submits
5. All progress is streamed to the frontend in real-time via SSE

## License

ISC
