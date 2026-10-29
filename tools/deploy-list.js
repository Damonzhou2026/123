// 列出和某个版本相比改过的云函数，也就是合并后要重新“上传并部署”的那些。
// 用法：node tools/deploy-list.js origin/main
const { execSync } = require('child_process');

const base = process.argv[2] || 'origin/main';
const files = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean);
const fns = [...new Set(files
  .map((f) => f.match(/^cloudfunctions\/([^/]+)\/(?!.*\.test\.js$)/))
  .filter(Boolean)
  .map((m) => m[1]))].sort();
const triggers = files.filter((f) => /^cloudfunctions\/[^/]+\/config\.json$/.test(f) && /"triggers"/.test(execSync(`git show HEAD:${f}`, { encoding: 'utf8' })));

console.log(fns.length ? `要重新部署的云函数：${fns.join('、')}` : '没有改云函数');
if (triggers.length) console.log(`还要“上传触发器”：${triggers.map((f) => f.split('/')[1]).join('、')}`);
if (files.some((f) => f.startsWith('miniprogram/'))) console.log('小程序页面也改了：重新编译，手机重新扫预览码');
