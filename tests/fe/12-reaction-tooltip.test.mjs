// tests/fe/12-reaction-tooltip.test.mjs — issue #12: hovering a reaction chip
// showed only the emoji name (native title); it must show WHO reacted.
//
// Covers: the GitHub-style "<names> reacted with :emoji:" hovercard ("You"
// first, others in reaction order), no more native title text, unknown
// reactor ids degrading to "someone" and refreshing once resolveUsers brings
// their names, graceful behaviour when get_users_by_ids doesn't exist yet,
// mouseleave hiding, long lists capped with "and N more", and the hovercard
// never leaking or duplicating across renderReactionsInto rebuilds.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };

const CHANNELS = [
  // unread → pinned in the unfolded Unread section, one click to open
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 6, member: { msg_count: 5 } },
];

const USERS = {
  u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" },
  u3: { id: "u3", username: "carol", first_name: "Carol", last_name: "Danvers" },
  u9: { id: "u9", username: "grace", first_name: "Grace", last_name: "Hopper" },
};

// p1: tada by Anna + me (me added second — "You" must still come first).
// p2: +1 by u9 alone — the post authors never include u9, so the name only
//     resolves when the hover triggers it.
const POSTS = {
  c1: [
    {
      id: "p1", user_id: "u2", channel_id: "c1", message: "nice", create_at: 1728000000000,
      metadata: { reactions: [
        { emoji_name: "tada", user_id: "u2" },
        { emoji_name: "tada", user_id: "me1" },
        { emoji_name: "rocket", user_id: "u2" },
      ] },
    },
    {
      id: "p2", user_id: "u2", channel_id: "c1", message: "mystery", create_at: 1728000060000,
      metadata: { reactions: [{ emoji_name: "tada", user_id: "u9" }] },
    },
  ],
};

async function openC1(w) {
  const row = w.qa(".channel-item").find((r) => r.textContent.includes("Town Square"));
  ok(row, "Town Square row rendered (unread → pinned Unread section)");
  w.fire(row, "click");
  await w.flush();
}

const pills = (w, postId) => w.qa(`.reactions[data-post-id="${postId}"] .reaction-pill`);
const tipIn = (pill) => pill.querySelector(".reaction-tip");

