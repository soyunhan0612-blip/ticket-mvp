"use client";

import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ErrorNotice,
  OPS_AGENT_ERROR,
  UnauthorizedNotice,
} from "@/components/admin/admin-query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  FIELD_CLASS_NAMES,
  FIELD_LABEL_CLASS_NAMES,
} from "@/components/ui/TextInput";
import { UnauthorizedError } from "@/lib/api-error";
import { AGENT_QUESTION_LIMIT } from "@/lib/ops-agent";

interface OpsAgentPanelProps {
  /** 빈 문자열이면 전체 공연 */
  showId: string;
}

export function OpsAgentPanel({ showId }: OpsAgentPanelProps): JSX.Element {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerError, setAnswerError] = useState<Error | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const answerAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setAnswer("");
    setAnswerError(null);

    /* 이전 공연 필터로 생성 중인 답변이 새 필터 옆에 남지 않게 한다. */
    return () => answerAbortRef.current?.abort();
  }, [showId]);

  const generateAnswer = useCallback(async () => {
    const normalizedQuestion = question.trim();
    if (normalizedQuestion.length === 0) return;

    const abortController = new AbortController();
    answerAbortRef.current = abortController;

    setIsAnswering(true);
    setAnswer("");
    setAnswerError(null);

    try {
      const response = await fetch("/api/admin/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: normalizedQuestion,
          ...(showId === "" ? {} : { showId }),
        }),
        signal: abortController.signal,
      });

      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok || !response.body) {
        throw new Error(OPS_AGENT_ERROR);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // 필터 변경으로 끊긴 뒤 도착한 조각은 화면에 올리지 않는다.
        if (abortController.signal.aborted) return;
        const chunk = decoder.decode(value, { stream: true });
        received += chunk;
        setAnswer((current) => current + chunk);
      }

      if (abortController.signal.aborted) return;

      const finalChunk = decoder.decode();
      received += finalChunk;
      setAnswer((current) => current + finalChunk);

      if (received.length === 0) {
        throw new Error(OPS_AGENT_ERROR);
      }
    } catch (error) {
      // 사용자가 필터를 바꿔 끊은 것은 실패가 아니다.
      if (abortController.signal.aborted) return;

      setAnswer("");
      setAnswerError(
        error instanceof Error
          ? error
          : new Error(OPS_AGENT_ERROR),
      );
    } finally {
      if (answerAbortRef.current === abortController) {
        answerAbortRef.current = null;
      }
      setIsAnswering(false);
    }
  }, [question, showId]);

  return (
    <section aria-labelledby="ops-agent-heading" className="space-y-xl">
      <header className="space-y-xs">
        <h2 className="text-display-xs" id="ops-agent-heading">
          운영 질문
        </h2>
        <p className="text-body-sm text-mute">
          현재 공연 필터의 서버 집계를 바탕으로 질문에 답합니다.
        </p>
      </header>

      <Card className="space-y-lg" tone="dark">
        <form
          className="space-y-md"
          onSubmit={(event) => {
            event.preventDefault();
            void generateAnswer();
          }}
        >
          <div className="space-y-xs">
            <label
              className={`${FIELD_LABEL_CLASS_NAMES} !text-on-dark`}
              htmlFor="ops-agent-question"
            >
              운영 질문
            </label>
            <textarea
              className={FIELD_CLASS_NAMES}
              id="ops-agent-question"
              maxLength={AGENT_QUESTION_LIMIT}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              value={question}
            />
            {/*
              * 상한을 넘긴 요청도 라우트가 바디를 읽기 전에 레이트리밋
              * 슬롯을 먹는다. 400을 받아 원인 불명의 실패를 보느니
              * 입력 단계에서 막고 남은 글자 수를 보여준다.
              */}
            <p className="text-body-sm text-mute">
              {question.length} / {AGENT_QUESTION_LIMIT}자
            </p>
          </div>

          <Button
            disabled={isAnswering || question.trim().length === 0}
            size="sm"
            type="submit"
            variant="outline-on-dark"
          >
            {isAnswering ? "답변 생성 중..." : "질문 보내기"}
          </Button>
        </form>

        {answerError instanceof UnauthorizedError ? (
          <UnauthorizedNotice />
        ) : answerError ? (
          <ErrorNotice>{answerError.message}</ErrorNotice>
        ) : null}

        {answer && (
          <p className="whitespace-pre-wrap text-body-sm text-on-dark">
            {answer}
          </p>
        )}
      </Card>
    </section>
  );
}
