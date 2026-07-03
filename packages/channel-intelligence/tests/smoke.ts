import assert from "node:assert/strict";
import { join } from "node:path";
import { ingestGoogleAdsFile, enrichRecord, buildPoolName } from "../src/index.js";

const fixture = join(process.cwd(), "test-data/map-international/campaigns.csv");
const records = ingestGoogleAdsFile(fixture, "map-international");

assert.ok(records.length > 0, "expected campaigns fixture to produce records");
assert.equal(records[0]?.clientId, "map-international");
assert.equal(records[0]?.channel, "google-ads");

const enriched = enrichRecord(records[0]!);
assert.ok(enriched.content.length > 0, "expected enriched memory content");
assert.ok(enriched.tags.includes("client:map-international"), "expected client tag");
assert.equal(buildPoolName("map-international", "google-ads"), "pool:map-international:google-ads");

console.log(`channel-intelligence smoke OK (${records.length} records)`);
