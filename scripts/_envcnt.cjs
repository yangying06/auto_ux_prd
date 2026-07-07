const fs = require('fs');
const c = fs.readFileSync('server/index.ts', 'utf8');
for (const s of ['readEnvValue','normalizeEnvField','stripEnvValueQuotes','normalizeSecretEnvField','normalizeFigmaTokenField','firstConfiguredSecret','configuredFigmaTokenFromEnv','toMockDecomposeValue','hasOwnEnvField','writeManagedEnvFile','previewSecret','buildAiEnvironmentStatus','AiEnvironmentUpdate','AiEnvironmentStatus']) {
  const re = new RegExp('\\b' + s + '\\b', 'g');
  console.log(s, (c.match(re) || []).length);
}
