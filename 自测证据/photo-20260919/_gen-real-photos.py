# 生成真实尺寸测试照片（卡F 验收用）
#
# ⚠️ 为什么不用「1x1 JPEG + COM 段填充」那套（上一批用过的做法）：
#    卡F 明确要求「验收必须用真实尺寸照片（手机原图 1~3MB），禁止再用几十字节的假图」。
#    所以这里生成**真实像素尺寸**（3024×4032 = 手机主摄 12MP 量级）且带真实图像内容（含
#    高频颗粒，JPEG 压不下去）的照片，体积自然落在 1~3MB，能真实走通「本地压缩 → 上传」链路。
#
# 用 numpy 做向量化运算（纯 Python 逐像素遍历 12MP 要几分钟，不可接受）。
#
# 用法（隔离环境 python，已装 Pillow + numpy）：
#   python _gen-real-photos.py <输出目录>
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)


def make_photo(seed, path, w, h, target_min, target_max):
    """合成一张「像手机随手拍」的图：渐变背景 + 主体色块 + 高频颗粒噪声（决定 JPEG 体积）。
    先扫质量，仍达不到目标体积就加颗粒重试。"""
    rng = np.random.default_rng(seed)

    # ① 平滑底：垂直渐变 + 少量色块（模拟光照与货物/单据）
    top = rng.integers(150, 231, size=3).astype(np.float32)
    bot = rng.integers(40, 91, size=3).astype(np.float32)
    t = np.linspace(0.0, 1.0, h, dtype=np.float32).reshape(h, 1, 1)
    grad = top.reshape(1, 1, 3) * (1 - t) + bot.reshape(1, 1, 3) * t
    img = Image.fromarray(np.repeat(grad, w, axis=1).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    for _ in range(int(rng.integers(4, 8))):
        x0, y0 = int(rng.integers(0, w - 200)), int(rng.integers(0, h - 200))
        bw, bh = int(rng.integers(300, 1600)), int(rng.integers(300, 1600))
        box = (x0, y0, min(w, x0 + bw), min(h, y0 + bh))
        color = tuple(int(v) for v in rng.integers(30, 256, size=3))
        (d.ellipse if rng.random() < 0.5 else d.rectangle)(box, fill=color)
    base = np.asarray(img.filter(ImageFilter.GaussianBlur(2)), dtype=np.float32)

    # ② 叠加高频颗粒（关键：真实照片的高频细节让 JPEG 压不下去，体积才会到手机原图量级）
    #    用固定种子，保证可复现
    sigma = 10.0
    for _ in range(6):
        nz = rng.normal(0.0, sigma, size=(h, w, 3)).astype(np.float32)
        arr = np.clip(base + nz, 0, 255).astype(np.uint8)
        # subsampling=0（4:4:4）保留色度高频，更接近真实照片编码
        lo, hi, q, size = 40, 98, 90, 0
        for _ in range(9):
            q = (lo + hi) // 2
            Image.fromarray(arr, "RGB").save(path, "JPEG", quality=q, optimize=True, subsampling=0)
            size = os.path.getsize(path)
            if size < target_min:
                lo = q + 1
            elif size > target_max:
                hi = q - 1
            else:
                break
        if target_min <= size <= target_max:
            break
        sigma *= 1.7  # 体积不够 → 加更多颗粒
        if sigma > 60:
            break

    with Image.open(path) as chk:
        w_, h_ = chk.size
        chk.verify()
    print(f"{os.path.basename(path)}  尺寸={w_}x{h_}  体积={size/1024/1024:.2f}MB (= {size}B)  quality={q}  noiseSigma={sigma:.1f}")


# 手机主摄量级 12MP，目标 1~3MB
make_photo(20260919, os.path.join(OUT, "real-photo-1.jpg"), 3024, 4032, int(1.5e6), int(3.0e6))
make_photo(777, os.path.join(OUT, "real-photo-2.jpg"), 3024, 4032, int(1.5e6), int(3.0e6))
# 超大图：目标 >5MB（用于「超限反例」，体积必须真的超过 5MB 上限）
make_photo(31337, os.path.join(OUT, "real-photo-8mb.jpg"), 4000, 5333, int(8.0e6), int(10.0e6))
print("done")
