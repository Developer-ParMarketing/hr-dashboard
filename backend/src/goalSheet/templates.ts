import type { AppraisalCriterion, AppraisalTemplate } from "../performance/templates.js";
import { SOCIAL_MEDIA_CRITERIA } from "../criteria/socialMedia.js";
import { CONTENT_CRITERIA } from "../criteria/content.js";

/**
 * Goal sheet criteria per team - edit this file when HR provides goal parameters.
 * Same team slugs as performance appraisal; criteria can differ.
 */
export type GoalSheetCriterion = AppraisalCriterion;
export type GoalSheetTemplate = AppraisalTemplate;

export const GOAL_SHEET_RATING_SCALE = [
  { value: 1, label: "Needs Development", note: "" },
  { value: 2, label: "Below Expectations", note: "" },
  { value: 3, label: "Meets Expectations", note: "" },
  { value: 4, label: "Above Par", note: "" },
  { value: 5, label: "Significantly Above Par", note: "" },
] as const;


const PRODUCT_GOALS: GoalSheetCriterion[] = [
  {
    index: 1,
    title: "Performance enhancement",
    description:
      "Improve platform performance, efficiency & customer reviews by ensuring ease of access, speed, ease of usage, code optimization, database performance tuning, and system architecture design.",
  },
  {
    index: 2,
    title: "Process improvement support",
    description:
      "Develop & improve platforms for better internal company processes & generate additional source of revenue by whitelabelling the best performing products. Identify bottlenecks and inefficiencies in development workflows and implement process improvements to increase productivity and collaboration.",
  },
  {
    index: 3,
    title: "Measure & Improve",
    description:
      "Recurring measurement, customer feedback, testing and reporting including code quality metrics, bug resolution rates, and delivery timelines, latest update corrections and sales requirements.",
  },
  {
    index: 4,
    title: "Business contribution",
    description:
      "Increase conversion on owned platforms by aligning development priorities with strategic business objectives and client needs, contributing to revenue growth and client satisfaction. Identify opportunities for innovation and differentiation within the agency's product portfolio, leveraging technical expertise to develop solutions that address market demand and drive competitive advantage.",
  },
  {
    index: 5,
    title: "Innovation",
    description:
      "Plan & develop atleast 2 innovative product developments in the year. Foster a culture of innovation within the development team, encouraging experimentation, creativity, and the exploration of new technologies and methodologies. Lead research and development initiatives to explore emerging technologies, trends, and opportunities, identifying innovative solutions that add value to the agency's products and services.",
  },
  {
    index: 6,
    title: "Talent Development",
    description:
      "Support the professional growth and development of the social media team members by setting goals for ongoing training, skill enhancement, and knowledge sharing, fostering a culture of continuous learning and improvement within the team.",
  },
  {
    index: 7,
    title: "Ownership",
    description:
      "Consistently identifies opportunities for improvement or innovation in order to deliver above par and takes proactive steps to implement solutions without requiring prompting by proactively taking responsibility for assigned tasks, projects, and outcomes.",
  },
  {
    index: 8,
    title: "Agility",
    description:
      "Demonstrate agility by adapting to delivering on set timelines, changing priorities, learning new skills quickly, and effectively solving problems in a dynamic environment.",
  },
];

const DESIGN_GOALS: GoalSheetCriterion[] = [
  {
    index: 1,
    title: "Brand Awareness",
    description:
      "Contribute in building brand awareness by developing distinctive brand assets, ensuring the clarity of brand message delivery and comprehension across channels rooted in customer insights measured through creative performance. Monitor brand sentiment and perception through audience feedback and analytics, adjusting creative strategies as needed to enhance brand awareness and reputation.",
  },
  {
    index: 2,
    title: "Customer Engagement",
    description:
      "Collaborate with the social media and content teams to develop creative assets & experiences that encourage active participation and interaction, drive meaningful conversations and connections with customers, fostering brand advocacy and develop a better 2 way communication based on their behaviour and category insights/ trends.",
  },
  {
    index: 3,
    title: "Measure & Improve",
    description:
      "Improve the campaign quality through recurring measurement, testing and reporting. Conduct regular analysis of creative performance data and feedback, identifying areas for improvement and optimization. Implement A/B testing and experimentation to refine creative strategies and tactics, continuously optimizing performance and driving better results.",
  },
  {
    index: 4,
    title: "Business contribution",
    description:
      "Contribute to lead generation by developing creative solutions that support client acquisition and retention efforts, driving measurable business results and client satisfaction.",
  },
  {
    index: 5,
    title: "Innovation",
    description:
      "Plan & develop atleast 2 innovative campaigns in the year. Foster a culture of innovation within the creative team, encouraging experimentation, risk-taking, and the exploration of new ideas and trends. Stay abreast of emerging technologies, design trends, and creative techniques, integrating innovative approaches into creative projects and campaigns. Collaborate cross-functionally with other teams to ideate and develop groundbreaking creative concepts that push the boundaries of traditional marketing and drive innovation within the industry.",
  },
  {
    index: 6,
    title: "Team Collaboration",
    description:
      "Consistently foster a collaborative environment by being open to peer feedback, actively listening, sharing knowledge,and supporting teammates to achieve common goals and collaboratively aiming to achieve above par.",
  },
  {
    index: 7,
    title: "Ownership",
    description:
      "Consistently identifies opportunities for improvement or innovation in order to deliver above par and takes proactive steps to implement solutions without requiring prompting by proactively taking responsibility for assigned tasks, projects, and outcomes.",
  },
  {
    index: 8,
    title: "Agility",
    description:
      "Demonstrate agility by adapting to delivering on set timelines, changing priorities, learning new skills quickly, and effectively solving problems in a dynamic environment.",
  },
];

