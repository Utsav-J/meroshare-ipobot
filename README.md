# Meroshare Autofill

A web-based automation tool for [Meroshare](https://meroshare.cdsc.com.np/) that streamlines IPO applications and tracks application reports. Built with a React frontend and an Express + Playwright backend.

## Features

- **Multi-account support** -- manage multiple Meroshare accounts from one dashboard
- **Per-account DP code** -- each account specifies its own Depository Participant (e.g., 10700 for Laxmi Sunrise Capital, 11700 for Citizens Bank International). The correct DP is resolved from the API and selected in the login dropdown automatically.
- **Automated login** -- handles DP selection, credential entry, and session management
- **IPO listing** -- scan for all currently open issues in the "Apply for Issue" tab
- **One-click IPO application** -- apply for an IPO by entering only the kitta amount and transaction PIN; the tool auto-fills bank, account, branch, CRN, and declaration fields
- **Bulk apply** -- apply for the same IPO across multiple accounts in one go, with per-account or global transaction PIN support
- **Per-account transaction PIN** -- optionally store a TPIN per account in the credentials file; the UI pre-fills it so you don't have to type it every time. If not specified, the global TPIN is used as fallback.
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
├── all_credentials.json     # Multi-account credentials (gitignored)
├── credentials.json         # Single-account fallback (gitignored)
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
cp credentials.example.json all_credentials.json
```

Edit `all_credentials.json` with your Meroshare account details. Each account entry requires:

| Field       | Required | Description                                                                 |
| ----------- | -------- | --------------------------------------------------------------------------- |
| `DP_CODE`   | Yes      | Depository Participant code (e.g., `"10700"` for Laxmi Sunrise Capital, `"11700"` for Citizens Bank International) |
| `username`  | Yes      | Meroshare DMAT number                                                       |
| `password`  | Yes      | Meroshare password                                                          |
| `CRN`       | Yes      | Customer Registration Number                                                |
| `TPIN`      | No       | Transaction PIN (4 digits). If set, pre-fills in the UI. Falls back to the global TPIN if not specified. |

Example:

```json
{
    "Dad": {
        "DP_CODE": "10700",
        "username": "00138869",
        "password": "your_password",
        "CRN": "your_crn",
        "TPIN": "1234"
    },
    "Mom": {
        "DP_CODE": "10700",
        "username": "00138873",
        "password": "your_password",
        "CRN": "your_crn"
    },
    "Dada": {
        "DP_CODE": "11700",
        "username": "01062707",
        "password": "your_password",
        "CRN": "your_crn",
        "TPIN": "5678"
    }
}
```

You can also create a `credentials.json` with a single account as a fallback (the tool prefers `all_credentials.json` if it exists).

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

| Method | Path              | Description                                         |
| ------ | ----------------- | --------------------------------------------------- |
| GET    | `/api/accounts`   | List account names, usernames, DP codes, and TPINs  |
| GET    | `/api/status`     | Check if an automation is currently running         |
| POST   | `/api/run`        | Run the full automation (login + reports, SSE stream) |
| POST   | `/api/scan`       | Scan for open issues only (SSE stream)              |
| POST   | `/api/apply`      | Apply for a specific IPO (SSE stream)               |
| POST   | `/api/bulk-apply` | Apply for an IPO across multiple accounts (SSE stream) |

### GET `/api/accounts`

Returns an array of accounts with no secrets exposed:

```json
[
  { "name": "Dad", "username": "0013xxxx", "dpCode": "10700", "tpin": "xxxx" },
  { "name": "Dada", "username": "0106xxxx", "dpCode": "11700", "tpin": "xxxx" }
]
```

### POST `/api/run`

```json
{ "account": "AccountName", "maxReports": 5 }
```

### POST `/api/scan`

```json
{ "account": "AccountName" }
```

### POST `/api/apply`

```json
{
  "account": "AccountName",
  "companyIndex": 0,
  "appliedKitta": "10",
  "transactionPIN": "1234"
}
```

### POST `/api/bulk-apply`

```json
{
  "accounts": ["Dad", "Mom", "Dada"],
  "companyName": "SOME COMPANY LIMITED",
  "appliedKitta": "10",
  "transactionPIN": "1234",
  "accountPINs": {
    "Dada": "5678"
  }
}
```

- `transactionPIN` is the global/default PIN used for accounts without an override.
- `accountPINs` is an optional map of per-account PINs that override the default.

## How It Works

1. The backend launches a headless Chromium browser via Playwright.
2. It navigates to Meroshare, captures the DP list from the API, and resolves the correct Depository Participant using the account's `DP_CODE`. For example, code `11700` resolves to "CITIZENS BANK INTERNATIONAL LIMITED".
3. The resolved DP name is used to select the correct entry in the login dropdown, and the DP's internal `clientId` is injected into the login POST request via API interception (to work around Angular's select binding).
4. For scanning: it logs in and scrapes open issues from the My ASBA page.
5. For applying: it fills the IPO form (bank, account, kitta, CRN), checks the declaration, enters the transaction PIN, and submits.
6. For bulk apply: it repeats the login-and-apply process for each selected account sequentially, using per-account credentials and DP codes.
7. All progress is streamed to the frontend in real-time via SSE.

## License

ISC
