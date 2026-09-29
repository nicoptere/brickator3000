#!/usr/bin/env python3
"""
Generates a master LEGO parts spritesheet image for Brickator3000.
Renders all 66 active LDraw connectors (categorized as FILL, EDGE, LEAF)
using authentic LDraw geometry, NumPy Z-buffer software rasterization,
and dark studio aesthetic.
"""

import os
import sys
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LDRAW_DIR = os.path.join(BASE_DIR, 'generator', 'public', 'ldraw')

PARTS_CATALOG = [
    # FILL (23 pieces) - Category: FILL, Color: #388bfd (Blue)
    ('FILL', '3007', 'Brick 2 x 8', '2x8x3', (56, 139, 253)),
    ('FILL', '2456', 'Brick 2 x 6', '2x6x3', (56, 139, 253)),
    ('FILL', '3001', 'Brick 2 x 4', '2x4x3', (56, 139, 253)),
    ('FILL', '3002', 'Brick 2 x 3', '2x3x3', (56, 139, 253)),
    ('FILL', '3003', 'Brick 2 x 2', '2x2x3', (56, 139, 253)),
    ('FILL', '3008', 'Brick 1 x 8', '1x8x3', (56, 139, 253)),
    ('FILL', '3009', 'Brick 1 x 6', '1x6x3', (56, 139, 253)),
    ('FILL', '3010', 'Brick 1 x 4', '1x4x3', (56, 139, 253)),
    ('FILL', '3622', 'Brick 1 x 3', '1x3x3', (56, 139, 253)),
    ('FILL', '3004', 'Brick 1 x 2', '1x2x3', (56, 139, 253)),
    ('FILL', '3034', 'Plate 2 x 8', '2x8x1', (40, 115, 235)),
    ('FILL', '3795', 'Plate 2 x 6', '2x6x1', (40, 115, 235)),
    ('FILL', '3020', 'Plate 2 x 4', '2x4x1', (40, 115, 235)),
    ('FILL', '3021', 'Plate 2 x 3', '2x3x1', (40, 115, 235)),
    ('FILL', '3022', 'Plate 2 x 2', '2x2x1', (40, 115, 235)),
    ('FILL', '3460', 'Plate 1 x 8', '1x8x1', (40, 115, 235)),
    ('FILL', '3666', 'Plate 1 x 6', '1x6x1', (40, 115, 235)),
    ('FILL', '3710', 'Plate 1 x 4', '1x4x1', (40, 115, 235)),
    ('FILL', '3623', 'Plate 1 x 3', '1x3x1', (40, 115, 235)),
    ('FILL', '3023', 'Plate 1 x 2', '1x2x1', (40, 115, 235)),
    ('FILL', '3700', 'Technic 1 x 2 Axle Hole', '1x2x3', (130, 145, 165)),
    ('FILL', '3701', 'Technic 1 x 4 Axle Holes', '1x4x3', (130, 145, 165)),
    ('FILL', '3702', 'Technic 1 x 8 Axle Holes', '1x8x3', (130, 145, 165)),

    # EDGE (26 pieces) - Category: EDGE, Color: #f0883e (Orange / Amber)
    ('EDGE', '88930', 'Slope Curved 2 x 4', '2x4x2', (245, 140, 60)),
    ('EDGE', '61678', 'Slope Curved 4 x 1', '1x4x3', (245, 140, 60)),
    ('EDGE', '15068', 'Slope Curved 2 x 2', '2x2x2', (245, 140, 60)),
    ('EDGE', '11477', 'Slope Curved 2 x 1', '1x2x3', (245, 140, 60)),
    ('EDGE', '93273', 'Slope Curved 4 x 1 Inv', '1x4x3', (220, 120, 45)),
    ('EDGE', '24201', 'Slope Curved 2 x 1 Inv', '1x2x3', (220, 120, 45)),
    ('EDGE', '3665', 'Slope 45 2 x 1 Inverted', '1x2x3', (220, 120, 45)),
    ('EDGE', '3660', 'Slope 45 2 x 2 Inverted', '2x2x3', (220, 120, 45)),
    ('EDGE', '3037', 'Slope Brick 45 2 x 4', '2x4x3', (235, 130, 50)),
    ('EDGE', '3038', 'Slope Brick 45 2 x 3', '2x3x3', (235, 130, 50)),
    ('EDGE', '3039', 'Slope Brick 45 2 x 2', '2x2x3', (235, 130, 50)),
    ('EDGE', '3040', 'Slope Brick 45 2 x 1', '1x2x3', (235, 130, 50)),
    ('EDGE', '27925', 'Tile 2 x 2 Macaroni Round', '2x2x1', (255, 170, 90)),
    ('EDGE', '25269', 'Tile 1 x 1 Quarter Round', '1x1x1', (255, 170, 90)),
    ('EDGE', '27263', 'Tile 2 x 2 Corner Round', '2x2x1', (255, 170, 90)),
    ('EDGE', '32803', 'Slope Curved 2 x 2 Inv', '2x2x3', (220, 120, 45)),
    ('EDGE', '43722', 'Wedge Plate 3 x 2 Left', '3x2x1', (215, 105, 40)),
    ('EDGE', '43723', 'Wedge Plate 3 x 2 Right', '3x2x1', (215, 105, 40)),
    ('EDGE', '2419', 'Wedge Plate 3 x 6', '3x6x1', (215, 105, 40)),
    ('EDGE', '50745', 'Wheel Arch 2 x 4 Extended', '2x4x3', (195, 95, 35)),
    ('EDGE', '18974', 'Wheel Arch 1 x 2 Curved', '1x2x3', (195, 95, 35)),
    ('EDGE', '6636', 'Tile 1 x 6 Studless', '1x6x1', (185, 195, 205)),
    ('EDGE', '2431', 'Tile 1 x 4 Studless', '1x4x1', (185, 195, 205)),
    ('EDGE', '3068b', 'Tile 2 x 2 with Groove', '2x2x1', (185, 195, 205)),
    ('EDGE', '3069b', 'Tile 1 x 2 with Groove', '1x2x1', (185, 195, 205)),
    ('EDGE', '2412b', 'Tile 1 x 2 Radiator Grille', '1x2x1', (145, 155, 165)),

    # LEAF (17 pieces) - Category: LEAF, Color: #3fb950 (Emerald / Lime)
    ('LEAF', '54200', 'Slope 31 1 x 1 Cheese', '1x1x2', (65, 190, 85)),
    ('LEAF', '85984', 'Slope 31 1 x 2 Cheese', '1x2x2', (65, 190, 85)),
    ('LEAF', '4740', 'Dish 2 x 2 Inverted Radar', '2x2x1', (90, 215, 105)),
    ('LEAF', '43898', 'Dish 3 x 3 Inverted Radar', '3x3x1', (90, 215, 105)),
    ('LEAF', '3960', 'Dish 4 x 4 Inverted Radar', '4x4x1', (90, 215, 105)),
    ('LEAF', '41669', 'Bionicle Tooth / Spine', '1x3x6', (240, 80, 80)),
    ('LEAF', '53451', 'Barb / Tooth / Horn 1x1', '1x1x2', (240, 80, 80)),
    ('LEAF', '87747', 'Curved Blade / Horn 4L', '1x1x4', (240, 80, 80)),
    ('LEAF', '32578', 'Bionicle Claw / Hook', '1x2x3', (240, 80, 80)),
    ('LEAF', '16770', 'Animal Barb Small', '1x1x2', (240, 80, 80)),
    ('LEAF', '48729b', 'Bar 1L Mechanical Claw', '1x1x2', (210, 65, 65)),
    ('LEAF', '4589', 'Cone 1 x 1 Top Stud', '1x1x3', (75, 200, 95)),
    ('LEAF', '3062b', 'Brick 1 x 1 Round Hollow', '1x1x3', (75, 200, 95)),
    ('LEAF', '6141', 'Plate 1 x 1 Round', '1x1x1', (75, 200, 95)),
    ('LEAF', '98138', 'Tile 1 x 1 Round', '1x1x1', (75, 200, 95)),
    ('LEAF', '3005', 'Brick 1 x 1 Unit', '1x1x3', (55, 175, 75)),
    ('LEAF', '3024', 'Plate 1 x 1 Unit', '1x1x1', (55, 175, 75)),
]

