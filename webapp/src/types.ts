export interface Account {
  name: string;
  username: string;
}

export type AutomationEvent =
  | { type: 'log'; message: string }
  | { type: 'issue'; data: { name: string; subGroup: string; shareType: string; shareGroup: string } }
  | { type: 'report'; data: { index: number; total: number; name: string; shareType: string; status: string; remarks: string } }
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
