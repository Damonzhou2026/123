// 运行：node cloudfunctions/createPost/secCheck.test.js
const assert = require('assert');
const { isRisky, checkText, submitImages, SCENE } = require('./secCheck');

assert.strictEqual(isRisky({ errCode: 0, result: { suggest: 'pass', label: 100 } }), false);
assert.strictEqual(isRisky({ errCode: 0, result: { suggest: 'review', label: 20001 } }), false);
assert.strictEqual(isRisky({ errCode: 0, result: { suggest: 'risky', label: 20001 } }), true);
assert.strictEqual(isRisky({ errCode: 87014 }), true);
assert.strictEqual(isRisky(null), false);

function fakeCloud({ text, media, urls }) {
  const calls = [];
  return {
    calls,
    getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map((f) => ({ fileID: f.fileID, tempFileURL: urls === false ? '' : `https://tmp/${f.fileID}` })) }),
    openapi: {
      security: {
        msgSecCheck: async (args) => { calls.push(args); return text(args); },
        mediaCheckAsync: async (args) => { calls.push(args); return media(args); }
      }
    }
  };
}

(async () => {
  // 几段文字合成一次检测，空的跳过
  let cloud = fakeCloud({ text: () => ({ errCode: 0, result: { suggest: 'pass' } }) });
  assert.strictEqual(await checkText(cloud, 'u1', ['钱包', '', '商场'], SCENE.forum), false);
  assert.deepStrictEqual(cloud.calls[0], { openid: 'u1', scene: 3, version: 2, content: '钱包\n商场' });

  cloud = fakeCloud({ text: () => ({ errCode: 0, result: { suggest: 'risky' } }) });
  assert.strictEqual(await checkText(cloud, 'u1', '坏话', SCENE.comment), true);

  // 接口抛 87014 算违规；其他错误放行
  cloud = fakeCloud({ text: () => { throw Object.assign(new Error('risky'), { errCode: 87014 }); } });
  assert.strictEqual(await checkText(cloud, 'u1', 'x', SCENE.comment), true);
  const origError = console.error;
  console.error = () => {};
  cloud = fakeCloud({ text: () => { throw Object.assign(new Error('no permission'), { errCode: -604101 }); } });
  assert.strictEqual(await checkText(cloud, 'u1', 'x', SCENE.comment), false);

  // 空内容不调接口
  cloud = fakeCloud({ text: () => { throw new Error('should not call'); } });
  assert.strictEqual(await checkText(cloud, 'u1', ['', ''], SCENE.forum), false);

  // 图片：每张提交一次，收集 traceId
  cloud = fakeCloud({ media: (a) => ({ errCode: 0, traceId: `t-${a.mediaUrl}` }) });
  const r = await submitImages(cloud, 'u1', ['cloud://a', 'cloud://b'], SCENE.forum);
  assert.deepStrictEqual(r, { traceIds: ['t-https://tmp/cloud://a', 't-https://tmp/cloud://b'], error: '' });
  assert.strictEqual(cloud.calls[0].mediaType, 2);

  cloud = fakeCloud({ media: () => { throw Object.assign(new Error('x'), { errMsg: 'openapi permission denied' }); } });
  const failed = await submitImages(cloud, 'u1', ['cloud://a'], SCENE.forum);
  assert.deepStrictEqual(failed, { traceIds: [], error: 'openapi permission denied' });
  console.error = origError;

  console.log('secCheck ok');
})().catch((err) => { console.error(err); process.exit(1); });
