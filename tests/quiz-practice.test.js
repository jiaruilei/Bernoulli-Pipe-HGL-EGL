import test from 'node:test';
import assert from 'node:assert/strict';
import {QUIZ_TYPES,calculateScene,quizAnswer,isCorrectAnswer,sessionTopics,sessionTopicCounts,
  sessionProbabilities,chooseSessionTopic,answerChoices,validateAttempt,PARAMETER_LIMITS,
  validParameter,generateQuizScene,pressureGaugeFraction,workedSolution,DEFAULT_GRAVITY,formatGravity} from '../quiz-practice.js';

const scene={rho:1000,g:9.80,D1:.1,D2:.05,v1:1,p1kPa:180,z1:0,z2:2};

test('incomplete and out-of-range inputs do not enter the physics calculation',()=>{
  for(const [key,[min,max]] of Object.entries(PARAMETER_LIMITS)){
    for(const value of ['', ' ', 'abc', Infinity,NaN,min-1,max+1]) assert.equal(validParameter(key,value),false);
    for(const value of [min,max,String((min+max)/2)]) assert.equal(validParameter(key,value),true);
  }
  assert.throws(()=>answerChoices(Infinity,String));
});

test('generated quizzes stay within the introductory teaching range for all fluid limits',()=>{
  let seed=90210;
  const random=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
  for(const rho of [500,1000,2000]) for(const g of [1,9.80,20]) for(let i=0;i<2500;i++){
    const sample=generateQuizScene({rho,g},random),r=calculateScene(sample);
    assert.ok(r.v2>=.2&&r.v2<=8); assert.ok(r.p2>=20000&&r.p2<=300000);
    assert.equal(sample.rho,rho); assert.equal(sample.g,g);
    for(const type of QUIZ_TYPES) assert.ok(Number.isFinite(quizAnswer(type,sample).value));
  }
  const fallback=generateQuizScene({rho:2000,g:20},()=>.99);
  assert.ok(calculateScene(fallback).p2>=20000);
  assert.throws(()=>generateQuizScene({rho:0,g:9.80}));
});

test('new quizzes use gravity 9.80 and custom gravity is displayed without rounding',()=>{
  assert.equal(DEFAULT_GRAVITY,9.80);
  assert.equal(generateQuizScene().g,9.80);
  assert.equal(generateQuizScene({g:9.806}).g,9.806);
  assert.equal(formatGravity(9.8),'9.80');
  assert.equal(formatGravity(9.806),'9.806');
  for(const type of ['p2kPa','dhMano','dhPitot']){
    assert.match(workedSolution(type,scene).join(' '),/9\.80/);
    assert.match(workedSolution(type,{...scene,g:9.806}).join(' '),/9\.806/);
  }
});

test('zero flow obeys hydrostatic pressure and grades correctly for every quiz topic',()=>{
  assert.equal(validParameter('v1',0),true);
  assert.equal(validParameter('v1',-.1),false);
  for(const D2 of [.02,.1,.5]) for(const [z2,pressure] of [[-2,199600],[0,180000],[2,160400]]){
    const still={...scene,v1:0,D2,z2},r=calculateScene(still);
    assert.equal(r.v2,0); assert.equal(r.Q,0); assert.equal(r.dhPitot,0);
    assert.equal(r.p2,pressure); assert.equal(r.dhMano,z2);
    for(const type of QUIZ_TYPES){
      const answer=quizAnswer(type,still);
      const choices=answerChoices(answer.value,answer.format,()=>.5);
      assert.equal(new Set(choices.map(answer.format)).size,4);
      assert.equal(choices.filter(value=>isCorrectAnswer(value,answer.value)).length,1);
      const attempt=validateAttempt({questionId:'still-1',sessionId:'still-session',mode:'session',type,
        scene:still,selectedAnswer:answer.value});
      assert.equal(attempt.correct,true);
      assert.doesNotMatch(workedSolution(type,still).join(' '),/NaN|Infinity|undefined/);
    }
  }
});

test('pressure ring fill increases on the shared 0–500 kPa scale',()=>{
  assert.equal(pressureGaugeFraction(0),0);
  assert.equal(pressureGaugeFraction(30),.06);
  assert.equal(pressureGaugeFraction(270),.54);
  assert.equal(pressureGaugeFraction(500),1);
  assert.equal(pressureGaugeFraction(-500),0);
  assert.equal(pressureGaugeFraction(800),1);
});

test('worked solutions use the quiz calculation and its displayed units for all topics',()=>{
  const expected={v2:'4.00 m/s',p2kPa:'153 kPa',dhMano:'2.77 m',dhPitot:'0.82 m',Q:'7.85 L/s'};
  for(const type of QUIZ_TYPES){
    const steps=workedSolution(type,scene);
    assert.equal(steps.at(-1),'Answer: '+expected[type]);
    assert.ok(steps.length>=2);
    assert.doesNotMatch(steps.join(' '),/NaN|Infinity|undefined/);
  }
  assert.match(workedSolution('p2kPa',scene).join(' '),/152900 Pa/);
  assert.match(workedSolution('Q',scene).join(' '),/Multiply by 1000/);
});

test('the existing physical quantities and quiz units are preserved',()=>{
  const r=calculateScene(scene);
  assert.equal(r.v2,4); assert.equal(r.p2,152900);
  assert.equal(r.dhMano,27100/9800); assert.equal(r.dhPitot,16/19.6);
  assert.equal(quizAnswer('p2kPa',scene).value,152.9);
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
