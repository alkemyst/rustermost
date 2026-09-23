// tests/fe/21-mention-hinting.test.mjs — issue #21: name & account-name hinting.
//
// Typing "@something" opens a GitHub-style dropdown: candidates match the
// prefix against usernames AND first/last names, insertion uses the username
// with a trailing space, keyboard/nav/escape semantics mirror the emoji
// autocomplete, and the two popups are mutually exclusive.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };

const CHANNELS = [
  // unread, so it renders in the pinned Unread section and opens with one click
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 4, member: { msg_count: 1 } },
];
// Authors of the history posts — opening the channel resolves them into
// state.users / state.usersByName, which is what the suggester reads.
const USERS = {
  u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" },
  u3: { id: "u3", username: "albert", first_name: "Albert", last_name: "King" },
  u4: { id: "u4", username: "zoe", first_name: "Zoe", last_name: "Almeida" },
};
const POSTS = {
  c1: [
    { id: "p1", user_id: "u2", channel_id: "c1", message: "one", create_at: 1728000000000 },
    { id: "p2", user_id: "u3", channel_id: "c1", message: "two", create_at: 1728000060000 },
    { id: "p3", user_id: "u4", channel_id: "c1", message: "three", create_at: 1728000120000 },
  ],
};

async function setup() {
  const w = await boot({ handlers: { send_message: async () => undefined }, channels: CHANNELS, posts: POSTS, users: USERS, me: ME });
  const row = w.qa(".channel-item").find((r) => r.textContent.includes("Town Square"));
  w.fire(row, "click");
  await w.flush(); // lets resolveUsers land
  return w;
}

// Type a burst of characters, one input event per char, exactly like a user.
function typeText(w, text) {
  const el = w.el("composer-input");
  for (const ch of text) {
    const s = el.selectionStart, e = el.selectionEnd;
    el.value = el.value.slice(0, s) + ch + el.value.slice(e);
    const caret = s + ch.length;
    el.setSelectionRange(caret, caret);
    w.fire("composer-input", "input", { inputType: "insertText" });
  }
}

const rows = (w) => w.qa(".mention-popup .mention-row");
const popupOpen = (w) => !w.q(".mention-popup").classList.contains("hidden");
const rowUser = (row) => row.querySelector(".un").textContent;

test("21: typing @al lists username and last-name prefix matches", async () => {
  const w = await setup();
  typeText(w, "@al");

  ok(popupOpen(w), "mention popup opened");
  eq(rows(w).length, 2, "username match + last-name match");
  eq(rowUser(rows(w)[0]), "@albert", "username prefix matches come first");
  eq(rowUser(rows(w)[1]), "@zoe", "name prefix match follows, mapped to the username");
  eq(rows(w)[1].querySelector(".rn").textContent, "Zoe Almeida", "row shows the real name");
});

test("21: ArrowDown + Enter inserts @username with a trailing space", async () => {
  const w = await setup();
  typeText(w, "@al");

  w.fire("composer-input", "keydown", { key: "ArrowDown" });
  w.fire("composer-input", "keydown", { key: "Enter", shiftKey: false });
  eq(w.el("composer-input").value, "@zoe ", "selected candidate inserted, prefix replaced");
  eq(w.el("composer-input").selectionStart, 5, "caret after the trailing space");
  ok(!popupOpen(w), "popup closed after insertion");
});

test("21: Escape closes the popup; a following Enter sends instead of inserting", async () => {
  const w = await setup();
  typeText(w, "@al");
  ok(popupOpen(w), "precondition: popup open");

  w.fire("composer-input", "keydown", { key: "Escape" });
  ok(!popupOpen(w), "Escape closed the popup");
  eq(w.el("composer-input").value, "@al", "typed text untouched");

  w.fire("composer-input", "keydown", { key: "Enter", shiftKey: false });
  await w.flush();
  const calls = w.invoked("send_message");
  eq(calls.length, 1, "Enter went through to the composer and sent");
  eq(calls[0].args.message, "@al", "verbatim text sent, no insertion happened");
});

test("21: @ in the middle of a word does NOT trigger", async () => {
  const w = await setup();

  const el = w.el("composer-input");
  el.value = "mail me@example.com";
  el.setSelectionRange(el.value.length, el.value.length);
  w.fire("composer-input", "input", { inputType: "insertText" });
  ok(!popupOpen(w), "no popup for a mid-word @ (regex anchored at start/whitespace)");

  el.value = "ask @an";
  el.setSelectionRange(el.value.length, el.value.length);
  w.fire("composer-input", "input", { inputType: "insertText" });
  ok(popupOpen(w), "but a whitespace-anchored @ does trigger");
  eq(rowUser(rows(w)[0]), "@anna", "anna matched");
});

test("21: insertion mid-text replaces only the typed prefix", async () => {
  const w = await setup();

  const el = w.el("composer-input");
  el.value = "hey @an there";
  el.setSelectionRange(7, 7); // caret right after "@an"
  w.fire("composer-input", "input", { inputType: "insertText" });
  ok(popupOpen(w), "popup opened at the caret");

  w.fire("composer-input", "keydown", { key: "Enter", shiftKey: false });
  eq(el.value, "hey @anna  there", "only @an was replaced; text before and after intact");
  eq(el.selectionStart, 10, "caret right after the inserted mention");
});

test("21: a name-prefix match inserts the username (@doe → @anna )", async () => {
  const w = await setup();
  typeText(w, "@doe");

  ok(popupOpen(w), "popup opened");
  eq(rowUser(rows(w)[0]), "@anna", "last name matched, username offered");
  w.fire("composer-input", "keydown", { key: "Enter", shiftKey: false });
  eq(w.el("composer-input").value, "@anna ", "username (not the name) goes into the text");
});

test("21: emoji and mention popups are mutually exclusive", async () => {
  const w = await setup();

  typeText(w, ":smi");
  ok(!w.q(".emoji-popup").classList.contains("hidden"), "emoji popup opened for :smi");
  ok(!popupOpen(w), "mention popup stays closed");

  const el = w.el("composer-input");
  el.value = "@an";
  el.setSelectionRange(3, 3);
  w.fire("composer-input", "input", { inputType: "insertText" });
  ok(popupOpen(w), "mention popup opened for @an");
  ok(w.q(".emoji-popup").classList.contains("hidden"), "emoji popup closed");

  w.fire("composer-input", "keydown", { key: "Enter", shiftKey: false });
  eq(el.value, "@anna ", "Enter hit the mention popup, not the emoji one");
});
