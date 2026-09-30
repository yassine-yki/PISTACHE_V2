import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { appendWorkshopLayers, sanitizeLayerName } from "../src/dxf-workshop.js";

type ParserConstructor = new () => { parseSync(source: string): { entities: Array<{ type: string; layer?: string; shape?: boolean; vertices?: unknown[] }> } | null };
const DxfParser = createRequire(import.meta.url)("dxf-parser") as ParserConstructor;

const emptyDxf = [
  "0", "SECTION", "2", "HEADER", "0", "ENDSEC",
  "0", "SECTION", "2", "TABLES",
  "0", "TABLE", "2", "LAYER", "70", "1",
  "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
  "0", "ENDTAB", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF", "",
].join("\n");

test("creates an AutoCAD layer and a closed polyline for a delimited space", () => {
  const exported = appendWorkshopLayers(emptyDxf, [{
    id: "zone-1", level: "R+2", layer: "Carrelage 60/60",
    points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }],
  }]);

  const parsed = new DxfParser().parseSync(exported);
  assert.ok(parsed);
  const contour = parsed.entities.find(entity => entity.type === "LWPOLYLINE");
  assert.equal(contour?.layer, "Carrelage 60-60");
  assert.equal(contour?.shape, true);
  assert.equal(contour?.vertices?.length, 4);
  assert.match(exported, /0\r\nLAYER\r\n2\r\nCarrelage 60-60/);
});

test("sanitizes characters forbidden in AutoCAD layer names", () => {
  assert.equal(sanitizeLayerName("  Couloir / BOH:*  "), "Couloir - BOH--");
  assert.equal(sanitizeLayerName(""), "ZONE");
});
