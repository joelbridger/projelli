import { describe, expect, test } from "bun:test";
import { FanoutHub } from "../src/lib/matters.ts";

describe("v2 sync fan-out", () => {
  test("frames and channels contain no route identifiers", () => {
    const hub = new FanoutHub(); const frames: unknown[] = [];
    hub.subscribe("mh2_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { id:"one", user_id:"u", seat_id:"s", send:(f) => frames.push(f) }, "sh2_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    hub.broadcast("mh2_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { type:"update", cursor:1, blob_id:"blob", key_epoch:1, author_seat:"s", created_at:"now", ciphertext_b64:"AA==" }, "sh2_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(frames).toEqual([{ type:"update", cursor:1, blob_id:"blob", key_epoch:1, author_seat:"s", created_at:"now", ciphertext_b64:"AA==" }]);
  });
});
