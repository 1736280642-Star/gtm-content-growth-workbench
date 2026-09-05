import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
function format(dir){for(const item of readdirSync(dir,{withFileTypes:true})){const path=dir+'/'+item.name;if(item.isDirectory())format(path);else if(/\.tsx?$/.test(path)){const text=readFileSync(path,'utf8');const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);writeFileSync(path,printer.printFile(source));}}}
format('src/demo');
