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

test('chat forwards conversation context, records replies, and recovers after an upstream timeout',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bernoulli-chat-test-'));
  const serverFile=fileURLToPath(new URL('../server.js',import.meta.url));
  const preload=path.join(directory,'fake-openai.cjs');
  await fs.writeFile(preload,`
    const realFetch=globalThis.fetch;
    const timeout=AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout=ms=>timeout(ms===25000?40:ms);
    globalThis.fetch=async(url,options)=>{
      if(url!=='https://api.openai.com/v1/chat/completions')return realFetch(url,options);
      const body=JSON.parse(options.body);
      if(body.messages.at(-1).content==='timeout')return new Promise((resolve,reject)=>{
        options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
      });
      return new Response(JSON.stringify({choices:[{message:{content:'Context messages: '+body.messages.length}}]}),{status:200});
    };
  `);
  const lease=net.createServer();
  await new Promise(resolve=>lease.listen(0,'127.0.0.1',resolve));
  const port=lease.address().port;await new Promise(resolve=>lease.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  let child,output='';
  try{
    child=spawn(process.execPath,['--require',preload,serverFile],{cwd:directory,windowsHide:true,
      env:{...process.env,PORT:String(port),QUESTION_LOG_DIR:directory,CHAT_LOG_FILE:path.join(directory,'chat.jsonl'),
        INSTRUCTOR_TOKEN:'qa-instructor-token',OPENAI_API_KEY:'test-key-no-network'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw Error(output);
      try{if((await fetch(base+'/api/health')).ok)break;}catch{}
      await delay(30);
    }
    const post=body=>fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const messages=[{role:'system',content:'Tutor'},{role:'user',content:'Explain continuity'},
      {role:'assistant',content:'A1v1=A2v2'},{role:'user',content:'What happens if D2 increases?'}];
    const success={sessionId:'chat-test',requestId:'success-1',question:'What happens if D2 increases?',messages};
    const response=await post(success);assert.equal(response.status,200);
    assert.equal((await response.json()).reply,'Context messages: 4');
    const failed=await post({...success,requestId:'timeout-1',question:'timeout',messages:[{role:'user',content:'timeout'}]});
    assert.equal(failed.status,504);assert.match((await failed.json()).error,/timed out/);
    assert.equal((await post({...success,requestId:'success-2'})).status,200);
    const records=(await fs.readFile(path.join(directory,'chat.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.length,2);assert.ok(records.every(record=>record.reply==='Context messages: 4'));
  } finally{
    if(child&&child.exitCode===null){const closed=once(child,'exit');child.kill();await closed;}
    const resolved=path.resolve(directory);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('bernoulli-chat-test-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
