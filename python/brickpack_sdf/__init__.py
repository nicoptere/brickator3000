"""BrickPack SDF — Implicit signed-distance field & Soft-IoU LEGO brick packer."""

from .units import STUD, PLATE, H, SX, SY, STUD_R, STUD_H
from .colors import load_colors, Palette, FALLBACK_COLORS
from .mesh_io import load_model, build_bricks_mesh, export_glb, export_ldr
from .catalog import (
    PACK_KINDS,
    load_catalog,
    save_catalog,
    train_catalog_ldraw,
    train_catalog_models,
    part_sdf,
    stud_sdf,
    build_variants,
)
from .target import encode_sdf_volume, save_sdf, load_sdf, target_field, target_from_sdf_volume
from .engine import pack_model, EFFORT
from .policy import POLICY

__all__ = [
    "STUD", "PLATE", "H", "SX", "SY", "STUD_R", "STUD_H",
    "load_colors", "Palette", "FALLBACK_COLORS",
    "load_model", "build_bricks_mesh", "export_glb", "export_ldr",
    "PACK_KINDS", "load_catalog", "save_catalog", "train_catalog_ldraw", "train_catalog_models",
    "part_sdf", "stud_sdf", "build_variants",
    "encode_sdf_volume", "save_sdf", "load_sdf", "target_field", "target_from_sdf_volume",
    "pack_model", "EFFORT", "POLICY",
]
