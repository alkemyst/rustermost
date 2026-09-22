// tests/fe/9-dm-prefetch.test.mjs — issue #9: DM post caches warm at startup.
//
// After init loads the channel list, a background prefetch fires get_posts for
// the most-recent DMs (and groups) so the on-disk snapshot exists before the
// first click. Covers: which channels are warmed, the cap + recency pick, the
// user-wins rule (opening a channel must never duplicate a get_posts), silent
// failure, re-run safety across a second init, and the in-flight join when an
// open races its own prefetch.
//
// Harness note: the login flow polls capture_session on a real 2s setInterval;
// the harness has no controllable timers, so the re-login test fakes
// setInterval/clearInterval locally (and restores them in a finally).

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };

const dm = (id, partner, lastPostAt = 0) => ({
  id, name: `${partner}__me1`, display_name: "", type: "D", team_id: "",
  total_msg_count: 2, member: { msg_count: 0 }, // 2 unread → row in the pinned, unfolded Unread section
  ...(lastPostAt ? { last_post_at: lastPostAt } : {}),
});
const gm = (id) => ({
  id, name: id, display_name: "Some group", type: "G", team_id: "",
  total_msg_count: 2, member: { msg_count: 0 },
});
const pub = (id) => ({
  id, name: id, display_name: id, type: "O", team_id: "",
  total_msg_count: 2, member: { msg_count: 0 },
});

// A get_posts handler whose promises the test resolves by hand, to hold the
// prefetch in flight at exact moments. One deferred per channel — the tests
// themselves assert no channel is ever fetched twice.
function gatedPosts(gates) {
  return ({ channelId } = {}) => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    gates[channelId] = { resolve, reject };
    return promise;
  };
}

const postsFor = (w) => w.invoked("get_posts").map((c) => c.args.channelId);
const countFor = (w, id) => postsFor(w).filter((c) => c === id).length;

test("9: after init, DM and group caches warm in the background; community channels are not fetched", async () => {
  const w = await boot({ channels: [pub("pub1"), dm("dm1", "u1"), gm("gm1"), dm("dm2", "u2")], me: ME });
  await w.flush();

  const got = postsFor(w);
  ok(got.includes("dm1") && got.includes("dm2") && got.includes("gm1"), `DMs and groups warmed, got ${JSON.stringify(got)}`);
  ok(!got.includes("pub1"), "community channels are never prefetched");
  eq(got.length, 3, "exactly the personal conversations are warmed, once each");
});

test("9: prefetch is capped to the 10 most recently active DMs", async () => {
  const channels = [];
  for (let i = 1; i <= 12; i++) channels.push(dm("dm" + i, "u" + i, i * 1000)); // dm12 freshest, dm1 coldest
  const w = await boot({ channels, me: ME });
  await w.flush();

  const got = postsFor(w);
  eq(got.length, 10, "only 10 of 12 DMs warmed");
  ok(!got.includes("dm1") && !got.includes("dm2"), "the two coldest conversations are skipped");
});

test("9: opening a queued channel wins — prefetch skips it, one get_posts total", async () => {
  const gates = {};
  const w = await boot({ handlers: { get_posts: gatedPosts(gates) }, channels: [dm("dm1", "u1"), dm("dm2", "u2"), dm("dm3", "u3")], me: ME });
  await w.flush();
  ok(gates.dm1 && gates.dm2 && !gates.dm3, "two workers busy with dm1+dm2, dm3 still queued");

  // All three are unread → rows sit in the pinned Unread section in list order.
  const rows = w.qa(".channel-item");
  eq(rows.length, 3, "three unread rows rendered");
  w.fire(rows[2], "click"); // open dm3 while it is still queued
  await w.flush();

  ok(gates.dm3, "opening dm3 fired its own fetch immediately");
  eq(countFor(w, "dm3"), 1, "exactly one fetch for dm3 so far");

  gates.dm1.resolve([]); // free worker 1 → it reaches dm3, must skip it (in flight)
  await w.flush();
  gates.dm2.resolve([]); // free worker 2 → same skip
  await w.flush();
  eq(countFor(w, "dm3"), 1, "still one fetch after the workers drained past dm3");

  gates.dm3.resolve([]); // the user's own fetch paints, prefetch stays silent
  await w.flush();
  eq(w.el("messages").textContent, "No messages yet.", "open channel settled on its own fetch");
  eq(w.invoked("get_posts").length, 3, "each DM fetched exactly once overall");
});

