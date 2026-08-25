#!/usr/bin/env python3
"""Strip the white background off the Arvo client JPGs -> transparent header PNGs."""
from PIL import Image
import numpy as np
from collections import deque

def make_transparent(src, out, target_w):
    im = Image.open(src).convert("RGB")
    arr = np.asarray(im).astype(int)
    H, W = arr.shape[:2]
    white = (arr[:, :, 0] >= 243) & (arr[:, :, 1] >= 243) & (arr[:, :, 2] >= 243)

    # Flood-fill the exterior background so interior whites (letterform holes) survive.
    bg = np.zeros((H, W), bool)
    q = deque()
    for x in range(W):
        if white[0, x] and not bg[0, x]:
            bg[0, x] = True; q.append((0, x))
        if white[H - 1, x] and not bg[H - 1, x]:
            bg[H - 1, x] = True; q.append((H - 1, x))
    for y in range(H):
        if white[y, 0] and not bg[y, 0]:
            bg[y, 0] = True; q.append((y, 0))
        if white[y, W - 1] and not bg[y, W - 1]:
            bg[y, W - 1] = True; q.append((y, W - 1))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True; q.append((ny, nx))

    content = ~bg
    ys, xs = np.where(content)
    if len(ys) == 0:
        print("no content in", src)
        return
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    pad = 8
    y0 = max(0, y0 - pad); x0 = max(0, x0 - pad)
    y1 = min(H - 1, y1 + pad); x1 = min(W - 1, x1 + pad)

    crop_bands = np.asarray(im.crop((x0, y0, x1 + 1, y1 + 1))).astype(int)
    cb = bg[y0:y1 + 1, x0:x1 + 1]
    rgba = np.dstack([crop_bands, np.full((*cb.shape, 1), 255, dtype=np.uint8)])
    rgba = np.ascontiguousarray(rgba, dtype=np.uint8)
    alpha = rgba[:, :, 3].copy()
    alpha[cb] = 0
    rgba[:, :, 3] = alpha
    out_im = Image.fromarray(rgba, mode="RGBA")
    out_im = out_im.resize((target_w, max(1, int(out_im.height * target_w / out_im.width))), Image.LANCZOS)
    out_im.save(out)
    print(f"{src} -> {out}  content bbox=({x0},{y0})-({x1},{y1})  saved {out_im.size}")


SRC = "/home/team/shared/arvo/public/logo"
DST = "/home/team/shared/arvo/public/img"
make_transparent(f"{SRC}/F950D59B-C1EE-49E6-A524-065C166C61CD.JPG", f"{DST}/logo-header.png", 900)
make_transparent(f"{SRC}/3BDF19EC-EDCA-405F-AA97-BEBDC8E8FEEE.JPG", f"{DST}/logo-emblem.png", 700)
