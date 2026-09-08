#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path

from openai import OpenAI

PROMPT = """You are analysing a simple 2D fabrication drawing for a Quick DXF workflow.

Rules:
- Read only dimensions that are explicitly written or unambiguously indicated.
- Never invent a production dimension from apparent image scale.
- Distinguish overall/size dimensions from positional dimensions.
- For cut-out or hole positions, identify whether the dimension terminates at the feature centre/centreline or at an edge. If unclear, use unknown.
- If a positional dimension is measured from an outer edge, identify which outer edge when clear.
- Treat a centre mark or C/CL-style centre indicator as centre-referenced only when visually supported.
- If the source contains several unrelated parts/drawings, mark single_part false and require human review.
- The result is only a proposal for human confirmation; production_ready must be false whenever any required dimension, position, feature type, or reference is uncertain.
- Use millimetres when the drawing explicitly uses mm. Do not silently convert unknown units.
- Focus on geometry needed to make one simple flat 2D DXF: outer profile, holes, slots, notches and cut-outs. Ignore decorative notes unless they alter geometry.
"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "single_part": {"type": "boolean"},
        "units": {"type": "string", "enum": ["mm", "inch", "unknown"]},
        "drawing_label": {"type": ["string", "null"]},
        "profile": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "type": {"type": "string", "enum": ["rectangle", "circle", "polygon", "irregular", "unknown"]},
                "width_mm": {"type": ["number", "null"]},
                "height_mm": {"type": ["number", "null"]},
                "diameter_mm": {"type": ["number", "null"]},
                "confidence": {"type": "string", "enum": ["high", "medium", "low"]}
            },
            "required": ["type", "width_mm", "height_mm", "diameter_mm", "confidence"]
        },
        "features": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string", "enum": ["rectangular_cutout", "circular_hole", "slot", "notch", "arc", "other"]},
                    "quantity": {"type": "integer", "minimum": 1},
                    "width_mm": {"type": ["number", "null"]},
                    "height_mm": {"type": ["number", "null"]},
                    "diameter_mm": {"type": ["number", "null"]},
                    "radius_mm": {"type": ["number", "null"]},
                    "x_mm": {"type": ["number", "null"]},
                    "x_reference": {"type": "string", "enum": ["centre", "edge", "unknown"]},
                    "x_from_edge": {"type": "string", "enum": ["left", "right", "top", "bottom", "unknown"]},
                    "y_mm": {"type": ["number", "null"]},
                    "y_reference": {"type": "string", "enum": ["centre", "edge", "unknown"]},
                    "y_from_edge": {"type": "string", "enum": ["left", "right", "top", "bottom", "unknown"]},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "source_note": {"type": ["string", "null"]}
                },
                "required": ["id", "type", "quantity", "width_mm", "height_mm", "diameter_mm", "radius_mm", "x_mm", "x_reference", "x_from_edge", "y_mm", "y_reference", "y_from_edge", "confidence", "source_note"]
            }
        },
        "dimensions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "raw_text": {"type": "string"},
                    "value": {"type": ["number", "null"]},
                    "role": {"type": "string", "enum": ["overall", "size", "position", "diameter", "radius", "unknown"]},
                    "reference": {"type": "string", "enum": ["centre", "edge", "size", "unknown"]},
                    "target": {"type": ["string", "null"]},
                    "from_edge": {"type": "string", "enum": ["left", "right", "top", "bottom", "unknown"]},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]}
                },
                "required": ["raw_text", "value", "role", "reference", "target", "from_edge", "confidence"]
            }
        },
        "uncertainties": {"type": "array", "items": {"type": "string"}},
        "requires_human_review": {"type": "boolean"},
        "production_ready": {"type": "boolean"},
        "summary": {"type": "string"}
    },
    "required": ["single_part", "units", "drawing_label", "profile", "features", "dimensions", "uncertainties", "requires_human_review", "production_ready", "summary"]
}

PRICING_USD_PER_MILLION = {
    "gpt-5.6-luna": (0.20, 1.20),
    "gpt-5.6-terra": (2.00, 12.00),
    "gpt-5.6-sol": (4.00, 20.00),
}


def encode_image(path: Path):
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return {"type": "input_image", "image_url": f"data:{mime};base64,{data}", "detail": "high"}


def estimate_cost(model, usage):
    if model not in PRICING_USD_PER_MILLION or usage is None:
        return None
    input_rate, output_rate = PRICING_USD_PER_MILLION[model]
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    return round((input_tokens * input_rate + output_tokens * output_rate) / 1_000_000, 6)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("drawing", type=Path)
    parser.add_argument("--model", default="gpt-5.6-terra", choices=list(PRICING_USD_PER_MILLION))
    parser.add_argument("--effort", default="low", choices=["none", "low", "medium", "high"])
    parser.add_argument("--output-dir", type=Path, default=Path("output"))
    args = parser.parse_args()

    if not args.drawing.exists():
        raise SystemExit(f"Drawing not found: {args.drawing}")
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is not set")

    client = OpenAI(max_retries=0, timeout=120.0)
    uploaded_file = None
    suffix = args.drawing.suffix.lower()

    try:
        if suffix == ".pdf":
            uploaded_file = client.files.create(
                file=args.drawing.open("rb"),
                purpose="user_data",
                expires_after={"anchor": "created_at", "seconds": 3600},
            )
            source_part = {"type": "input_file", "file_id": uploaded_file.id}
        elif suffix in {".png", ".jpg", ".jpeg", ".webp"}:
            source_part = encode_image(args.drawing)
        else:
            raise SystemExit("Supported test inputs: PDF, PNG, JPG, JPEG, WebP")

        response = client.responses.create(
            model=args.model,
            reasoning={"effort": args.effort},
            store=False,
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": PROMPT},
                    source_part,
                ],
            }],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "quick_dxf_extraction",
                    "description": "Structured proposal of fabrication geometry and figured dimensions for human review.",
                    "strict": True,
                    "schema": SCHEMA,
                }
            },
        )

        extraction = json.loads(response.output_text)
        usage = response.usage
        result = {
            "input_file": args.drawing.as_posix(),
            "model": args.model,
            "reasoning_effort": args.effort,
            "response_id": response.id,
            "usage": {
                "input_tokens": getattr(usage, "input_tokens", None),
                "output_tokens": getattr(usage, "output_tokens", None),
                "total_tokens": getattr(usage, "total_tokens", None),
            },
            "estimated_cost_usd": estimate_cost(args.model, usage),
            "pricing_note": "Estimate uses OpenAI API token rates current on 2026-09-08; verify before commercial pricing.",
            "extraction": extraction,
        }

        args.output_dir.mkdir(parents=True, exist_ok=True)
        out = args.output_dir / f"{args.drawing.stem}-analysis.json"
        out.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result, indent=2))
        print(f"\nSaved {out}")
    finally:
        if uploaded_file is not None:
            try:
                client.files.delete(uploaded_file.id)
            except Exception as exc:
                print(f"Warning: could not delete temporary uploaded PDF: {exc}")


if __name__ == "__main__":
    main()
