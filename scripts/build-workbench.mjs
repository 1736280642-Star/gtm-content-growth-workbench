import { spawn } from 'node:child_process';
// The dedicated Demo branch must remain synthetic even in git-triggered previews.
// All other branches keep the original Next production build by default.
const demo = process.env.APP_RUNTIME_MODE === 'demo' || (process.env.VERCEL === '1' && process.env.VERCEL_GIT_COMMIT_REF === 'codex/demo-runtime');
const args = demo ? ['scripts/demo-run.mjs', 'build'] : ['node_modules/next/dist/bin/next', 'build'];
const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
