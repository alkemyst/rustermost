// tests/fe/19-edit-message.test.mjs — issue #19: edit messages.
//
// Covers the whole edit feature: the history "edited" marker, the right-click
// menu (mine only), arming/cancelling edit mode, saving (happy path, server
// failure, missing-command degradation), and the live mm-post-edited repaint.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };

const CHANNELS = [
  // public channel with the messages; unread so it renders in the pinned
  // (unfolded) Unread section and can be opened with one click
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 6, member: { msg_count: 5 } },
  // a DM for the channel-switch test
  { id: "c2", name: "u2__me1", display_name: "", type: "D", team_id: "", total_msg_count: 0, member: { msg_count: 0 } },
];
const USERS = { u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" } };
const POSTS = {
  c1: [
    { id: "p1", user_id: "me1", channel_id: "c1", message: "old text", create_at: 1728000000000 },
    { id: "p2", user_id: "me1", channel_id: "c1", message: "fixed typo", create_at: 1728000060000, edit_at: 1728000100000 },
    { id: "p3", user_id: "u2", channel_id: "c1", message: "their words", create_at: 1728000120000 },
  ],
};

async function openC1(w) {
  const row = w.qa(".channel-item").find((r) => r.textContent.includes("Town Square"));
  ok(row, "Town Square row rendered (unread → pinned Unread section)");
  w.fire(row, "click");
  await w.flush();
}

// qa(".context-menu")[0] is the sidebar channel menu (created earlier in
// main.js); [1] is the message-bubble menu.
const msgMenu = (w) => w.qa(".context-menu")[1];

function rightClick(w, postId) {
  w.fire(w.q(`.msg-row[data-post-id="${postId}"]`), "contextmenu", { clientX: 40, clientY: 40 });
}

function clickEditItem(w) {
  w.fire(w.q(".context-menu-row", msgMenu(w)), "mousedown");
}

function pressKey(w, key) {
  w.fire("composer-input", "keydown", { key, shiftKey: false });
}

test("19: history post with edit_at renders the 'edited' marker", async () => {
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  const tag = w.q('.msg-row[data-post-id="p2"] .msg-edited');
  ok(tag, "edited history post carries the marker");
  eq(tag.textContent, "edited", "marker text");
  ok(!w.q('.msg-row[data-post-id="p1"] .msg-edited'), "unedited post has no marker");
  ok(!w.q('.msg-row[data-post-id="p3"] .msg-edited'), "other's unedited post has no marker");
});

test("19: right-click offers Edit only on my own bubbles", async () => {
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  rightClick(w, "p3"); // someone else's bubble
  ok(msgMenu(w).classList.contains("hidden"), "other's bubble: menu stays hidden");

  rightClick(w, "p1"); // my bubble
  ok(!msgMenu(w).classList.contains("hidden"), "my bubble: menu opens");
  const row = w.q(".context-menu-row", msgMenu(w));
  ok(row, "menu has a row");
  eq(row.textContent, "✏️  Edit message", "menu row label");
});

test("19: clicking Edit arms the edit bar with the original text", async () => {
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  rightClick(w, "p1");
  clickEditItem(w);
  await w.flush();

  ok(msgMenu(w).classList.contains("hidden"), "menu closed after picking the item");
  ok(!w.q(".edit-bar").classList.contains("hidden"), "edit bar visible");
  eq(w.q(".edit-bar-title").textContent, "Edit message");
  eq(w.q(".edit-bar-preview").textContent, "old text", "preview shows the original");
  eq(w.el("composer-input").value, "old text", "composer pre-filled with the original");
  eq(w.el("send-btn").textContent, "✔", "send button switched to save");
  eq(w.el("send-btn").title, "Save edit");
});

test("19: saving an edit calls edit_message and repaints the bubble", async () => {
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  rightClick(w, "p1");
  clickEditItem(w);
  w.el("composer-input").value = "brand new text";
  pressKey(w, "Enter");
  await w.flush();

  const calls = w.invoked("edit_message");
  eq(calls.length, 1, "edit_message invoked once");
  eq(calls[0].args.postId, "p1", "edited post id");
  eq(calls[0].args.message, "brand new text", "new text sent");
  eq(w.q('.msg-row[data-post-id="p1"] .msg-body').textContent, "brand new text", "bubble repainted");
  ok(w.q('.msg-row[data-post-id="p1"] .msg-edited'), "edited marker appended");
  eq(w.el("composer-input").value, "", "composer cleared");
  ok(w.q(".edit-bar").classList.contains("hidden"), "edit bar hidden after save");
  eq(w.el("send-btn").textContent, "➤", "send button back to send");
  eq(w.el("send-btn").disabled, false, "send button re-enabled");
});

test("19: Escape cancels an edit without touching the server", async () => {
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  rightClick(w, "p1");
  clickEditItem(w);
  w.el("composer-input").value = "half-typed change";
  pressKey(w, "Escape");
  await w.flush();

  eq(w.invoked("edit_message").length, 0, "no edit_message call");
  ok(w.q(".edit-bar").classList.contains("hidden"), "edit bar hidden");
  eq(w.el("composer-input").value, "", "composer cleared");
  eq(w.el("send-btn").textContent, "➤", "send button back to send");
  eq(w.q('.msg-row[data-post-id="p1"] .msg-body').textContent, "old text", "bubble untouched");
});

test("19: a failing save keeps edit mode, shows the error, keeps the feature on", async () => {
  const w = await boot({
    handlers: { edit_message: async () => { throw new Error("server blew up"); } },
    channels: CHANNELS, posts: POSTS, users: USERS, me: ME,
  });
  await openC1(w);

  rightClick(w, "p1");
  clickEditItem(w);
  w.el("composer-input").value = "new but doomed";
  pressKey(w, "Enter");
  await w.flush();

  eq(w.invoked("edit_message").length, 1, "the attempt did fire");
  ok(!w.q(".edit-bar").classList.contains("hidden"), "edit bar still visible");
  eq(w.el("composer-input").value, "new but doomed", "draft preserved for retry");
  const err = w.q(".edit-bar-error");
  ok(!err.classList.contains("hidden"), "error row shown");
  ok(err.textContent.includes("server blew up"), "error text carried through, got: " + err.textContent);
  eq(w.el("send-btn").disabled, false, "send button re-enabled");
  eq(w.q('.msg-row[data-post-id="p1"] .msg-body').textContent, "old text", "bubble not repainted");

  // The feature flag must NOT flip on a runtime error → the menu still shows.
  rightClick(w, "p1");
  ok(!msgMenu(w).classList.contains("hidden"), "right-click still offers Edit");
});

test("19: missing edit_message command degrades the feature silently", async () => {
  // no edit_message handler → the harness rejects with "no stub handler"
  const w = await boot({ handlers: {}, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  rightClick(w, "p1");
  ok(!msgMenu(w).classList.contains("hidden"), "menu offered before the first attempt");
  clickEditItem(w);
  w.el("composer-input").value = "whatever";
  pressKey(w, "Enter");
  await w.flush();

  eq(w.invoked("edit_message").length, 1, "one attempt was made");
  ok(w.q(".edit-bar").classList.contains("hidden"), "edit bar closed after degradation");
  ok(!w.q('.msg-row[data-post-id="p1"] .msg-edited'), "bubble not marked");
  eq(w.q('.msg-row[data-post-id="p1"] .msg-body').textContent, "old text", "bubble unchanged");

  rightClick(w, "p1");
  ok(msgMenu(w).classList.contains("hidden"), "Edit no longer offered");
});

test("19: mm-post-edited repaints a rendered bubble in place", async () => {
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);
  ok(w.q('.msg-row[data-post-id="p3"]'), "other's post rendered");

  w.emitEvent("mm-post-edited", { id: "p3", channel_id: "c1", message: "edited live", edit_at: 1728000100000 });
  await w.flush();
  eq(w.q('.msg-row[data-post-id="p3"] .msg-body').textContent, "edited live", "body updated live");
  ok(w.q('.msg-row[data-post-id="p3"] .msg-edited'), "marker appended live");

  // Echo of our own edit: applying again must not duplicate the marker.
  w.emitEvent("mm-post-edited", { id: "p3", channel_id: "c1", message: "edited live", edit_at: 1728000100000 });
  await w.flush();
  eq(w.qa('.msg-row[data-post-id="p3"] .msg-edited').length, 1, "marker applied at most once");

  // An edit for a channel that isn't open is ignored and must not crash.
  w.emitEvent("mm-post-edited", { id: "p3", channel_id: "c9", message: "elsewhere", edit_at: 1728000200000 });
  await w.flush();
  eq(w.q('.msg-row[data-post-id="p3"] .msg-body').textContent, "edited live", "other-channel event ignored");

  // An edit for a post that isn't rendered: no crash either.
  w.emitEvent("mm-post-edited", { id: "nope", channel_id: "c1", message: "?", edit_at: 1728000300000 });
  await w.flush();
  ok(!w.q('.msg-row[data-post-id="nope"]'), "nothing rendered for the unknown post");
});

test("19: empty edit is a no-op; unchanged text cancels quietly", async () => {
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  rightClick(w, "p1");
  clickEditItem(w);

  w.el("composer-input").value = "   "; // whitespace only
  pressKey(w, "Enter");
  await w.flush();
  eq(w.invoked("edit_message").length, 0, "empty edit sends nothing");
  ok(!w.q(".edit-bar").classList.contains("hidden"), "still in edit mode");

  w.el("composer-input").value = "old text"; // back to the original
  pressKey(w, "Enter");
  await w.flush();
  eq(w.invoked("edit_message").length, 0, "unchanged text sends nothing");
  ok(w.q(".edit-bar").classList.contains("hidden"), "unchanged text closes the editor");
  eq(w.el("send-btn").textContent, "➤", "send button back to send");
});

test("19: attachment-only bubble gains text via edit, body inserted after meta", async () => {
  // Regression for the NodeList fix in applyEditToBubble: a body-less bubble
  // (file-only post, see #20's image pastes) must gain a .msg-body placed
  // directly after .msg-meta when an edit adds text — without a TypeError.
  const posts = {
    c1: [
      { id: "p9", user_id: "me1", channel_id: "c1", message: "", create_at: 1728000120000, file_ids: ["f1"] },
    ],
  };
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts, users: USERS, me: ME });
  await openC1(w);

  const row = () => w.q('.msg-row[data-post-id="p9"]');
  ok(row(), "attachment-only post rendered");
  ok(!w.q(".msg-body", row()), "no body node before the edit");

  rightClick(w, "p9");
  clickEditItem(w);
  w.el("composer-input").value = "added a caption later";
  pressKey(w, "Enter");
  await w.flush();

  ok(w.invoked("edit_message").some((c) => c.args.postId === "p9"), "edit sent for the attachment-only post");
  const body = w.q(".msg-body", row());
  ok(body, "body node created by the in-place repaint");
  eq(body.textContent, "added a caption later", "new text rendered");
  const kids = row().querySelector(".msg").childNodes;
  const metaIdx = kids.findIndex((n) => n.classList && n.classList.contains("msg-meta"));
  eq(kids.indexOf(body), metaIdx + 1, "body sits directly after the meta line, before attachments");
  ok(w.q(".msg-edited", row()), "marker appended");
});

test("19: switching channels cancels a pending edit", async () => {
  const w = await boot({ handlers: { edit_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  await openC1(w);

  rightClick(w, "p1");
  clickEditItem(w);
  ok(!w.q(".edit-bar").classList.contains("hidden"), "edit armed");

  // Unfold the Direct messages section and open the DM with Anna.
  const dmTitle = w.qa(".section-title").find((t) => t.textContent.includes("Direct messages"));
  ok(dmTitle, "Direct messages section header rendered");
  w.fire(dmTitle, "click");
  await w.flush();
  const dmRow = w.qa(".channel-item").find((r) => r.textContent.includes("Anna Doe"));
  ok(dmRow, "DM row rendered");
  w.fire(dmRow, "click");
  await w.flush();

  ok(w.q(".edit-bar").classList.contains("hidden"), "edit cancelled on channel switch");
  eq(w.el("composer-input").value, "", "composer cleared by the cancel");
  eq(w.el("send-btn").textContent, "➤", "send button back to send");
  eq(w.invoked("edit_message").length, 0, "no edit fired");
});
