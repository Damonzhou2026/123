const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 用户自己管理发布和账号：
// close：东西找到了 / 不需要了，撤回这条发布（别人搜不到、认领不了，自己还能看到）
// delete：彻底删除这条发布和照片
// deleteAccount：注销，删除这个人的全部发布、照片、私信、评分，认领记录匿名化
const ACTIONS = { close, remove, deleteAccount };

exports.main = async (event) => {
  const action = ACTIONS[event.action === 'delete' ? 'remove' : event.action];
  if (!action) return { ok: false, message: '未知操作' };
  const { OPENID } = cloud.getWXContext();
  try {
    return await action(event, OPENID);
  } catch (err) {
    console.error(event.action, err);
    return { ok: false, message: err.message || '操作失败' };
  }
};

async function loadOwnPost(postId, openid) {
  const post = await db.collection('posts').doc(postId).get().then((r) => r.data).catch(() => null);
  if (!post || post._openid !== openid) return null;
  return post;
}

// 这条发布上还没处理的认领一起拒掉，免得对方一直等
async function rejectPendingClaims(post) {
  const field = post.type === 'lost' ? 'lostPostId' : 'foundPostId';
  await db.collection('claims')
    .where({ [field]: post._id, status: 'pending' })
    .update({ data: { status: 'rejected', reviewedAt: db.serverDate() } });
}

async function deletePhotos(fileIDs) {
  const ids = fileIDs.filter((id) => typeof id === 'string' && id.startsWith('cloud://'));
  // 一次最多删 50 个
  for (let i = 0; i < ids.length; i += 50) {
    await cloud.deleteFile({ fileList: ids.slice(i, i + 50) }).catch((err) => console.error('删除照片失败', err));
  }
}

const MATCHED_MESSAGE = '这件东西正在交接中，交接完成后才能操作';

async function close(event, openid) {
  const post = await loadOwnPost(event.postId, openid);
  if (!post) return { ok: false, message: '找不到这条发布' };
  if (post.status === 'matched') return { ok: false, message: MATCHED_MESSAGE };
  if (post.status !== 'open') return { ok: false, message: '这条发布已经不在匹配中了' };

  await db.collection('posts').doc(post._id).update({ data: { status: 'withdrawn', withdrawnAt: db.serverDate() } });
  await rejectPendingClaims(post);
  return { ok: true };
}

async function remove(event, openid) {
  const post = await loadOwnPost(event.postId, openid);
  if (!post) return { ok: false, message: '找不到这条发布' };
  if (post.status === 'matched') return { ok: false, message: MATCHED_MESSAGE };

  if (post.status === 'open') await rejectPendingClaims(post);
  await db.collection('posts').doc(post._id).remove();
  await deletePhotos(post.photos || []);
  return { ok: true };
}

// 分页把一个人的全部发布读出来（每次最多 100 条）
async function loadAllPosts(openid) {
  const all = [];
  for (;;) {
    const { data } = await db.collection('posts').where({ _openid: openid })
      .field({ photos: 1, status: 1 }).skip(all.length).limit(100).get();
    all.push(...data);
    if (data.length < 100) return all;
  }
}

async function deleteAccount(event, openid) {
  const posts = await loadAllPosts(openid);
  if (posts.some((p) => p.status === 'matched')) {
    return { ok: false, message: '你还有正在交接的物品，请先完成交接再注销' };
  }

  // 别人还在等的认领先拒掉，再删发布和照片
  const postIds = posts.map((p) => p._id);
  const claims = db.collection('claims');
  if (postIds.length) {
    await claims.where(_.and([_.or([{ foundPostId: _.in(postIds) }, { lostPostId: _.in(postIds) }]), { status: 'pending' }]))
      .update({ data: { status: 'rejected', reviewedAt: db.serverDate() } });
    await db.collection('posts').where({ _openid: openid }).remove();
    await deletePhotos(posts.flatMap((p) => p.photos || []));
  }

  // 已完成的认领留给对方看记录，但抹掉这个人的身份和他填的答案
  await claims.where({ claimantOpenid: openid }).update({ data: { claimantOpenid: 'deleted', answer: '' } });
  await claims.where({ finderOpenid: openid }).update({ data: { finderOpenid: 'deleted' } });

  await db.collection('messages').where({ senderOpenid: openid }).remove();
  await db.collection('ratings').where(_.or([{ raterOpenid: openid }, { rateeOpenid: openid }])).remove();
  await db.collection('reports').where({ reporterOpenid: openid }).remove().catch(() => {});
  await db.collection('users').doc(openid).remove().catch(() => {});
  return { ok: true };
}
