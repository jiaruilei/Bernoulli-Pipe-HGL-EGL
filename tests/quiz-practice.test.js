import test from 'node:test';
import assert from 'node:assert/strict';
import {QUIZ_TYPES,calculateScene,quizAnswer,isCorrectAnswer,practiceWeights,selectionProbabilities,
  chooseTopic,recentHistory,answerChoices,validateAttempt} from '../quiz-practice.js';

const scene={rho:1000,g:9.81,D1:.1,D2:.05,v1:1,p1kPa:180,z1:0,z2:2};
const history=(type,correct,count,start=0)=>Array.from({length:count},(_,i)=>({questionId:`q-${start+i}`,type,correct,at:start+i}));

test('the existing physical quantities and quiz units are preserved',()=>{
  const r=calculateScene(scene);
  assert.equal(r.v2,4); assert.equal(r.p2,152880);
  assert.equal(r.dhMano,27120/9810); assert.equal(r.dhPitot,16/19.62);
  assert.equal(quizAnswer('p2kPa',scene).value,152.88);
  assert.equal(quizAnswer('Q',scene).value,r.Q*1000);
  assert.equal(quizAnswer('dhPitot',scene).unit,'m');
});

test('new learners begin evenly; mistakes raise focus and success lowers it',()=>{
  assert.deepEqual(Object.values(selectionProbabilities('auto',[])),[.2,.2,.2,.2,.2]);
  const wrong=history('dhMano',false,1);
  assert.ok(practiceWeights(wrong).dhMano>practiceWeights([]).dhMano);
  assert.ok(selectionProbabilities('auto',wrong).dhMano>.2);
  assert.ok(practiceWeights(history('dhMano',true,10)).dhMano<practiceWeights([]).dhMano);
  const improving=[...history('dhMano',false,4),...history('dhMano',true,6,4)];
  assert.ok(practiceWeights(improving).dhMano<practiceWeights(history('dhMano',false,4)).dhMano);
  for(const value of Object.values(selectionProbabilities('auto',improving))) assert.ok(value>0);
});

test('old evidence and duplicate submissions cannot dominate a profile',()=>{
  const attempts=[...history('v2',false,100),...history('v2',true,10,100)];
  assert.equal(recentHistory(attempts).length,10);
  assert.deepEqual(practiceWeights(attempts),practiceWeights(history('v2',true,10,100)));
  assert.equal(recentHistory([...attempts,...attempts]).length,10);
  assert.equal(recentHistory([null,{type:'unknown'},...history('Q',false,1)]).length,1);
});

test('manual topics and balanced mode override learned weights without changing history',()=>{
  const attempts=history('v2',false,10), before=JSON.stringify(attempts);
  assert.deepEqual(Object.values(selectionProbabilities('balanced',attempts)),[.2,.2,.2,.2,.2]);
  for(const type of QUIZ_TYPES){
    assert.equal(selectionProbabilities(type,attempts)[type],1);
    for(const random of [0,.15,.55,.999999]) assert.equal(chooseTopic(type,attempts,()=>random),type);
  }
  assert.equal(JSON.stringify(attempts),before);
  assert.ok(selectionProbabilities('auto',attempts).v2>.2);
});

test('answer choices are distinct when displayed and have exactly one correct choice',()=>{
  for(const type of QUIZ_TYPES){
    for(const sample of [scene,{...scene,D2:.1,z2:0},{...scene,D2:.16,v1:.4,z2:-2}]){
      const answer=quizAnswer(type,sample);
      for(const random of [()=>.5,Math.random]){
        const options=answerChoices(answer.value,answer.format,random);
        assert.equal(options.length,4);
        assert.equal(new Set(options.map(answer.format)).size,4);
        assert.equal(options.filter(x=>isCorrectAnswer(x,answer.value)).length,1);
      }
    }
  }
});

test('server grading validates input and derives its own correctness and question text',()=>{
  const input={questionId:'q-1',sessionId:'learner-1',type:'v2',mode:'auto',scene,selectedAnswer:4,
    correct:false,question:'untrusted supplied text',clientTimestamp:'2026-09-05T00:00:00Z'};
  const result=validateAttempt(input);
  assert.equal(result.correct,true); assert.equal(result.correctAnswer,4);
  assert.notEqual(result.question,input.question);
  assert.equal(validateAttempt({...input,selectedAnswer:2}).correct,false);
  for(const patch of [{sessionId:''},{questionId:'=formula'},{mode:'other'},{type:'other'},
    {selectedAnswer:null},{selectedAnswer:Infinity},{scene:{...scene,D2:0}},{scene:{...scene,rho:'1000'}}]){
    assert.throws(()=>validateAttempt({...input,...patch}));
  }
});
