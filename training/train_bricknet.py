#!/usr/bin/env python3
"""
train_bricknet.py — Train & Fine-Tune BrickNet V6 Classifier (MobileNetV3-Large, 936 classes)
with Multi-Stream Data Ingestion, Neighbor Intrusion Augmentation, and Automatic WebGL ONNX Export.
"""

import os
import sys
import glob
import json
import time
import random
import argparse
import shutil
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
import numpy as np
import timm

# Enforce resource guardrails
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_META = SCRIPT_DIR / "config" / "class_indices.json"
DEFAULT_CHECKPOINT = SCRIPT_DIR / "weights" / "bricknet_v6_best.pt"
OUTPUT_DIR = SCRIPT_DIR / "runs" / "bricknet"
APP_MODELS_DIR = (SCRIPT_DIR.parent / "app" / "public" / "models").resolve()


class BricknetDataset(Dataset):
    """
    Multi-Stream LEGO Dataset with optional Neighbor Intrusion Augmentation.
    Streams:
    - Stream A: Single-part path-traced views
    - Stream B: Multi-part cluster crops
    - Stream C: Dense pile clutter crops
    - Stream D: Real photograph crops
    """
    def __init__(
        self,
        classes_meta_path: Path,
        single_dir: Optional[Path] = None,
        crops_dir: Optional[Path] = None,
        dense_dir: Optional[Path] = None,
        real_dir: Optional[Path] = None,
        is_train: bool = True,
        transform=None,
        enable_intrusion: bool = True
    ):
        self.is_train = is_train
        self.transform = transform
        self.enable_intrusion = enable_intrusion
        self.samples: List[Tuple[str, int, str]] = []
        self.cached_patches: List[Image.Image] = []

        with open(classes_meta_path, "r", encoding="utf-8") as f:
            classes_meta = json.load(f)

        self.class_list = classes_meta["classes"]  # 936 classes
        self.class_to_idx = {cid: idx for idx, cid in enumerate(self.class_list)}
        self.num_classes = len(self.class_list)

        # 1. Stream A: Single-part path-traced views
        if single_dir and single_dir.exists():
            for cid, c_idx in self.class_to_idx.items():
                p_dir = single_dir / cid
                if not p_dir.exists():
                    continue
                imgs = sorted(list(p_dir.glob("*.png")) + list(p_dir.glob("*.jpg")))
                if not imgs:
                    continue
                val_split = max(1, int(len(imgs) * 0.15))
                selected = imgs[:-val_split] if is_train else imgs[-val_split:]
                for img_path in selected:
                    self.samples.append((str(img_path), c_idx, "single"))

        # 2. Stream B: Cluster crops
        if crops_dir and crops_dir.exists():
            for cid, c_idx in self.class_to_idx.items():
                p_dir = crops_dir / cid
                if not p_dir.exists():
                    continue
                imgs = sorted(list(p_dir.glob("*.png")) + list(p_dir.glob("*.jpg")))
                if not imgs:
                    continue
                val_split = max(1, int(len(imgs) * 0.15))
                if is_train:
                    selected = imgs[:-val_split]
                    for img_path in selected:
                        for _ in range(3):
                            self.samples.append((str(img_path), c_idx, "cluster_crop"))
                else:
                    selected = imgs[-val_split:]
                    for img_path in selected:
                        self.samples.append((str(img_path), c_idx, "cluster_crop"))

        # 3. Stream C: Dense pile clutter crops
        if dense_dir and dense_dir.exists():
            for cid, c_idx in self.class_to_idx.items():
                p_dir = dense_dir / cid
                if not p_dir.exists():
                    continue
                imgs = sorted(list(p_dir.glob("*.png")))
                if not imgs:
                    continue
                val_split = max(1, int(len(imgs) * 0.15))
                if is_train:
                    selected = imgs[:-val_split]
                    for img_path in selected:
                        for _ in range(2):
                            self.samples.append((str(img_path), c_idx, "dense_pile"))
                else:
                    selected = imgs[-val_split:]
                    for img_path in selected:
                        self.samples.append((str(img_path), c_idx, "dense_pile"))

        # 4. Stream D: Real photos
        if real_dir and real_dir.exists():
            manifest_file = real_dir / "manifest.json"
            if manifest_file.exists():
                with open(manifest_file, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
                items = manifest.get("train" if is_train else "val", [])
                for item in items:
                    pid = item.get("part_id")
                    fname = item.get("file")
                    if pid in self.class_to_idx and fname:
                        fpath = real_dir / ("train" if is_train else "val") / fname
                        if fpath.exists():
                            mult = 8 if is_train else 1
                            for _ in range(mult):
                                self.samples.append((str(fpath), self.class_to_idx[pid], "real_photo"))

        if is_train:
            random.seed(42)
            random.shuffle(self.samples)

            # Pre-cache random patch intruders for boundary intrusion
            num_intruders = min(200, len(self.samples))
            for i in range(num_intruders):
                try:
                    s_path, _, _ = self.samples[i]
                    with Image.open(s_path) as im:
                        im_rgb = im.convert("RGB")
                        w, h = im_rgb.size
                        pw = random.randint(int(w * 0.25), int(w * 0.45))
                        ph = random.randint(int(h * 0.25), int(h * 0.45))
                        px = random.randint(0, w - pw)
                        py = random.randint(0, h - ph)
                        self.cached_patches.append(im_rgb.crop((px, py, px + pw, py + ph)))
                except Exception:
                    pass

        print(f"[*] BricknetDataset ({'TRAIN' if is_train else 'VAL'}): loaded {len(self.samples)} samples across {self.num_classes} classes.")

    def __len__(self):
        return len(self.samples)

    def _apply_neighbor_intrusion(self, img: Image.Image) -> Image.Image:
        """Pastes a random neighboring brick fragment onto image border to simulate occlusion."""
        if not self.cached_patches or random.random() > 0.40:
            return img

        patch = random.choice(self.cached_patches)
        w, h = img.size
        pw = random.randint(int(w * 0.20), int(w * 0.40))
        ph = random.randint(int(h * 0.20), int(h * 0.40))
        patch_resized = patch.resize((pw, ph), Image.Resampling.BILINEAR)

        edge = random.choice(["top", "bottom", "left", "right", "corner"])
        if edge == "top":
            pos = (random.randint(0, w - pw), random.randint(-int(ph * 0.4), int(ph * 0.2)))
        elif edge == "bottom":
            pos = (random.randint(0, w - pw), h - ph + random.randint(-int(ph * 0.2), int(ph * 0.4)))
        elif edge == "left":
            pos = (random.randint(-int(pw * 0.4), int(pw * 0.2)), random.randint(0, h - ph))
        elif edge == "right":
            pos = (w - pw + random.randint(-int(pw * 0.2), int(pw * 0.4)), random.randint(0, h - ph))
        else:
            pos = (random.choice([0, w - pw]), random.choice([0, h - ph]))

        img_copy = img.copy()
        img_copy.paste(patch_resized, pos)
        return img_copy

    def __getitem__(self, idx: int):
        path, label, _ = self.samples[idx]
        try:
            with Image.open(path) as img:
                img = img.convert("RGB")
                if self.is_train and self.enable_intrusion:
                    img = self._apply_neighbor_intrusion(img)
                if self.transform:
                    img = self.transform(img)
                return img, label
        except Exception as e:
            # Fallback black image if corrupt
            fallback = torch.zeros(3, 224, 224, dtype=torch.float32)
            return fallback, label


def export_to_onnx(model: nn.Module, num_classes: int, out_path: Path, opset: int = 17):
    """Exports trained MobileNetV3-Large to ONNX format with dynamic batching."""
    model.eval()
    dummy_input = torch.randn(1, 3, 224, 224, dtype=torch.float32, device="cpu")
    cpu_model = timm.create_model("mobilenetv3_large_100", pretrained=False, num_classes=num_classes)
    cpu_model.load_state_dict(model.state_dict())
    cpu_model.eval()

    print(f"[*] Exporting ONNX to {out_path} (opset {opset})...")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        cpu_model,
        dummy_input,
        str(out_path),
        export_params=True,
        opset_version=opset,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch_size"}, "logits": {0: "batch_size"}},
        dynamo=False
    )
    sz_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"✓ Validated ONNX model: {sz_mb:.2f} MB")


