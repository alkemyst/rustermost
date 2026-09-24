// tests/fe/16-grouped-spacing.test.mjs — issue #16, follow-up: tighter runs
// and the top-aligned avatar.
//
// The spacing/alignment itself is CSS (the fake DOM can't measure layout);
// these tests pin the DOM structure that CSS keys off:
//  - every bubble carries a .msg-stamp node (time, then "edited" when apt)
//    next to the regular .msg-meta line, so the .grouped flip never needs a
//    DOM rebuild — including the loadOlder boundary retagging;
//  - the stamp is a direct child of .msg (the positioned column the CSS
//    anchors it to), a sibling of — never inside — .msg-body;
//  - an empty reactions strip is tagged with-pills=false so grouped CSS can
//    dock the hover "+" beside the bubble instead of stretching the run;
//  - edited markers land in both time reads (meta line and corner stamp).

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };
const CHANNELS = [
  // fully read — keeps the #11 unread divider out of these grouping tests
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 200, member: { msg_count: 200 } },
];
const USERS = { u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" } };

const T0 = 1728000000000;
const MIN = 60 * 1000;
const post = (id, uid, message, create_at, extra = {}) => ({ id, user_id: uid, channel_id: "c1", message, create_at, ...extra });

async function bootWith(posts, handlers = {}) {
  const w = await boot({ handlers, channels: CHANNELS, posts: { c1: posts }, users: USERS, me: ME });
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Community")), "click");
  await w.flush();
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Other")), "click");
  await w.flush();
  w.fire(w.qa(".channel-item").find((r) => r.textContent.includes("Town Square")), "click");
  await w.flush();
  return w;
}

const rowOf = (w, id) => w.q(`.msg-row[data-post-id="${id}"]`);
const stampOf = (w, id) => w.q(".msg-stamp", rowOf(w, id));
const metaOf = (w, id) => w.q(".msg-meta", rowOf(w, id));

test("16: every bubble carries a corner stamp mirroring the meta time", async () => {
  const w = await bootWith([
    post("p1", "u2", "first", T0),
    post("p2", "u2", "second", T0 + 1 * MIN),
    post("p3", "me1", "mine, breaking the run", T0 + 2 * MIN),
    post("p4", "me1", "mine grouped", T0 + 3 * MIN),
  ]);

  for (const id of ["p1", "p2", "p3", "p4"]) {
    const stamp = stampOf(w, id);
    ok(stamp, `${id}: stamp node rendered into the bubble`);
    ok(stamp.textContent.trim().length > 0, `${id}: stamp shows the time`);
    // The stamp is the meta line's clock, relocated: same time text in both.
    ok(metaOf(w, id).textContent.includes(stamp.textContent), `${id}: stamp time == meta time`);
    ok(!stamp.querySelector(".msg-sender"), `${id}: the stamp never carries the sender name`);
  }
  // Smart format (#16 follow-up): T0 is inherently "another day" relative to
  // the real now, so BOTH time reads must carry the short date — one helper
  // (formatTime) feeds meta and stamp, they can never disagree.
  const day = new Date(T0).toLocaleDateString([], { day: "2-digit", month: "2-digit" });
  const clock = new Date(T0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ok(stampOf(w, "p1").textContent.includes(day) && stampOf(w, "p1").textContent.includes(clock),
    "old stamp reads 'date time'");
  ok(metaOf(w, "p1").textContent.includes(day) && metaOf(w, "p1").textContent.includes(clock),
    "old meta reads 'date time' too");
  // The stamp lives in the .msg column as a sibling, NOT inside .msg-body —
  // markdown/table renderings keep their body child structure untouched.
  const body = w.q(".msg-body", rowOf(w, "p2"));
  ok(!w.q(".msg-stamp", body), "stamp is not a body child");
  eq(body.closest(".msg"), stampOf(w, "p2").parentNode, "stamp and body share the same .msg parent");
  // Mirroring (#16): my grouped row keeps the .mine/.msg-me structure the CSS
  // flips the stamp corner with.
  ok(rowOf(w, "p4").classList.contains("mine") && rowOf(w, "p4").classList.contains("grouped"), "p4: mine + grouped");
  ok(w.q(".msg-me .msg-stamp", rowOf(w, "p4")), "p4: stamp inside the .msg-me column");
});

test("16: the loadOlder boundary flip needs no DOM rebuild — header and stamp survive", async () => {
  // Same page-partitioning trick as 16-message-grouping: f1 starts ungrouped,
  // then the prepended page's last post groups it. The retag is a bare
  // classList.toggle, so every node the grouped CSS hides/shows must already
  // be on the row — meta line, sender span AND the corner stamp.
  const latest = [post("f1", "u2", "first of the latest page", T0)];
  for (let i = 2; i <= 30; i++) latest.push(post("f" + i, "me1", "noise " + i, T0 + (i - 1) * MIN));
  const older = [post("o1", "u2", "older one", T0 - 2 * MIN), post("o2", "u2", "older two", T0 - 1 * MIN)];
  const w = await bootWith(latest, { get_posts: async ({ before }) => (before ? older : latest) });

  ok(!rowOf(w, "f1").classList.contains("grouped"), "f1 starts ungrouped");
  const metaBefore = metaOf(w, "f1").childNodes.length;

  w.fire("messages", "scroll");
  await w.flush();

  ok(rowOf(w, "f1").classList.contains("grouped"), "f1 flipped to grouped by the boundary fix-up");
  const meta = metaOf(w, "f1");
  ok(meta, "meta line still in the DOM after the flip");
  eq(meta.childNodes.length, metaBefore, "flipping did not rebuild the meta line");
  ok(w.q(".msg-sender", meta), "sender span intact (grouped CSS hides it)");
  const stamp = stampOf(w, "f1");
  ok(stamp && stamp.textContent.trim().length > 0, "corner stamp intact and showing the time");
  ok(meta.textContent.includes(stamp.textContent), "stamp mirrors the same time");
});

test("16: empty reactions strips are told apart (with-pills) so grouped runs pack tight", async () => {
  const w = await bootWith([
    post("p1", "u2", "answer me", T0),
    post("p2", "u2", "second balloon", T0 + 1 * MIN),
  ]);

  const strip = w.q('.reactions[data-post-id="p2"]');
  ok(strip, "reactions strip rendered on the grouped row");
  ok(!strip.classList.contains("with-pills"), "no pills yet → strip tagged empty for the CSS dock");
  ok(w.q(".reaction-add", strip), "hover '+' still rendered");

  // A live reaction lands on the grouped bubble: the strip gains pills and
  // with-pills, so it drops back into the flow below the bubble.
  w.emitEvent("mm-reaction-added", { post_id: "p2", emoji_name: "tada", user_id: "me1" });
  await w.flush();
  ok(strip.classList.contains("with-pills"), "pilled strip tagged with-pills (in-flow below the bubble)");
  eq(w.qa(".reaction-pill", strip).length, 1, "the pill rendered");

  // Removing it again clears the tag → the grouped row packs tight once more.
  w.emitEvent("mm-reaction-removed", { post_id: "p2", emoji_name: "tada", user_id: "me1" });
  await w.flush();
  ok(!strip.classList.contains("with-pills"), "back to an empty, docked strip");

  // The ungrouped run leader follows the same rule (the class is universal;
  // only grouped CSS docks the "+").
  ok(!w.q('.reactions[data-post-id="p1"]').classList.contains("with-pills"), "leader's empty strip untagged");
});

test("16: edited grouped bubbles mark both time reads — history and live", async () => {
  const w = await bootWith([
    post("p1", "u2", "first", T0),
    post("p2", "u2", "changed my mind", T0 + 1 * MIN, { edit_at: T0 + 90 * 1000 }),
    post("p3", "u2", "virgin", T0 + 2 * MIN),
  ], { edit_message: async () => undefined });

  // History-seeded edit on a grouped bubble: stamp leads with the marker.
  ok(rowOf(w, "p2").classList.contains("grouped"), "p2 grouped");
  ok(w.q(".msg-stamp .msg-edited", rowOf(w, "p2")), "grouped stamp shows the edited marker");
  ok(w.q(".msg-meta .msg-edited", rowOf(w, "p2")), "meta keeps its marker too");
  ok(!w.q(".msg-stamp .msg-edited", rowOf(w, "p3")), "unedited grouped row: no marker in the stamp");

  // Live edit on the grouped p3: the marker must appear in the stamp as well,
  // else the visible corner read would silently lose the "edited" info.
  w.emitEvent("mm-post-edited", { id: "p3", channel_id: "c1", message: "virgin no more", edit_at: T0 + 150 * 1000 });
  await w.flush();
  ok(rowOf(w, "p3").classList.contains("grouped"), "p3 still grouped after the in-place edit");
  ok(w.q(".msg-stamp .msg-edited", rowOf(w, "p3")), "live edit marked the corner stamp");
  ok(w.q(".msg-meta .msg-edited", rowOf(w, "p3")), "live edit marked the meta line too");
  ok(stampOf(w, "p3").textContent.includes("edited"), "stamp reads 'edited · time'");
});

test("16: live grouped appends arrive with the stamp already on board", async () => {
  const w = await bootWith([post("p1", "u2", "just now", Date.now() - 30 * 1000)]);

  w.emitEvent("mm-post", { id: "live1", channel_id: "c1", sender: "anna", message: "same author live" });
  await w.flush();
  ok(rowOf(w, "live1").classList.contains("grouped"), "live follow-up grouped");
  const stamp = stampOf(w, "live1");
  ok(stamp && stamp.textContent.trim().length > 0, "live bubble carries a populated stamp");
  ok(metaOf(w, "live1").textContent.includes(stamp.textContent), "stamp mirrors the meta time");
});

test("16: same-day messages read time only, in both time reads", async () => {
  // The smart format (#16 follow-up) cuts both ways: old posts earn a date
  // (asserted above via the fixed T0 posts), today's stay a bare clock.
  const ts = Date.now() - 60 * 1000;
  const w = await bootWith([post("t1", "u2", "today", ts)]);

  const expected = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  eq(metaOf(w, "t1").textContent.trim(), expected, "meta is the bare clock, no date prefix");
  eq(stampOf(w, "t1").textContent.trim(), expected, "stamp is the bare clock too");
});
