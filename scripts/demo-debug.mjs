import { chromium } from '../.tmp/demo-browser-tools/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const page=await browser.newPage();
  page.on('pageerror',error=>console.log(error.stack));
  await page.goto('http://127.0.0.1:3064'+(process.argv[2]||'/'),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(4000);
  console.log((await page.locator('body').innerText()).slice(0,14000));
  if(process.argv.includes('--controls'))console.log(await page.locator('button,input,textarea').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,text:node.innerText,placeholder:node.getAttribute('placeholder'),label:node.getAttribute('aria-label'),disabled:node.disabled}))));
}finally{await browser.close();}
