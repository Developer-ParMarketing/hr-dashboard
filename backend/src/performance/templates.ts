export type AppraisalCriterion = {
  index: number;
  title: string;
  description: string;
};

export type AppraisalTemplate = {
  teamSlug: string;
  teamName: string;
  titleColumn: "Skills" | "Goal Title";
  criteria: AppraisalCriterion[];
};

export const APPRAISAL_RATING_SCALE = [
  { value: 1, label: "Needs Development", note: "" },
  { value: 2, label: "Below Expectations", note: "" },
  { value: 3, label: "Meets Expectations", note: "" },
  { value: 4, label: "Above Par", note: "" },
  { value: 5, label: "Significantly Above Par", note: "" },
] as const;

import { SOCIAL_MEDIA_CRITERIA } from "../criteria/socialMedia.js";
import { CONTENT_CRITERIA } from "../criteria/content.js";

const PRODUCT: AppraisalCriterion[] = [
  {
    index: 1,
    title: "Innovation & User-Centric Solutions",
    description:
      "Approaches briefs & challenges creatively, utilizes data insights to inform solutions, and developes innovative software solutions that address user needs.",
  },
  {
    index: 2,
    title: "Project Management & Analysis",
    description:
      "Effectively plans, prioritizes, and manages assigned tasks, utilizes data to track progress, identify risks, and contributes to ensuring projects meet deadlines and budget constraints.",
  },
  {
    index: 3,
    title: "Technical Proficiency & Execution",
    description:
      "Possesses strong technical expertise in web and app development, implementing best practices to deliver robust and efficient software solutions.",
  },
  {
    index: 4,
    title: "Data-Driven Decision Making",
    description:
      "Maintains high coding standards, advocates for continuous testing and bug identification, and actively participates in improving development processes.",
  },
  {
    index: 5,
    title: "Measurement & Analysis",
    description:
      "Contributes to data-driven decision making by utilizing metrics to evaluate performance, identifying areas for improvement, and suggesting optimizations based on insights.",
  },
  {
    index: 6,
    title: "Timeline Management",
    description:
      "Works effectively within the team to manage assigned tasks, meet deadlines, and proactively communicate potential delays to ensure smooth project execution.",
  },
  {
    index: 7,
    title: "Team Collaboration",
    description:
      "Consistently fosters a collaborative environment by being open to peer feedback, actively listening, sharing knowledge,and supporting teammates to achieve common goals and collaboratively aiming to achieve above par.",
  },
  {
    index: 8,
    title: "Self Initiative",
    description:
      "Consistently identifies opportunities for improvement or innovation in order to deliver above par and takes proactive steps to implement solutions without requiring prompting.",
  },
  {
    index: 9,
    title: "Agility",
    description:
      "Demonstrates agility by adapting to delivering on set timelines, changing priorities, learning new skills quickly, and effectively solving problems in a dynamic environment.",
  },
];

const SEO: AppraisalCriterion[] = [
  {
    index: 1,
    title: "Brand Awareness",
    description:
      "Increase brand visibility, recognition, and recall among target audiences, driving organic and direct traffic growth.",
  },
  {
    index: 2,
    title: "Customer Engagement",
    description:
      "Enhance customer engagement on websites by optimizing content and improving user experience. Foster two-way communication with users based on their behavior, category insights, and trends. Track and boost engagement metrics such as time spent on site, blog interactions (comments, likes, shares).",
  },
  {
    index: 3,
    title: "Measure & Improve",
    description:
      "Measure the effectiveness of SEO efforts through robust metrics (organic traffic, keyword rankings, conversion rates) and implement A/B testing for continuous optimization.",
  },
  {
    index: 4,
    title: "Business contribution",
    description:
      "Increase qualified organic traffic and leads, directly supporting the agency's business growth and revenue targets.",
  },
  {
    index: 5,
    title: "Innovation",
    description: "Plan & develop atleast 1 innovative SEO initiatives in the financial year.",
  },
  {
    index: 6,
    title: "Talent Development",
    description:
      "Support team members professional growth and foster a culture of continuous learning, sharing expertise in advanced SEO, better development and technical skills.",
  },
  {
    index: 7,
    title: "Ownership",
    description:
      "Proactively identify opportunities for improvement and innovation, taking full responsibility for assigned tasks, projects, and outcomes without requiring prompting.",
  },
  {
    index: 8,
    title: "Agility",
    description:
      "Demonstrate adaptability to changing priorities, algorithm updates, and a dynamic environment, ensuring the timely delivery of projects.",
  },
];

const DESIGN: AppraisalCriterion[] = [
  {
    index: 1,
    title: "Concept Development",
    description:
      "Collaborates with the team to ideate and develop innovative marketing campaigns, drawing insights from consumer trends and industry benchmarks.",
  },
  {
    index: 2,
    title: "Creative Execution",
    description:
      "Consistently delivers high-quality, on-brand creative campaigns within budget and deadlines, responsible for managing and supporting the creative team to bring concepts, presentations, and prototypes to life.",
  },
  {
    index: 3,
    title: "Technical Proficiency",
    description:
      "Maintains up-to-date knowledge of design tools and trends, seamlessly integrating them into projects to ensure effectiveness.",
  },
  {
    index: 4,
    title: "Quality Control & Brand Consistency",
    description:
      "Meticulously upholds brand guidelines, ensuring all designs are visually cohesive and reflect brand identity.",
  },
  {
    index: 5,
    title: "Time Management & Adherence",
    description:
      "Effectively prioritizes tasks and manages time efficiently to deliver high-quality work consistently and on time.",
  },
  {
    index: 6,
    title: "Team Collaboration",
    description:
      "Consistently fosters a collaborative environment by being open to peer feedback, actively listening, sharing knowledge,and supporting teammates to achieve common goals and collaboratively aiming to achieve above par.",
  },
  {
    index: 7,
    title: "Self Initiative",
    description:
      "Consistently identifies opportunities for improvement or innovation in order to deliver above par and takes proactive steps to implement solutions.",
  },
  {
    index: 8,
    title: "Agility",
    description:
      "Demonstrates agility by adapting to delivering on set timelines, changing priorities, and effectively solving problems in a dynamic environment.",
  },
];

export const APPRAISAL_TEMPLATES: Record<string, AppraisalTemplate> = {
  product: {
    teamSlug: "product",
    teamName: "Product",
    titleColumn: "Skills",
    criteria: PRODUCT,
  },
  "social-media": {
    teamSlug: "social-media",
    teamName: "Social Media",
    titleColumn: "Goal Title",
    criteria: SOCIAL_MEDIA_CRITERIA,
  },
  seo: {
    teamSlug: "seo",
    teamName: "SEO",
    titleColumn: "Goal Title",
    criteria: SEO,
  },
  content: {
    teamSlug: "content",
    teamName: "Content",
    titleColumn: "Goal Title",
    criteria: CONTENT_CRITERIA,
  },
  design: {
    teamSlug: "design",
    teamName: "Design",
    titleColumn: "Skills",
    criteria: DESIGN,
  },
  "performance-marketing": {
    teamSlug: "performance-marketing",
    teamName: "Performance Marketing",
    titleColumn: "Goal Title",
    criteria: [],
  },
};

export function getAppraisalTemplate(teamSlug: string | null | undefined): AppraisalTemplate | null {
  if (!teamSlug) return null;
  return APPRAISAL_TEMPLATES[teamSlug] ?? null;
}
