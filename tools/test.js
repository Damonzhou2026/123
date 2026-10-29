// 跑全部测试和副本检查。用法：node tools/test.js
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const scripts = [
  'tools/check-copies.js',
  'cloudfunctions/findMatches/scoring.test.js',
  'cloudfunctions/createPost/embedding.test.js',
  'cloudfunctions/createPost/notifyMatches.test.js',
  'cloudfunctions/createPost/secCheck.test.js',
  'cloudfunctions/rateUser/validate.test.js',
  'cloudfunctions/reward/reward.test.js',
  'cloudfunctions/sendMessage/template.test.js',
  'miniprogram/utils/safety.test.js'
];
let failed = 0;
for (const s of scripts) {
  try {
    execFileSync(process.execPath, [path.join(root, s)], { stdio: 'pipe' });
    console.log(`通过  ${s}`);
  } catch (err) {
    failed += 1;
    console.log(`失败  ${s}\n${String(err.stdout || '')}${String(err.stderr || '')}`);
  }
}
process.exit(failed ? 1 : 0);
