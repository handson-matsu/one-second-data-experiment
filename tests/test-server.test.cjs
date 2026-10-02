const {test}=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../tools/test-server.cjs');
const http=require('node:http');
test('local launcher serves only application files, marks test and rejects external Host',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 const get=(url,host=`127.0.0.1:${port}`)=>new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port,path:url,headers:{Host:host}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject));
 try{
  assert.match((await get('/')).body,/ローカルテスト専用/);
  assert.match((await get('/experiment-config.js')).body,/localTest = true/);
  assert.equal((await get('/gas/admin/Code.gs')).status,404);
  assert.equal((await get('/../README.md')).status,404);
  assert.equal((await get('/','evil.example')).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
