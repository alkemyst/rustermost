// tests/fe/16-message-grouping.test.mjs — issue #16: more compact messages.
//
// Consecutive messages from the same author collapse into a group
// (WhatsApp/Mattermost-style) — no time window ("mai ripetere nome e icona"),
// same author + consecutive is all it takes. The follow-up bubbles carry
// .grouped, which hides the repeated avatar (visibility — the gutter and the
// text's flush edge stay) and the sender name, and packs the run tighter.
// These tests cover every render path the grouping must survive: the full
// repaint (including the users-resolved second paint), live mm-post appends,
// the loadOlder prepend (both directions of the boundary pairing), my own
// messages, and the compact density.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };
const CHANNELS = [
  // fully read, deliberately: an unread channel would pin a "New messages"
  // divider (#11) before the latest posts, which is a legitimate group
  // breaker — the grouping tests stay decoupled from it this way.
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 200, member: { msg_count: 200 } },
];
const USERS = {
  u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" },
  u3: { id: "u3", username: "bob", first_name: "Bob", last_name: "Ray" },
};

const T0 = 1728000000000;
const MIN = 60 * 1000;
const post = (id, uid, message, create_at) => ({ id, user_id: uid, channel_id: "c1", message, create_at });

async function openC1(w) {
  // A fully-read channel sits under Community → Other; unfold both levels.
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Community")), "click");
  await w.flush();
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Other")), "click");
  await w.flush();
  const row = w.qa(".channel-item").find((r) => r.textContent.includes("Town Square"));
  ok(row, "Town Square row rendered after unfolding Community → Other");
  w.fire(row, "click");
  await w.flush();
}

async function bootWith(posts, handlers = {}) {
  const w = await boot({ handlers, channels: CHANNELS, posts: { c1: posts }, users: USERS, me: ME });
  await openC1(w);
  return w;
}

const rowOf = (w, id) => w.q(`.msg-row[data-post-id="${id}"]`);
const isGrouped = (w, id) => rowOf(w, id).classList.contains("grouped");

test("16: consecutive same-author messages group regardless of the gap; a different author breaks the run", async () => {
  // Was: "…or a >5min gap breaks it" — the 5-minute window is gone (user
  // feedback: name and avatar must never repeat while the same person keeps
  // the floor), so the long-gap cases now assert GROUPING, not breaking.
  const w = await bootWith([
    post("p1", "u2", "first", T0),
    post("p2", "u2", "second, 1 min later", T0 + 1 * MIN),
    post("p3", "u2", "third, 40 min later — far past the old 5 min window", T0 + 41 * MIN),
    post("p4", "u3", "bob jumps in", T0 + 42 * MIN),
    post("p5", "u3", "bob again", T0 + 43 * MIN),
    post("p6", "u3", "bob hours later, same author again", T0 + 5 * 60 * MIN),
  ]);

  ok(!isGrouped(w, "p1"), "run leader shows the full header");
  ok(isGrouped(w, "p2"), "same author 1 min later groups");
  ok(isGrouped(w, "p3"), "a 40 min gap still groups — no time window anymore");
  ok(!isGrouped(w, "p4"), "a different author breaks the run");
  ok(isGrouped(w, "p5"), "bob's follow-up groups with bob's first");
  ok(isGrouped(w, "p6"), "even hours later the same author keeps grouping");

  // The header is only *visually* collapsed: gutter + small timestamp remain.
  for (const id of ["p1", "p2", "p3"]) {
    const row = rowOf(w, id);
    ok(w.q(".msg-avatar", row), `${id}: avatar node kept (gutter stays aligned)`);
    const meta = w.q(".msg-meta", row);
    ok(meta, `${id}: meta line still rendered`);
    ok(meta.textContent.trim().length > 0, `${id}: timestamp still visible on the meta line`);
    ok(w.q(".msg-sender", row), `${id}: sender lives in its own span, hidden by CSS when grouped`);
  }
  eq(w.q(".msg-sender", rowOf(w, "p1")).textContent, "Anna Doe · ", "ungrouped meta keeps 'sender · time'");
  ok(rowOf(w, "p2").dataset.author === "u2" && rowOf(w, "p2").dataset.ts, "grouping metadata stamped on the row");
});

test("16: grouping survives the resolveUsers repaint, and my own runs group too", async () => {
  // Users resolve asynchronously (get_users_by_ids in openChannel), then
  // renderMessages repaints. The grouped classes must be identical after
  // that second paint — the flush in bootWith lands us past it, so assert
  // the steady state here.
  const w = await bootWith([
    post("p1", "me1", "mine one", T0),
    post("p2", "me1", "mine two", T0 + 30 * 1000),
  ]);

  ok(!isGrouped(w, "p1"), "first of my run ungrouped");
  ok(isGrouped(w, "p2"), "my follow-up groups like anybody's");
  ok(rowOf(w, "p1").classList.contains("mine") && rowOf(w, "p2").classList.contains("mine"), "both carry .mine");
});

