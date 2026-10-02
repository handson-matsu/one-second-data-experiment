const SESSIONS_SHEET = 'sessions';
const SETTINGS_SHEET = 'settings';

const ALLOWED_TARGETS = [1, 3, 5];
const ALLOWED_COUNTS = [10, 30, 50, 100];
const MAX_MEASUREMENTS = 100;


// ---------- 初期設定 ----------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // sessions
  let sessions = ss.getSheetByName(SESSIONS_SHEET);
  if (!sessions) {
    sessions = ss.insertSheet(SESSIONS_SHEET);
  }

  if (sessions.getLastRow() === 0) {
    const headers = [
      'session_id',
      'started_at',
      'completed_at',
      'received_at',
      'target_seconds',
      'planned_count',
      'actual_count',
      'feedback_mode',
      'app_version',
      'schema_version'
    ];

    for (let i = 1; i <= MAX_MEASUREMENTS; i++) {
      headers.push(`value_${String(i).padStart(3, '0')}_ms`);
    }

    headers.push('data_type');
    sessions.getRange(1, 1, 1, headers.length).setValues([headers]);
    sessions.setFrozenRows(1);
  }

  // settings
  let settings = ss.getSheetByName(SETTINGS_SHEET);
  if (!settings) {
    settings = ss.insertSheet(SETTINGS_SHEET);
  }

  if (settings.getLastRow() === 0) {
    settings.getRange(1, 1, 2, 2).setValues([
      ['setting', 'value'],
      ['accepting', false]
    ]);
    settings.setFrozenRows(1);
  }
}


// ---------- Web App ----------

function doGet() {
  return jsonResponse({
    ok: true,
    accepting: isAccepting()
  });
}


function doPost(e) {
  try {
    if (!isAccepting()) {
      return jsonResponse({
        ok: false,
        status: 'closed',
        message: 'Data collection is currently closed.'
      });
    }

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No data received.');
    }

    const data = JSON.parse(e.postData.contents);
    validateData(data);
    const dataType = normalizeDataType_(data);

    const sheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SESSIONS_SHEET);

    if (!sheet) {
      throw new Error('sessions sheet does not exist.');
    }

    // session_id の重複確認
    if (sessionExists(sheet, data.session_id)) {
      return jsonResponse({
        ok: true,
        status: 'duplicate',
        message: 'This session has already been saved.'
      });
    }

    const measurements = data.measurements_ms.slice(0, MAX_MEASUREMENTS);

    while (measurements.length < MAX_MEASUREMENTS) {
      measurements.push('');
    }

    const row = [
      data.session_id,
      data.started_at,
      data.completed_at,
      new Date(),
      data.target_seconds,
      data.planned_count,
      data.measurements_ms.length,
      data.feedback_mode,
      data.app_version || '',
      data.schema_version || '',
      ...measurements,
      dataType
    ];

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      // ロック取得後にも再確認
      if (sessionExists(sheet, data.session_id)) {
        return jsonResponse({
          ok: true,
          status: 'duplicate',
          message: 'This session has already been saved.'
        });
      }

      ensureDataTypeColumn_(sheet);
      sheet.appendRow(row);

    } finally {
      lock.releaseLock();
    }

    return jsonResponse({
      ok: true,
      status: 'saved'
    });

  } catch (error) {
    return jsonResponse({
      ok: false,
      status: 'error',
      message: String(error.message || error)
    });
  }
}


// ---------- 設定 ----------

function isAccepting() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SETTINGS_SHEET);

  if (!sheet) return false;

  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === 'accepting') {
      const value = values[i][1];

      return value === true ||
        String(value).toLowerCase().trim() === 'true';
    }
  }

  return false;
}


// ---------- 検証 ----------

function validateData(data) {
  if (!data.session_id || typeof data.session_id !== 'string') {
    throw new Error('Invalid session_id.');
  }

  if (!ALLOWED_TARGETS.includes(Number(data.target_seconds))) {
    throw new Error('Invalid target_seconds.');
  }

  if (!ALLOWED_COUNTS.includes(Number(data.planned_count))) {
    throw new Error('Invalid planned_count.');
  }

  if (!['on', 'off'].includes(data.feedback_mode)) {
    throw new Error('Invalid feedback_mode.');
  }

  if (!Array.isArray(data.measurements_ms)) {
    throw new Error('measurements_ms must be an array.');
  }

  if (data.measurements_ms.length !== Number(data.planned_count)) {
    throw new Error('Measurement count does not match planned_count.');
  }

  for (const value of data.measurements_ms) {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0
    ) {
      throw new Error('Invalid measurement value.');
    }
  }

  if (!data.started_at || !data.completed_at) {
    throw new Error('Missing timestamp.');
  }
}


// ---------- 重複確認 ----------

function sessionExists(sheet, sessionId) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return false;

  const ids = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .flat();

  return ids.includes(sessionId);
}


// ---------- JSON応答 ----------

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
// Add only the new trailing column; never rewrite existing rows or columns.
function ensureDataTypeColumn_(sheet) {
  const expected = ['session_id', 'started_at', 'completed_at', 'received_at',
    'target_seconds', 'planned_count', 'actual_count', 'feedback_mode',
    'app_version', 'schema_version'];
  for (let i = 1; i <= 100; i++) expected.push(`value_${String(i).padStart(3, '0')}_ms`);
  const actual = sheet.getRange(1, 1, 1, 110).getValues()[0];
  if (expected.some((name, i) => actual[i] !== name)) throw new Error('Unexpected sessions headers; no data was changed.');
  if (sheet.getLastColumn() > 111) throw new Error('Unexpected extra sessions columns; no data was changed.');
  if (sheet.getMaxColumns() < 111) sheet.insertColumnsAfter(sheet.getMaxColumns(), 111 - sheet.getMaxColumns());
  const cell = sheet.getRange(1, 111);
  const header = cell.getValue();
  if (header === 'data_type') return;
  if (header !== '' || sheet.getLastColumn() > 110) throw new Error('Column 111 is already in use.');
  cell.setValue('data_type');
}

// Optional editor-only migration, also performed under the receive lock on first save.
function migrateDataType_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SESSIONS_SHEET);
    if (!sheet) throw new Error('sessions sheet does not exist.');
    ensureDataTypeColumn_(sheet);
  } finally { lock.releaseLock(); }
}

function normalizeDataType_(data) {
  if (!Object.prototype.hasOwnProperty.call(data, 'data_type')) return 'production';
  if (!['production', 'test'].includes(data.data_type)) throw new Error('Invalid data_type.');
  return data.data_type;
}
