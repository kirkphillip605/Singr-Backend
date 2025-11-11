declare module 'problem-json' {
  export type ProblemDocument<T extends Record<string, unknown>> = T & {
    type?: string;
    title: string;
    status: number;
    detail?: string;
    instance?: string;
  };

  export function createProblemDocument<T extends Record<string, unknown>>(
    problem: T,
  ): ProblemDocument<T>;
}
