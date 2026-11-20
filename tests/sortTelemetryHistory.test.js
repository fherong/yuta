import assert from "node:assert/strict";
import test from "node:test";

import { sortTelemetryHistoryNewestFirst } from "../src/utils/sortTelemetryHistory.js";

test("sorts by test timestamp descending instead of Firebase object order", () => {
  const records = [
    { id: "older-key", timestamp: "2026-11-19T23:59:00Z" },
    { id: "newer-key", timestamp: "2026-11-20T10:00:00Z" },
  ];

  assert.deepEqual(
    sortTelemetryHistoryNewestFirst(records).map((record) => record.id),
    ["newer-key", "older-key"]
  );
  assert.equal(records[0].id, "older-key");
});

test("places records without valid dates after dated records", () => {
  const records = [
    { id: "z-id" },
    { id: "a-id", timestamp: "invalid" },
    { id: "dated", timestamp: "2026-11-20T10:00:00Z" },
  ];

  assert.deepEqual(
    sortTelemetryHistoryNewestFirst(records).map((record) => record.id),
    ["dated", "z-id", "a-id"]
  );
});
