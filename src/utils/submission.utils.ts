import type {
  SubmissionReviewItem,
  SubmittedAnswer,
} from "../types/submission.types";

type ReviewQuestion = {
  id: string;
  text: string;
  order: number;
};

export const isSubmittedAnswerArray = (
  value: unknown,
): value is SubmittedAnswer[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.questionId === "string" &&
      typeof item.answer === "string",
  );

export const buildSubmissionReview = (
  questions: ReviewQuestion[],
  answers: unknown,
): SubmissionReviewItem[] => {
  if (!isSubmittedAnswerArray(answers)) {
    return [];
  }

  const answerMap = new Map(
    answers.map((submittedAnswer) => [
      submittedAnswer.questionId,
      submittedAnswer.answer,
    ]),
  );

  return questions.map((question) => ({
    questionId: question.id,
    question: question.text,
    order: question.order,
    answer: answerMap.get(question.id) ?? "",
  }));
};
