"""Unit and integration tests for BrickPack SDF Python implementation."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brickpack_sdf.catalog import (
    PACK_KINDS,
    build_variants,
    load_catalog,
    part_sdf,
    stud_sdf,
    train_catalog_ldraw,
    train_part_from_mesh,
)
from brickpack_sdf.colors import Palette, load_colors
from brickpack_sdf.engine import pack_model
from brickpack_sdf.mesh_io import build_bricks_mesh, export_glb, export_ldr, load_model
from brickpack_sdf.target import encode_sdf_volume, load_sdf, save_sdf, target_from_sdf_volume

DATASET = Path(__file__).resolve().parents[2] / "dataset"


class TestBrickPackPython(unittest.TestCase):
    def test_catalog_99_and_part_sdf(self):
        cat = load_catalog(DATASET / "catalog_99.json")
        self.assertEqual(len(cat), 99)
        by_key, variants = build_variants(cat, kinds=PACK_KINDS)
        self.assertIn(("3001", 0), by_key)
        self.assertGreater(len(variants), 100)

        brick = next(p for p in cat if p["id"] == "3001")
        s = part_sdf(brick, pad=2)
        self.assertGreater(s["vol"], 10000)
        self.assertLessEqual(stud_sdf(s["studs"], 10.0, s["studs"][0][1] + 2.0, 10.0), 0.0)

        if (DATASET / "ldraw" / "parts").exists():
            full = train_catalog_ldraw(DATASET / "ldraw", DATASET / "omr_top99.json")
            self.assertGreaterEqual(len(full), 90)

    def test_mesh_adapters_stanford_bunny_obj_glb_ply(self):
        bunny_obj = load_model(DATASET / "models/stanford_bunny.obj")
        self.assertGreaterEqual(len(bunny_obj["tris"]), 5000)

        bunny_glb = load_model(DATASET / "models/stanford_bunny.glb")
        self.assertEqual(len(bunny_glb["tris"]), len(bunny_obj["tris"]))
        self.assertTrue(bunny_glb["has_color"])

        bunny_ply = load_model(DATASET / "models/stanford_bunny.ply")
        self.assertEqual(len(bunny_ply["tris"]), len(bunny_obj["tris"]))
        self.assertTrue(bunny_ply["has_color"])

    def test_custom_mesh_part_training(self):
        bunny = load_model(DATASET / "models/stanford_bunny.obj")
        part = train_part_from_mesh("custom_bunny", bunny["tris"], w=2, d=2, h_plates=3)
        self.assertEqual(part["w"], 2)
        self.assertEqual(part["d"], 2)
        self.assertTrue(any(v > 0 for v in part["top"]))

    def test_sdf_roundtrip_pack_and_glb_export(self):
        cat = load_catalog(DATASET / "catalog_99.json")
        colors = load_colors(DATASET / "colors.json")
        self.assertGreaterEqual(len(colors), 150)
        pal = Palette(colors)
        self.assertIsInstance(pal.snap((255, 0, 0))["code"], int)

        bunny = load_model(DATASET / "models/stanford_bunny.ply")
        hdr, data = encode_sdf_volume(bunny, res=24, pad_voxels=2)
        self.assertEqual(hdr["format"], "brickpack-sdf-v1")

        with tempfile.TemporaryDirectory() as td:
            td_p = Path(td)
            jp, _ = save_sdf(hdr, data, td_p / "bunny.sdf.json")
            hdr2, data2 = load_sdf(jp)
            T = target_from_sdf_volume(hdr2, data2, studs=10)
            self.assertGreater(float(T["t"].max()), 0.5)

            res = pack_model(bunny, catalog=cat, studs=10, effort="quick", colors=colors)
            self.assertGreaterEqual(res["pack"]["pieces"], 5)
            self.assertGreater(res["pack"]["softIoU"], 0.45)

            res_sdf = pack_model((hdr2, data2), catalog=cat, studs=10, effort="quick", colors=colors)
            self.assertGreaterEqual(res_sdf["pack"]["pieces"], 5)

            mesh = build_bricks_mesh(res["pieces"], cat)
            glb_path = export_glb(mesh, td_p / "bunny_bricks.glb")
            ldr_path = export_ldr(res["pieces"], cat, td_p / "bunny_bricks.ldr")
            self.assertGreater(glb_path.stat().st_size, 200)
            self.assertIn("0 Name:", ldr_path.read_text(encoding="utf-8"))

            reloaded = load_model(glb_path)
            self.assertEqual(len(reloaded["tris"]), len(mesh["idx"]) // 3)
            self.assertTrue(reloaded["has_color"])


if __name__ == "__main__":
    unittest.main()
