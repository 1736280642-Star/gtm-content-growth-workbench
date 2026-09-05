import ts from 'typescript';
import { readFileSync } from 'node:fs';
const [file, ...names] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
for (const node of source.statements) {
  if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && (!names.length || names.includes(node.name.text))) console.log(node.getText(source));
}
