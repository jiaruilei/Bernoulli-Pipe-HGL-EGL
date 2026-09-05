import test from 'node:test';
import assert from 'node:assert/strict';
import {QUIZ_TYPES,calculateScene,quizAnswer,isCorrectAnswer,sessionTopics,sessionTopicCounts,
  sessionProbabilities,chooseSessionTopic,answerChoices,validateAttempt} from '../quiz-practice.js';

const scene={rho:1000,g:9.81,D1:.1,D2:.05,v1:1,p1kPa:180,z1:0,z2:2};

test('the existing physical quantities and quiz units are preserved',()=>{
  const r=calculateScene(scene);
  assert.equal(r.v2,4); assert.equal(r.p2,152880);
  assert.equal(r.dhMano,27120/9810); assert.equal(r.dhPitot,16/19.62);
  assert.equal(quizAnswer('p2kPa',scene).value,152.88);
  assert.equal(quizAnswer('Q',scene).value,r.Q*1000);
  assert.equal(quizAnswer('dhPitot',scene).unit,'m');
});

test('sessions start evenly and only asked-about topics gain priority',()=>{
  assert.deepEqual(Object.values(sessionProbabilities()),[.2,.2,.2,.2,.2]);
  const counts=sessionTopicCounts();
  for(const type of sessionTopics('Please explain the manometer')) counts[type]++;
  assert.ok(sessionProbabilities(counts).dhMano>.2);
  assert.ok(sessionProbabilities({...counts,dhMano:2}).dhMano>sessionProbabilities(counts).dhMano);
  const probabilities=sessionProbabilities({dhMano:1000000});
  assert.ok(Math.abs(Object.values(probabilities).reduce((a,b)=>a+b,0)-1)<1e-12);
  for(const value of Object.values(probabilities)) assert.ok(value>=.08);
  assert.deepEqual(sessionTopics('Thank you'),[]);
});

test('topic matching handles displayed symbols and corrupted session counts',()=>{
  assert.ok(sessionTopics('Check: v₂ = 2').includes('v2'));
  assert.ok(sessionTopics('Why is p₂ lower?').includes('p2kPa'));
  assert.deepEqual(sessionTopics('Pitot tube'),['dhPitot']);
  assert.deepEqual(sessionTopics('Flow rate Q'),['Q']);
  assert.deepEqual(sessionTopics('continuity'),['v2','Q']);
  assert.deepEqual(sessionTopics('manometer manometer manometer'),['dhMano']);
  assert.deepEqual(Object.values(sessionTopicCounts({v2:-1,p2kPa:'5',dhMano:Infinity,Q:null})),[0,0,0,0,0]);
});

test('weighted question selection follows current-session probabilities and retains all topics',()=>{
  const counts={dhMano:10},probabilities=sessionProbabilities(counts),before=JSON.stringify(counts);
  let lower=0;
  for(const type of QUIZ_TYPES){
    assert.equal(chooseSessionTopic(counts,()=>lower+probabilities[type]/2),type);
    lower+=probabilities[type];
  }
  assert.equal(JSON.stringify(counts),before);
  assert.notEqual(chooseSessionTopic({},()=>.35),chooseSessionTopic(counts,()=>.35));
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
  assert.equal(validateAttempt({...input,mode:'session'}).mode,'session');
  assert.equal(validateAttempt({...input,selectedAnswer:2}).correct,false);
  for(const patch of [{sessionId:''},{questionId:'=formula'},{mode:'other'},{type:'other'},
    {selectedAnswer:null},{selectedAnswer:Infinity},{scene:{...scene,D2:0}},{scene:{...scene,rho:'1000'}}]){
    assert.throws(()=>validateAttempt({...input,...patch}));
  }
});