def det3(m):
    return (
        m[0] * (m[4]*m[8] - m[5]*m[7])
        - m[1] * (m[3]*m[8] - m[5]*m[6])
        + m[2] * (m[3]*m[7] - m[4]*m[6])
    )

def parse_ldraw_triangles(part_name, base_dir=LDRAW_DIR, depth=0, transform=None, inverted=False):
    if depth > 4:
        return []
    if transform is None:
        transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

    clean_name = part_name.replace('\\', '/').lower()
    if not clean_name.endswith('.dat'):
        clean_name += '.dat'

    candidates = [
        os.path.join(base_dir, 'parts', clean_name),
        os.path.join(base_dir, 'p', clean_name),
        os.path.join(base_dir, 'parts', 's', clean_name),
        os.path.join(base_dir, 'p', '8', clean_name),
        os.path.join(base_dir, 'p', '48', clean_name),
    ]
    file_path = None
    for c in candidates:
        if os.path.exists(c):
            file_path = c
            break
    if not file_path:
        return []

    def mult(t, x, y, z):
        return (
            t[0]*x + t[1]*y + t[2]*z + t[9],
            t[3]*x + t[4]*y + t[5]*z + t[10],
            t[6]*x + t[7]*y + t[8]*z + t[11]
        )

    def compose(p, s):
        M = [
            p[0]*s[0] + p[1]*s[3] + p[2]*s[6],
            p[0]*s[1] + p[1]*s[4] + p[2]*s[7],
            p[0]*s[2] + p[1]*s[5] + p[2]*s[8],
            p[3]*s[0] + p[4]*s[3] + p[5]*s[6],
            p[3]*s[1] + p[4]*s[4] + p[5]*s[7],
            p[3]*s[2] + p[4]*s[5] + p[5]*s[8],
            p[6]*s[0] + p[7]*s[3] + p[8]*s[6],
            p[6]*s[1] + p[7]*s[4] + p[8]*s[7],
            p[6]*s[2] + p[7]*s[5] + p[8]*s[8],
        ]
        pos_x = p[0]*s[9] + p[1]*s[10] + p[2]*s[11] + p[9]
        pos_y = p[3]*s[9] + p[4]*s[10] + p[5]*s[11] + p[10]
        pos_z = p[6]*s[9] + p[7]*s[10] + p[8]*s[11] + p[11]
        return M + [pos_x, pos_y, pos_z]

    triangles = []
    try:
        with open(file_path, 'r', encoding='latin1') as f:
            for line in f:
                tokens = line.strip().split()
                if not tokens:
                    continue
                lt = tokens[0]
                if lt == '1':
                    if len(tokens) >= 15:
                        sub_pos = [float(tokens[2]), float(tokens[3]), float(tokens[4])]
                        sub_m = [
                            float(tokens[5]), float(tokens[6]), float(tokens[7]),
                            float(tokens[8]), float(tokens[9]), float(tokens[10]),
                            float(tokens[11]), float(tokens[12]), float(tokens[13])
                        ]
                        sub_t = sub_m + sub_pos
                        new_t = compose(transform, sub_t)
                        sub_inv = (det3(sub_m) < 0) ^ inverted
                        triangles.extend(parse_ldraw_triangles(tokens[14], base_dir, depth + 1, new_t, sub_inv))
                elif lt == '3':
                    if len(tokens) >= 11:
                        p1 = mult(transform, float(tokens[2]), float(tokens[3]), float(tokens[4]))
                        p2 = mult(transform, float(tokens[5]), float(tokens[6]), float(tokens[7]))
                        p3 = mult(transform, float(tokens[8]), float(tokens[9]), float(tokens[10]))
                        if inverted:
                            triangles.append((p1, p3, p2))
                        else:
                            triangles.append((p1, p2, p3))
                elif lt == '4':
                    if len(tokens) >= 14:
                        p1 = mult(transform, float(tokens[2]), float(tokens[3]), float(tokens[4]))
                        p2 = mult(transform, float(tokens[5]), float(tokens[6]), float(tokens[7]))
                        p3 = mult(transform, float(tokens[8]), float(tokens[9]), float(tokens[10]))
                        p4 = mult(transform, float(tokens[11]), float(tokens[12]), float(tokens[13]))
                        if inverted:
                            triangles.append((p1, p4, p3))
                            triangles.append((p1, p3, p2))
                        else:
                            triangles.append((p1, p2, p3))
                            triangles.append((p1, p3, p4))
    except Exception:
        pass
    return triangles

