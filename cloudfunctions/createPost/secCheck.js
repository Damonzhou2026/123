// 内容安全检测：文字用 security.msgSecCheck，图片用 security.mediaCheckAsync（微信审核要求）。
// createPost、submitClaim、sendMessage 各放一份（云函数不能共用文件），改的时候三份一起改。

// 微信的场景值：1 资料，2 评论，3 论坛，4 社交日志
const SCENE = { profile: 1, comment: 2, forum: 3, social: 4 };
// 87014：内容含有违法违规内容（老版本接口用错误码表示违规）
const RISKY_CODE = 87014;

// 检查返回结果是否违规。只拦 risky；review 是"建议人工复核"，先放行
function isRisky(res) {
  if (!res) return false;
  if (res.errCode === RISKY_CODE || res.errcode === RISKY_CODE) return true;
  return !!(res.result && res.result.suggest === 'risky');
}

// 检查一段或几段文字。违规返回 true；接口本身出错（没配权限、次数用完等）时放行，原因记在日志里，
// 免得检测服务出问题时用户什么都发不了
async function checkText(cloud, openid, texts, scene) {
  const content = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join('\n');
  if (!content) return false;
  try {
    const res = await cloud.openapi.security.msgSecCheck({ openid, scene, version: 2, content });
    return isRisky(res);
  } catch (err) {
    if (err && err.errCode === RISKY_CODE) return true;
    console.error('msgSecCheck failed', err);
    return false;
  }
}

// 把云存储里的图片提交给微信异步检测，结果由 mediaCheckCallback 云函数收到。
// 返回 { traceIds, error }；提交失败不影响发布
async function submitImages(cloud, openid, fileIDs, scene) {
  try {
    // 微信要自己来下载图片，所以换成临时链接，有效期给 1 天
    const { fileList } = await cloud.getTempFileURL({
      fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 24 * 60 * 60 }))
    });
    const traceIds = [];
    for (const f of fileList) {
      if (!f.tempFileURL) continue;
      const res = await cloud.openapi.security.mediaCheckAsync({
        mediaUrl: f.tempFileURL,
        mediaType: 2, // 2 是图片
        version: 2,
        openid,
        scene
      });
      if (res.traceId) traceIds.push(res.traceId);
    }
    return { traceIds, error: '' };
  } catch (err) {
    console.error('mediaCheckAsync failed', err);
    return { traceIds: [], error: String((err && (err.errMsg || err.message)) || err).slice(0, 200) };
  }
}

module.exports = { SCENE, isRisky, checkText, submitImages };
