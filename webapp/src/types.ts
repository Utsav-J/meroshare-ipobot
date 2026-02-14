export interface Account {
  name: string;
  username: string;
  dpCode: string;
  tpin: string;
}

export type AutomationEvent =
  | { type: 'log'; message: string }
  | { type: 'issue'; data: IssueRow }
  | { type: 'report'; data: ReportRow }
  | { type: 'apply_success'; message: string }
  | { type: 'account_status'; data: AccountStatus }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ReportRow {
  index: number;
  total: number;
  name: string;
  shareType: string;
  status: string;
  remarks: string;
}

export interface IssueRow {
  name: string;
  subGroup: string;
  shareType: string;
  shareGroup: string;
}

export interface ApplyRequest {
  account: string;
  companyName: string;
  companyIndex: number;
  appliedKitta: string;
  transactionPIN: string;
}

export interface BulkApplyRequest {
  accounts: string[];
  companyName: string;
  appliedKitta: string;
  transactionPIN: string;
}

export type AccountStatusType = 'pending' | 'running' | 'already_applied' | 'success' | 'error' | 'login_failed';

export interface AccountStatus {
  account: string;
  status: AccountStatusType;
  message: string;
}
