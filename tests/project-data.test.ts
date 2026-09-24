import test from "node:test";
import assert from "node:assert/strict";
import { R2_BLOCKS, R2_ROOMS } from "../src/project-data.js";

test("R+2 room definitions match the workbook", () => {
  assert.equal(R2_ROOMS.length, 40);
  assert.deepEqual(R2_BLOCKS, ["A", "B", "C"]);
  assert.equal(R2_ROOMS.filter((room) => room.blockId === "A").length, 16);
  assert.equal(R2_ROOMS.filter((room) => room.blockId === "B").length, 12);
  assert.equal(R2_ROOMS.filter((room) => room.blockId === "C").length, 12);
  assert.equal(R2_ROOMS.filter((room) => room.roomType === "junior").length, 8);
  assert.equal(R2_ROOMS.filter((room) => room.roomType === "executive").length, 1);
  assert.equal(R2_ROOMS.find((room) => room.number === 214)?.blockId, "B");
});
