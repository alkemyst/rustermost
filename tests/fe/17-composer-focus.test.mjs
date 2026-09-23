// tests/fe/17-composer-focus.test.mjs — issue #17: jump to the send textbox.
//
// Opening a conversation must put the keyboard focus into the composer, so a
// search → click → type flow works without clicking the textbox first. And
// after a send, focus must stay (Enter) / come back (➤ click) there.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };

const CHANNELS = [
  // unread, so it renders in the pinned Unread section and opens with one click
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 6, member: { msg_count: 5 } },
];
const POSTS = {
  c1: [{ id: "p1", user_id: "me1", channel_id: "c1", message: "old text", create_at: 1728000000000 }],
};
const HANDLERS = { send_message: async () => undefined, edit_message: async () => undefined };

async function openC1(w) {
  const row = w.qa(".channel-item").find((r) => r.textContent.includes("Town Square"));
  ok(row, "Town Square row rendered (unread → pinned Unread section)");
  w.fire(row, "click");
  await w.flush();
}

test("17: opening a channel focuses the composer right away", async () => {
  const w = await boot({ handlers: HANDLERS, channels: CHANNELS, posts: POSTS, me: ME });
  ok(w.document.activeElement !== w.el("composer-input"), "composer not focused before opening");
  await openC1(w);
  eq(w.document.activeElement, w.el("composer-input"), "composer focused after opening the channel");
});

test("17: sending with Enter keeps focus in the composer", async () => {
  const w = await boot({ handlers: HANDLERS, channels: CHANNELS, posts: POSTS, me: ME });
  await openC1(w);
  const input = w.el("composer-input");
  eq(w.document.activeElement, input, "precondition: composer focused");

  input.value = "hi there";
  w.fire("composer-input", "keydown", { key: "Enter", shiftKey: false });
  await w.flush();

  eq(w.invoked("send_message").length, 1, "message sent");
  eq(input.value, "", "composer cleared after send");
  eq(w.document.activeElement, input, "focus still in the composer after Enter-send");
});

test("17: sending via the ➤ button hands focus back to the composer", async () => {
  const w = await boot({ handlers: HANDLERS, channels: CHANNELS, posts: POSTS, me: ME });
  await openC1(w);
  const input = w.el("composer-input");

  input.value = "clicked send";
  w.el("send-btn").focus(); // clicking the button moves focus onto it…
  w.fire("composer", "submit"); // …which is what submits the form in a browser
  await w.flush();

  eq(w.invoked("send_message").length, 1, "message sent");
  eq(input.value, "", "composer cleared after send");
  eq(w.document.activeElement, input, "focus returned to the composer after a button-send");
});

test("17: saving an edit via the ✔ button also returns focus to the composer", async () => {
  const w = await boot({ handlers: HANDLERS, channels: CHANNELS, posts: POSTS, me: ME });
  await openC1(w);

  // arm edit mode on my own bubble
  w.fire(w.q('.msg-row[data-post-id="p1"]'), "contextmenu", { clientX: 40, clientY: 40 });
  w.fire(w.q(".context-menu-row", w.qa(".context-menu")[1]), "mousedown");
  await w.flush();
  const input = w.el("composer-input");
  input.value = "edited text";

  w.el("send-btn").focus(); // simulate clicking the ✔ save button
  w.fire("composer", "submit");
  await w.flush();

  eq(w.invoked("edit_message").length, 1, "edit saved");
  eq(w.document.activeElement, input, "focus back in the composer after saving the edit");
});
