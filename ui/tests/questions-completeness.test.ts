import { afterEach, expect, it, vi } from "vitest";
import { answerQuestions } from "@/lib/claude/extras";
const { runAgent } = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock("@/lib/claude/agent", async (original) => ({
  ...(await original<typeof import("@/lib/claude/agent")>()),
  runAgent,
}));
afterEach(() => vi.clearAllMocks());
const answer = (question: string) => ({
  question,
  options: ["One", "Two", "Three"],
  needsUser: "",
});
const inputs = {
  questionsRules: "Ground answers in career facts",
  careerEvidence: "Experience",
};
it("rejects schema-valid output that omits a requested question", async () => {
  runAgent.mockResolvedValue({
    subtype: "success",
    structuredOutput: {
      company: { name: "Example", whatTheyDo: "Software" },
      answers: [answer("Why us?")],
    },
  });
  await expect(
    answerQuestions(
      inputs,
      "Posting",
      ["Why us?", "Why this role?"],
      "gpt-6.1-terra",
    ),
  ).rejects.toThrow(/2.*question|question.*2/i);
});
it("accepts one answer per question box, retaining multipart questions", async () => {
  const questions = ["What did you build?\nWhat was hard?", "Why us?"];
  const result = {
    company: { name: "Example", whatTheyDo: "Software" },
    answers: questions.map(answer),
  };
  runAgent.mockResolvedValue({ subtype: "success", structuredOutput: result });
  await expect(
    answerQuestions(inputs, "Posting", questions, "gpt-6.1-terra"),
  ).resolves.toEqual(result);
});
