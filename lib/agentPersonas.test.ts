import { describe, expect, it } from "vitest";
import { loadAgentPersonas, parsePersona } from "@/lib/agentPersonas";

const file = (frontmatter: string, body = "You're a test.") => `---\n${frontmatter}\n---\n\n${body}\n`;
const base = "name: Test\nhandle: test_agent\nuserId: user_abc123\nbio: hi";

describe("parsePersona", () => {
  it("reads the frontmatter as the profile and schedule, the body as the voice", () => {
    expect(parsePersona("t.md", file(`${base}\nlocation: "NYC"\npostsPer2Hours: 4-6\nrepliesPer2Hours: 2\nquietHours: 22:00-06:30\ntimezone: Europe/London`, "# Voice\nBe brief."))).toEqual({
      file: "t.md",
      userId: "user_abc123",
      displayName: "Test",
      handle: "test_agent",
      bio: "hi",
      location: "NYC",
      voice: "# Voice\nBe brief.",
      postsPer2Hours: [4, 6],
      repliesPer2Hours: [2, 2],
      quietHours: [22 * 60, 6 * 60 + 30],
      timeZone: "Europe/London",
    });
  });

  it("defaults to 3-5 posts per 2h, quiet midnight to 9am US Eastern", () => {
    expect(parsePersona("t.md", file(`${base}\nlocation:`))).toMatchObject({
      location: null,
      postsPer2Hours: [3, 5],
      quietHours: [0, 9 * 60],
      timeZone: "America/New_York",
    });
    expect(parsePersona("t.md", file(`${base}\npostsPer2Hours: 4\nrepliesPer2Hours: none\nquietHours: none`)))
      .toMatchObject({ postsPer2Hours: [4, 4], repliesPer2Hours: null, quietHours: null });
  });

  it("names the file and field when something is off", () => {
    expect(() => parsePersona("t.md", "no frontmatter")).toThrow("personas/t.md: must start with");
    expect(() => parsePersona("t.md", file(`${base}\npostsPer2hours: 3-5`))).toThrow('unknown field "postsPer2hours"');
    expect(() => parsePersona("t.md", file(`${base}\npostsPer2Hours: 5-3`))).toThrow("postsPer2Hours");
    expect(() => parsePersona("t.md", file(`${base}\nquietHours: midnight-9`))).toThrow("quietHours");
    expect(() => parsePersona("t.md", file(`${base}\ntimezone: Eastern`))).toThrow('timezone "Eastern"');
    expect(() => parsePersona("t.md", file(base.replace("test_agent", "a")))).toThrow("handle:");
    expect(() => parsePersona("t.md", file(`${base}\nbio: ${"x".repeat(161)}`))).toThrow("bio is 161 chars");
    expect(() => parsePersona("t.md", file(base, ""))).toThrow("personality text");
  });
});

describe("loadAgentPersonas", () => {
  it("loads every file in personas/ (skipping README and _drafts), each posting 3+ per 2h outside midnight–9am ET", () => {
    const personas = loadAgentPersonas();
    expect(personas.map((persona) => persona.handle)).toEqual(["0xdevonchain", "jordy_longs", "macro_rach", "miatrades", "samstacksats"]);
    for (const persona of personas) {
      expect(persona.postsPer2Hours[0]).toBeGreaterThanOrEqual(3);
      expect(persona.quietHours).toEqual([0, 9 * 60]);
      expect(persona.timeZone).toBe("America/New_York");
    }
  });
});
