// 订阅消息模板的字段是在公众平台选模板时定的（比如 thing1、time3），这里按字段名和类型自动填，
// 换模板时只要改小程序里的模板 ID，不用改这里。

// 解析模板内容，比如 "发送人:{{name1.DATA}}\n消息内容:{{thing2.DATA}}"
function parseTemplate(content) {
  const fields = [];
  const re = /([^\n:：{}]*)[:：]?\s*\{\{(\w+)\.DATA\}\}/g;
  let m;
  while ((m = re.exec(content || ''))) {
    fields.push({ label: m[1].trim(), key: m[2], type: m[2].replace(/\d+$/, '') });
  }
  return fields;
}

// 微信要求的北京时间格式：2026-10-24 10:30
function beijingTime(date) {
  const d = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function cut(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// 按字段名猜它要什么
function pick(label, info) {
  if (/内容|留言|消息|详情|回复/.test(label)) return info.text;
  if (/人|发送|昵称|对方|来自|用户|姓名/.test(label)) return info.sender;
  if (/物品|名称|标题|主题|事项|商品/.test(label)) return info.title;
  return '';
}

// info: { text, sender（失主/拾得者）, title（物品名）, time（Date） }
function buildData(fields, info) {
  const data = {};
  fields.forEach(({ label, key, type }) => {
    let value;
    if (type === 'time') value = beijingTime(info.time);
    else if (type === 'date') value = beijingTime(info.time).slice(0, 10);
    else if (type === 'thing') value = cut(pick(label, info) || '对方发来新消息，点开回复', 20);
    else if (type === 'name') value = cut(info.sender, 10);
    // phrase 只能是 5 个以内的汉字
    else if (type === 'phrase') value = /人|发送|对方|来自/.test(label) ? info.sender : '新消息';
    else if (type === 'number') value = '1';
    else value = cut(pick(label, info) || '新消息', 20);
    data[key] = { value };
  });
  return data;
}

module.exports = { parseTemplate, buildData, beijingTime };
