// Preloaded in the Demo CLI and all Next workers. Do not read local dotenv files.
// Keep this small compatibility boundary covered when upgrading Next.js.
const envPath = require.resolve('@next/env');
const nextEnv = require(envPath);
require.cache[envPath].exports = {
  ...nextEnv,
  loadEnvConfig: () => ({ combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: [] }),
};
