/** Prompts shown above the box, one at a time, in order. Edit freely. */
export type Prompt = { title: string; body: string; hint?: string };

export const PROMPTS: Prompt[] = [
  {
    title: "Where do you want to be?",
    body: "Describe the life you want in 5–10 years. Work, place, people, daily rhythm — be concrete and don't filter. Write using complete sentences. Contain one thought in one sentence.",
    hint: "What does a good Tuesday look like? What would make you proud? I want A. I want B. Etc.",
  },
  {
    title: "What are you good at?",
    body: "List skills, knowledge and abilities — formal and informal. Include things others come to you for.",
    hint: "Think of moments where something felt easy to you but hard for others. I can ...",
  },
  {
    title: "What do you have?",
    body: "Resources available to you: money, time, network, location, health, tools, credentials. Focus on things you know are relevant to your career.",
    hint: "I have ...",
  },
  {
    title: "What worries you?",
    body: "Concerns, fears, and things you want to avoid in your career or life.",
    hint: "I don't want ...",
  },
  {
    title: "What drains and energises you?",
    body: "I love... I hate...",
  },
  {
    title: "Constraints & commitments",
    body: "Things that are fixed for now: family, location, obligations, contracts, visas. I need to ...",
  },
];

/** Shown once every prompt has been answered. */
export const FINAL_PROMPT: Prompt = {
  title: "Anything else?",
  body: "That covers the prompts. Keep adding anything you think matters.",
};
