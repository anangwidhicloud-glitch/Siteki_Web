import test from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_EVENTS } from "../worker/lib/push.js";

test("notifikasi operasional hanya memakai enam kejadian yang disetujui",()=>{
  assert.deepEqual(NOTIFICATION_EVENTS.map(event=>event.key),[
    "order_new","order_close","bon_new","bon_close","report_new","kvar_check",
  ]);
  assert.equal(new Set(NOTIFICATION_EVENTS.map(event=>event.key)).size,6);
});
