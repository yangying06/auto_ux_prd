const fs = require('fs');
const c = fs.readFileSync('server/index.ts', 'utf8');
const ls = c.split('\n');
for (const s of ['ENV_FILE_PATH','getConfiguredFigmaToken','LEGACY_SERVER_ENV_FILE_PATH','figmaToken']) {
  const re = new RegExp('\\b' + s + '\\b', 'g');
  console.log(s, (c.match(re) || []).length);
}
const envLine = ls.findIndex((l) => l.startsWith('const ENV_FILE_PATH') || l.startsWith('let ENV_FILE_PATH'));
console.log('ENV_FILE_PATH line:', envLine === -1 ? 'NF' : (envLine+1) + ': ' + ls[envLine]);
const gtLine = ls.findIndex((l) => l.startsWith('function getConfiguredFigmaToken'));
console.log('getConfiguredFigmaToken:', gtLine === -1 ? 'NF' : 'L' + (gtLine+1));
