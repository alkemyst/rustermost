// tests/fe/29-small-image-inline.test.mjs — issue #29: an already-small image
// (the reporter's 333×30 banner) renders inline at full fidelity instead of
// the miniaturized thumbnail.
//
// Covers the two-tier "small" probe — pixel dims once FileInfo carries
// width/height (future backend field), byte size until then — plus the large
// images staying on the thumbnail path, non-image files staying chips, the
// get_file → thumbnail fallback, and click → lightbox staying uniform.

import { boot, test, ok, eq } from "../harness.mjs";

const ME = { id: "me1", username: "me", first_name: "Me", last_name: "" };
const CHANNELS = [
  // unread by one → pinned in the unfolded Unread section, one click to open
  { id: "c1", name: "town-square", display_name: "Town Square", type: "O", team_id: "", total_msg_count: 9, member: { msg_count: 8 } },
];
const USERS = { u2: { id: "u2", username: "anna", first_name: "Anna", last_name: "Doe" } };

const FULL = "data:image/png;base64,FULL-";
const THUMB = "data:image/png;base64,THUMB-";
const INFOS = {
  f1: { id: "f1", name: "banner.png", size: 4096, mime_type: "image/png", width: 333, height: 30 }, // the issue's banner
  f2: { id: "f2", name: "marker.png", size: 40 * 1024, mime_type: "image/png" }, // no dims yet, small bytes
  f3: { id: "f3", name: "photo.jpg", size: 3 * 1024 * 1024, mime_type: "image/jpeg", width: 2000, height: 1000 }, // big, dims known
  f4: { id: "f4", name: "raw.jpg", size: 3 * 1024 * 1024, mime_type: "image/jpeg" }, // big, dims unknown
  f5: { id: "f5", name: "paper.pdf", size: 2048, mime_type: "application/pdf" },
  f6: { id: "f6", name: "icon.png", size: 10 * 1024, mime_type: "image/png", width: 64, height: 64 }, // small, but get_file fails
  f7: { id: "f7", name: "edge-ok.png", size: 900 * 1024, mime_type: "image/png", width: 480, height: 479 }, // dims on the boundary
  f8: { id: "f8", name: "edge-wide.png", size: 900, mime_type: "image/png", width: 481, height: 10 }, // 1px past the boundary
};

const post = (id, fileIds) => ({ id, user_id: "u2", channel_id: "c1", message: "", create_at: 1728000000000, file_ids: fileIds });
const POSTS = { c1: [["p1", "f1"], ["p2", "f2"], ["p3", "f3"], ["p4", "f4"], ["p5", "f5"], ["p6", "f6"], ["p7", "f7"], ["p8", "f8"]].map(([p, f]) => post(p, [f])) };

const attOf = (w, p) => w.q(`.msg-row[data-post-id="${p}"] .attachment`);
const thumbAsked = (w, f) => w.invoked("get_file_thumbnail").some((c) => c.args.fileId === f);
const fileAsked = (w, f) => w.invoked("get_file").filter((c) => c.args.fileId === f);

async function bootFiles() {
  const w = await boot({
    handlers: {
      get_file_info: async ({ fileId }) => { if (!INFOS[fileId]) throw new Error("unknown file " + fileId); return INFOS[fileId]; },
      get_file_thumbnail: async ({ fileId }) => THUMB + fileId,
      get_file: async ({ fileId }) => { if (fileId === "f6") throw new Error("read blew up"); return FULL + fileId; },
    },
    channels: CHANNELS, posts: POSTS, users: USERS, me: ME,
  });
  const row = w.qa(".channel-item").find((r) => r.textContent.includes("Town Square"));
  w.fire(row, "click");
  await w.flush();
  return w;
}

test("29: dims known and small (the issue's 333×30 banner) → full image inline, no thumbnail", async () => {
  const w = await bootFiles();

  ok(fileAsked(w, "f1").length >= 1, "get_file pulled for the small banner");
  eq(fileAsked(w, "f1")[0].args.mime, "image/png", "mime passed through");
  ok(!thumbAsked(w, "f1"), "thumbnail NOT fetched for it");
  const att = attOf(w, "p1");
  ok(att.classList.contains("image"), "renders as an image attachment");
  const img = w.q("img", att);
  eq(img.src, FULL + "f1", "inline img holds the FULL data URL");
  eq(img.alt, "banner.png", "alt kept");

  // Click still opens the lightbox with the same full image (uniform behavior).
  w.fire(att, "click");
  await w.flush();
  const overlay = w.q(".lightbox");
  ok(overlay, "lightbox opened from the inlined image");
  eq(w.q("img", overlay).src, FULL + "f1", "lightbox shows the same full image");
});

test("29: dims unknown (FileInfo has none yet) → byte size decides, small = full inline", async () => {
  const w = await bootFiles();

  ok(fileAsked(w, "f2").length >= 1, "get_file pulled for the small-bytes image");
  ok(!thumbAsked(w, "f2"), "no thumbnail roundtrip");
  eq(w.q("img", attOf(w, "p2")).src, FULL + "f2", "full image inlined");
});

test("29: large images stay on the thumbnail path (dims known or not)", async () => {
  const w = await bootFiles();

  for (const [p, f] of [["p3", "f3"], ["p4", "f4"]]) {
    ok(thumbAsked(w, f), `${f}: thumbnail fetched`);
    eq(fileAsked(w, f).length, 0, `${f}: no premature full read`);
    eq(w.q("img", attOf(w, p)).src, THUMB + f, `${f}: inline img holds the thumbnail`);
  }
});

test("29: probe boundaries — max edge exactly at the limit qualifies, one pixel over does not", async () => {
  const w = await bootFiles();

  ok(fileAsked(w, "f7").length >= 1, "480px long edge: dims say small despite the 900 KB size");
  ok(!thumbAsked(w, "f7"), "f7: no thumbnail");
  ok(thumbAsked(w, "f8"), "481px long edge: thumbnail path despite the tiny byte size");
  eq(fileAsked(w, "f8").length, 0, "f8: no full read");
});

test("29: non-image files render the file chip, untouched by the small-image path", async () => {
  const w = await bootFiles();

  const att = attOf(w, "p5");
  ok(att.classList.contains("file-chip"), "pdf renders as a chip");
  ok(!att.classList.contains("image"), "not an image attachment");
  ok(att.textContent.includes("paper.pdf"), "chip names the file");
  eq(thumbAsked(w, "f5"), false, "no thumbnail probe for a pdf");
  eq(fileAsked(w, "f5").length, 0, "no full read for a pdf");
});

test("29: a failing full read falls back to the thumbnail, never breaks rendering", async () => {
  const w = await bootFiles();

  // (>= 1: the resolveUsers repaint rebuilds the bubble — and its attachments.)
  ok(fileAsked(w, "f6").length >= 1, "f6: the full read was attempted (and blew up)");
  ok(thumbAsked(w, "f6"), "thumbnail fetched as the fallback");
  const att = attOf(w, "p6");
  ok(att.classList.contains("image"), "still rendered as an image");
  eq(w.q("img", att).src, THUMB + "f6", "inline img holds the thumbnail after the failure");
});
