// Separate project. Deploy as USER_DEPLOYING, access MYSELF only.
// Script properties: SPREADSHEET_ID and ADMIN_EMAIL (the deploying owner's email).
function authorize_() {
  const props = PropertiesService.getScriptProperties();
  const admin = (props.getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  const active = Session.getActiveUser().getEmail().trim().toLowerCase();
  if (!admin || !active || active !== admin) throw new Error('管理者権限がありません。');
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID を設定してください。');
  return id;
}
function doGet() {
  authorize_();
  return HtmlService.createHtmlOutputFromFile('Admin').setTitle('1 SECOND DATA 管理').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function sheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(name + ' シートがありません。');
  return sheet;
}
function setting_(ss) {
  const sheet = sheet_(ss, 'settings');
  const rows = sheet.getDataRange().getValues();
  const matches = rows.map((row,i) => i > 0 && String(row[0]).trim() === 'accepting' ? i + 1 : 0).filter(Boolean);
  if (matches.length !== 1) throw new Error('accepting は1行だけ設定してください。');
  const value = rows[matches[0]-1][1];
  return {sheet, row:matches[0], accepting:value === true || String(value).trim().toLowerCase() === 'true'};
}
function setAccepting(value) {
  const id = authorize_();
  if (typeof value !== 'boolean') throw new Error('受付状態は真偽値で指定してください。');
  const lock = LockService.getScriptLock();lock.waitLock(10000);
  try {
    const state = setting_(SpreadsheetApp.openById(id));
    state.sheet.getRange(state.row,2).setValue(value);
    SpreadsheetApp.flush();
    return {accepting:value};
  } finally {lock.releaseLock();}
}
function readData_(ss) {
  const values = sheet_(ss,'sessions').getDataRange().getValues();
  const headers = values[0].map(String);
  const required = ['session_id','received_at','target_seconds','feedback_mode','planned_count'];
  if (new Set(headers).size !== headers.length || required.some(h=>!headers.includes(h))) throw new Error('sessions のヘッダーを確認してください。');
  const index = Object.fromEntries(headers.map((h,i)=>[h,i]));
  const timezone = ss.getSpreadsheetTimeZone();
  const rows = values.slice(1).filter(row=>row.some(v=>v!==''));
  return {headers,index,timezone,rows};
}
function type_(row,index) {
  const value = index.data_type === undefined ? '' : row[index.data_type];
  return value === '' || value == null ? 'production' : value;
}
function legacy_(row,index) {return index.data_type === undefined || row[index.data_type] === '' || row[index.data_type] == null;}
function date_(value) {
  if (value === '' || value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}
function filters_(input) {
  const f = input || {};
  const result = {};
  for (const [key,allowed] of Object.entries({data_type:['production','test'],target_seconds:['1','3','5'],feedback_mode:['on','off'],planned_count:['10','30','50','100']})) {
    const value = f[key] == null ? '' : String(f[key]);
    if (value && !allowed.includes(value)) throw new Error('不正な検索条件: ' + key);
    result[key]=value;
  }
  for (const key of ['from','to']) {
    const v=f[key] || '';
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !date_(v) || date_(v).toISOString().slice(0,10)!==v)) throw new Error('日付が不正です。');
    result[key]=v;
  }
  if(result.from && result.to && result.from>result.to)throw new Error('開始日は終了日以前にしてください。');
  return result;
}
function select_(data,input) {
  const f=filters_(input), ix=data.index;
  return data.rows.filter(row=>{
    if(f.data_type && type_(row,ix)!==f.data_type)return false;
    for(const key of ['target_seconds','feedback_mode','planned_count'])if(f[key] && String(row[ix[key]])!==f[key])return false;
    if(f.from || f.to){
      const date=date_(row[ix.received_at]);if(!date)return false;
      const day=Utilities.formatDate(date,data.timezone,'yyyy-MM-dd');
      if((f.from && day<f.from)||(f.to && day>f.to))return false;
    }
    return true;
  });
}
function serial_(value) {return value instanceof Date ? value.toISOString() : value;}
function getDashboard(input,page) {
  const ss=SpreadsheetApp.openById(authorize_()), data=readData_(ss), ix=data.index;
  const summary={total:data.rows.length,production:0,test:0,unknown:0,legacy:0,latest:null,target_seconds:{1:0,3:0,5:0},feedback_mode:{on:0,off:0},planned_count:{10:0,30:0,50:0,100:0}};
  for(const row of data.rows){
    const type=type_(row,ix);if(type==='production'||type==='test')summary[type]++;else summary.unknown++;
    if(legacy_(row,ix))summary.legacy++;
    const date=date_(row[ix.received_at]);if(date && (!summary.latest || date.toISOString()>summary.latest))summary.latest=date.toISOString();
    for(const key of ['target_seconds','feedback_mode','planned_count']){
      const label=String(row[ix[key]]);summary[key][label]=(Object.prototype.hasOwnProperty.call(summary[key],label)?summary[key][label]:0)+1;
    }
  }
  const rows=select_(data,input).reverse();
  const totalPages=Math.max(1,Math.ceil(rows.length/50));
  const p=Math.min(totalPages,Math.max(1,Math.floor(Number(page)||1)));
  return {accepting:setting_(ss).accepting,timezone:data.timezone,summary,count:rows.length,page:p,totalPages,
    headers:[...data.headers,'effective_data_type','legacy_data_type'],
    rows:rows.slice((p-1)*50,p*50).map(row=>[...row.map(serial_),type_(row,ix),legacy_(row,ix)])};
}
function exportCsv(input) {
  const ss=SpreadsheetApp.openById(authorize_()), data=readData_(ss);
  const rows=select_(data,input);
  const cell=value=>{
    let s=String(serial_(value) ?? '');
    // Spreadsheet formula injection protection; numeric measurements stay numeric.
    if(typeof value==='string' && /^[\s]*[=+\-@]/.test(s))s="'"+s;
    return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  };
  const csv='\uFEFF'+[data.headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
  return {count:rows.length,csv,filename:'sessions-'+new Date().toISOString().replace(/[:.]/g,'-')+'.csv'};
}
