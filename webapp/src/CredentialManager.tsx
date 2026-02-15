import { useState, useEffect, useRef } from 'react';
import type { StoredCredential, CredentialsMap } from './types';

// ── Common DP options (Nepal) ────────────────────────────────────────────────

const COMMON_DPS = [
  { code: '10200', name: 'Himalayan Bank Limited' },
  { code: '10300', name: 'Nabil Bank Limited' },
  { code: '10400', name: 'Nepal Investment Mega Bank Limited' },
  { code: '10500', name: 'Standard Chartered Bank Nepal Limited' },
  { code: '10600', name: 'Nepal SBI Bank Limited' },
  { code: '10700', name: 'Global IME Bank Limited' },
  { code: '10800', name: 'Everest Bank Limited' },
  { code: '10900', name: 'NIC Asia Bank Limited' },
  { code: '11000', name: 'Kumari Bank Limited' },
  { code: '11100', name: 'Laxmi Sunrise Bank Limited' },
  { code: '11200', name: 'Citizens Bank International Limited' },
  { code: '11300', name: 'Prime Commercial Bank Limited' },
  { code: '11400', name: 'Sanima Bank Limited' },
  { code: '11500', name: 'Machhapuchchhre Bank Limited' },
  { code: '11600', name: 'NMB Bank Limited' },
  { code: '11700', name: 'Nepal Bank Limited' },
  { code: '11800', name: 'Agriculture Development Bank Limited' },
  { code: '11900', name: 'Rastriya Banijya Bank Limited' },
  { code: '12000', name: 'Siddhartha Bank Limited' },
  { code: '12100', name: 'Bank of Kathmandu Limited' },
  { code: '12200', name: 'Century Commercial Bank Limited' },
  { code: '12300', name: 'Prabhu Bank Limited' },
  { code: '13100', name: 'NIBL Ace Capital Limited' },
  { code: '13200', name: 'NIC Asia Capital Limited' },
  { code: '13300', name: 'Global IME Capital Limited' },
  { code: '13400', name: 'Prabhu Capital Limited' },
  { code: '13500', name: 'Siddhartha Capital Limited' },
  { code: '13600', name: 'Sunrise Capital Limited' },
  { code: '13700', name: 'NMB Capital Limited' },
  { code: '14700', name: 'Mero Share (CDSC)' },
];

// ── localStorage helpers ──────────────────────────────────────────────────────

const STORAGE_KEY = 'meroshare_credentials';

export function loadCredentials(): CredentialsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupt data – ignore
  }
  return {};
}

export function saveCredentials(creds: CredentialsMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

// ── Validation helpers ────────────────────────────────────────────────────────

interface FormErrors {
  accountName?: string;
  dpCode?: string;
  username?: string;
  password?: string;
  crn?: string;
}

function validateForm(
  accountName: string,
  cred: StoredCredential,
  existingNames: string[],
  editingName: string | null,
): FormErrors {
  const errors: FormErrors = {};

  const trimmedName = accountName.trim();
  if (!trimmedName) {
    errors.accountName = 'Account name is required';
  } else if (trimmedName.length > 50) {
    errors.accountName = 'Account name is too long';
  } else if (editingName !== trimmedName && existingNames.includes(trimmedName)) {
    errors.accountName = 'An account with this name already exists';
  }

  if (!cred.DP_CODE) {
    errors.dpCode = 'DP is required';
  }

  if (!cred.username.trim()) {
    errors.username = 'Username / DMAT is required';
  }

  if (!cred.password.trim()) {
    errors.password = 'Password is required';
  } else if (cred.password.length < 4) {
    errors.password = 'Password is too short';
  }

  if (!cred.CRN.trim()) {
    errors.crn = 'CRN is required';
  }

  return errors;
}

/** Strip TPIN from a credential (TPIN is only entered at apply-time) */
function stripTpin(cred: StoredCredential): StoredCredential {
  const { TPIN: _, ...rest } = cred;
  return rest;
}

/** Validate & parse a JSON credentials import. Returns cleaned map or error string. */
function parseImportedJSON(raw: string): { creds: CredentialsMap } | { error: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Invalid JSON file.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'JSON must be an object with account names as keys.' };
  }

  const creds: CredentialsMap = {};
  const problems: string[] = [];

  for (const [name, entry] of Object.entries(parsed)) {
    const e = entry as any;
    if (!e || typeof e !== 'object') {
      problems.push(`"${name}": not a valid object`);
      continue;
    }
    if (!e.DP_CODE || !e.username || !e.password || !e.CRN) {
      const missing = ['DP_CODE', 'username', 'password', 'CRN'].filter((k) => !e[k]);
      problems.push(`"${name}": missing ${missing.join(', ')}`);
      continue;
    }
    creds[name] = stripTpin({
      DP_CODE: String(e.DP_CODE),
      username: String(e.username),
      password: String(e.password),
      CRN: String(e.CRN),
    });
  }

  if (Object.keys(creds).length === 0) {
    return { error: problems.length > 0 ? `No valid accounts found:\n${problems.join('\n')}` : 'No accounts found in file.' };
  }

  return { creds };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onCredentialsChange: (creds: CredentialsMap) => void;
}

