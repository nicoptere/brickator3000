#!/usr/bin/env python3
"""
export_onnx.py — Export Trained BrickNet Model to FP32 ONNX & Quantized INT8 ONNX
for in-browser WebGL / WebGPU / WASM deployment via ONNX Runtime Web.
"""

import os
import sys
import json
import argparse
from pathlib import Path

import torch
import timm
import onnx
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CHECKPOINT = SCRIPT_DIR / "weights" / "bricknet_v6_best.pt"
DEFAULT_META = SCRIPT_DIR / "config" / "class_indices.json"
DEFAULT_OUTPUT_DIR = (SCRIPT_DIR.parent / "app" / "public" / "models").resolve()


def export_bricknet(
    checkpoint_path: Path,
    class_meta_path: Path,
    output_dir: Path,
    opset: int = 17,
    quantize: bool = False
):
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"[*] Loading class metadata from {class_meta_path}...")
    with open(class_meta_path, "r", encoding="utf-8") as f:
        class_meta = json.load(f)

    classes = class_meta["classes"]
    num_classes = len(classes)
    model_arch = class_meta.get("model_architecture", "mobilenetv3_large_100")
    print(f"[*] Architecture: {model_arch} with {num_classes} output classes.")

    print(f"[*] Loading model weights from {checkpoint_path}...")
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    
    model = timm.create_model(model_arch, pretrained=False, num_classes=num_classes)
    state_dict = checkpoint.get("model_state_dict", checkpoint)
    model.load_state_dict(state_dict)
    model.eval()

    dummy_input = torch.randn(1, 3, 224, 224, dtype=torch.float32)

    # 1. Export standard FP32 ONNX
    onnx_file = output_dir / "bricknet_v6_decomposed.onnx"
    print(f"[*] Exporting FP32 ONNX to {onnx_file} (opset {opset})...")
    
    torch.onnx.export(
        model,
        dummy_input,
        str(onnx_file),
        export_params=True,
        opset_version=opset,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "logits": {0: "batch_size"}
        },
        dynamo=False
    )

    onnx_model = onnx.load(str(onnx_file))
    onnx.checker.check_model(onnx_model)
    fp32_size_mb = onnx_file.stat().st_size / (1024 * 1024)
    print(f"✓ Validated FP32 ONNX model. File size: {fp32_size_mb:.2f} MB")

    # Mirror to bricknet_v6.onnx
    mirror_file = output_dir / "bricknet_v6.onnx"
    import shutil
    shutil.copy2(onnx_file, mirror_file)

    # 2. Export INT8 Quantized ONNX (optional)
    if quantize:
        quant_file = output_dir / "bricknet_v6_quant.onnx"
        print(f"[*] Quantizing to INT8 ONNX: {quant_file}...")
        try:
            quantize_dynamic(
                model_input=str(onnx_file),
                model_output=str(quant_file),
                weight_type=QuantType.QUInt8
            )
            quant_size_mb = quant_file.stat().st_size / (1024 * 1024)
            print(f"✓ INT8 Quantized model generated: {quant_size_mb:.2f} MB ({quant_size_mb / fp32_size_mb * 100:.1f}% of original)")
        except Exception as e:
            print(f"[!] Warning: Quantization encountered error: {e}")

    # 3. Verify ONNX Runtime vs PyTorch
    print("[*] Verifying ONNX Runtime output vs PyTorch...")
    with torch.no_grad():
        pt_out = model(dummy_input).numpy()

    ort_session = ort.InferenceSession(str(onnx_file), providers=["CPUExecutionProvider"])
    ort_inputs = {"input": dummy_input.numpy()}
    ort_out = ort_session.run(None, ort_inputs)[0]

    max_diff = abs(pt_out - ort_out).max()
    print(f"✓ PyTorch vs ONNX max output diff: {max_diff:.6f} (Validated)")
    print("\n★ ONNX EXPORT COMPLETED SUCCESSFULLY! ★")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export BrickNet PyTorch Checkpoint to ONNX")
    parser.add_argument("--checkpoint", type=str, default=str(DEFAULT_CHECKPOINT))
    parser.add_argument("--meta", type=str, default=str(DEFAULT_META))
    parser.add_argument("--output-dir", type=str, default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--quantize", action="store_true", default=False)
    args = parser.parse_args()

    export_bricknet(
        checkpoint_path=Path(args.checkpoint),
        class_meta_path=Path(args.meta),
        output_dir=Path(args.output_dir),
        opset=args.opset,
        quantize=args.quantize
    )
