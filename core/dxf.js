/**
 * Minimal DXF writer for closed 2D fabrication polylines.
 * Coordinates are expected in millimetres.
 */

function cleanNumber(value) {
  if (!Number.isFinite(value)) throw new Error("DXF coordinate is not finite");
  return Number(value.toFixed(4));
}

function pair(code, value) {
  return `${code}\n${value}\n`;
}

export function buildCutDxf(polylines, { layer = "CUT" } = {}) {
  if (!Array.isArray(polylines) || polylines.length === 0) {
    throw new Error("At least one cut polyline is required");
  }

  let dxf = "";
  dxf += pair(0, "SECTION");
  dxf += pair(2, "HEADER");
  dxf += pair(9, "$ACADVER");
  dxf += pair(1, "AC1015");
  dxf += pair(9, "$INSUNITS");
  dxf += pair(70, 4);
  dxf += pair(0, "ENDSEC");
  dxf += pair(0, "SECTION");
  dxf += pair(2, "TABLES");
  dxf += pair(0, "TABLE");
  dxf += pair(2, "LAYER");
  dxf += pair(70, 1);
  dxf += pair(0, "LAYER");
  dxf += pair(2, layer);
  dxf += pair(70, 0);
  dxf += pair(62, 7);
  dxf += pair(6, "CONTINUOUS");
  dxf += pair(0, "ENDTAB");
  dxf += pair(0, "ENDSEC");
  dxf += pair(0, "SECTION");
  dxf += pair(2, "ENTITIES");

  for (const polyline of polylines) {
    if (!Array.isArray(polyline) || polyline.length < 3) {
      throw new Error("Every cut shape must contain at least three vertices");
    }
    dxf += pair(0, "LWPOLYLINE");
    dxf += pair(100, "AcDbEntity");
    dxf += pair(8, layer);
    dxf += pair(100, "AcDbPolyline");
    dxf += pair(90, polyline.length);
    dxf += pair(70, 1);
    for (const point of polyline) {
      dxf += pair(10, cleanNumber(point.x));
      dxf += pair(20, cleanNumber(point.y));
    }
  }

  dxf += pair(0, "ENDSEC");
  dxf += pair(0, "EOF");
  return dxf;
}

export function downloadTextFile(text, filename, mime = "application/dxf") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