test("12: hovering a chip lists who reacted, 'You' first, no native title", async () => {
  const w = await boot({ channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  const [tada, rocket] = pills(w, "p1");
  eq(pills(w, "p1").length, 2, "both emoji chips rendered");
  ok(!tada.title, "no native title tooltip leaking the bare emoji name");

  w.fire(tada, "mouseenter");
  const tip = tipIn(tada);
  ok(tip, "hovercard appears inside the pill on mouseenter");
  // insertion order is Anna, me — but "You" always leads
  eq(tip.textContent, "You and Anna Doe reacted with :tada:", "names with 'You' first");

  // a second chip has its own independent hovercard
  w.fire(tada, "mouseleave");
  w.fire(rocket, "mouseenter");
  ok(!tipIn(tada), "tada hovercard gone after leaving its chip");
  eq(tipIn(rocket).textContent, "Anna Doe reacted with :rocket:", "other chip shows its own reactors");
  eq(w.qa(".reaction-tip").length, 1, "only one hovercard visible at a time");
});

test("12: mouseleave hides the hovercard", async () => {
  const w = await boot({ channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  const tada = pills(w, "p1")[0];
  w.fire(tada, "mouseenter");
  ok(tipIn(tada), "hovercard shown");
  w.fire(tada, "mouseleave");
  ok(!tipIn(tada), "hovercard removed on mouseleave");
  eq(w.qa(".reaction-tip").length, 0, "no hovercard left anywhere");
});

test("12: unknown reactors degrade, then refresh once names resolve", async () => {
  const w = await boot({ channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  const chip = pills(w, "p2")[0];
  ok(!w.invoked("get_users_by_ids").some((c) => (c.args.ids || []).includes("u9")),
    "u9 not resolved during history render");

  w.fire(chip, "mouseenter");
  eq(tipIn(chip).textContent, "someone reacted with :tada:", "unknown id degrades — no raw id, no 'undefined'");

  await w.flush();
  ok(w.invoked("get_users_by_ids").some((c) => (c.args.ids || []).includes("u9")),
    "hover triggered user resolution");
  eq(tipIn(chip).textContent, "Grace Hopper reacted with :tada:", "hovercard refreshed with the real name");

  // the resolved name sticks for later hovers, without another lookup round
  w.fire(chip, "mouseleave");
  w.fire(chip, "mouseenter");
  eq(tipIn(chip).textContent, "Grace Hopper reacted with :tada:", "cached name shown immediately");
});

test("12: missing get_users_by_ids degrades quietly and never shows 'undefined'", async () => {
  const w = await boot({
    handlers: { get_users_by_ids: async () => { throw new Error("no such command"); } },
    channels: CHANNELS, posts: POSTS, users: USERS, me: ME,
  });
  await openC1(w);

  const chip = pills(w, "p2")[0];
  w.fire(chip, "mouseenter");
  await w.flush();
  const tip = tipIn(chip);
  ok(tip, "hovercard still shown without the lookup command");
  eq(tip.textContent, "someone reacted with :tada:", "degraded text survives the failed lookup");
  ok(!tip.textContent.includes("undefined"), "no 'undefined' in the text");
});

test("12: long reactor lists are capped at 10 names plus 'and N more'", async () => {
  const users = {};
  const reactions = [];
  // 11 others first, me last → "You" first + 9 more names + "and 2 more"
  for (let i = 1; i <= 11; i++) {
    users[`a${i}`] = { id: `a${i}`, username: `r${i}`, first_name: "Reactor", last_name: `${i}` };
    reactions.push({ emoji_name: "tada", user_id: `a${i}` });
  }
  reactions.push({ emoji_name: "tada", user_id: "me1" });
  const posts = {
    c1: [{ id: "p1", user_id: "u2", channel_id: "c1", message: "popular", create_at: 1728000000000, metadata: { reactions } }],
  };
  const w = await boot({ channels: CHANNELS, posts, users: { ...USERS, ...users }, me: ME });
  await openC1(w);

  const chip = pills(w, "p1")[0];
  w.fire(chip, "mouseenter");
  // the 11 strangers resolve in the background; the hovercard refreshes
  await w.flush();
  const text = tipIn(chip).textContent;
  ok(text.startsWith("You, "), "'You' still first in a long list");
  ok(text.includes("Reactor 1") && text.includes("Reactor 9"), "first 9 others named");
  ok(!text.includes("Reactor 10"), "the 11th reactor collapses into the tail");
  ok(text.endsWith("and 2 more reacted with :tada:"), `tail counts everyone, got: ${text}`);
});

test("12: a re-render while hovering leaks nothing and never duplicates", async () => {
  const w = await boot({ channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  w.fire(pills(w, "p1")[0], "mouseenter");
  eq(w.qa(".reaction-tip").length, 1, "hovercard visible before the event");

  // a live reaction event rebuilds the chips under the cursor
  w.emitEvent("mm-reaction-added", { post_id: "p1", emoji_name: "tada", user_id: "u3" });
  await w.flush();
  eq(w.qa(".reaction-tip").length, 0, "stale hovercard died with its rebuilt chip");

  const fresh = pills(w, "p1")[0];
  w.fire(fresh, "mouseenter");
  eq(w.qa(".reaction-tip").length, 1, "rebuilt chip grows exactly one fresh hovercard");
  await w.flush(); // Carol's name resolves in the background
  eq(tipIn(fresh).textContent, "You, Anna Doe and Carol Danvers reacted with :tada:",
    "fresh hovercard reflects the live reaction");
  eq(fresh.querySelectorAll(".reaction-tip").length, 1, "no duplicate hovercards inside the chip");
});
