// tests/fe/bubble-time-beside-balloon.test.mjs — the time sits beside the
// balloon on every row, the meta line keeps only the name heading a run.
//
// Visibility is CSS (the fake DOM can't compute styles); these tests pin the
// DOM hooks it keys off:
//  - the meta line's time is wrapped in .msg-meta-time and the " · " in
//    .msg-sep, so CSS can hide both and leave the bare sender name;
//  - rows with no sender (my own) carry .no-sender, which drops the empty
//    meta line and the avatar's meta-line offset;
//  - every row, grouped or not, still has its .msg-stamp.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };
const CHANNELS = [
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 200, member: { msg_count: 200 } },
];
const USERS = { u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" } };

const T0 = 1728000000000;
const MIN = 60 * 1000;
const post = (id, uid, message, create_at) => ({ id, user_id: uid, channel_id: "c1", message, create_at });

async function bootWith(posts) {
  const w = await boot({ channels: CHANNELS, posts: { c1: posts }, users: USERS, me: ME });
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Community")), "click");
  await w.flush();
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Other")), "click");
  await w.flush();
  w.fire(w.qa(".channel-item").find((r) => r.textContent.includes("Town Square")), "click");
  await w.flush();
  return w;
}

const rowOf = (w, id) => w.q(`.msg-row[data-post-id="${id}"]`);

test("bubble time: meta time and separator are wrapped for CSS to hide", async () => {
  const w = await bootWith([post("p1", "u2", "hello", T0), post("p2", "u2", "again", T0 + MIN)]);
  const meta = w.q(".msg-meta", rowOf(w, "p1"));
  const time = w.q(".msg-meta-time", meta);
  ok(time && time.textContent.trim().length > 0, "meta time lives in .msg-meta-time");
  ok(w.q(".msg-sender .msg-sep", meta), "separator lives in .msg-sep inside the sender span");
  eq(w.q(".msg-sender", meta).textContent, "Anna Doe · ", "sender span text unchanged");
});

test("bubble time: every row, grouped or not, carries a stamp", async () => {
  const w = await bootWith([post("p1", "u2", "hello", T0), post("p2", "u2", "again", T0 + MIN)]);
  ok(!rowOf(w, "p1").classList.contains("grouped"), "p1 heads the run");
  ok(rowOf(w, "p2").classList.contains("grouped"), "p2 is grouped");
  for (const id of ["p1", "p2"]) {
    const stamp = w.q(".msg-stamp", rowOf(w, id));
    ok(stamp && stamp.textContent.trim().length > 0, `${id}: stamp shows the time`);
  }
});

test("bubble time: my rows are tagged no-sender, others' are not", async () => {
  const w = await bootWith([post("p1", "u2", "hello", T0), post("p2", "me1", "mine", T0 + MIN)]);
  ok(!rowOf(w, "p1").classList.contains("no-sender"), "other's row has a sender");
  ok(rowOf(w, "p2").classList.contains("no-sender"), "my row has no sender");
});
