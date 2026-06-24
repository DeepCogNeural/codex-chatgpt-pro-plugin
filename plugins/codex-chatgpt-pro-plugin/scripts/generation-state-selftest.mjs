import assert from "node:assert/strict";
import {
  activeGenerationLabels,
  isActiveGenerationLabel,
} from "../src/chatgpt-composer.mjs";

assert.equal(isActiveGenerationLabel("Stop generating"), true);
assert.equal(isActiveGenerationLabel("Stop answering"), true);
assert.equal(isActiveGenerationLabel("Interrupt"), true);
assert.equal(isActiveGenerationLabel("Pro thinking"), true);
assert.equal(isActiveGenerationLabel("Reading documents"), true);
assert.equal(isActiveGenerationLabel("Finalizing answer"), true);

assert.equal(isActiveGenerationLabel("Open conversation options for LP resize/cancel review"), false);
assert.equal(isActiveGenerationLabel("Cancel subscription analysis"), false);
assert.equal(isActiveGenerationLabel("Open project options for Polymarket LP"), false);

assert.deepEqual(
  activeGenerationLabels([
    "Open conversation options for LP resize/cancel review",
    "Open project options for Polymarket LP",
  ]),
  [],
);
assert.deepEqual(
  activeGenerationLabels([
    "Open conversation options for LP resize/cancel review",
    "Stop generating",
  ]),
  ["Stop generating"],
);

console.log(JSON.stringify({ ok: true, tested: "generation-state" }, null, 2));
