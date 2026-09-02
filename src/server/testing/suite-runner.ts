import type { TestSuiteDefinition } from "../../shared/testing/test-suite.js";
import type { TestExecutionStatus } from "../../shared/testing/test-execution.js";

type SuiteTerminalStatus = Extract<
  TestExecutionStatus,
  "PASSED" | "FAILED" | "ERROR" | "CANCELLED" | "INTERRUPTED"
>;

export interface SuiteMemberInvocationResult {
  testExecutionId: string | null;
  status: SuiteTerminalStatus;
}

export interface SuiteRunItem extends SuiteMemberInvocationResult {
  memberId: string;
  testCaseId: string;
  position: number;
}

export interface SuiteRunResult {
  status: SuiteTerminalStatus;
  items: SuiteRunItem[];
}

export interface SuiteRunnerInput {
  members: TestSuiteDefinition["members"];
  concurrency: number;
  stopOnFailure: boolean;
  signal?: AbortSignal;
}

export interface SuiteRunnerDependencies {
  execute(
    member: TestSuiteDefinition["members"][number],
    signal?: AbortSignal,
  ): Promise<SuiteMemberInvocationResult>;
}

function cancelledItem(member: TestSuiteDefinition["members"][number]): SuiteRunItem {
  return {
    memberId: member.id,
    testCaseId: member.testCaseId,
    position: member.position,
    testExecutionId: null,
    status: "CANCELLED",
  };
}

function aggregateStatus(items: readonly SuiteRunItem[], aborted: boolean): SuiteTerminalStatus {
  if (aborted) return "CANCELLED";
  if (items.some(({ status }) => status === "ERROR" || status === "INTERRUPTED")) return "ERROR";
  if (items.some(({ status }) => status === "FAILED")) return "FAILED";
  if (items.some(({ status }) => status === "CANCELLED")) return "CANCELLED";
  return "PASSED";
}

function isFailure(status: SuiteTerminalStatus): boolean {
  return status !== "PASSED";
}

export async function runSuite(
  input: SuiteRunnerInput,
  dependencies: SuiteRunnerDependencies,
): Promise<SuiteRunResult> {
  if (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > 8) {
    throw new Error("Suite concurrency must be an integer between 1 and 8");
  }
  const members = [...input.members.filter(({ isEnabled }) => isEnabled)].sort((left, right) =>
    left.position - right.position || left.id.localeCompare(right.id));
  if (members.length === 0) return { status: "PASSED", items: [] };

  const results = new Map<string, SuiteRunItem>();
  let nextIndex = 0;
  let stopScheduling = input.signal?.aborted === true;

  const worker = async () => {
    while (!stopScheduling) {
      const index = nextIndex;
      if (index >= members.length) return;
      nextIndex += 1;
      const current = members[index]!;
      if (input.signal?.aborted) {
        stopScheduling = true;
        return;
      }
      let invocation: SuiteMemberInvocationResult;
      try {
        invocation = await dependencies.execute(current, input.signal);
      } catch {
        invocation = { testExecutionId: null, status: input.signal?.aborted ? "CANCELLED" : "ERROR" };
      }
      results.set(current.id, {
        memberId: current.id,
        testCaseId: current.testCaseId,
        position: current.position,
        ...invocation,
      });
      if (input.signal?.aborted || (input.stopOnFailure && isFailure(invocation.status))) {
        stopScheduling = true;
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(input.concurrency, members.length) },
    () => worker(),
  ));

  const items = members.map((member) => results.get(member.id) ?? cancelledItem(member));
  return { status: aggregateStatus(items, input.signal?.aborted === true), items };
}
