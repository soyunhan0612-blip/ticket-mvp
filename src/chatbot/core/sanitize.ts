export const USER_INPUT_START = "===USER_INPUT_START===";
export const USER_INPUT_END = "===USER_INPUT_END===";
export const DEFAULT_INPUT_LIMIT = 100;

/*
 * 구분자 리터럴을 지우면 겹쳐 심은 입력에서 제거 후 구분자가 되살아날 수 있다.
 * 줄 구조와 구분자 경계를 지키기 위해 공백류를 먼저 접고 `=` 연속을 하나로
 * 접은 다음, 정리된 결과에 마지막으로 길이 상한을 적용한다.
 */
export function neutralizeInput(
  value: string,
  limit: number = DEFAULT_INPUT_LIMIT,
): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/={2,}/g, "=")
    .trim()
    .slice(0, limit);
}

export function wrapUserInput(
  value: string,
  limit: number = DEFAULT_INPUT_LIMIT,
): string {
  return [
    USER_INPUT_START,
    neutralizeInput(value, limit),
    USER_INPUT_END,
  ].join("\n");
}