test("16: a live mm-post from the last author appends grouped; another author restarts", async () => {
  // With no time window, a live bubble (ts: Date.now()) groups onto ANY
  // same-author history post — these are deliberately days old (fixed T0).
  // bob appears once in the history so openChannel's resolveUsers learns his
  // id — a live sender we've never resolved intentionally never groups (one
  // header too many beats one too few).
  const w = await bootWith([
    post("p0", "u3", "bob was here earlier", T0),
    post("p1", "u2", "anna, also old history", T0 + 1 * MIN),
  ]);

  w.emitEvent("mm-post", { id: "live1", channel_id: "c1", sender: "anna", message: "anna live 1" });
  await w.flush();
  ok(isGrouped(w, "live1"), "live follow-up from anna joins anna's group");

  w.emitEvent("mm-post", { id: "live2", channel_id: "c1", sender: "anna", message: "anna live 2" });
  await w.flush();
  ok(isGrouped(w, "live2"), "the live run continues");

  w.emitEvent("mm-post", { id: "live3", channel_id: "c1", sender: "bob", message: "bob live" });
  await w.flush();
  ok(!isGrouped(w, "live3"), "bob restarts the run with a full header");

  w.emitEvent("mm-post", { id: "live4", channel_id: "c1", sender: "bob", message: "bob live 2" });
  await w.flush();
  ok(isGrouped(w, "live4"), "and bob's own follow-up groups again");
});

test("16: a live message from a never-resolved sender falls back to a full header", async () => {
  const w = await bootWith([post("p1", "u2", "just now", Date.now() - 30 * 1000)]);

  w.emitEvent("mm-post", { id: "live1", channel_id: "c1", sender: "carol", message: "stranger 1" });
  await w.flush();
  ok(!isGrouped(w, "live1"), "unknown sender starts ungrouped");

  w.emitEvent("mm-post", { id: "live2", channel_id: "c1", sender: "carol", message: "stranger 2" });
  await w.flush();
  // Unresolved live senders carry no uid, so the pair can't be told apart
  // from anybody else — safety rule: show one header too many.
  ok(!isGrouped(w, "live2"), "unknown senders never group");
});

test("16: loadOlder groups within the new page and regroups the boundary bubble", async () => {
  // A full first page (PAGE_SIZE = 30) leaves pageMore open; the older page
  // ends with the same author as the current page's first bubble — the
  // boundary bubble must flip to grouped on prepend.
  const latest = [post("f1", "u2", "first of the latest page", T0)];
  for (let i = 2; i <= 30; i++) latest.push(post("f" + i, "u3", "noise " + i, T0 + (i - 1) * MIN));
  const older = [post("o1", "u2", "older one", T0 - 2 * MIN), post("o2", "u2", "older two", T0 - 1 * MIN)];
  const w = await bootWith(latest, {
    get_posts: async ({ before }) => (before ? older : latest),
  });

  ok(!isGrouped(w, "f1"), "page-top bubble starts ungrouped (nothing above it)");
  ok(isGrouped(w, "f3"), "the same-author noise within the page groups");

  w.fire("messages", "scroll"); // scrollTop 0 < 80 → loadOlder()
  await w.flush();

  ok(rowOf(w, "o1"), "older page prepended");
  ok(!isGrouped(w, "o1"), "top of the older page has nothing above it");
  ok(isGrouped(w, "o2"), "same-author run inside the prepended page groups");
  ok(isGrouped(w, "f1"), "boundary: f1 continues the prepended page's last bubble");
  ok(!isGrouped(w, "f2"), "author change right after the boundary still breaks the run");
});

test("16: a different author at the prepend boundary leaves the first bubble ungrouped", async () => {
  const latest = [post("f1", "u2", "first of the latest page", T0)];
  for (let i = 2; i <= 30; i++) latest.push(post("g" + i, "u2", "noise " + i, T0 + (i - 1) * MIN));
  const older = [post("o1", "u3", "older one", T0 - 2 * MIN), post("o2", "u3", "older two", T0 - 1 * MIN)];
  const w = await bootWith(latest, {
    get_posts: async ({ before }) => (before ? older : latest),
  });

  w.fire("messages", "scroll");
  await w.flush();

  ok(isGrouped(w, "o2"), "boundary page still groups internally");
  ok(!isGrouped(w, "f1"), "author differs across the boundary → full header stays");
});

test("16: a late avatar fill paints only avatar nodes, never the row", async () => {
  // Rows carry grouping metadata as data-attributes; an avatar image arriving
  // after the render paints every [data-uid] node (see ensureAvatar) with
  // paintAvatar, which clears textContent — if the row ever matched that
  // selector its whole bubble would be wiped.
  const AVA = "data:image/png;base64,iVBORw0KGgo=";
  const w = await bootWith([post("p1", "u2", "hello", T0)], {
    get_avatar: async () => AVA,
  });

  const row = rowOf(w, "p1");
  ok((w.q(".msg-avatar", row).style.backgroundImage || "").includes("base64"), "avatar image painted into the avatar node");
  ok(!row.style.backgroundImage, "the row itself is never painted");
  ok(row.textContent.includes("hello"), "bubble content intact after the avatar fill");
});

test("16: grouping holds in compact density too", async () => {
  // Flip the density setting through the settings modal's segmented control.
  const w = await bootWith([
    post("p1", "u2", "first", T0),
    post("p2", "u2", "second", T0 + 1 * MIN),
  ]);
  w.fire("settings-btn", "click");
  await w.flush();
  const seg = w.q('.option-seg[data-setting="density"] .seg-btn[data-value="compact"]');
  ok(seg, "compact density segment rendered");
  w.fire(seg, "click");
  await w.flush();
  eq(w.document.documentElement.dataset.density, "compact", "compact density applied to <html>");

  // Re-open the channel for a full repaint under the new density (the
  // sections stay unfolded from the first open — re-unfolding would fold).
  const row = w.qa(".channel-item").find((r) => r.textContent.includes("Town Square"));
  w.fire(row, "click");
  await w.flush();
  ok(!isGrouped(w, "p1"), "run leader ungrouped under compact");
  ok(isGrouped(w, "p2"), "follow-up still groups under compact");
  ok(w.q(".msg-avatar", rowOf(w, "p2")), "gutter node still rendered under compact");
});
