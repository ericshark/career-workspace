// Fictional example posts and the prepared answers that stand in for a model.
import type { ClaudeReviewOutput, QuickJob } from "@/lib/types";
import type { JobBrief } from "@/lib/jobBrief";

type ReviewAnswer = Omit<ClaudeReviewOutput, "suggestedSlug"> & {
  jobBrief: JobBrief;
};

export const QUICK_POSTS = [
  {
    link: "https://example.com/jobs/orchard-systems-backend-engineer",
    marker: "Orchard Systems",
    text: `Backend Engineer, Orchard Systems (fictional example)
New York, NY, hybrid. Posted today. $118,000 to $142,000.

Orchard Systems builds inventory software for independent grocers. You will build Python services, write integration tests, and improve API reliability with a team of six.

Requirements: 1 to 3 years of backend experience, Python, SQL, and REST API design. Docker is a plus.`,
  },
  {
    link: "https://example.com/jobs/lanternfish-product-engineer",
    marker: "Lanternfish Learning",
    text: `Product Engineer, Lanternfish Learning (fictional example)
Remote, United States. Posted yesterday. $110,000 to $130,000.

Lanternfish Learning makes practice tools for community colleges. You will ship features across a TypeScript and React front end and a Node API, and talk with instructors every week.

Requirements: TypeScript, React, and an eye for accessible interfaces. Teaching or tutoring experience is a plus.`,
  },
];

const QUICK_ANSWERS: Record<string, Omit<QuickJob, "job">> = {
  "Orchard Systems": {
    company: "Orchard Systems",
    role: "Backend Engineer",
    location: "New York, NY",
    workMode: "hybrid",
    level: "entry",
    postedText: "Posted today",
    postedDate: "",
    jobId: "",
    link: QUICK_POSTS[0].link,
    jobBrief: {
      overview:
        "Build and maintain Python services for inventory software used by independent grocers.",
      experience: "1 to 3 years of backend experience",
      responsibilities: [
        "Build Python services",
        "Write integration tests",
        "Improve API reliability",
      ],
      qualifications: [
        "Required: Python, SQL and REST API design",
        "Preferred: Docker",
      ],
      location: "New York, NY (hybrid)",
      compensation: "$118,000 to $142,000",
    },
  },
  "Lanternfish Learning": {
    company: "Lanternfish Learning",
    role: "Product Engineer",
    location: "Remote, United States",
    workMode: "remote",
    level: "",
    postedText: "Posted yesterday",
    postedDate: "",
    jobId: "",
    link: QUICK_POSTS[1].link,
    jobBrief: {
      overview:
        "Ship product features across a React front end and a Node API for community college practice tools.",
      experience: "",
      responsibilities: [
        "Build TypeScript and React features",
        "Extend the Node API",
        "Talk with instructors weekly",
      ],
      qualifications: [
        "Required: TypeScript and React",
        "Required: Accessible interface design",
        "Preferred: Teaching experience",
      ],
      location: "Remote, United States",
      compensation: "$110,000 to $130,000",
    },
  },
};

export const REVIEW_POST = {
  link: "https://example.com/jobs/harborlight-labs-platform-engineer",
  text: `Platform Engineer, Harborlight Labs (fictional example)
Boston, MA, hybrid. Posted 2 days ago. $125,000 to $150,000.

Harborlight Labs builds scheduling tools for ferry operators. You will own Python services that plan crews and vessels, keep a PostgreSQL database healthy, and help product teams release safely.

What you will do: build FastAPI services, design PostgreSQL schemas and migrations, write automated tests, and improve our CI/CD pipeline.

Required: Python, PostgreSQL, REST APIs, automated testing. Preferred: OAuth2, Docker, Terraform.`,
};

const PREPARED = "Prepared example, not a live AI result.";

