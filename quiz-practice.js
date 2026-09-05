// Shared quiz calculations and personal practice rules. No student data is stored here.
export const QUIZ_LABELS = Object.freeze({
  v2: 'Continuity: velocity', p2kPa: 'Bernoulli: pressure',
  dhMano: 'Manometer', dhPitot: 'Pitot tube', Q: 'Flow rate',
});
export const QUIZ_TYPES = Object.freeze(Object.keys(QUIZ_LABELS));
// Keep previous mode names valid for older submissions waiting to upload.
export const PRACTICE_MODES = Object.freeze(['session', 'auto', 'balanced', ...QUIZ_TYPES]);

export const PARAMETER_LIMITS = Object.freeze({
  rho:[500,2000], g:[1,20], D1:[.03,.5], D2:[.02,.5],
  v1:[.1,6], p1kPa:[0,500], z2:[-10,10],
});

export function validParameter(key, raw) {
  const limits=PARAMETER_LIMITS[key], value=Number(raw);
  return Boolean(limits && String(raw).trim()!=='' && Number.isFinite(value) &&
    value>=limits[0] && value<=limits[1]);
}

// Introductory quiz examples: moderate speeds and positive gauge pressures.
// Explore mode retains the wider input range.
export function generateQuizScene({rho=1000,g=9.81}={}, random=Math.random) {
  if(!validParameter('rho',rho)||!validParameter('g',g)) throw new Error('Invalid fluid parameters');
  const rnd=(a,b,step)=>Number((Math.round((a+random()*(b-a))/step)*step).toFixed(3));
  for(let tries=0;tries<100;tries++) {
    const scene={rho,g,D1:rnd(.06,.20,.005),D2:rnd(.03,.16,.005),
      v1:rnd(.4,4,.1),p1kPa:rnd(90,240,1),z1:0,z2:rnd(-3,3,.1)};
    const r=calculateScene(scene);
    if(r.v2>=.2 && r.v2<=8 && r.p2>=20000 && r.p2<=300000) return scene;
  }
  return {rho,g,D1:.1,D2:.08,v1:1,p1kPa:180,z1:0,z2:0};
}

export function pressureGaugeFraction(value) {
  return Math.max(0,Math.min(1,value/500));
}

export function workedSolution(type, scene) {
  const r=calculateScene(scene), answer=quizAnswer(type,scene);
  const f=(value,n=3)=>Number(value.toFixed(n)).toString();
  const velocity=`Continuity: v₂ = v₁(D₁/D₂)² = ${scene.v1} × (${scene.D1}/${scene.D2})² = ${f(r.v2)} m/s.`;
  const pressure=`Bernoulli: p₂ = p₁ + ½ρ(v₁² − v₂²) + ρg(z₁ − z₂).\nUsing Pa: p₂ = ${scene.p1kPa*1000} + ½ × ${scene.rho} × (${scene.v1}² − (${scene.v1} × (${scene.D1}/${scene.D2})²)²) + ${scene.rho} × ${scene.g} × (${scene.z1} − (${scene.z2})) = ${f(r.p2)} Pa.`;
  const steps={
    v2:[velocity],
    p2kPa:[velocity,pressure,'Divide Pa by 1000 to obtain kPa (gauge).'],
    dhMano:[velocity,pressure,`For the pressure-head difference used in this quiz: Δh = (p₁ − p₂)/(ρg) = (${scene.p1kPa*1000} − ${f(r.p2)})/(${scene.rho} × ${scene.g}) = ${f(r.dhMano)} m.`],
    dhPitot:[velocity,`Pitot velocity head: Δhₚ = v₂²/(2g) = (${scene.v1} × (${scene.D1}/${scene.D2})²)²/(2 × ${scene.g}) = ${f(r.dhPitot)} m.`],
    Q:[`Area: A₁ = πD₁²/4 = π × ${scene.D1}²/4 = ${f(r.A1,6)} m².`,
      `Flow rate: Q = A₁v₁ = (π × ${scene.D1}²/4) × ${scene.v1} = ${f(r.Q,6)} m³/s. Multiply by 1000 for L/s.`],
  };
  return [...steps[type],`Answer: ${answer.format(answer.value)}`];
}

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

export function sessionTopics(question) {
  const text=String(question||'').normalize('NFKC');
  const rules={
    v2:/continuity|diameter|\barea\b|\bd[12]\b|\bv[12]\b|velocity|speed|narrow|widen/i,
    p2kPa:/bernoulli|pressure|\bp[12]\b|elevation|\bz[12]\b|gauge|\bkpa\b/i,
    dhMano:/manometer|\btaps?\b|delta\s*h|\bdh\b|Δh/i,
    dhPitot:/pitot|stagnation|velocity\s*head/i,
    Q:/flow\s*rate|discharge|\bq\b|continuity/i,
  };
  return QUIZ_TYPES.filter(type=>rules[type].test(text));
}

export function sessionTopicCounts(counts={}) {
  return Object.fromEntries(QUIZ_TYPES.map(type=>{
    const value=counts?.[type];
    return [type,Number.isSafeInteger(value)&&value>=0?Math.min(value,1000000):0];
  }));
}

export function sessionProbabilities(counts={}) {
  const clean=sessionTopicCounts(counts);
  const total=Object.values(clean).reduce((a,b)=>a+b,0);
  // Start evenly, increase asked-about topics gradually, and retain mixed review.
  return Object.fromEntries(QUIZ_TYPES.map(type=>[type,0.08+0.6*(clean[type]+1)/(total+5)]));
}

export function chooseSessionTopic(counts, random=Math.random) {
  const probabilities=sessionProbabilities(counts);
  let value=random();
  for(const type of QUIZ_TYPES) {
    if(probabilities[type]===0) continue;
    value-=probabilities[type]; if(value<0) return type;
  }
  return [...QUIZ_TYPES].reverse().find(type=>probabilities[type]>0);
}

export function answerChoices(correct, format, random=Math.random) {
  if(!Number.isFinite(correct)) throw new Error('Quiz answer must be finite');
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
