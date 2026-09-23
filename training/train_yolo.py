#!/usr/bin/env python3
"""
train_yolo.py — Train & Fine-Tune YOLO11-seg on LEGO Instance Segmentation Dataset
and automatically export to optimized ONNX format for client-side WebGL/WASM inference.
"""

import os
import shutil
import argparse
from pathlib import Path

# Enforce resource guardrails
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_YAML = SCRIPT_DIR / "config" / "yolo_data.yaml"
DEFAULT_WEIGHTS = SCRIPT_DIR / "weights" / "yolo11n-seg.pt"
OUTPUT_DIR = SCRIPT_DIR / "runs" / "yolo11_seg"
APP_MODELS_DIR = (SCRIPT_DIR.parent / "app" / "public" / "models").resolve()


def main():
    parser = argparse.ArgumentParser(description="Train YOLO11n-seg on LEGO Bricks")
    parser.add_argument("--data", type=str, default=str(DEFAULT_DATA_YAML), help="Path to data.yaml")
    parser.add_argument("--weights", type=str, default=str(DEFAULT_WEIGHTS), help="Base pretrained weights (.pt)")
    parser.add_argument("--epochs", type=int, default=80, help="Number of epochs to train (default: 80)")
    parser.add_argument("--patience", type=int, default=15, help="Early stopping patience (default: 15)")
    parser.add_argument("--batch", type=int, default=8, help="Batch size (default: 8)")
    parser.add_argument("--imgsz", type=int, default=1024, help="Image resolution for train/export (default: 1024)")
    parser.add_argument("--workers", type=int, default=4, help="DataLoader workers (default: 4, max: 4)")
    parser.add_argument("--name", type=str, default="train_lego_yolo11", help="Experiment run name")
    parser.add_argument("--device", type=str, default="0", help="CUDA device index or 'cpu'")
    parser.add_argument("--deploy", action="store_true", default=True, help="Deploy exported ONNX to app/public/models")
    args = parser.parse_args()

    from ultralytics import YOLO

    workers = min(4, max(1, args.workers))

    print("==================================================================")
    print("  🧱 YOLO11-seg Fine-Tuning & Browser ONNX Export")
    print(f"  ➜ Epochs:   {args.epochs} (patience: {args.patience})")
    print(f"  ➜ Res:      {args.imgsz}x{args.imgsz}")
    print(f"  ➜ Batch:    {args.batch} (workers: {workers})")
    print(f"  ➜ Weights:  {args.weights}")
    print(f"  ➜ Data:     {args.data}")
    print("==================================================================\n")

    # 1. Load pretrained model
    model = YOLO(args.weights)

    # 2. Train model
    print(f"[*] Starting training...")
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        workers=workers,
        device=args.device,
        amp=True,
        patience=args.patience,
        save=True,
        project=str(OUTPUT_DIR),
        name=args.name,
        exist_ok=True,
        verbose=True
    )

    best_pt = OUTPUT_DIR / args.name / "weights" / "best.pt"
    if not best_pt.exists():
        best_pt = OUTPUT_DIR / args.name / "weights" / "last.pt"

    print(f"\n✓ Best model checkpoint saved to: {best_pt}")

    # 3. Export to ONNX (opset 12 for WebGL / WebGPU / ONNX Runtime Web)
    print(f"\n[*] Exporting to ONNX format (imgsz={args.imgsz}, opset=12, simplify=True)...")
    best_model = YOLO(str(best_pt))
    exported_onnx = best_model.export(
        format="onnx",
        imgsz=args.imgsz,
        opset=12,
        simplify=True
    )

    exported_path = Path(exported_onnx)
    print(f"✓ ONNX export complete: {exported_path} ({exported_path.stat().st_size / 1024 / 1024:.2f} MB)")

    # 4. Deploy to App public/models folder
    if args.deploy and APP_MODELS_DIR.exists():
        dest = APP_MODELS_DIR / f"yolo11n_seg_{args.imgsz}.onnx"
        shutil.copy2(exported_path, dest)
        shutil.copy2(exported_path, APP_MODELS_DIR / "yolo11n_seg.onnx")
        print(f"✓ Deployed ONNX model to: {dest}")

    print("\n★ YOLO11-seg TRAINING & EXPORT COMPLETED SUCCESSFULLY! ★")


if __name__ == "__main__":
    main()