const PERFORMANCE_MARKETING_GOALS: GoalSheetCriterion[] = [
  {
    index: 1,
    title: "Campaign strategy",
    description:
      "Develop & execute campaign strategies based on specific objectives to achieve performance metrics such as click-through rates (CTR), conversion rates, return on ad spend (ROAS), and cost per acquisition (CPA) targets across various digital marketing channels. Utilize data-driven insights and audience segmentation strategies to optimize campaign targeting, creative implementation and maximize brand exposure to potential customers.",
  },
  {
    index: 2,
    title: "Budget Efficiency",
    description:
      "Reduce the cost per acquisition (CPA) and cost per click (CPC) of performance marketing campaigns through efficient budget allocation, targeting refinement, attribution modelling and ongoing optimization efforts.",
  },
  {
    index: 3,
    title: "Measure & Improve",
    description:
      "Improve the campaign quality through recurring measurement, testing and reporting. Implement a structured testing and optimization process to continuously improve campaign performance, including A/B testing, ad creative testing, audience segmentation, and landing page optimization.",
  },
  {
    index: 4,
    title: "Conversion Rate Optimization",
    description:
      "Improve the conversion rates of performance marketing campaigns by implementing strategies to optimize landing pages, ad creatives, targeting parameters, and other campaign elements.",
  },
  {
    index: 5,
    title: "Innovation",
    description:
      "Plan & develop atleast 2 innovative campaigns in the year for separate brands by exploring new channels, platforms, and strategies, and identifying opportunities for growth and scalability, deliver cutting-edge solutions to clients and a quotable case-study for the team.",
  },
  {
    index: 6,
    title: "Team Collaboration",
    description:
      "Consistently foster a collaborative environment by being open to peer feedback, actively listening, sharing knowledge,and supporting teammates to achieve common goals and collaboratively aiming to achieve above par.",
  },
  {
    index: 7,
    title: "Ownership",
    description:
      "Consistently identifies opportunities for improvement or innovation in order to deliver above par and takes proactive steps to implement solutions without requiring prompting.",
  },
  {
    index: 8,
    title: "Agility",
    description:
      "Demonstrate agility by adapting to delivering on set timelines, changing priorities, learning new skills quickly, and effectively solving problems in a dynamic environment.",
  },
];

const SEO_GOALS: GoalSheetCriterion[] = [
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

/** Goal sheet uses the same Goal Title / Goal Description as performance appraisal for Social Media. */
const SOCIAL_MEDIA_GOALS: GoalSheetCriterion[] = SOCIAL_MEDIA_CRITERIA;

const CONTENT_GOALS: GoalSheetCriterion[] = CONTENT_CRITERIA;

/** Add team goal rows here, e.g. product: { teamSlug, teamName, titleColumn: "Goal Title", criteria: [...] } */
export const GOAL_SHEET_TEMPLATES: Record<string, GoalSheetTemplate> = {
  product: {
    teamSlug: "product",
    teamName: "Product",
    titleColumn: "Goal Title",
    criteria: PRODUCT_GOALS,
  },
  "social-media": {
    teamSlug: "social-media",
    teamName: "Social Media",
    titleColumn: "Goal Title",
    criteria: SOCIAL_MEDIA_GOALS,
  },
  seo: {
    teamSlug: "seo",
    teamName: "SEO",
    titleColumn: "Goal Title",
    criteria: SEO_GOALS,
  },
  content: {
    teamSlug: "content",
    teamName: "Content",
    titleColumn: "Goal Title",
    criteria: CONTENT_GOALS,
  },
  design: {
    teamSlug: "design",
    teamName: "Design",
    titleColumn: "Goal Title",
    criteria: DESIGN_GOALS,
  },
  "performance-marketing": {
    teamSlug: "performance-marketing",
    teamName: "Performance Marketing",
    titleColumn: "Goal Title",
    criteria: PERFORMANCE_MARKETING_GOALS,
  },
};

export function getGoalSheetTemplate(teamSlug: string | null | undefined): GoalSheetTemplate | null {
  if (!teamSlug) return null;
  return GOAL_SHEET_TEMPLATES[teamSlug] ?? null;
}