test("9: opening a channel whose prefetch is in flight joins it instead of duplicating", async () => {
  const gates = {};
  const w = await boot({ handlers: { get_posts: gatedPosts(gates) }, channels: [dm("dm1", "u1"), dm("dm2", "u2")], me: ME });
  await w.flush();
  ok(gates.dm1, "dm1 prefetch in flight");

  w.fire(w.qa(".channel-item")[0], "click"); // dm1 row
  await w.flush();
  eq(countFor(w, "dm1"), 1, "no duplicate fetch — the open joined the prefetch");
  eq(w.el("messages").textContent, "Loading messages…", "still loading while the shared fetch pends");

  gates.dm1.resolve([{ id: "p1", user_id: "u1", channel_id: "dm1", message: "hi from the shared fetch", create_at: 1728000000000 }]);
  gates.dm2.resolve([]);
  await w.flush();
  ok(w.el("messages").textContent.includes("hi from the shared fetch"), "open painted from the shared fetch's result");
  eq(countFor(w, "dm1"), 1, "one get_posts did both the warm and the paint");
});

test("9: a failing warm is invisible and doesn't poison the pool", async () => {
  // Node fails the whole run on an unhandled rejection, so this test staying
  // green at all already proves prefetch swallowed the error.
  const w = await boot({
    handlers: {
      get_posts: async ({ channelId } = {}) => {
        if (channelId === "dm1") throw new Error("offline");
        if (channelId === "dm2") return [{ id: "p1", user_id: "u2", channel_id: "dm2", message: "second channel still warmed", create_at: 1728000000000 }];
        return [];
      },
    },
    channels: [dm("dm1", "u1"), dm("dm2", "u2")],
    me: ME,
  });
  await w.flush();

  eq(countFor(w, "dm1"), 1, "the failing channel was attempted once");
  eq(countFor(w, "dm2"), 1, "the failure did not abort the rest of the pool");

  // The app stays fully usable: dm2 opens and paints normally.
  const rows = w.qa(".channel-item");
  w.fire(rows[1], "click");
  await w.flush();
  ok(w.el("messages").textContent.includes("second channel still warmed"), "opening the warmed channel works");

  // And the never-warmed dm1 degrades to its normal error pane, not a crash.
  w.fire(rows[0], "click");
  await w.flush();
  eq(w.el("messages").textContent, "Failed to load messages.", "opening the failed channel shows its usual error");
});

test("9: a second init (re-login) re-renders but never double-prefetches", async () => {
  const w = await boot({
    handlers: { open_sso_window: async () => undefined, capture_session: async () => undefined },
    channels: [dm("dm1", "u1"), dm("dm2", "u2")],
    me: ME,
  });
  await w.flush();
  eq(w.invoked("get_posts").length, 2, "both DMs warmed once by the first init");

  // Fake the login poll's 2s interval so the re-login runs right now.
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  let poll = null;
  globalThis.setInterval = (fn) => { poll = fn; return 1; };
  globalThis.clearInterval = () => {};
  try {
    w.el("url-input").value = "https://mm.example.org";
    w.fire("url-form", "submit");
    await w.flush();
    ok(poll, "login poll was scheduled");
    await poll(); // capture_session resolves → init() runs a second time
    await w.flush();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }

  eq(w.invoked("fetch_all_channels_with_members").length, 2, "the second init really re-loaded the channels");
  eq(w.invoked("get_posts").length, 2, "…but queued no duplicate warm");
});
