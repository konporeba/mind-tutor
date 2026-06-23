// Unit tests for the ask-the-tutor message builder (S-05, FR-008).
//
// buildQaMessages is pure — it shapes the grounding system frame, embeds the source,
// includes bounded prior turns, and appends the question. These assertions pin the
// wedge-critical structure (grounding instruction + source injection + refusal rule)
// without any network call.

import { describe, expect, it } from "vitest";
import { buildQaMessages, type QaTurn } from "./answer";

const SOURCE = "Photosynthesis converts light into chemical energy in chloroplasts.";

describe("buildQaMessages", () => {
  it("opens with a system frame carrying the grounding + refusal rules and the source", () => {
    const messages = buildQaMessages(SOURCE, [], "What is photosynthesis?");
    const system = messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("ONLY using facts present in the SOURCE MATERIAL");
    expect(system.content).toContain("cannot find it in their material");
    expect(system.content).toContain("Do not answer from general knowledge");
    expect(system.content).toContain(SOURCE);
  });

  it("appends the new question as the final user message", () => {
    const messages = buildQaMessages(SOURCE, [], "What is photosynthesis?");
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe("What is photosynthesis?");
  });

  it("includes prior turns between the system frame and the new question", () => {
    const prior: QaTurn[] = [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ];
    const messages = buildQaMessages(SOURCE, prior, "follow-up");
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[1].content).toBe("earlier question");
    expect(messages[2].content).toBe("earlier answer");
  });

  it("bounds prior-turn context to the 10 most recent turns", () => {
    const prior: QaTurn[] = Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn ${i}`,
    }));
    const messages = buildQaMessages(SOURCE, prior, "newest");
    // system + 10 recent + new question
    expect(messages).toHaveLength(12);
    expect(messages[1].content).toBe("turn 4");
    expect(messages[messages.length - 1].content).toBe("newest");
  });

  it("caps an oversized source so the prompt stays bounded", () => {
    const huge = "x".repeat(70_000);
    const messages = buildQaMessages(huge, [], "q");
    // 60k cap + the rest of the system scaffolding, but well under the raw 70k.
    expect(messages[0].content.length).toBeLessThan(61_000);
  });
});