def render_part_thumbnail_zbuffer(triangles, size=150, base_color=(56, 139, 253)):
    W, H = size, size
    z_buffer = np.full((H, W), -1e9, dtype=np.float32)
    img_buffer = np.full((H, W, 4), [13, 17, 23, 255], dtype=np.uint8)

    if not triangles:
        # Fallback placeholder box
        im = Image.fromarray(img_buffer, 'RGBA')
        draw = ImageDraw.Draw(im)
        draw.rectangle([(20, 20), (size-20, size-20)], fill=(30, 36, 45, 255), outline=(50, 60, 75, 255), width=2)
        return im

    # Isometric rotation angles (rotate so studs face up, front-left visible)
    ay = math.radians(38)
    ax = math.radians(-26)
    cos_y, sin_y = math.cos(ay), math.sin(ay)
    cos_x, sin_x = math.cos(ax), math.sin(ax)

    def rot(p):
        x, y, z = p
        x1 = x * cos_y + z * sin_y
        y1 = y
        z1 = -x * sin_y + z * cos_y
        x2 = x1
        y2 = y1 * cos_x - z1 * sin_x
        z2 = y1 * sin_x + z1 * cos_x
        return (x2, y2, z2)

    rot_tris = []
    min_x, max_x = float('inf'), float('-inf')
    min_y, max_y = float('inf'), float('-inf')

    for (p1, p2, p3) in triangles:
        r1, r2, r3 = rot(p1), rot(p2), rot(p3)
        v1 = (r2[0]-r1[0], r2[1]-r1[1], r2[2]-r1[2])
        v2 = (r3[0]-r1[0], r3[1]-r1[1], r3[2]-r1[2])
        nx = v1[1]*v2[2] - v1[2]*v2[1]
        ny = v1[2]*v2[0] - v1[0]*v2[2]
        nz = v1[0]*v2[1] - v1[1]*v2[0]
        l = math.hypot(nx, ny, nz)
        if l > 1e-6:
            nx, ny, nz = nx/l, ny/l, nz/l
        else:
            continue
        if nz < 0.02:
            continue  # Backface culling

        min_x = min(min_x, r1[0], r2[0], r3[0])
        max_x = max(max_x, r1[0], r2[0], r3[0])
        min_y = min(min_y, r1[1], r2[1], r3[1])
        max_y = max(max_y, r1[1], r2[1], r3[1])
        rot_tris.append(((r1, r2, r3), (nx, ny, nz)))

    if not rot_tris or max_x <= min_x or max_y <= min_y:
        im = Image.fromarray(img_buffer, 'RGBA')
        draw = ImageDraw.Draw(im)
        draw.rectangle([(20, 20), (size-20, size-20)], fill=(30, 36, 45, 255), outline=(50, 60, 75, 255), width=2)
        return im

    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    scale = (size * 0.74) / max(max_x - min_x, max_y - min_y, 1.0)
    ox = size / 2.0
    oy = size / 2.0

    # Key directional light
    lx, ly, lz = -0.35, -0.65, 0.65
    l_len = math.hypot(lx, ly, lz)
    lx, ly, lz = lx/l_len, ly/l_len, lz/l_len

    for (r1, r2, r3), (nx, ny, nz) in rot_tris:
        x1, y1 = ox + (r1[0] - cx) * scale, oy + (r1[1] - cy) * scale
        x2, y2 = ox + (r2[0] - cx) * scale, oy + (r2[1] - cy) * scale
        x3, y3 = ox + (r3[0] - cx) * scale, oy + (r3[1] - cy) * scale
        z1, z2, z3 = r1[2], r2[2], r3[2]

        min_px = max(0, int(min(x1, x2, x3)))
        max_px = min(W - 1, int(max(x1, x2, x3)) + 1)
        min_py = max(0, int(min(y1, y2, y3)))
        max_py = min(H - 1, int(max(y1, y2, y3)) + 1)

        if min_px > max_px or min_py > max_py:
            continue

        denom = (y2 - y3)*(x1 - x3) + (x3 - x2)*(y1 - y3)
        if abs(denom) < 1e-5:
            continue
        inv_denom = 1.0 / denom

        dot = max(0.0, nx*lx + ny*ly + nz*lz)
        light = 0.35 + 0.65 * dot
        col = np.array([
            int(min(255, base_color[0] * light)),
            int(min(255, base_color[1] * light)),
            int(min(255, base_color[2] * light)),
            255
        ], dtype=np.uint8)

        px = np.arange(min_px, max_px + 1)
        py = np.arange(min_py, max_py + 1)
        grid_x, grid_y = np.meshgrid(px, py)

        w1 = ((y2 - y3)*(grid_x - x3) + (x3 - x2)*(grid_y - y3)) * inv_denom
        w2 = ((y3 - y1)*(grid_x - x3) + (x1 - x3)*(grid_y - y3)) * inv_denom
        w3 = 1.0 - w1 - w2

        inside = (w1 >= -0.01) & (w2 >= -0.01) & (w3 >= -0.01)
        if not np.any(inside):
            continue

        depth = w1 * z1 + w2 * z2 + w3 * z3
        mask = inside & (depth > z_buffer[min_py:max_py+1, min_px:max_px+1])

        z_sub = z_buffer[min_py:max_py+1, min_px:max_px+1]
        z_sub[mask] = depth[mask]

        img_sub = img_buffer[min_py:max_py+1, min_px:max_px+1]
        img_sub[mask] = col

    return Image.fromarray(img_buffer, 'RGBA')

