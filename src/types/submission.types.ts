export type SubmittedAnswer = { questionId: string; answer: string };

export type SubmissionReviewItem = {
  questionId: string;
  question: string;
  order: number;
  answer: string;
};
