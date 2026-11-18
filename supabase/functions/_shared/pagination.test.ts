import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllPages } from "./pagination.ts";

test("fetchAllPages combines every page until a short page", async () => {
  const source = Array.from({ length: 7 }, (_, i) => i + 1);
  const ranges: Array<[number, number]> = [];
  const result = await fetchAllPages(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  }, 3);
  assert.deepEqual(result, source);
  assert.deepEqual(ranges, [[0, 2], [3, 5], [6, 8]]);
});

test("fetchAllPages handles an empty result", async () => {
  const result = await fetchAllPages(async () => ({ data: [], error: null }), 10);
  assert.deepEqual(result, []);
});

test("fetchAllPages fails closed when any page errors", async () => {
  await assert.rejects(
    () => fetchAllPages(async from => ({
      data: from === 0 ? [1, 2] : null,
      error: from === 0 ? null : new Error("database unavailable"),
    }), 2),
    /complete result set/,
  );
});

test("fetchAllPages rejects unsafe page sizes", async () => {
  await assert.rejects(() => fetchAllPages(async () => ({ data: [], error: null }), 0), /pageSize/);
  await assert.rejects(() => fetchAllPages(async () => ({ data: [], error: null }), 1001), /pageSize/);
});
