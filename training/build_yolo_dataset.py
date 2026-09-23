#!/usr/bin/env python3
"""
build_yolo_dataset.py — Utilities to convert instance masks into normalized YOLO polygon labels
and organize dataset directories for YOLO11-seg training.
"""

import os
import sys
import argparse
import numpy as np
import cv2
from pathlib import Path


def mask_to_yolo_polygon(mask: np.ndarray, min_points: int = 6, max_points: int = 32):
    """
    Converts a binary mask (H, W) to normalized YOLO polygon coordinates [x1, y1, x2, y2, ...].
    """
    h, w = mask.shape[:2]
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []

    polygons = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 80:
            continue

        peri = cv2.arcLength(cnt, True)
        eps = 0.004 * peri
        approx = cv2.approxPolyDP(cnt, eps, True)

        pts = approx.reshape(-1, 2)
        if len(pts) < 3:
            continue

        if len(pts) > max_points:
            indices = np.linspace(0, len(pts) - 1, max_points, dtype=int)
            pts = pts[indices]

        norm_pts = []
        for x, y in pts:
            nx = max(0.0, min(1.0, float(x) / w))
            ny = max(0.0, min(1.0, float(y) / h))
            norm_pts.extend([round(nx, 5), round(ny, 5)])

        if len(norm_pts) >= min_points:
            polygons.append(norm_pts)

    return polygons


def save_yolo_annotation(label_path: Path, class_id: int, polygons: list):
    """Writes YOLO segmentation line: `<class_id> <x1> <y1> <x2> <y2> ...`"""
    with open(label_path, "w", encoding="utf-8") as f:
        for poly in polygons:
            coords_str = " ".join(f"{coord:.5f}" for coord in poly)
            f.write(f"{class_id} {coords_str}\n")


def main():
    parser = argparse.ArgumentParser(description="YOLO Dataset Polygon Preparation Tool")
    parser.add_argument("--test", action="store_true", help="Run self-test on dummy mask")
    args = parser.parse_args()

    if args.test:
        print("[*] Running polygon extraction self-test...")
        dummy_mask = np.zeros((256, 256), dtype=np.uint8)
        cv2.rectangle(dummy_mask, (50, 50), (150, 150), 255, -1)
        poly = mask_to_yolo_polygon(dummy_mask)
        assert len(poly) > 0, "Self-test failed to extract polygon"
        print(f"✓ Extracted {len(poly[0]) // 2} vertices for test polygon.")


if __name__ == "__main__":
    main()