def build_spritesheet():
    cols = 8
    rows = 9
    cell_w = 224
    cell_h = 244
    padding_x = 24
    padding_y = 24
    header_h = 100

    sheet_w = cols * cell_w + padding_x * 2
    sheet_h = rows * cell_h + padding_y * 2 + header_h

    sheet = Image.new('RGBA', (sheet_w, sheet_h), (13, 17, 23, 255))
    draw = ImageDraw.Draw(sheet)

    try:
        font_title = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 28)
        font_sub = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
        font_id = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
        font_name = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11)
        font_dim = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 11)
        font_tag = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 10)
    except Exception:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        font_id = ImageFont.load_default()
        font_name = ImageFont.load_default()
        font_dim = ImageFont.load_default()
        font_tag = ImageFont.load_default()

    # Draw Header
    draw.text((padding_x, padding_y), 'BRICKATOR3000 — LEGO PARTS SPRITESHEET', fill=(240, 246, 252), font=font_title)
    draw.text((padding_x, padding_y + 40), f'Master Connector Catalog ({len(PARTS_CATALOG)} Active LDraw Parts) — Categorized as FILL, EDGE, and LEAF', fill=(139, 148, 158), font=font_sub)

    # Category Badges Legend in Header
    legend_items = [
        ('FILL (Bulk Interior Structural Mass)', (56, 139, 253), (25, 45, 75)),
        ('EDGE (Surface Boundary Slopes & Contours)', (245, 140, 60), (75, 45, 20)),
        ('LEAF (Extremities, Apexes & Creature Detailing)', (65, 190, 85), (25, 60, 35)),
    ]
    lx = sheet_w - padding_x - 700
    for name, fg, bg in legend_items:
        bbox = draw.textbbox((lx, padding_y + 12), name, font=font_tag)
        w = bbox[2] - bbox[0] + 16
        draw.rounded_rectangle([(lx, padding_y + 8), (lx + w, padding_y + 30)], radius=4, fill=bg, outline=fg)
        draw.text((lx + 8, padding_y + 12), name, fill=fg, font=font_tag)
        lx += w + 14

    draw.line([(padding_x, header_h + 10), (sheet_w - padding_x, header_h + 10)], fill=(48, 54, 61), width=1)

    print(f'Rendering {len(PARTS_CATALOG)} parts into Z-buffered spritesheet ({sheet_w}x{sheet_h})...')

    for idx, (cat, part_id, name, dims, color) in enumerate(PARTS_CATALOG):
        col = idx % cols
        row = idx // cols

        x0 = padding_x + col * cell_w
        y0 = header_h + 20 + row * cell_h
        card_w = cell_w - 12
        card_h = cell_h - 14

        # Card Background
        card_bg = (22, 27, 34, 255)
        border_col = (48, 54, 61, 255)
        draw.rounded_rectangle([(x0, y0), (x0 + card_w, y0 + card_h)], radius=8, fill=card_bg, outline=border_col, width=1)

        # Category Top Accent Line
        cat_color = (56, 139, 253) if cat == 'FILL' else ((245, 140, 60) if cat == 'EDGE' else (65, 190, 85))
        draw.line([(x0 + 8, y0 + 1), (x0 + card_w - 8, y0 + 1)], fill=cat_color, width=2)

        # Render Part 3D Thumbnail via NumPy Z-Buffer
        tris = parse_ldraw_triangles(part_id)
        thumb = render_part_thumbnail_zbuffer(tris, size=142, base_color=color)

        thumb_x = x0 + int((card_w - 142) / 2)
        thumb_y = y0 + 8
        sheet.paste(thumb, (thumb_x, thumb_y))

        # Part Info Block
        info_y = y0 + 154

        # Category Tag & Part ID
        tag_bg = (25, 45, 75) if cat == 'FILL' else ((75, 45, 20) if cat == 'EDGE' else (25, 60, 35))
        draw.rounded_rectangle([(x0 + 10, info_y), (x0 + 44, info_y + 16)], radius=3, fill=tag_bg, outline=cat_color)
        draw.text((x0 + 14, info_y + 2), cat, fill=cat_color, font=font_tag)

        draw.text((x0 + 50, info_y), f'#{part_id}', fill=(240, 246, 252), font=font_id)

        # Dimensions Pill
        dim_bbox = draw.textbbox((0, 0), dims, font=font_dim)
        dim_w = dim_bbox[2] - dim_bbox[0] + 10
        dim_x = x0 + card_w - dim_w - 10
        draw.rounded_rectangle([(dim_x, info_y), (dim_x + dim_w, info_y + 16)], radius=3, fill=(33, 38, 45), outline=(48, 54, 61))
        draw.text((dim_x + 5, info_y + 2), dims, fill=(139, 148, 158), font=font_dim)

        # Part Name
        short_name = name if len(name) <= 24 else name[:22] + '...'
        draw.text((x0 + 10, info_y + 22), short_name, fill=(201, 209, 217), font=font_name)

        if (idx + 1) % 10 == 0 or idx == len(PARTS_CATALOG) - 1:
            print(f'  Rendered {idx + 1}/{len(PARTS_CATALOG)} parts...')

    pub_path = os.path.join(BASE_DIR, 'generator', 'public', 'parts_spritesheet.png')
    dist_path = os.path.join(BASE_DIR, 'generator', 'dist', 'parts_spritesheet.png')
    artifact_dir = '/home/nico/.gemini/antigravity/brain/e4e95b1e-9d75-4a6e-8673-e7784d53b231'
    art_path = os.path.join(artifact_dir, 'parts_spritesheet.png')

    sheet.save(pub_path, 'PNG', optimize=True)
    print(f'Saved spritesheet to: {pub_path}')

    if os.path.exists(os.path.dirname(dist_path)):
        sheet.save(dist_path, 'PNG', optimize=True)
        print(f'Saved spritesheet to: {dist_path}')

    if os.path.exists(artifact_dir):
        sheet.save(art_path, 'PNG', optimize=True)
        print(f'Saved spritesheet to artifact: {art_path}')

if __name__ == '__main__':
    build_spritesheet()
