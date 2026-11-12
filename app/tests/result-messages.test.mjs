import test from "node:test";
import assert from "node:assert/strict";
import { resultEnglish, resultMessages } from "../src/ui/resultMessages.ts";
const placeholders = (text) =>
  [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();
test("automatic lifecycle messages cover five translations with exact English placeholder parity", () => {
  assert.ok(Object.keys(resultMessages).length >= 165);
  for (const [key, translations] of Object.entries(resultMessages)) {
    assert.equal(translations.length, 5, key);
    for (const text of translations) {
      assert.equal(typeof text, "string", key);
      assert.ok(text.trim(), key);
      assert.deepEqual(
        placeholders(text),
        placeholders(resultEnglish[key] ?? key),
        key,
      );
    }
  }
  for (const key of [
    "REQUEST_UNKNOWN",
    "DETAIL_INTEGRITY_FAILED",
    "OUTPUT_INTEGRITY_FAILED",
    "UPGRADE_WAIT_FOR_UPLOAD",
    "QUALITY_UNAVAILABLE",
    "NO_VISIBLE_CONFLICT_NOTICED",
  ]) {
    assert.ok(resultEnglish[key]);
    assert.ok(resultMessages[key]);
  }
});
