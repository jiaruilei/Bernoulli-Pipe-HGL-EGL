import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

test('quiz logging is validated, durable, deduplicated and export-protected',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bernoulli-quiz-test-'));
  const serverFile=fileURLToPath(new URL('../server.js',import.meta.url));
  const lease=net.createServer();
  await new Promise(resolve=>lease.listen(0,'127.0.0.1',resolve));
  const port=lease.address().port; await new Promise(resolve=>lease.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  let child,output='';
  async function start(){
    child=spawn(process.execPath,[serverFile],{cwd:directory,windowsHide:true,
      env:{...process.env,PORT:String(port),QUESTION_LOG_DIR:directory,CHAT_LOG_FILE:path.join(directory,'chat.jsonl'),
        INSTRUCTOR_TOKEN:'qa-instructor-token',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',data=>output+=data); child.stderr.on('data',data=>output+=data);
    for(let i=0;i<100;i++){
      if(child.exitCode!==null) throw Error(output);
      try {if((await fetch(base+'/api/health')).ok)return;}catch{}
      await delay(30);
    }
    throw Error('Server did not start: '+output);
  }
  async function stop(){if(child&&child.exitCode===null){const closed=once(child,'exit');child.kill();await closed;}}
  const attempt={questionId:'q-1',sessionId:'learner-1',type:'v2',mode:'auto',selectedAnswer:4,
    scene:{rho:1000,g:9.81,D1:.1,D2:.05,v1:1,p1kPa:180,z1:0,z2:2},clientTimestamp:'2026-09-05T00:00:00Z'};
  const post=body=>fetch(base+'/api/quiz/attempts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    await start();
    for(const route of ['/','/quiz-practice.js'])assert.equal((await fetch(base+route)).status,200);
    for(const route of ['/api/quiz/export.csv','/api/chat/export.csv','/api/questions/export.csv']){
      assert.equal((await fetch(base+route)).status,401);
      assert.equal((await fetch(base+route,{headers:{'x-instructor-token':'wrong'}})).status,401);
    }
    for(const body of [{}, {...attempt,selectedAnswer:null}, {...attempt,scene:{...attempt.scene,D1:0}}])assert.equal((await post(body)).status,400);
    const results=await Promise.all([post(attempt),post(attempt),post(attempt)]);
    const recorded=await Promise.all(results.map(r=>r.json()));
    assert.equal(recorded.filter(r=>r.recorded).length,1);
    assert.equal((await (await post({...attempt,sessionId:'learner-2',selectedAnswer:2})).json()).recorded,true);
    await stop(); await start();
    assert.equal((await (await post(attempt)).json()).recorded,false);
    const response=await fetch(base+'/api/quiz/export.csv',{headers:{'x-instructor-token':'qa-instructor-token'}});
    assert.equal(response.status,200); assert.match(response.headers.get('content-type'),/text\/csv/);
    const csv=await response.text();
    assert.equal(csv.split('\n').length,3); assert.match(csv,/learner-1/); assert.match(csv,/learner-2/);
    const records=(await fs.readFile(path.join(directory,'quiz-attempts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records[0].correct,true);assert.equal(records[1].correct,false);
    assert.equal((await (await fetch(base+'/api/questions/quiz-signal')).json()).totalQuestions,0);
    assert.equal((await fetch(base+'/quiz-attempts.jsonl')).status,404);
  } finally {
    await stop();
    const resolved=path.resolve(directory), parent=path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved),parent);
    assert.ok(path.basename(resolved).startsWith('bernoulli-quiz-test-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
