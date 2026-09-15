import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateGradeLines,calculatePipeDiagramLayout,calculateScene,PARAMETER_LIMITS} from '../quiz-practice.js';

const scene={rho:1000,g:9.8,D1:.1,D2:.05,v1:1,p1kPa:180,z1:0,z2:2};
const close=(actual,expected,tolerance=1e-10)=>{
  assert.ok(Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),
    `${actual} should equal ${expected}`);
};

test('default station heads match independently calculated Bernoulli values',()=>{
  const original={...scene};
  const {points,section1,section2}=calculateGradeLines(scene);
  assert.equal(points.length,81);
  assert.equal(section1,points[0]);
  assert.equal(section2,points.at(-1));
  assert.equal(section1.s,0); assert.equal(section2.s,1);
  close(section1.pressureHead,18.36734693877551);
  close(section1.velocityHead,.0510204081632653);
  close(section1.hgl,18.36734693877551);
  close(section1.egl,18.418367346938776);
  close(section2.velocity,4);
  close(section2.pressureHead,15.60204081632653);
  close(section2.velocityHead,.8163265306122448);
  close(section2.hgl,17.60204081632653);
  close(section2.egl,18.418367346938776);
  assert.deepEqual(scene,original);
});

test('interior sections conserve flow and total head through a linear taper',()=>{
  const {points,section1}=calculateGradeLines(scene,5);
  const middle=points[2];
  close(middle.diameter,.075); close(middle.z,1);
  close(middle.velocity,16/9);
  const expectedFlow=Math.PI*.1**2/4;
  for(const point of points){
    close(Math.PI*point.diameter**2/4*point.velocity,expectedFlow);
    assert.equal(point.egl,section1.egl);
    close(point.pressureHead+point.z,point.hgl);
    close(point.hgl+point.velocityHead,point.egl);
    close(point.velocityHead,point.velocity**2/(2*scene.g));
    assert.ok(point.egl>=point.hgl);
  }
});

test('zero flow makes HGL and EGL coincide at every section, including elevation changes',()=>{
  for(const D2 of [.02,.1,.5]) for(const z2 of [-10,0,10]){
    const still={...scene,v1:0,D2,z2};
    const {points,section2}=calculateGradeLines(still);
    for(const point of points){
      assert.equal(point.velocity,0); assert.equal(point.velocityHead,0);
      assert.equal(point.hgl,point.egl);
      close(point.hgl,180000/9800);
    }
    close(section2.pressureHead*still.rho*still.g,180000-still.rho*still.g*z2);
  }
});

test('HGL falls through a contraction, rises through an expansion, and stays level at fixed diameter',()=>{
  for(const [D2,direction] of [[.05,-1],[.2,1],[.1,0]]){
    const {points}=calculateGradeLines({...scene,D2});
    for(let index=1;index<points.length;index++){
      const delta=points[index].hgl-points[index-1].hgl;
      if(direction===0) close(delta,0);
      else assert.ok(delta*direction>0);
      assert.equal(points[index].egl,points[0].egl);
    }
  }
});

test('elevation changes pressure head without changing grade elevations at the same flow',()=>{
  const lower=calculateGradeLines({...scene,z2:-7});
  const upper=calculateGradeLines({...scene,z2:8});
  for(let index=0;index<lower.points.length;index++){
    const a=lower.points[index],b=upper.points[index];
    assert.equal(a.hgl,b.hgl); assert.equal(a.egl,b.egl);
    close(a.pressureHead-b.pressureHead,b.z-a.z);
  }
});

test('negative gauge pressure is preserved as HGL below the pipe centreline and datum',()=>{
  const lowPressure={...scene,v1:3,p1kPa:10};
  const {section2}=calculateGradeLines(lowPressure);
  close(section2.velocity,12);
  close(section2.pressureHead*lowPressure.rho*lowPressure.g,-77100);
  close(section2.hgl,-5.86734693877551);
  assert.ok(section2.hgl<section2.z);
  assert.ok(section2.hgl<0);
  assert.ok(section2.egl>0);
});

test('all corners of the supported parameter ranges produce finite, consistent station values',()=>{
  const entries=Object.entries(PARAMETER_LIMITS);
  for(let mask=0;mask<2**entries.length;mask++){
    const extreme={z1:0,...Object.fromEntries(entries.map(([key,limits],index)=>
      [key,limits[(mask>>index)&1]]))};
    const {points,section1,section2}=calculateGradeLines(extreme,9);
    const flow=calculateScene(extreme);
    for(const point of points){
      for(const value of Object.values(point)) assert.ok(Number.isFinite(value));
      assert.equal(point.egl,section1.egl);
      assert.ok(point.hgl<=point.egl);
      close(Math.PI*point.diameter**2/4*point.velocity,flow.Q);
    }
    close(section1.pressureHead*extreme.rho*extreme.g,extreme.p1kPa*1000);
    close(section2.pressureHead*extreme.rho*extreme.g,flow.p2);
    assert.equal(section2.velocity,flow.v2);
    assert.equal(section2.z,extreme.z2);
    assert.equal(section2.diameter,extreme.D2);
  }
});

