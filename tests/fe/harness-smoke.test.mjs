// tests/fe/harness-smoke.test.mjs — smoke test for the harness itself.
//
// Proves the fake DOM is good enough to boot the real app and drive one full
// user flow through it; along the way it covers sidebar rendering, unread
// badge seeding (total_msg_count − member.msg_count), DM partner resolution
// via get_users_by_ids, channel opening and optimistic mark-read reporting.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };

const CHANNELS = [
  // fully read public channel — stays out of the Unread section
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 5, member: { msg_count: 5 } },
  // 1:1 DM named "<partnerId>__<me>", 2 unread
  { id: "c2", name: "u2__me1", display_name: "", type: "D", team_id: "", total_msg_count: 3, member: { msg_count: 1 } },
];
const USERS = { u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" } };
const POSTS = { c2: [{ id: "p1", user_id: "u2", channel_id: "c2", message: "hi there", create_at: 1728000000000 }] };

test("boot → unread DM in sidebar → open conversation → marked read", async () => {
  const w = await boot({ channels: CHANNELS, posts: POSTS, users: USERS, me: ME });

  ok(!w.el("app-view").classList.contains("hidden"), "app view visible after boot");
  ok(w.el("login-view").classList.contains("hidden"), "login view hidden after boot");

  const list = w.el("channel-list");
  const titles = () => w.qa(".section-title", list).map((el) => el.textContent);
  ok(titles().some((t) => t.includes("Unread · 1")), `sidebar has a pinned "Unread · 1" section, got ${JSON.stringify(titles())}`);

  const rows = w.qa(".channel-item", list);
  eq(rows.length, 1, "only the Unread section is unfolded at boot, so only its row renders");
  const dmRow = rows[0];
  ok(dmRow.textContent.includes("Anna Doe"), "unread DM row shows the partner's resolved real name");

  const badge = w.q(".badge", dmRow);
  ok(badge, "DM row carries an unread badge");
  eq(badge.textContent, "2", "badge = 3 total − 1 read");

  w.fire(dmRow, "click");
  await w.flush();

  ok(!w.el("chat-panel").classList.contains("hidden"), "chat panel opened");
  ok(w.el("empty-state").classList.contains("hidden"), "empty state hidden while chatting");
  eq(w.el("chat-title").textContent, "Anna Doe", "chat title shows the partner's real name");

  ok(!w.q(".badge", list), "badge cleared after opening (optimistic mark-read)");
  ok(!titles().some((t) => t.includes("Unread")), "Unread section disappears once empty");

  ok(w.invoked("get_posts").some((c) => c.args.channelId === "c2"), "history fetched for the opened channel");
  ok(w.invoked("view_channel").some((c) => c.args.channelId === "c2"), "server told we read the channel");
});
