// tests/fe/20-paste-fallback.test.mjs — issue #20 follow-up: the reporter's
// clipboard forensics. Copying an image in Firefox fills the clipboard with
// a text/html flavor (a bare <img> fragment) beside the pixels. The paste
// handler saw that string item, classified the paste as text, inserted ""
// natively, and never tried the image. The rule now: no pasted file AND the
// text the clipboard would insert is empty → ask the OS clipboard for an
// image (queueClipboardImage), exactly like the empty-DataTransfer WebKitGTK
// case.
//
// The harness has no canvas/ImageData, so queueClipboardImage's success path
// can't render here — these tests pin the DECISION: a spied clipboardManager
// .readImage (throwing, like a no-image clipboard) tells us whether the OS
// fallback fired. The native text-insert path is what we must NOT disturb.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };
const CHANNELS = [
  // unread by one → pinned in the unfolded Unread section, one click to open
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 9, member: { msg_count: 8 } },
];
const POSTS = { c1: [{ id: "p1", user_id: "me1", channel_id: "c1", message: "seed", create_at: 1728000000000 }] };

// Minimal DataTransfer stand-in; tests override what they need.
const cd = (over = {}) => ({ items: [], files: [], getData: () => "", ...over });

let readImageCalls = 0;

async function bootPaste() {
  const w = await boot({ channels: CHANNELS, posts: POSTS, me: ME });
  w.fire(w.qa(".channel-item").find((r) => r.textContent.includes("Town Square")), "click");
  await w.flush();
  // Spy the plugin the fallback goes through; it throws like a text clipboard
  // would (the app warns and gives up — that failure path is the contract).
  readImageCalls = 0;
  w.window.__TAURI__.clipboardManager = {
    readImage: async () => { readImageCalls++; throw new Error("[test] no clipboard image"); },
  };
  return w;
}

const paste = (w, clipboardData) =>
  w.fire(w.document.getElementById("composer-input"), "paste", { clipboardData });

test("20: the reporter's case — Firefox image copy (text/html, no plain text) falls back to the OS image", async () => {
  const w = await bootPaste();

  const ev = paste(w, cd({
    items: [{ kind: "string", type: "text/html" }],
    getData: (t) => (t === "text/html" ? '<img width="333" src="…">' : ""), // text/plain renders as ""
  }));
  await w.flush();

  ok(readImageCalls >= 1, "the OS clipboard was probed for an image");
  ok(!ev.defaultPrevented, "native paste not blocked (inserts the empty text harmlessly)");
  eq(w.el("pending-files").classList.contains("hidden"), true, "no chip — the probe found no image");
});

test("20: a real text paste passes through natively and never touches the plugin", async () => {
  const w = await bootPaste();

  const ev = paste(w, cd({
    items: [{ kind: "string", type: "text/plain" }],
    getData: (t) => (t === "text/plain" ? "ciao mondo" : ""),
  }));
  await w.flush();

  eq(readImageCalls, 0, "no OS image probe for a real text paste");
  ok(!ev.defaultPrevented, "native text insert preserved");
});

test("20: whitespace-only text still falls back (degenerate text flavors)", async () => {
  const w = await bootPaste();

  paste(w, cd({ items: [{ kind: "string", type: "text/plain" }], getData: () => "   \n " }));
  await w.flush();

  ok(readImageCalls >= 1, "whitespace is not worth blocking the image probe");
});

test("20: empty DataTransfer (WebKitGTK hides the pixels) keeps probing the OS clipboard", async () => {
  const w = await bootPaste();

  paste(w, cd());
  await w.flush();

  ok(readImageCalls >= 1, "empty transfer → OS probe (pre-existing behavior)");
});

test("20: pasted FILE items queue the attachment, prevent native insert, skip the probe", async () => {
  const w = await bootPaste();

  const ev = paste(w, cd({
    items: [{ kind: "file", type: "image/png", getAsFile: () => new File(["x"], "shot.png", { type: "image/png" }) }],
  }));
  await w.flush();

  eq(readImageCalls, 0, "a file in the event never reaches for the OS clipboard");
  ok(ev.defaultPrevented, "native paste suppressed — we own it");
  const pending = w.el("pending-files");
  ok(!pending.classList.contains("hidden"), "pending-files strip visible");
  ok(pending.textContent.includes("shot.png"), "the chip names the pasted file");
});