test('a requested sample count includes both stations and rejects invalid counts',()=>{
  for(const count of [2,3,101]){
    const {points}=calculateGradeLines(scene,count);
    assert.equal(points.length,count);
    assert.equal(points[0].s,0); assert.equal(points.at(-1).s,1);
  }
  for(const count of [0,1,-1,2.5,NaN,Infinity,'81',10002]){
    assert.throws(()=>calculateGradeLines(scene,count),RangeError);
  }
});

test('the combined pipe diagram uses one head scale for grade lines and section elevations',()=>{
  const layout=calculatePipeDiagramLayout(scene,{width:900,height:620});
  const {profile,yForHead,plotTop,plotBottom,minHead,maxHead}=layout;
  const pixelsPerMetre=(plotBottom-plotTop)/(maxHead-minHead);
  assert.equal(layout.r1,36); assert.equal(layout.r2,18);
  close(yForHead(maxHead),plotTop); close(yForHead(minHead),plotBottom);
  close(layout.y1,yForHead(scene.z1)); close(layout.y2,yForHead(scene.z2));
  close(layout.y1-layout.y2,(scene.z2-scene.z1)*pixelsPerMetre);
  for(const point of profile.points){
    close(yForHead(point.hgl)-yForHead(point.egl),point.velocityHead*pixelsPerMetre);
    close(yForHead(point.z)-yForHead(point.hgl),point.pressureHead*pixelsPerMetre);
    close(yForHead(point.egl),yForHead(profile.section1.egl));
  }
});

test('pipe bodies and all heads fit the mobile and desktop plotting area at every parameter corner',()=>{
  const entries=Object.entries(PARAMETER_LIMITS);
  for(const [width,height] of [[330,560],[900,620]]){
    for(let mask=0;mask<2**entries.length;mask++){
      const sample={z1:0,...Object.fromEntries(entries.map(([key,limits],index)=>
        [key,limits[(mask>>index)&1]]))};
      const layout=calculatePipeDiagramLayout(sample,{width,height});
      const {x1,x2,y1,y2,r1,r2,plotTop,plotBottom,profile,yForHead}=layout;
      assert.ok(x1-r1*.5>=60); assert.ok(width-x2-r2*.5>=50);
      assert.ok(y1-r1>=plotTop+26-1e-8); assert.ok(y2-r2>=plotTop+26-1e-8);
      assert.ok(y1+r1<=plotBottom-26+1e-8); assert.ok(y2+r2<=plotBottom-26+1e-8);
      const radius=Math.max(r1,r2);
      assert.ok(radius<=55+1e-8);
      assert.ok(radius<=.16*(plotBottom-plotTop)+1e-8);
      assert.ok(radius<=.45*(x2-x1)+1e-8);
      close(r1/r2,sample.D1/sample.D2);
      for(const point of profile.points) for(const head of [point.z,point.hgl,point.egl,0]){
        const y=yForHead(head);
        assert.ok(Number.isFinite(y));
        assert.ok(y>=plotTop+radius+26-1e-8);
        assert.ok(y<=plotBottom-radius-26+1e-8);
      }
    }
  }
});

test('negative pressure and no-flow coincidence retain their physical vertical relationships',()=>{
  const negative=calculatePipeDiagramLayout({...scene,v1:3,p1kPa:10},{width:330,height:560});
  assert.ok(negative.yForHead(negative.profile.section2.hgl)>negative.y2);
  assert.ok(negative.yForHead(negative.profile.section2.hgl)>negative.yForHead(0));
  for(const z2 of [-10,0,10]){
    const still=calculatePipeDiagramLayout({...scene,v1:0,p1kPa:0,z2},{width:900,height:620});
    for(const point of still.profile.points){
      assert.equal(still.yForHead(point.hgl),still.yForHead(point.egl));
    }
    assert.ok(still.maxHead-still.minHead>=4);
  }
});

test('hidden grade lines cannot leak pressure or velocity through changing axis limits or pipe placement',()=>{
  const base=calculatePipeDiagramLayout(scene,{width:330,height:560,revealGrades:false});
  for(const changes of [{p1kPa:0},{p1kPa:500},{v1:0},{v1:6},{rho:500,g:1},{rho:2000,g:20}]){
    const hidden=calculatePipeDiagramLayout({...scene,...changes},{width:330,height:560,revealGrades:false});
    for(const key of ['x1','x2','y1','y2','r1','r2','plotTop','plotBottom','minHead','maxHead']){
      assert.equal(hidden[key],base[key],`${key} must not disclose the changed flow data`);
    }
    for(const head of [-20,0,2,20]) assert.equal(hidden.yForHead(head),base.yForHead(head));
  }
});
