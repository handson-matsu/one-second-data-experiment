// No files are rewritten. Only explicit loopback serving enables test submissions.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/stats.js':'stats.js','/experiment.js':'experiment.js','/experiment-config.js':'experiment-config.js','/style.css':'style.css'};
function createServer() {
 return http.createServer((req,res)=>{
  if(req.method!=='GET' || !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')){res.writeHead(403);res.end();return;}
  const file=files[new URL(req.url,'http://127.0.0.1').pathname];
  if(!file){res.writeHead(404);res.end();return;}
  let content=fs.readFileSync(path.join(root,file),'utf8');
  if(file==='experiment-config.js')content+='\nwindow.ExperimentConfig.localTest = true;\n';
  if(file==='index.html')content=content.replace('<body>','<body><aside style="padding:12px;background:#fff2ad;color:#482b00;text-align:center" role="status">ローカルテスト専用：完了データは test として送信します。受付ONが必要です。</aside>').replace('<title>','<title>【TEST】');
  res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html;charset=utf-8':file.endsWith('.css')?'text/css;charset=utf-8':'text/javascript;charset=utf-8','Cache-Control':'no-store'});res.end(content);
 });
}
if(require.main===module){
 const server=createServer();server.on('error',e=>{console.error(e.message);process.exitCode=1;});
 server.listen(8765,'127.0.0.1',()=>console.log('テスト送信専用: http://127.0.0.1:8765 （終了: Ctrl+C）。公開版の設定は変更しません。'));
}
module.exports={createServer};
