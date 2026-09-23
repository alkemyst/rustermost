// tests/fe/18-composer-undo.test.mjs — issue #18: composer undo/redo.
//
// The webview has no usable native textarea undo, so the composer keeps its
// own bounded history. Covered here: paste is one atomic undo step, typing
// bursts merge, kind switches break, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y work,
// programmatic inserts (emoji autocomplete) participate, and the history is
// wiped on send / channel switch and bounded at HISTORY_MAX entries.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };

const CHANNELS = [
  // unread, so they render in the pinned Unread section and open with one click
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 6, member: { msg_count: 5 } },
  { id: "c2", name: "random", display_name: "Random", type: "O", team_id: "", total_msg_count: 2, member: { msg_count: 1 } },
];

async function openCh(w, label) {
  const row = w.qa(".channel-item").find((r) => r.textContent.includes(label));
  ok(row, label + " row rendered (unread → pinned Unread section)");
  w.fire(row, "click");
  await w.flush();
}

// Deliver `text` at the caret as one input event of the given inputType —
// the way a real keystroke / paste / drop arrives at the textarea.
function deliverInput(w, text, inputType) {
  const el = w.el("composer-input");
  const s = el.selectionStart, e = el.selectionEnd;
  el.value = el.value.slice(0, s) + text + el.value.slice(e);
  const caret = s + text.length;
  el.setSelectionRange(caret, caret);
  w.fire("composer-input", "input", { inputType });
}

const typeText = (w, text) => { for (const ch of text) deliverInput(w, ch, "insertText"); };

const ctrlZ = (w) => w.fire("composer-input", "keydown", { key: "z", ctrlKey: true, shiftKey: false });
const ctrlShiftZ = (w) => w.fire("composer-input", "keydown", { key: "Z", ctrlKey: true, shiftKey: true });
const ctrlY = (w) => w.fire("composer-input", "keydown", { key: "y", ctrlKey: true });
const val = (w) => w.el("composer-input").value;
const caret = (w) => w.el("composer-input").selectionStart;

test("18: a paste is exactly one undo step", async () => {
  const w = await boot({ handlers: {}, channels: CHANNELS });
  await openCh(w, "Town Square");

  typeText(w, "ab");
  deliverInput(w, "XX", "insertFromPaste");
  eq(val(w), "abXX", "paste landed");

  ctrlZ(w);
  eq(val(w), "ab", "one Ctrl+Z removes exactly the paste");
  eq(caret(w), 2, "caret back where the paste started");

  ctrlZ(w);
  eq(val(w), "", "second Ctrl+Z removes the typed burst");
  ctrlZ(w);
  eq(val(w), "", "third Ctrl+Z is a harmless no-op");
});

test("18: redo restores undone state (Ctrl+Shift+Z and Ctrl+Y)", async () => {
  const w = await boot({ handlers: {}, channels: CHANNELS });
  await openCh(w, "Town Square");

  typeText(w, "ab");
  deliverInput(w, "XX", "insertFromPaste");
  ctrlZ(w); // → "ab"
  ctrlZ(w); // → ""

  ctrlShiftZ(w);
  eq(val(w), "ab", "Ctrl+Shift+Z redoes the typing burst");
  eq(caret(w), 2, "caret restored with the snapshot");
  ctrlY(w);
  eq(val(w), "abXX", "Ctrl+Y redoes the paste");
  eq(caret(w), 4, "caret back after the pasted text");
});

test("18: continuous typing merges into one step; a kind switch breaks", async () => {
  const w = await boot({ handlers: {}, channels: CHANNELS });
  await openCh(w, "Town Square");

  typeText(w, "ab");
  // then one backspace: value "a", delivered as a deleteContentBackward input
  const el = w.el("composer-input");
  el.value = "a";
  el.setSelectionRange(1, 1);
  w.fire("composer-input", "input", { inputType: "deleteContentBackward" });

  ctrlZ(w);
  eq(val(w), "ab", "first undo rewinds only the delete (kind switch broke the step)");
  ctrlZ(w);
  eq(val(w), "", "second undo rewinds the whole typing burst as ONE step");
});

test("18: two consecutive pastes stay two separate steps", async () => {
  const w = await boot({ handlers: {}, channels: CHANNELS });
  await openCh(w, "Town Square");

  deliverInput(w, "A", "insertFromPaste");
  deliverInput(w, "B", "insertFromPaste");
  eq(val(w), "AB", "both pastes landed");

  ctrlZ(w);
  eq(val(w), "A", "atomic: only the second paste is undone");
  ctrlZ(w);
  eq(val(w), "", "then the first");
});

test("18: emoji autocomplete insert is one undoable step", async () => {
  const w = await boot({ handlers: {}, channels: CHANNELS });
  await openCh(w, "Town Square");

  typeText(w, ":smi"); // opens the emoji popup (:smile etc.)
  ok(!w.q(".emoji-popup").classList.contains("hidden"), "emoji popup open");
  w.fire("composer-input", "keydown", { key: "Enter", shiftKey: false }); // accept first candidate
  eq(val(w), "😄 ", "applyEmoji replaced the :prefix");

  ctrlZ(w);
  eq(val(w), ":smi", "Ctrl+Z restores the text as typed before the autocomplete");
  eq(caret(w), 4, "caret back after the typed prefix");
  ctrlShiftZ(w);
  eq(val(w), "😄 ", "redo replays the emoji insert");
});

test("18: new input kills the redo branch", async () => {
  const w = await boot({ handlers: {}, channels: CHANNELS });
  await openCh(w, "Town Square");

  typeText(w, "ab");
  ctrlZ(w); // → ""
  typeText(w, "c");
  ctrlShiftZ(w);
  eq(val(w), "c", "redo is a no-op once new text was typed");
});

test("18: history is cleared when the message is sent", async () => {
  const w = await boot({ handlers: { send_message: async () => undefined }, channels: CHANNELS });
  await openCh(w, "Town Square");

  typeText(w, "hi");
  w.fire("composer-input", "keydown", { key: "Enter", shiftKey: false });
  await w.flush();
  eq(w.invoked("send_message").length, 1, "message sent");
  eq(val(w), "", "composer cleared");

  ctrlZ(w);
  eq(val(w), "", "the sent draft does not come back through undo");
});

test("18: history is cleared on channel switch (draft text survives, undo does not)", async () => {
  const w = await boot({ handlers: {}, channels: CHANNELS });
  await openCh(w, "Town Square");
  typeText(w, "x");
  eq(val(w), "x", "draft typed");

  await openCh(w, "Random");
  eq(val(w), "x", "existing draft text carries to the other conversation (unchanged behavior)");
  ctrlZ(w);
  eq(val(w), "x", "but undo forgot the pre-switch burst");
});

test("18: history is bounded — the oldest steps fall off", async () => {
  const w = await boot({ handlers: {}, channels: CHANNELS });
  await openCh(w, "Town Square");

  for (let i = 0; i < 105; i++) deliverInput(w, "x", "insertFromPaste"); // 105 atomic steps
  eq(val(w).length, 105, "105 chars pasted");
  for (let i = 0; i < 105; i++) ctrlZ(w);
  eq(val(w).length, 5, "only 100 undos land — the 5 oldest snapshots were evicted");
});
