// Shared quiz calculations and personal practice rules. No student data is stored here.
export const QUIZ_LABELS = Object.freeze({
  v2: 'Continuity: velocity', p2kPa: 'Bernoulli: pressure',
  dhMano: 'Manometer', dhPitot: 'Pitot tube', Q: 'Flow rate',
});
export const QUIZ_TYPES = Object.freeze(Object.keys(QUIZ_LABELS));
export const PRACTICE_MODES = Object.freeze(['auto', 'balanced', ...QUIZ_TYPES]);
export const RECENT_PER_TOPIC = 10;

export function calculateScene({rho,g,D1,D2,v1,p1kPa,z1,z2}) {
  const A1=Math.PI*D1*D1/4, A2=Math.PI*D2*D2/4;
  const v2=v1*(A1/A2), p1=p1kPa*1000;
  const p2=p1 + 0.5*rho*(v1*v1-v2*v2) + rho*g*(z1-z2);
  return {A1,A2,v2,p2,dhMano:(p1-p2)/(rho*g),dhPitot:v2*v2/(2*g),Q:A1*v1};
}

export function quizAnswer(type, scene) {
  if (!QUIZ_TYPES.includes(type)) throw new Error('Unknown quiz topic');
  const r=calculateScene(scene);
  const values={v2:r.v2,p2kPa:r.p2/1000,dhMano:r.dhMano,dhPitot:r.dhPitot,Q:r.Q*1000};
  const units={v2:'m/s',p2kPa:'kPa',dhMano:'m',dhPitot:'m',Q:'L/s'};
  const questions={
    v2:`Given D₁=${scene.D1.toFixed(3)} m, D₂=${scene.D2.toFixed(3)} m, v₁=${scene.v1.toFixed(2)} m/s, what is v₂?`,
    p2kPa:`With p₁=${scene.p1kPa.toFixed(0)} kPa (g), v₁=${scene.v1.toFixed(2)} m/s, D₁=${scene.D1.toFixed(3)} m, D₂=${scene.D2.toFixed(3)} m, and z₂=${scene.z2.toFixed(2)} m, what is p₂ (gauge)?`,
    dhMano:'What is the manometer reading Δh (water) between taps at 1 and 2?',
    dhPitot:'Pitot tube at section 2: what is Δhₚ (water)?',
    Q:'What is the flow rate Q through the pipe?',
  };
  return {value:values[type],unit:units[type],question:questions[type],
    format:value=>value.toFixed(type==='p2kPa'?0:2)+' '+units[type]};
}

export function isCorrectAnswer(selected, correct) {
  return Number.isFinite(selected) && Number.isFinite(correct) &&
    Math.abs(selected-correct) <= Math.max(1e-6, Math.abs(correct)*0.02);
}

export function recentHistory(attempts=[]) {
  const ids=new Set(), counts={};
  return [...attempts].filter(a=>a && typeof a.questionId==='string' &&
    QUIZ_TYPES.includes(a.type) && typeof a.correct==='boolean' && Number.isFinite(a.at))
    .sort((a,b)=>b.at-a.at).filter(a=>{
      if(ids.has(a.questionId) || (counts[a.type]||0)>=RECENT_PER_TOPIC) return false;
      ids.add(a.questionId); counts[a.type]=(counts[a.type]||0)+1; return true;
    }).reverse();
}

export function practiceWeights(attempts=[]) {
  const history=recentHistory(attempts), weights={};
  for(const type of QUIZ_TYPES) {
    const recent=history.filter(a=>a.type===type).reverse();
    let evidence=0, mistakes=0;
    recent.forEach((a,index)=>{
      const influence=0.85**index;
      evidence+=influence; if(!a.correct) mistakes+=influence;
    });
    // Two balanced prior observations limit the effect of a single lucky or mistaken answer.
    // Every topic retains a positive base weight, including after consistent success.
    weights[type]=1+4*(mistakes+1)/(evidence+2);
  }
  return weights;
}

export function selectionProbabilities(mode, attempts=[]) {
  if(!PRACTICE_MODES.includes(mode)) mode='auto';
  const weights=mode==='auto'?practiceWeights(attempts):
    Object.fromEntries(QUIZ_TYPES.map(type=>[type,mode==='balanced'||mode===type?1:0]));
  const sum=Object.values(weights).reduce((a,b)=>a+b,0);
  return Object.fromEntries(QUIZ_TYPES.map(type=>[type,weights[type]/sum]));
}

export function chooseTopic(mode, attempts, random=Math.random) {
  const probabilities=selectionProbabilities(mode, attempts);
  let value=random();
  for(const type of QUIZ_TYPES) {
    if(probabilities[type]===0) continue;
    value-=probabilities[type]; if(value<0) return type;
  }
  return [...QUIZ_TYPES].reverse().find(type=>probabilities[type]>0);
}

export function answerChoices(correct, format, random=Math.random) {
  const options=[correct], labels=new Set([format(correct)]);
  const add=value=>{
    if(!Number.isFinite(value) || isCorrectAnswer(value,correct) || labels.has(format(value))) return;
    options.push(value); labels.add(format(value));
  };
  for(let tries=0;options.length<4 && tries<64;tries++) add(correct*(1+(random()*2-1)*0.35));
  let step=Math.max(Math.abs(correct)*0.35,0.01);
  while(options.length<4) { add(correct+step); step*=2; }
  for(let i=options.length-1;i>0;i--) {
    const j=Math.floor(random()*(i+1)); [options[i],options[j]]=[options[j],options[i]];
  }
  return options;
}

export function validateAttempt(body) {
  const validId=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
  if(!body || !validId(body.questionId) || !validId(body.sessionId) ||
    !QUIZ_TYPES.includes(body.type) || !PRACTICE_MODES.includes(body.mode) ||
    typeof body.selectedAnswer!=='number' || !Number.isFinite(body.selectedAnswer)) {
    throw new Error('Invalid quiz submission');
  }
  const scene={};
  for(const key of ['rho','g','D1','D2','v1','p1kPa','z1','z2']) {
    const value=body.scene?.[key];
    if(typeof value!=='number' || !Number.isFinite(value) || Math.abs(value)>1e9) throw new Error('Invalid quiz scene');
    scene[key]=value;
  }
  for(const key of ['rho','g','D1','D2']) if(scene[key]<=0) throw new Error('Invalid quiz scene');
  const answer=quizAnswer(body.type,scene);
  if(!Number.isFinite(answer.value)) throw new Error('Invalid quiz answer');
  const date=typeof body.clientTimestamp==='string'?Date.parse(body.clientTimestamp):NaN;
  return {questionId:body.questionId,sessionId:body.sessionId,type:body.type,mode:body.mode,
    clientTimestamp:Number.isFinite(date)?new Date(date).toISOString():null,
    question:answer.question,selectedAnswer:body.selectedAnswer,correctAnswer:answer.value,
    correct:isCorrectAnswer(body.selectedAnswer,answer.value),unit:answer.unit,scene};
}
