import { z } from "zod";

export const createShowInputSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  posterUrl: z.string().min(1),
  presetId: z.enum(["small", "medium", "large"]),
  /*
   * 회차 시작 시각은 ISO 8601로 잠근다. 이 값은 Session.startsAt이 되어 운영
   * 집계를 타고 AI 요약 프롬프트와 Agent Tool 결과에 그대로 실린다. 자유
   * 문자열을 허용하면 셀러가 여기에 ===USER_INPUT_END=== 를 심어 신뢰 영역을
   * 위조할 수 있다. title과 달리 길이 상한도 중화도 걸리지 않는 자리다.
   */
  sessions: z.array(z.iso.datetime()).min(1).max(10),
});

export type CreateShowInput = z.infer<typeof createShowInputSchema>;
