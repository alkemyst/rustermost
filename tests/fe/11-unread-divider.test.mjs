// tests/fe/11-unread-divider.test.mjs — issue #11: unread messages not
// clearly defined in the conversation.
//
// Opening a channel with unread messages renders a WhatsApp-style divider
// (full-width hairline + centered "New messages" pill) right before the first
// unread post. The count is captured in openChannel before markViewed wipes
// the badge, so the divider survives the resolveUsers repaint; it's anchored
// at the bottom end, so loadOlder prepends don't shift it; and it disappears
// the moment the channel is read / another channel is opened.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };
const USERS = {
  u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" },
  u3: { id: "u3", username: "bob", first_name: "Bob", last_name: "Ray" },
};

const T0 = 1728000000000;
const MIN = 60 * 1000;
// Alternating authors, 10 min apart: nothing ever groups (#16 orthogonality).
const post = (id, uid, create_at) => ({ id, user_id: uid, channel_id: id.startsWith("b") ? "c2" : "c1", message: "msg " + id, create_at });
const posts = (ids, t0 = T0) => ids.map((id, i) => post(id, i % 2 ? "u3" : "u2", t0 + i * 10 * MIN));

// The message list's children, flattened to a readable shape: "DIV" for the
// unread divider, otherwise the post id (or a tag marker for placeholders).
// Returned as a joined string so harness eq() (Object.is) can compare it.
function flow(w) {
  return w.el("messages").children
    .map((el) => (el.classList.contains("unread-divider") ? "DIV" : el.dataset.postId || el.className))
    .join(" ");
}

async function openChannel(w, needle) {
  const row = w.qa(".channel-item").find((r) => r.textContent.includes(needle));
  ok(row, `${needle} row rendered`);
  w.fire(row, "click");
  await w.flush();
}

test("11: opening a channel with 2 unread draws the divider before the first unread post", async () => {
  const w = await boot({
    channels: [
      { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 5, member: { msg_count: 3 } },
    ],
    posts: { c1: posts(["p1", "p2", "p3", "p4"]) },
    users: USERS,
    me: ME,
  });
  await openChannel(w, "Town Square");

  eq(flow(w), "p1 p2 DIV p3 p4", "4 loaded posts, last 2 unread → divider before the (N−2)-th");
  const divider = w.q(".unread-divider");
  ok(divider, "divider element rendered");
  ok(divider.scrolledIntoView, "view lands on the unread boundary, not the bottom");
  const pill = w.q(".unread-pill", divider);
  ok(pill, "centered pill inside the divider");
  eq(pill.textContent, "New messages", "pill label");

  // The resolveUsers-triggered second renderMessages must not lose it.
  await w.flush();
  eq(flow(w), "p1 p2 DIV p3 p4", "divider survives the users-resolved repaint");
});

test("11: no unread → no divider", async () => {
  const w = await boot({
    channels: [
      { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 2, member: { msg_count: 2 } },
    ],
    posts: { c1: posts(["p1", "p2"]) },
    users: USERS,
    me: ME,
  });
  // Fully read: unfold Community → Other to reach the row.
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Community")), "click");
  await w.flush();
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Other")), "click");
  await w.flush();
  await openChannel(w, "Town Square");

  eq(flow(w), "p1 p2", "read channel renders plain");
  ok(!w.q(".unread-divider"), "no divider element");
});

test("11: more unread than loaded posts clamps the divider to the very top", async () => {
  const w = await boot({
    channels: [
      { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 10, member: { msg_count: 0 } },
    ],
    posts: { c1: posts(["p1", "p2", "p3"]) }, // 10 unread, only 3 loaded
    users: USERS,
    me: ME,
  });
  await openChannel(w, "Town Square");

  eq(flow(w), "DIV p1 p2 p3", "overflowing count → divider on top, no crash");
  ok(w.q(".unread-divider").scrolledIntoView, "even at the top the view lands on the boundary");
});

test("11: the divider clears when the channel is read or another is opened", async () => {
  const w = await boot({
    channels: [
      { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 5, member: { msg_count: 3 } },
      { id: "c2", name: "random", display_name: "Random", type: "O", team_id: "", total_msg_count: 4, member: { msg_count: 3 } },
    ],
    posts: { c1: posts(["p1", "p2", "p3", "p4"]), c2: posts(["b1", "b2", "b3"], T0 + 60 * MIN) },
    users: USERS,
    me: ME,
  });
  await openChannel(w, "Town Square");
  ok(w.q(".unread-divider"), "divider shown for the unread channel");

  // Switch away: c2 has 1 unread → its own divider, and only its own.
  await openChannel(w, "Random");
  eq(flow(w), "b1 b2 DIV b3", "switched channel shows only its own unread anchor");

  // Back to c1: markViewed read it meanwhile, so the divider is gone. c1 no
  // longer pins to Unread — reach it through Community → Other instead.
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Community")), "click");
  await w.flush();
  w.fire(w.qa(".section-title").find((t) => t.textContent.includes("Other")), "click");
  await w.flush();
  await openChannel(w, "Town Square");
  eq(flow(w), "p1 p2 p3 p4", "read-once channel reopens without a divider");
});

test("11: a loadOlder prepend inserts above and never shifts the divider", async () => {
  // 30 posts (a full PAGE_SIZE) so paging stays open; last 2 are unread.
  const latest = posts(Array.from({ length: 30 }, (_, i) => "f" + (i + 1)));
  const older = posts(["o1", "o2"], T0 - 30 * MIN);
  const w = await boot({
    handlers: { get_posts: async ({ before }) => (before ? older : latest) },
    channels: [
      { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 32, member: { msg_count: 30 } },
    ],
    posts: { c1: latest },
    users: USERS,
    me: ME,
  });
  await openChannel(w, "Town Square");
  ok(flow(w).endsWith("DIV f29 f30"), "divider before the last two");

  w.fire("messages", "scroll"); // scrollTop 0 < 80 → loadOlder()
  await w.flush();

  const f = flow(w).split(" ");
  eq(f.length, 33, "two older posts prepended above the divider's anchor");
  eq(f.slice(0, 2).join(" "), "o1 o2", "older page on top");
  ok(flow(w).endsWith("DIV f29 f30"), "divider still anchors the same last two unread posts");
});

test("11: live messages land below the divider without disturbing it", async () => {
  const w = await boot({
    channels: [
      { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 3, member: { msg_count: 2 } },
    ],
    posts: { c1: posts(["p1", "p2"]) },
    users: USERS,
    me: ME,
  });
  await openChannel(w, "Town Square");
  eq(flow(w), "p1 DIV p2", "one unread → divider before the last post");

  w.emitEvent("mm-post", { id: "live1", channel_id: "c1", sender: "bob", message: "arrived later" });
  await w.flush();
  eq(flow(w), "p1 DIV p2 live1", "the unread anchor does not move on live appends");
});
