import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const mode=process.argv[2] || 'dev';
const port=process.argv[3] || '3064';
const args=mode==='build'?['build']:[mode,'--hostname','127.0.0.1','--port',port];
const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(?:API_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|MYSQL_|SMTP_|OPENSEARCH_|NEXT_PUBLIC_)/i.test(key)));
const child=spawn(process.execPath,['node_modules/next/dist/bin/next',...args],{stdio:'inherit',env:{...environment,NODE_OPTIONS:`--require "${resolve('scripts/demo-env-guard.cjs').replaceAll('\\', '/')}"`,__NEXT_PROCESSED_ENV:'true',APP_RUNTIME_MODE:'demo',NEXT_DIST_DIR:process.env.VERCEL?'.next':mode==='dev'?'.next-demo':'.next-demo-build'}});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