export function reviewAnswer(
  company: string,
  role: string,
  location: string,
  fit: number,
  match: number,
): ReviewAnswer {
  const tailor = fit >= 60 && match < 80;
  return {
    company,
    role,
    location,
    workMode: /remote/i.test(location) ? "remote" : "hybrid",
    level: "entry",
    postedDate: "",
    postedText: "Posted 2 days ago",
    jobId: "",
    decisionBrief: {
      strengths:
        "FastAPI and PostgreSQL projects with automated tests support the core backend work.",
      gaps: "Terraform and production infrastructure work are not in the career profile.",
      resumeAction: tailor
        ? "Tailor: surface the OAuth2 login and migration work that the resume leaves out."
        : "Use the master resume; the main requirements are already prominent.",
    },
    requirements: [
      {
        id: "r1",
        text: "Python API services",
        kind: "must",
        career: "strong",
        careerQuote: "Built a FastAPI service",
        careerSection: "Projects",
        resume: "bullet",
        resumeQuote: "Built a FastAPI service",
        placement: "prominent",
        fix: null,
        terms: ["Python", "FastAPI"],
      },
      {
        id: "r2",
        text: "PostgreSQL schemas and migrations",
        kind: "must",
        career: "strong",
        careerQuote: "PostgreSQL schemas and Alembic migrations",
        careerSection: "Projects",
        resume: "bullet",
        resumeQuote: "PostgreSQL",
        placement: "buried",
        fix: "light",
        terms: ["PostgreSQL"],
      },
      {
        id: "r3",
        text: "Automated testing",
        kind: "must",
        career: "strong",
        careerQuote: "Wrote automated tests with pytest",
        careerSection: "Projects",
        resume: "bullet",
        resumeQuote: "Wrote automated tests with pytest",
        placement: "prominent",
        fix: null,
        terms: ["automated tests"],
      },
      {
        id: "r4",
        text: "OAuth2",
        kind: "nice",
        career: "strong",
        careerQuote: "OAuth2 login",
        careerSection: "Projects",
        resume: "absent",
        resumeQuote: "",
        placement: null,
        fix: "light",
        terms: ["OAuth2"],
      },
      {
        id: "r5",
        text: "Docker",
        kind: "nice",
        career: "partial",
        careerQuote: "Docker for local development",
        careerSection: "Skills",
        resume: "skills",
        resumeQuote: "Docker",
        placement: "buried",
        fix: "light",
        terms: ["Docker"],
      },
      {
        id: "r6",
        text: "Terraform",
        kind: "nice",
        career: "none",
        careerQuote: "",
        careerSection: "",
        resume: "absent",
        resumeQuote: "",
        placement: null,
        fix: null,
        terms: ["Terraform"],
      },
    ],
    fit: {
      score: fit,
      summary: `${PREPARED} Sample backend projects cover the main requirements for this role.`,
    },
    match: {
      score: match,
      summary: `${PREPARED} The sample resume shows the core stack and leaves out some supported work.`,
    },
    recommendation: tailor
      ? {
          kind: "tailor",
          reason:
            "Two supported skills from the profile are missing from the resume.",
        }
      : {
          kind: "use-master",
          reason: "The master resume already shows the main requirements.",
        },
    keywords: [
      "Python",
      "FastAPI",
      "PostgreSQL",
      "OAuth2",
      "Docker",
      "Terraform",
    ],
    gaps: ["Terraform is not documented in the career profile."],
    blockers: [],
    why: [
      "Strong Python, FastAPI and PostgreSQL evidence",
      "Automated testing is documented in completed projects",
      "OAuth2 work supports a preferred requirement",
    ],
    recommendedChanges: [
      {
        action: "surface",
        requirementId: "r4",
        text: "Surface the OAuth2 login work",
      },
      {
        action: "emphasize",
        requirementId: "r2",
        text: "Emphasize PostgreSQL migrations",
      },
    ],
    suggestedResume: "tech",
    jobBrief: {
      overview: `Build and run Python services at ${company}, with ownership of data, tests and releases.`,
      experience: "1 to 3 years of backend experience",
      responsibilities: [
        "Build FastAPI services",
        "Design PostgreSQL schemas and migrations",
        "Write automated tests",
        "Improve CI/CD",
      ],
      qualifications: [
        "Required: Python, PostgreSQL, REST APIs and automated testing",
        "Preferred: OAuth2, Docker and Terraform",
      ],
      location,
      compensation: "$125,000 to $150,000",
    },
  };
}

/** The bundled answer for a bundled post; null for anything else. */
export function preparedAnswer(
  operation: string | undefined,
  prompt: string,
): unknown {
  if (operation === "quick") {
    const blocks = [
      ...prompt.matchAll(/<job number="(\d+)"[^>]*>([\s\S]*?)<\/job>/g),
    ];
    const jobs = blocks.map((block) => {
      const key = Object.keys(QUICK_ANSWERS).find((name) =>
        block[2].includes(name),
      );
      return key ? { ...QUICK_ANSWERS[key], job: Number(block[1]) } : null;
    });
    return jobs.length && jobs.every(Boolean) ? { jobs } : null;
  }
  const post = /<job_post>\s*([\s\S]*?)\s*<\/job_post>/.exec(prompt)?.[1] ?? "";
  if (
    !operation &&
    post.includes("Platform Engineer, Harborlight Labs (fictional example)")
  )
    return reviewAnswer(
      "Harborlight Labs",
      "Platform Engineer",
      "Boston, MA (hybrid)",
      84,
      72,
    );
  return null;
}
