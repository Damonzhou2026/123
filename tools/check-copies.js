// 云函数之间不能共用文件，同一份代码和常量只能各放一份。这个脚本检查这些副本有没有改漏。
// 用法：node tools/check-copies.js   （有不一致就列出来，并以非 0 退出）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// 必须一模一样的文件
const SAME_FILES = {
  'push.js': ['sendMessage', 'submitClaim', 'reviewClaim', 'createPost', 'dailyJobs'],
  'template.js': ['sendMessage', 'submitClaim', 'reviewClaim', 'createPost', 'dailyJobs'],
  'secCheck.js': ['createPost', 'submitClaim', 'sendMessage'],
  'scoring.js': ['findMatches', 'createPost']
};

// 必须取值相同的常量：[文件, 常量名]
const SAME_CONSTANTS = [
  [['miniprogram/utils/constants.js', 'CATEGORIES'], ['cloudfunctions/createPost/index.js', 'CATEGORIES']],
  [['miniprogram/utils/constants.js', 'NO_REWARD_CATEGORIES'], ['cloudfunctions/createPost/index.js', 'NO_REWARD_CATEGORIES']],
  [['miniprogram/utils/constants.js', 'MAX_REWARD'], ['cloudfunctions/createPost/index.js', 'MAX_REWARD']],
  [['miniprogram/utils/constants.js', 'MAX_CUSTOM_CATEGORY'], ['cloudfunctions/createPost/index.js', 'MAX_CUSTOM_CATEGORY']],
  [['miniprogram/utils/constants.js', 'PRIVATE_PHOTO_CATEGORIES'], ['cloudfunctions/listNearby/index.js', 'PRIVATE_PHOTO_CATEGORIES'], ['cloudfunctions/getPost/index.js', 'PRIVATE_PHOTO_CATEGORIES']],
  [['miniprogram/pages/chat/chat.js', 'CANCEL_REASONS'], ['cloudfunctions/reviewClaim/index.js', 'CANCEL_REASONS']],
  [['miniprogram/utils/report.js', 'REASONS'], ['cloudfunctions/report/index.js', 'REASONS']]
];

function constantValue(file, name) {
  const m = read(file).match(new RegExp(`const ${name} = ([\\s\\S]*?);\\s*(?://.*)?\\n`));
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

const problems = [];
for (const [file, dirs] of Object.entries(SAME_FILES)) {
  const first = read(`cloudfunctions/${dirs[0]}/${file}`);
  dirs.slice(1).forEach((d) => {
    if (read(`cloudfunctions/${d}/${file}`) !== first) problems.push(`${file}：cloudfunctions/${d} 和 cloudfunctions/${dirs[0]} 不一样`);
  });
}
for (const group of SAME_CONSTANTS) {
  const values = group.map(([file, name]) => ({ file, name, value: constantValue(file, name) }));
  values.filter((v) => v.value == null).forEach((v) => problems.push(`${v.file} 里找不到 ${v.name}`));
  const found = values.filter((v) => v.value != null);
  if (new Set(found.map((v) => v.value)).size > 1) {
    problems.push(`${found[0].name} 不一致：\n${found.map((v) => `  ${v.file}: ${v.value}`).join('\n')}`);
  }
}

if (problems.length) {
  console.error(`副本不一致：\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('副本检查通过');