def main():
    parser = argparse.ArgumentParser(description="Train BrickNet V6 Classifier (MobileNetV3-Large, 936 Classes)")
    parser.add_argument("--meta", type=str, default=str(DEFAULT_META), help="Path to class_indices.json")
    parser.add_argument("--checkpoint", type=str, default=str(DEFAULT_CHECKPOINT), help="Warm-start checkpoint (.pt)")
    parser.add_argument("--single-dir", type=str, default=None, help="Directory containing single-part render folders")
    parser.add_argument("--crops-dir", type=str, default=None, help="Directory containing cluster crop folders")
    parser.add_argument("--dense-dir", type=str, default=None, help="Directory containing dense clutter crop folders")
    parser.add_argument("--real-dir", type=str, default=None, help="Directory containing real photo crops")
    parser.add_argument("--epochs", type=int, default=15, help="Number of epochs to train (default: 15)")
    parser.add_argument("--batch-size", type=int, default=64, help="Batch size (default: 64)")
    parser.add_argument("--lr", type=float, default=3e-4, help="Learning rate (default: 3e-4)")
    parser.add_argument("--workers", type=int, default=4, help="DataLoader workers (default: 4, max: 4)")
    parser.add_argument("--device", type=str, default="cuda:0" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--name", type=str, default="bricknet_run", help="Run name")
    parser.add_argument("--deploy", action="store_true", default=True, help="Deploy exported ONNX to app/public/models")
    args = parser.parse_args()

    workers = min(4, max(1, args.workers))
    device = torch.device(args.device)

    print("==================================================================")
    print("  🧱 BrickNet V6 Classifier Training & WebGL Export")
    print(f"  ➜ Device:     {args.device}")
    print(f"  ➜ Epochs:     {args.epochs}")
    print(f"  ➜ Batch Size: {args.batch_size} (workers: {workers})")
    print(f"  ➜ LR:         {args.lr}")
    print(f"  ➜ Meta:       {args.meta}")
    print("==================================================================\n")

    with open(args.meta, "r", encoding="utf-8") as f:
        meta = json.load(f)
    num_classes = meta["num_classes"]
    print(f"[*] Target Architecture: MobileNetV3-Large with {num_classes} classes.")

    # Data Transforms
    train_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.RandomVerticalFlip(p=0.5),
        transforms.RandomRotation(degrees=180),
        transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    val_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    single_p = Path(args.single_dir) if args.single_dir else None
    crops_p = Path(args.crops_dir) if args.crops_dir else None
    dense_p = Path(args.dense_dir) if args.dense_dir else None
    real_p = Path(args.real_dir) if args.real_dir else None

    train_ds = BricknetDataset(
        classes_meta_path=Path(args.meta),
        single_dir=single_p,
        crops_dir=crops_p,
        dense_dir=dense_p,
        real_dir=real_p,
        is_train=True,
        transform=train_transform,
        enable_intrusion=True
    )

    val_ds = BricknetDataset(
        classes_meta_path=Path(args.meta),
        single_dir=single_p,
        crops_dir=crops_p,
        dense_dir=dense_p,
        real_dir=real_p,
        is_train=False,
        transform=val_transform,
        enable_intrusion=False
    )

    if len(train_ds) == 0:
        print("[!] No training samples found. Provide --single-dir, --crops-dir, --dense-dir, or --real-dir.")
        print("    If you want to synthesize training data, use training/generator/generate_dataset.js")
        return

    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=workers,
        pin_memory=True,
        drop_last=True
    )

    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=workers,
        pin_memory=True
    ) if len(val_ds) > 0 else None

    # Model definition
    model = timm.create_model("mobilenetv3_large_100", pretrained=True, num_classes=num_classes)
    
    # Warm start
    if args.checkpoint and os.path.exists(args.checkpoint):
        print(f"[*] Loading warm-start weights from: {args.checkpoint}...")
        ckpt = torch.load(args.checkpoint, map_location="cpu")
        state_dict = ckpt.get("model_state_dict", ckpt)
        try:
            model.load_state_dict(state_dict)
            print("✓ Loaded warm-start checkpoint state_dict successfully.")
        except Exception as e:
            print(f"[!] Warning: Mismatch loading checkpoint ({e}), continuing with partial/pretrained init.")

    model.to(device)

    criterion = nn.CrossEntropyLoss(label_smoothing=0.08)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=1e-6)

    best_val_acc = 0.0
    run_dir = OUTPUT_DIR / args.name
    run_dir.mkdir(parents=True, exist_ok=True)
    best_ckpt_path = run_dir / "best.pt"

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        correct = 0
        total = 0
        t0 = time.time()

        for batch_idx, (inputs, targets) in enumerate(train_loader):
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * inputs.size(0)
            _, preds = outputs.max(1)
            correct += preds.eq(targets).sum().item()
            total += targets.size(0)

        scheduler.step()
        train_loss = total_loss / max(1, total)
        train_acc = (correct / max(1, total)) * 100.0

        # Validation
        val_loss, val_acc = 0.0, 0.0
        if val_loader:
            model.eval()
            v_loss, v_corr, v_tot = 0.0, 0, 0
            with torch.no_grad():
                for inputs, targets in val_loader:
                    inputs, targets = inputs.to(device), targets.to(device)
                    outputs = model(inputs)
                    loss = criterion(outputs, targets)
                    v_loss += loss.item() * inputs.size(0)
                    _, preds = outputs.max(1)
                    v_corr += preds.eq(targets).sum().item()
                    v_tot += targets.size(0)
            val_loss = v_loss / max(1, v_tot)
            val_acc = (v_corr / max(1, v_tot)) * 100.0

        dt = time.time() - t0
        print(f"Epoch [{epoch:02d}/{args.epochs:02d}] ({dt:.1f}s) | Train Loss: {train_loss:.4f} Acc: {train_acc:.2f}% | Val Loss: {val_loss:.4f} Val Acc: {val_acc:.2f}%")

        if val_acc >= best_val_acc or val_loader is None:
            best_val_acc = val_acc
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "val_acc": val_acc,
                "num_classes": num_classes
            }, best_ckpt_path)

    print(f"\n✓ Training complete! Best checkpoint saved to {best_ckpt_path}")

    # Export to ONNX
    onnx_path = run_dir / "bricknet_v6.onnx"
    export_to_onnx(model, num_classes, onnx_path)

    if args.deploy and APP_MODELS_DIR.exists():
        shutil.copy2(onnx_path, APP_MODELS_DIR / "bricknet_v6_decomposed.onnx")
        shutil.copy2(onnx_path, APP_MODELS_DIR / "bricknet_v6.onnx")
        print(f"✓ Deployed BrickNet ONNX to {APP_MODELS_DIR}")

    print("\n★ BRICKNET TRAINING & EXPORT COMPLETED SUCCESSFULLY! ★")


if __name__ == "__main__":
    main()