const emptyCredential: StoredCredential = {
  DP_CODE: '',
  username: '',
  password: '',
  CRN: '',
};

export default function CredentialManager({ onCredentialsChange }: Props) {
  const [credentials, setCredentials] = useState<CredentialsMap>(() => loadCredentials());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form fields
  const [accountName, setAccountName] = useState('');
  const [formData, setFormData] = useState<StoredCredential>({ ...emptyCredential });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  // JSON import state
  const [dragOver, setDragOver] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist & notify parent whenever credentials change
  useEffect(() => {
    saveCredentials(credentials);
    onCredentialsChange(credentials);
  }, [credentials, onCredentialsChange]);

  // Auto-clear import message
  useEffect(() => {
    if (!importMsg) return;
    const t = setTimeout(() => setImportMsg(null), 5000);
    return () => clearTimeout(t);
  }, [importMsg]);

  const accountNames = Object.keys(credentials);

  // ── Form helpers ───────────────────────────────────────────────────────

  const resetForm = () => {
    setAccountName('');
    setFormData({ ...emptyCredential });
    setErrors({});
    setTouched({});
    setShowPassword(false);
    setEditingName(null);
    setIsFormOpen(false);
  };

  const openAddForm = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEditForm = (name: string) => {
    const cred = credentials[name];
    if (!cred) return;
    setAccountName(name);
    setFormData({ ...cred });
    setEditingName(name);
    setErrors({});
    setTouched({});
    setShowPassword(false);
    setIsFormOpen(true);
  };

  const handleFieldChange = (field: string, value: string) => {
    if (field === 'accountName') {
      setAccountName(value);
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    // Re-validate
    const newErrors = validateForm(accountName, formData, accountNames, editingName);
    setErrors(newErrors);
  };

  const handleSubmit = () => {
    // Mark all as touched
    setTouched({
      accountName: true,
      dpCode: true,
      username: true,
      password: true,
      crn: true,
    });

    const newErrors = validateForm(accountName, formData, accountNames, editingName);
    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) return;

    const trimmedName = accountName.trim();
    const cleanCred: StoredCredential = {
      DP_CODE: formData.DP_CODE,
      username: formData.username.trim(),
      password: formData.password,
      CRN: formData.CRN.trim(),
    };

    setCredentials((prev) => {
      const updated = { ...prev };
      // If renaming, remove old key
      if (editingName && editingName !== trimmedName) {
        delete updated[editingName];
      }
      updated[trimmedName] = cleanCred;
      return updated;
    });

    resetForm();
  };

  const handleDelete = (name: string) => {
    setCredentials((prev) => {
      const updated = { ...prev };
      delete updated[name];
      return updated;
    });
    setDeleteConfirm(null);
    if (editingName === name) resetForm();
  };

  // ── JSON Import handlers ──────────────────────────────────────────────

  const processImportFile = (file: File) => {
    if (!file.name.endsWith('.json')) {
      setImportMsg({ type: 'error', text: 'Please drop a .json file.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = parseImportedJSON(reader.result as string);
      if ('error' in result) {
        setImportMsg({ type: 'error', text: result.error });
        return;
      }

      const count = Object.keys(result.creds).length;
      setCredentials((prev) => ({ ...prev, ...result.creds }));
      setImportMsg({ type: 'success', text: `Imported ${count} account${count !== 1 ? 's' : ''} successfully.` });
    };
    reader.onerror = () => {
      setImportMsg({ type: 'error', text: 'Failed to read the file.' });
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processImportFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImportFile(file);
    // Reset so the same file can be selected again
    e.target.value = '';
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const hasError = (field: string) => touched[field] && errors[field as keyof FormErrors];

  return (
    <div className="cred-manager">
      <div className="cred-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="cred-header-left">
          <h2>Manage Accounts</h2>
          <span className="cred-count">{accountNames.length} account{accountNames.length !== 1 ? 's' : ''} saved</span>
        </div>
        <button className="cred-collapse-btn" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '▸' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <div className="cred-content">
          {/* Account list */}
          {accountNames.length > 0 && (
            <div className="cred-list">
              {accountNames.map((name) => {
                const cred = credentials[name];
                const dpInfo = COMMON_DPS.find((d) => d.code === cred.DP_CODE);
                return (
                  <div key={name} className="cred-card">
                    <div className="cred-card-main">
                      <div className="cred-card-name">{name}</div>
                      <div className="cred-card-details">
                        <span className="cred-detail">
                          <span className="cred-detail-label">DMAT:</span> {cred.username}
                        </span>
                        <span className="cred-detail">
                          <span className="cred-detail-label">DP:</span>{' '}
                          {dpInfo ? `${dpInfo.name} (${cred.DP_CODE})` : cred.DP_CODE}
                        </span>
                        <span className="cred-detail">
                          <span className="cred-detail-label">CRN:</span> {cred.CRN}
                        </span>
                      </div>
                    </div>
                    <div className="cred-card-actions">
                      <button className="cred-edit-btn" onClick={() => openEditForm(name)}>Edit</button>
                      {deleteConfirm === name ? (
                        <span className="cred-delete-confirm">
                          <span>Sure?</span>
                          <button className="cred-delete-yes" onClick={() => handleDelete(name)}>Yes</button>
                          <button className="cred-delete-no" onClick={() => setDeleteConfirm(null)}>No</button>
                        </span>
                      ) : (
                        <button className="cred-delete-btn" onClick={() => setDeleteConfirm(name)}>Delete</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {accountNames.length === 0 && !isFormOpen && (
            <div className="cred-empty">
              No accounts added yet. Add your Meroshare credentials below, or drop a JSON file to import.
            </div>
          )}

          {/* JSON drop zone */}
          <div
            className={`cred-dropzone ${dragOver ? 'cred-dropzone-active' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileInput}
              hidden
            />
            <div className="cred-dropzone-icon">&#x1F4C4;</div>
            <div className="cred-dropzone-text">
              <strong>Drop a JSON file</strong> here to import accounts, or <span className="cred-dropzone-link">click to browse</span>
            </div>
            <div className="cred-dropzone-hint">
              Expected format: <code>{`{ "Name": { "DP_CODE", "username", "password", "CRN" } }`}</code>
            </div>
          </div>

          {importMsg && (
            <div className={`cred-import-msg ${importMsg.type === 'error' ? 'cred-import-error' : 'cred-import-success'}`}>
              {importMsg.text}
            </div>
          )}

          {/* Add/Edit form */}
          {isFormOpen ? (
            <div className="cred-form">
              <h3>{editingName ? `Edit "${editingName}"` : 'Add New Account'}</h3>

              <div className="cred-form-grid">
                {/* Account Name */}
                <div className={`control-group cred-field-full ${hasError('accountName') ? 'has-error' : ''}`}>
                  <label htmlFor="cred-name">Account Name (label)</label>
                  <input
                    id="cred-name"
                    type="text"
                    placeholder="e.g. Dad, Mom, Self..."
                    value={accountName}
                    onChange={(e) => handleFieldChange('accountName', e.target.value)}
                    onBlur={() => handleBlur('accountName')}
                    autoFocus
                  />
                  {hasError('accountName') && <span className="field-error">{errors.accountName}</span>}
                </div>

                {/* DP Code */}
                <div className={`control-group ${hasError('dpCode') ? 'has-error' : ''}`}>
                  <label htmlFor="cred-dp">Depository Participant (DP)</label>
                  <select
                    id="cred-dp"
                    value={formData.DP_CODE}
                    onChange={(e) => handleFieldChange('DP_CODE', e.target.value)}
                    onBlur={() => handleBlur('dpCode')}
                  >
                    <option value="">Select DP...</option>
                    {COMMON_DPS.map((dp) => (
                      <option key={dp.code} value={dp.code}>
                        {dp.name} ({dp.code})
                      </option>
                    ))}
                  </select>
                  {hasError('dpCode') && <span className="field-error">{errors.dpCode}</span>}
                </div>

                {/* Username / DMAT */}
                <div className={`control-group ${hasError('username') ? 'has-error' : ''}`}>
                  <label htmlFor="cred-user">Username (DMAT No.)</label>
                  <input
                    id="cred-user"
                    type="text"
                    placeholder="e.g. 00138869"
                    value={formData.username}
                    onChange={(e) => handleFieldChange('username', e.target.value)}
                    onBlur={() => handleBlur('username')}
                  />
                  {hasError('username') && <span className="field-error">{errors.username}</span>}
                </div>

                {/* Password */}
                <div className={`control-group ${hasError('password') ? 'has-error' : ''}`}>
                  <label htmlFor="cred-pass">Password</label>
                  <div className="cred-password-wrap">
                    <input
                      id="cred-pass"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Meroshare password"
                      value={formData.password}
                      onChange={(e) => handleFieldChange('password', e.target.value)}
                      onBlur={() => handleBlur('password')}
                    />
                    <button
                      type="button"
                      className="cred-toggle-pass"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {hasError('password') && <span className="field-error">{errors.password}</span>}
                </div>

                {/* CRN */}
                <div className={`control-group ${hasError('crn') ? 'has-error' : ''}`}>
                  <label htmlFor="cred-crn">CRN (Capital Registration Number)</label>
                  <input
                    id="cred-crn"
                    type="text"
                    placeholder="e.g. 142S4166"
                    value={formData.CRN}
                    onChange={(e) => handleFieldChange('CRN', e.target.value)}
                    onBlur={() => handleBlur('crn')}
                  />
                  {hasError('crn') && <span className="field-error">{errors.crn}</span>}
                </div>
              </div>

              <div className="cred-form-actions">
                <button className="run-btn cred-save-btn" onClick={handleSubmit}>
                  {editingName ? 'Save Changes' : 'Add Account'}
                </button>
                <button className="cred-cancel-btn" onClick={resetForm}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="cred-add-btn" onClick={openAddForm}>
              + Add Account
            </button>
          )}
        </div>
      )}
    </div>
  );
}
