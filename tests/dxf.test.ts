import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { cleanDxfText, findRoomNumbers, roomNumberFromText, type DxfRoomText } from "../src/dxf-identification.js";

type ParserConstructor = new () => { parseSync(source: string): { entities: unknown[] } | null };
const DxfParser = createRequire(import.meta.url)("dxf-parser") as ParserConstructor;

test("reads chamber labels on the required DXF layer", () => {
  assert.equal(roomNumberFromText("CHAMBRE 214"), 214);
  assert.equal(roomNumberFromText("CHAMBRE 240\\PSTANDARD"), 240);
  assert.equal(roomNumberFromText("LOGGIA 214"), null);
  assert.equal(cleanDxfText("CHAMBRE 214\\P SUITE EXECUTIVE"), "CHAMBRE 214 SUITE EXECUTIVE");
  assert.deepEqual(findRoomNumbers([
    { layer: "A-AREA-IDEN", type: "MTEXT", text: "CHAMBRE 214" },
    { layer: "LOGGIA", type: "TEXT", text: "CHAMBRE 215" },
  ]), [214]);
});

const dxfPath = process.env.R2_DXF || join(homedir(), "Documents", "a2.dxf");
test("finds all 40 R+2 rooms in the real DXF", { skip: !existsSync(dxfPath) }, () => {
  const dxf = new DxfParser().parseSync(readFileSync(dxfPath, "utf8"));
  assert.ok(dxf);
  const numbers = findRoomNumbers(dxf.entities as unknown as DxfRoomText[]);
  assert.deepEqual(numbers, Array.from({ length: 40 }, (_, index) => 201 + index));
});
