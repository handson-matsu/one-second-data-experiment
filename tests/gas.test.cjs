const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const headers=['session_id','started_at','completed_at','received_at','target_seconds','planned_count','actual_count','feedback_mode','app_version','schema_version',...Array.from({length:100},(_,i)=>`value_${String(i+1).padStart(3,'0')}_ms`)];
class Sheet {
 constructor(rows){this.rows=rows;this.max=110;}
 getLastRow(){return this.rows.length;}
 getLastColumn(){return Math.max(0,...this.rows.map(r=>r.length));}
 getMaxColumns(){return this.max;}
 insertColumnsAfter(after,count){this.max+=count;}
 getDataRange(){return this.getRange(1,1,Math.max(1,this.rows.length),Math.max(1,this.getLastColumn()));}
 getRange(r,c,n=1,m=1){return {
  getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[r+i-1]?.[c+j-1]??'')),
  getValue:()=>this.rows[r-1]?.[c-1]??'',
  setValue:v=>{while(this.rows.length<r)this.rows.push([]);this.rows[r-1][c-1]=v;},
  setValues:values=>values.forEach((row,i)=>row.forEach((v,j)=>{while(this.rows.length<r+i)this.rows.push([]);this.rows[r+i-1][c+j-1]=v;}))
 };}
 appendRow(row){this.rows.push([...row]);}
 setFrozenRows(){}
}
function harness(file,rows=[headers.slice()],accepting=true){
 const sessions=new Sheet(rows),settings=new Sheet([['setting','value'],['accepting',accepting]]);
 const ss={getSheetByName:n=>({sessions,settings}[n]),getSpreadsheetTimeZone:()=> 'Asia/Tokyo'};
 let email='owner@example.com',opens=0,locked=false;
 const props={ADMIN_EMAIL:'owner@example.com',SPREADSHEET_ID:'sheet-id'};
 const context=vm.createContext({Date,console,
  SpreadsheetApp:{getActiveSpreadsheet:()=>ss,openById:id=>{assert.equal(id,'sheet-id');opens++;return ss;},flush(){}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
  Session:{getActiveUser:()=>({getEmail:()=>email})},
  LockService:{getScriptLock:()=>({waitLock(){locked=true;},releaseLock(){locked=false;}})},
  Utilities:{formatDate:(d,tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas',file),'utf8'),context);
 return {context,sessions,settings,setEmail:v=>email=v,props,get opens(){return opens;},get locked(){return locked;}};
}
function payload(extra={}){return {session_id:'uuid-1',started_at:'2026-10-02T00:00:00.000Z',completed_at:'2026-10-02T00:00:10.000Z',target_seconds:1,planned_count:10,feedback_mode:'on',app_version:'1',schema_version:'1',measurements_ms:Array.from({length:10},(_,i)=>1000.125+i/8),...extra};}
function send(h,data){return JSON.parse(h.context.doPost({postData:{contents:JSON.stringify(data)}}).text);}
test('receiver preserves 110 columns, appends type, keeps precision, deduplicates',()=>{
 const old=['old',...Array(109).fill('')],h=harness('receiver/Code.gs',[headers.slice(),old.slice()]);
 assert.equal(send(h,payload({data_type:'test'})).status,'saved');
 assert.deepEqual(h.sessions.rows[0].slice(0,110),headers);assert.equal(h.sessions.rows[0][110],'data_type');
 assert.deepEqual(h.sessions.rows[1],old);assert.equal(h.sessions.rows[2][110],'test');
 assert.deepEqual(h.sessions.rows[2].slice(10,20),payload().measurements_ms);
 assert.ok(h.sessions.rows[2].slice(20,110).every(v=>v===''));
 assert.equal(send(h,payload()).status,'duplicate');assert.equal(h.sessions.rows.length,3);assert.equal(h.locked,false);
 h.context.migrateDataType_();assert.equal(h.sessions.rows[0].length,111);
});
test('receiver all 24 configurations retain exact values and old clients default production',()=>{
 const h=harness('receiver/Code.gs');let n=0;
 for(const target_seconds of [1,3,5])for(const planned_count of [10,30,50,100])for(const feedback_mode of ['on','off']){
  const p=payload({session_id:String(++n),target_seconds,planned_count,feedback_mode,measurements_ms:Array(planned_count).fill(target_seconds*1000+.125)});
  assert.equal(send(h,p).status,'saved');const row=h.sessions.rows.at(-1);
  assert.deepEqual(row.slice(10,10+planned_count),p.measurements_ms);assert.equal(row[110],'production');
 }
});
test('receiver invalid type/closed/mismatched headers do not alter saved data',()=>{
 for(const data_type of ['',null,'other']){const h=harness('receiver/Code.gs');assert.equal(send(h,payload({data_type})).status,'error');assert.equal(h.sessions.rows.length,1);}
 const closed=harness('receiver/Code.gs',undefined,false);assert.equal(send(closed,payload()).status,'closed');assert.equal(closed.sessions.rows.length,1);
 const bad=headers.slice();bad[10]='wrong';const h=harness('receiver/Code.gs',[bad]);assert.equal(send(h,payload()).status,'error');assert.deepEqual(h.sessions.rows,[bad]);assert.equal(h.locked,false);
});
function row(id,type,date,target=1,feedback='on',count=10){const r=[id,'2026-10-01T00:00:00Z','2026-10-01T00:00:10Z',new Date(date),target,count,count,feedback,'1','1',...Array(100).fill(1000.125)];if(type!==undefined)r.push(type);return r;}
function admin(){return harness('admin/Code.gs',[[...headers,'data_type'],row('old','','2026-10-01T14:59:59Z'),row('prod','production','2026-10-01T15:00:00Z',3,'off',30),row('test','test','2026-10-02T14:59:59Z',5,'on',100),row('next','test','2026-10-02T15:00:00Z',5,'off',50)]);}
test('admin counts all data, legacy production, breakdowns and timezone date boundaries',()=>{
 const h=admin(),d=h.context.getDashboard({},1);
 assert.equal(d.summary.total,4);assert.equal(d.summary.production,2);assert.equal(d.summary.test,2);assert.equal(d.summary.legacy,1);assert.equal(d.summary.planned_count['100'],1);
 assert.equal(d.summary.latest,'2026-10-02T15:00:00.000Z');assert.equal(d.timezone,'Asia/Tokyo');
 const result=h.context.getDashboard({from:'2026-10-02',to:'2026-10-02'},1);assert.equal(result.count,2);
 assert.equal(h.context.getDashboard({data_type:'test',target_seconds:5,feedback_mode:'on',planned_count:100,from:'2026-10-02',to:'2026-10-02'},1).count,1);
 assert.equal(h.context.getDashboard({data_type:'production'},1).count,2);
 assert.throws(()=>h.context.getDashboard({from:'2026-02-30'},1));
 assert.throws(()=>h.context.getDashboard({from:'2026-10-03',to:'2026-10-02'},1));
});
test('admin CSV has all saved columns, precise values, all pages, safe text and BOM/CRLF',()=>{
 const h=admin();for(let i=0;i<60;i++)h.sessions.rows.push(row('more-'+i,'production','2026-10-02T01:00:00Z'));
 h.sessions.rows[1][8]='=HYPERLINK("bad")';
 const d=h.context.getDashboard({},1);assert.equal(d.rows.length,50);assert.equal(d.totalPages,2);
 const result=h.context.exportCsv({});assert.equal(result.count,64);assert.equal(result.csv[0],'\uFEFF');
 const lines=result.csv.slice(1).trimEnd().split('\r\n');assert.equal(lines.length,65);assert.equal(lines[0].split(',').length,111);
 assert.ok(result.csv.includes('1000.125'));assert.ok(result.csv.includes("'=HYPERLINK"));assert.ok(!result.csv.replace(/\r\n/g,'').includes('\n'));
 assert.equal(h.context.exportCsv({data_type:'test'}).count,2);
});
test('admin reads sheets before migration without writing data',()=>{
 const h=harness('admin/Code.gs',[headers.slice(),row('legacy',undefined,'2026-10-02T00:00:00Z')]);const before=JSON.stringify(h.sessions.rows);
 assert.equal(h.context.getDashboard({},1).summary.legacy,1);assert.equal(h.context.exportCsv({data_type:'production'}).count,1);assert.equal(JSON.stringify(h.sessions.rows),before);
});
test('every public admin API rejects anonymous/wrong accounts before sheet access',()=>{
 for(const email of ['', 'intruder@example.com']){const h=admin();h.setEmail(email);
 for(const [name,args]of [['doGet',[]],['getDashboard',[{},1]],['exportCsv',[{}]],['setAccepting',[false]]])assert.throws(()=>h.context[name](...args),/管理者権限/);
 assert.equal(h.opens,0);assert.equal(h.settings.rows[1][1],true);}
 const h=admin();delete h.props.ADMIN_EMAIL;assert.throws(()=>h.context.getDashboard({},1),/管理者権限/);
});
test('only accepting value is changed, invalid arguments rejected',()=>{
 const h=admin(),before=JSON.stringify(h.sessions.rows);assert.throws(()=>h.context.setAccepting('false'));
 assert.equal(h.context.setAccepting(false).accepting,false);assert.equal(h.settings.rows[1][1],false);assert.equal(JSON.stringify(h.sessions.rows),before);
 assert.equal(h.context.setAccepting(true).accepting,true);
});

test('empty sessions show zero counts and export headers only',()=>{
 const h=harness('admin/Code.gs'),d=h.context.getDashboard({},1);
 assert.equal(d.count,0);assert.equal(d.summary.total,0);assert.equal(d.summary.latest,null);
 for(const k of ['1','3','5'])assert.equal(d.summary.target_seconds[k],0);
 assert.equal(h.context.exportCsv({}).count,0);
 assert.equal(h.context.exportCsv({}).csv.split('\r\n').length,2);
});
