const fs = require('fs');
const c = fs.readFileSync('server/index.ts', 'utf8');
const ls = c.split('\n');
function fb(si){let d=0,s=false;for(let k=si;k<ls.length;k++){const t=ls[k];d+=(t.match(/{/g)||[]).length-(t.match(/}/g)||[]).length;if(d>0)s=true;if(s&&d<=0)return k;}return null;}
// Print the full cluster
const start = ls.findIndex((l) => l.startsWith('type AiEnvironmentUpdate'));
console.log('AiEnvironmentUpdate @ L', start+1);
for (let i = start; i < start + 3; i++) console.log(ls[i]);
console.log('--- full cluster L5163-5270 ---');
const s2 = ls.findIndex((l) => l.startsWith('function readEnvValue'));
const e2 = fb(ls.findIndex((l) => l.startsWith('function buildAiEnvironmentStatus')));
for (let i = s2; i <= e2; i++) console.log((i+1) + '|' + ls[i]);
