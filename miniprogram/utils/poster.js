// 寻物海报：照片 + 名称地点 + 小程序码，画在 canvas 上导出成图片。
// 用户可以发朋友圈、存到相册再发小红书、抖音、QQ，别人用微信扫码就能打开这条发布。
const W = 750;
const H = 1200;
const COLORS = { lost: '#E0480F', found: '#2459E0', ground: '#FFF8F3', ink: '#1C1B19', quiet: '#5F5C55' };

function loadImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// 按宽度把文字切成几行，超出 maxLines 的用省略号
function wrap(ctx, text, width, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ctx.measureText(line + ch).width > width) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  return lines;
}

// 图片按“裁切填满”画进一个圆角方框
function drawCover(ctx, img, x, y, w, h, r) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.clip();
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

// post: { type, title, placeName, reward }；photoPath、codePath 是本地临时文件
async function drawPoster(canvas, post, photoPath, codePath) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const isLost = post.type === 'lost';
  const accent = isLost ? COLORS.lost : COLORS.found;

  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText(isLost ? '帮忙留意，谢谢！' : '有人捡到了，是你的吗？', 48, 96);

  const [photo, code] = await Promise.all([
    photoPath ? loadImage(canvas, photoPath).catch(() => null) : null,
    loadImage(canvas, codePath)
  ]);
  if (photo) drawCover(ctx, photo, 48, 190, W - 96, 520, 32);

  let y = photo ? 790 : 260;
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 48px sans-serif';
  wrap(ctx, post.title, W - 96, 2).forEach((line) => { ctx.fillText(line, 48, y); y += 64; });
  ctx.fillStyle = COLORS.quiet;
  ctx.font = '32px sans-serif';
  if (post.placeName) {
    wrap(ctx, `${isLost ? '大概丢在' : '捡到地点'}：${post.placeName}`, W - 96, 2).forEach((line) => { ctx.fillText(line, 48, y); y += 46; });
  }
  if (isLost && post.reward > 0) {
    ctx.fillStyle = accent;
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`失主愿意给感谢金 ¥${post.reward}`, 48, y + 4);
  }

  // 底部：小程序码和说明
  const codeSize = 200;
  ctx.drawImage(code, W - 48 - codeSize, H - 48 - codeSize, codeSize, codeSize);
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(isLost ? '见到了请微信扫码告诉我' : '是你的？微信扫码认领', 48, H - 170);
  ctx.fillStyle = COLORS.quiet;
  ctx.font = '28px sans-serif';
  ctx.fillText('掉了么 · 拍张照，帮丢的东西回家', 48, H - 116);
  ctx.fillText('长按识别或用微信扫一扫', 48, H - 72);

  const { tempFilePath } = await wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality: 0.9 });
  return tempFilePath;
}

module.exports = { drawPoster };
